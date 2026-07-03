// SignalCourt — server.js
// SSE cockpit + REST API for claim submission and audit docket

import http from 'node:http';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { verifyClaim } from './verifier.js';
import { ReceiptChain } from './receipts.js';
import { ping as sodexPing } from './sodex.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '8803');
const DATA_DIR = join(__dirname, '..', '.signal-court');
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

const CHAIN_PATH = join(DATA_DIR, 'receipts.jsonl');
const DOCKET_PATH = join(DATA_DIR, 'docket.json');
const chain = new ReceiptChain(CHAIN_PATH);

// In-memory state
const state = {
  docket: existsSync(DOCKET_PATH) ? JSON.parse(readFileSync(DOCKET_PATH, 'utf8')) : [],
  running: null, // currently auditing claim id
};

const sseClients = new Set();

function broadcast(type, data) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(msg); } catch { sseClients.delete(res); }
  }
}

function saveDocket() {
  writeFileSync(DOCKET_PATH, JSON.stringify(state.docket, null, 2));
}

// Sample pre-loaded claims for demo (represent what other Wave-3 agents claim)
const DEMO_CLAIMS = [
  {
    id: 'claim-demo-1',
    agent: 'SoSoFlows v3',
    symbol: 'vBTC_vUSDC',
    direction: 'LONG',
    signal_basis: 'BOTH',
    currency: 'BTC',
    note: 'Agent claimed BTC LONG based on ETF inflow momentum + positive SSI trend',
  },
  {
    id: 'claim-demo-2',
    agent: 'earlynotwrong',
    symbol: 'vETH_vUSDC',
    direction: 'SHORT',
    signal_basis: 'NEWS',
    currency: 'ETH',
    note: 'Contrarian agent claimed ETH SHORT citing bearish sentiment signals',
  },
  {
    id: 'claim-demo-3',
    agent: 'lenitnes',
    symbol: 'vSOL_vUSDC',
    direction: 'LONG',
    signal_basis: 'NEWS',
    currency: 'SOL',
    note: 'News-driven: claimed SOL LONG based on ecosystem news sentiment',
  },
];

async function auditClaim(claim) {
  state.running = claim.id;
  broadcast('state', { running: claim.id, phase: 'AUDITING' });

  chain.add('claim_received', { claimId: claim.id, agent: claim.agent, symbol: claim.symbol, direction: claim.direction });

  const result = await verifyClaim(claim, {
    events: (type, data) => {
      broadcast(type, data);
      if (type === 'step') {
        chain.add('audit_step', { claimId: claim.id, ...data });
      }
    },
  });

  // Add to docket
  const entry = { ...result, receipt: chain.add('verdict', result) };
  const existing = state.docket.findIndex(d => d.claimId === claim.id);
  if (existing >= 0) state.docket[existing] = entry;
  else state.docket.unshift(entry);
  saveDocket();

  state.running = null;
  broadcast('state', { running: null, phase: 'IDLE', docket: state.docket.slice(0, 10) });
  broadcast('verdict', entry);
  return entry;
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); } catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // ── GET / — cockpit HTML ──────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/') {
    const html = readFileSync(join(__dirname, '..', 'public', 'cockpit.html'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
    return;
  }

  // ── GET /events — SSE stream ──────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    sseClients.add(res);
    // Send current state to late-joiner
    res.write(`event: state\ndata: ${JSON.stringify({ running: state.running, phase: state.running ? 'AUDITING' : 'IDLE', docket: state.docket.slice(0, 10) })}\n\n`);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  // ── GET /api/state ────────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/api/state') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ running: state.running, docket: state.docket }));
    return;
  }

  // ── GET /api/receipts ─────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/api/receipts') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ receipts: chain.all(), verify: chain.verify() }));
    return;
  }

  // ── GET /api/demo-claims ──────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/api/demo-claims') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(DEMO_CLAIMS));
    return;
  }

  // ── GET /api/health ───────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/api/health') {
    const sodex = await sodexPing();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, sodex, receipts: chain.all().length, docket: state.docket.length }));
    return;
  }

  // ── POST /api/claims — submit a claim for audit ───────────────────────
  if (req.method === 'POST' && url.pathname === '/api/claims') {
    if (state.running) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Audit already in progress', running: state.running }));
      return;
    }
    try {
      const body = await parseBody(req);
      const claim = {
        id: body.id || `claim-${randomBytes(4).toString('hex')}`,
        agent: body.agent || 'Anonymous',
        symbol: body.symbol || 'vBTC_vUSDC',
        direction: body.direction || 'LONG',
        signal_basis: body.signal_basis || 'NEWS',
        currency: body.currency,
        indexId: body.indexId,
        note: body.note,
        submittedAt: Date.now(),
      };
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ accepted: true, claimId: claim.id }));
      // Audit in background
      auditClaim(claim).catch(e => {
        state.running = null;
        broadcast('error', { msg: e.message });
      });
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ── POST /api/audit-demo — run a preset demo claim ───────────────────
  if (req.method === 'POST' && url.pathname === '/api/audit-demo') {
    if (state.running) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Audit already in progress' }));
      return;
    }
    const body = await parseBody(req).catch(() => ({}));
    const idx = parseInt(body.index ?? '0');
    const claim = { ...DEMO_CLAIMS[idx % DEMO_CLAIMS.length], submittedAt: Date.now() };
    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ accepted: true, claimId: claim.id }));
    auditClaim(claim).catch(e => {
      state.running = null;
      broadcast('error', { msg: e.message });
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found', path: url.pathname }));
});

server.listen(PORT, () => {
  console.log(`SignalCourt cockpit → http://localhost:${PORT}`);
  console.log(`Health: http://localhost:${PORT}/api/health`);
  console.log('SSE: /events  |  Submit claim: POST /api/claims  |  Demo: POST /api/audit-demo');
});

export { server };
