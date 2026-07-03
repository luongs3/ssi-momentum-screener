// SoSoValue API client
// Base: https://openapi.sosovalue.com/openapi/v1
// Auth: x-soso-api-key header (key in env or ~/.config/me-secrets/sosovalue.txt)
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
  return null; // graceful — some endpoints may work without key
}

async function sosoFetch(path, params = {}) {
  const url = new URL(SOSOVALUE_BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, v);
  }
  const key = apiKey();
  const headers = { 'Accept': 'application/json', 'Content-Type': 'application/json' };
  if (key) headers['x-soso-api-key'] = key;

  const res = await fetch(url.toString(), { headers });
  if (!res.ok) throw new Error(`SoSoValue ${path} → HTTP ${res.status}`);
  const body = await res.json();
  if (body.code !== 0) throw new Error(`SoSoValue ${path} → code ${body.code}: ${body.msg || JSON.stringify(body)}`);
  return body.data;
}

// ── 6.1 News Feed ──────────────────────────────────────────────────────────
// Returns recent crypto news items
export async function getNewsFeed({ limit = 20, currency } = {}) {
  return sosoFetch('/news/feeds', { limit, currency });
}

// ── 6.3 Featured News ──────────────────────────────────────────────────────
// High-signal curated news
export async function getFeaturedNews({ limit = 10, currency } = {}) {
  return sosoFetch('/news/featured', { limit, currency });
}

// ── 3.3 Index Market Snapshot ──────────────────────────────────────────────
// Current SSI index value + composition
export async function getIndexSnapshot({ indexId } = {}) {
  return sosoFetch('/index/snapshot', { indexId });
}

// ── 3.1 Index List ─────────────────────────────────────────────────────────
export async function getIndexList() {
  return sosoFetch('/index/list');
}

// ── 3.4 Index Historical Klines ────────────────────────────────────────────
export async function getIndexKlines({ indexId, interval = '1d', limit = 30 } = {}) {
  return sosoFetch('/index/klines', { indexId, interval, limit });
}

// ── 1.3 Market Snapshot ────────────────────────────────────────────────────
export async function getMarketSnapshot({ currency } = {}) {
  return sosoFetch('/currency/snapshot', { currency });
}

// ── Sentiment summarizer ────────────────────────────────────────────────────
// Summarizes news into a simple sentiment signal
export function summarizeSentiment(newsItems, { currency } = {}) {
  if (!newsItems || !newsItems.length) return { sentiment: 'NEUTRAL', score: 0, count: 0, items: [] };

  const relevant = currency
    ? newsItems.filter(n => {
        const text = (n.title || '') + ' ' + (n.summary || '') + ' ' + JSON.stringify(n.currencies || []);
        return text.toLowerCase().includes(currency.toLowerCase());
      })
    : newsItems;

  const BULLISH = /bullish|surge|soar|rally|ath|breakout|adoption|institutional|etf\s+inflow|approval|accumulate/i;
  const BEARISH = /bearish|crash|plunge|sell.?off|dump|bear|liquidat|outflow|ban|hack|exploit|decline/i;

  let score = 0;
  for (const item of relevant) {
    const text = (item.title || '') + ' ' + (item.summary || '');
    if (BULLISH.test(text)) score += 1;
    if (BEARISH.test(text)) score -= 1;
  }

  const sentiment = score > 0 ? 'BULLISH' : score < 0 ? 'BEARISH' : 'NEUTRAL';
  return { sentiment, score, count: relevant.length, items: relevant.slice(0, 5) };
}
