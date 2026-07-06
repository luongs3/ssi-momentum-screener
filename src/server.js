// SSI Momentum Screener — Express SSE server
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rankAll, getCorrelatedNews } from './screener.js';
import { getLatestSnapshots, scheduleSnapshots } from './snapshot.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 8803;
const REFRESH_MS = 90_000; // 90s — 13 tickers × 1s = ~13s fetch; 90s gives comfortable headroom

app.use(express.static(path.join(__dirname, '..', 'public')));

// ── Cached state ─────────────────────────────────────────────────────────────
let lastRanking = null;
let lastTs      = null;
const clients   = new Set();

async function refreshRanking() {
  try {
    lastRanking = await rankAll();
    lastTs      = Date.now();
    console.log(`[screener] refreshed ${lastRanking.length} indices at`, new Date(lastTs).toISOString());
    // Broadcast to all connected SSE clients
    const payload = { type: 'rank', data: lastRanking, ts: lastTs };
    for (const send of clients) {
      try { send(payload); } catch {}
    }
  } catch (e) {
    console.error('[screener] refresh error:', e.message);
  }
}

// Initial fetch, then periodic
refreshRanking();
setInterval(refreshRanking, REFRESH_MS);

// ── Routes ────────────────────────────────────────────────────────────────────
app.get('/api/rank', async (req, res) => {
  if (lastRanking) return res.json({ ok: true, data: lastRanking, ts: lastTs });
  try {
    const ranked = await rankAll();
    res.json({ ok: true, data: ranked, ts: Date.now() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/news/:ticker', async (req, res) => {
  try {
    const items = await getCorrelatedNews(req.params.ticker);
    res.json({ ok: true, ticker: req.params.ticker, items });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/snapshots', (req, res) => {
  res.json({ ok: true, data: getLatestSnapshots() });
});

app.get('/sse', (req, res) => {
  res.set({
    'Content-Type':      'text/event-stream',
    'Cache-Control':     'no-cache',
    'Connection':        'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  const send = data => res.write(`data: ${JSON.stringify(data)}\n\n`);

  // Late-joiner: send last known ranking immediately
  if (lastRanking) send({ type: 'rank', data: lastRanking, ts: lastTs });

  clients.add(send);
  req.on('close', () => clients.delete(send));
});

// ── Snapshot cron (hourly) ────────────────────────────────────────────────────
scheduleSnapshots();

app.listen(PORT, () => console.log(`SSI Momentum Screener listening on :${PORT}`));
