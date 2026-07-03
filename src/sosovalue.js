// SoSoValue API client — corrected endpoints (verified live 2026-07-03)
// Base: https://openapi.sosovalue.com/openapi/v1
// Auth: x-soso-api-key header
// Docs: https://sosovalue.gitbook.io/soso-value-api-doc/

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const SOSOVALUE_BASE = process.env.SOSOVALUE_BASE_URL || 'https://openapi.sosovalue.com/openapi/v1';

export function apiKey() {
  if (process.env.SOSOVALUE_API_KEY) return process.env.SOSOVALUE_API_KEY.trim();
  try {
    const raw = readFileSync(join(homedir(), '.config', 'me-secrets', 'sosovalue.txt'), 'utf8');
    const m = raw.match(/\S+/);
    if (m) return m[0];
  } catch { /* fall through */ }
  return null;
}

async function sosoFetch(path, params = {}) {
  const url = new URL(SOSOVALUE_BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  }
  const key = apiKey();
  const headers = { 'Accept': 'application/json' };
  if (key) headers['x-soso-api-key'] = key;

  const res = await fetch(url.toString(), { headers });
  if (!res.ok) throw new Error(`SoSoValue ${path} → HTTP ${res.status}`);
  const body = await res.json();
  if (body.code !== 0) throw new Error(`SoSoValue ${path} → code ${body.code}: ${JSON.stringify(body).slice(0, 100)}`);
  return body.data;
}

// ── 6.1 News Feed ──────────────────────────────────────────────────────────
// GET /news
// category: 1=news, 2=research, 3=institution, 4=insights/KOL, 7=announcement, 13=crypto-stock
export async function getNewsFeed({ pageSize = 20, page = 1, category, currencyId, startTime, endTime } = {}) {
  const data = await sosoFetch('/news', { page, page_size: pageSize, category, currency_id: currencyId, start_time: startTime, end_time: endTime });
  // Response: { page, page_size, total, list: [...] }
  return Array.isArray(data) ? data : (data?.list || []);
}

// ── 6.3 Featured News — uses standard /news with category filter ────────────
export async function getFeaturedNews({ pageSize = 10, currencyId } = {}) {
  // Featured/hot news: try category=4 (KOL insights) which tends to be high signal
  return getNewsFeed({ pageSize, category: 1, currencyId });
}

// ── 3.1 Index List ─────────────────────────────────────────────────────────
// GET /indices → returns array of ticker strings e.g. ['ssiDeFi','ssiMAG7',...]
export async function getIndexList() {
  return sosoFetch('/indices');
}

// ── 3.3 Index Market Snapshot ──────────────────────────────────────────────
// GET /indices/{ticker}/market-snapshot
// ticker e.g. "ssiMAG7", "ssiLayer1", "ssiAI", "ssimag7"
export async function getIndexSnapshot(ticker) {
  if (!ticker) ticker = 'ssiMAG7';
  return sosoFetch(`/indices/${ticker}/market-snapshot`);
}

// ── 3.4 Index Historical Klines ────────────────────────────────────────────
export async function getIndexKlines(ticker, { interval = '1D', limit = 30 } = {}) {
  if (!ticker) ticker = 'ssiMAG7';
  return sosoFetch(`/indices/${ticker}/klines`, { interval, limit });
}

// ── 1.3 Market Snapshot ────────────────────────────────────────────────────
export async function getMarketSnapshot(currency) {
  return sosoFetch('/currencies/snapshot', { currency });
}

// ── Sentiment summarizer ────────────────────────────────────────────────────
export function summarizeSentiment(newsItems, { currency } = {}) {
  if (!newsItems || !newsItems.length) return { sentiment: 'NEUTRAL', score: 0, count: 0, items: [] };

  const relevant = currency
    ? newsItems.filter(n => {
        const text = (n.title || '') + ' ' + (n.content || '') + ' ' +
          JSON.stringify(n.matched_currencies || []);
        return text.toLowerCase().includes(currency.toLowerCase());
      })
    : newsItems;

  const BULLISH = /bullish|surge|soar|rally|ath|breakout|adoption|institutional|etf\s+inflow|approval|accumulate|bull\s+run|record\s+high/i;
  const BEARISH = /bearish|crash|plunge|sell.?off|dump|bear|liquidat|outflow|ban|hack|exploit|decline|plummet|collapse/i;

  let score = 0;
  for (const item of relevant) {
    const text = (item.title || '') + ' ' + (item.content || '').replace(/<[^>]+>/g, ' ');
    if (BULLISH.test(text)) score += 1;
    if (BEARISH.test(text)) score -= 1;
  }

  const sentiment = score > 0 ? 'BULLISH' : score < 0 ? 'BEARISH' : 'NEUTRAL';
  return {
    sentiment,
    score,
    count: relevant.length,
    items: relevant.slice(0, 5).map(n => ({ title: n.title, release_time: n.release_time })),
  };
}

// ── Best index ticker for a symbol/currency ────────────────────────────────
export function pickIndexTicker(currency) {
  const c = (currency || '').toUpperCase();
  if (c === 'BTC') return 'ssiMAG7';      // BTC is dominant in MAG7
  if (c === 'ETH') return 'ssiLayer1';
  if (c === 'SOL') return 'ssiLayer1';
  if (['AAVE','UNI','COMP'].includes(c)) return 'ssiDeFi';
  if (['AI16Z','FET','TAO'].includes(c)) return 'ssiAI';
  if (['IMX','AXS','GALA'].includes(c)) return 'ssiGameFi';
  return 'ssiMAG7'; // broad default
}
