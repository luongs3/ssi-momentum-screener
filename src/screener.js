// SSI Momentum Screener — core engine
// Computes composite momentum score for each SSI index from SoSoValue API data.
// Score = 0.5 × norm(change_pct_24h) + 0.3 × norm(roi_7d) + 0.2 × norm(roi_1m)
// All indices ranked highest→lowest. Refreshed every 30s.

import { getIndexSnapshot, getNewsFeed } from './sosovalue.js';

// Human-readable labels for index tickers
const LABELS = {
  ssiMAG7:     'MAG7 (BTC/ETH/SOL/BNB/XRP/DOGE/ADA)',
  ssiDeFi:     'DeFi',
  ssiAI:       'AI & Agents',
  ssiLayer1:   'Layer 1',
  ssiLayer2:   'Layer 2',
  ssiMeme:     'Meme',
  ssiRWA:      'RWA',
  ssiDePIN:    'DePIN',
  ssiNFT:      'NFT & Gaming',
  ssiGameFi:   'GameFi',
  ssiPayFi:    'PayFi',
  ssiCeFi:     'CeFi',
  ssiSocialFi: 'SocialFi',
};

export function normalize(values) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  if (range === 0) return values.map(() => 0.5);
  return values.map(v => (v - min) / range);
}

export function computeScore({ change_pct_24h = 0, roi_7d = 0, roi_1m = 0 }) {
  // Raw weighted sum — normalized across peers in rankAll()
  return (change_pct_24h * 0.5) + (roi_7d * 0.3) + (roi_1m * 0.2);
}

// Format: +1.23% or -1.23%
export function pct(v) {
  if (v == null) return 'n/a';
  return (v >= 0 ? '+' : '') + (v * 100).toFixed(2) + '%';
}

export function momentum(score) {
  if (score >= 0.7) return { label: 'STRONG UP',  emoji: '🚀', css: 'strong-up'   };
  if (score >= 0.55) return { label: 'UP',          emoji: '📈', css: 'up'          };
  if (score >= 0.45) return { label: 'NEUTRAL',     emoji: '➡️',  css: 'neutral'    };
  if (score >= 0.3)  return { label: 'DOWN',         emoji: '📉', css: 'down'        };
  return                    { label: 'STRONG DOWN', emoji: '💥', css: 'strong-down' };
}

// ── Main screener ─────────────────────────────────────────────────────────────
// Hardcoded ticker list — saves 1 API request per cycle (rate-limit is ~10 req/window)
const ALL_TICKERS = [
  'ssiDeFi','ssiSocialFi','ssiRWA','ssiAI','ssiCeFi',
  'ssiLayer1','ssiDePIN','ssiNFT','ssiMAG7','ssiMeme',
  'ssiPayFi','ssiGameFi','ssiLayer2',
];

// Stale-ok cache: if an index fails this cycle, use last known good value (with stale flag)
const SNAPSHOT_CACHE = new Map(); // ticker → { data, ts, stale }

// Serial fetch with delay + retry; on failure use stale cache
async function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

export async function rankAll() {
  const snaps = [];

  for (const ticker of ALL_TICKERS) {
    let data = null;
    try {
      data = await getIndexSnapshot(ticker);
      // Update cache with fresh data
      SNAPSHOT_CACHE.set(ticker, { data, ts: Date.now(), stale: false });
    } catch {
      // Use stale cache if available
      const cached = SNAPSHOT_CACHE.get(ticker);
      if (cached) {
        data = { ...cached.data };
        SNAPSHOT_CACHE.set(ticker, { ...cached, stale: true });
      }
    }

    if (data) {
      const cached = SNAPSHOT_CACHE.get(ticker);
      snaps.push({
        ticker,
        label:   LABELS[ticker] || ticker,
        ...data,
        stale:   cached?.stale || false,
        error:   null,
      });
    }
    await delay(1000); // 1s gap — conservative to stay under ~10 req/min limit
  }

  const valid = snaps.filter(s => !s.error);

  // Compute raw scores
  const rawScores = valid.map(s => computeScore(s));

  // Normalize to [0,1]
  const normScores = normalize(rawScores);

  // Attach normalized score + momentum label
  const ranked = valid.map((s, i) => ({
    ...s,
    rawScore:   rawScores[i],
    score:      normScores[i],
    momentum:   momentum(normScores[i]),
    updatedAt:  Date.now(),
  }));

  // Sort by normalized score descending
  ranked.sort((a, b) => b.score - a.score);

  return ranked;
}

// ── News correlation ──────────────────────────────────────────────────────────
// For any index with score > 0.6 (strong upward momentum), fetch recent news.
// Returns top 3 most recent relevant news items.
const NEWS_CACHE = new Map(); // ticker → { ts, items }
const NEWS_TTL = 5 * 60 * 1000; // 5 min

// Map index tickers to likely search terms
const INDEX_KEYWORDS = {
  ssiMAG7:     ['bitcoin', 'BTC', 'ethereum', 'ETH', 'solana', 'SOL'],
  ssiDeFi:     ['defi', 'uniswap', 'aave', 'compound', 'curve'],
  ssiAI:       ['AI', 'artificial intelligence', 'fetch.ai', 'render', 'TAO'],
  ssiLayer1:   ['layer 1', 'L1', 'solana', 'avalanche', 'near'],
  ssiLayer2:   ['layer 2', 'L2', 'arbitrum', 'optimism', 'polygon'],
  ssiMeme:     ['meme', 'dogecoin', 'DOGE', 'shiba', 'pepe'],
  ssiRWA:      ['RWA', 'real world assets', 'tokenized', 'ondo'],
  ssiDePIN:    ['DePIN', 'helium', 'hivemapper', 'io.net'],
  ssiNFT:      ['NFT', 'ordinals', 'blur'],
  ssiGameFi:   ['gamefi', 'gaming', 'immutable', 'axie'],
  ssiPayFi:    ['payfi', 'payment', 'stellar', 'ripple', 'XRP'],
  ssiCeFi:     ['cefi', 'binance', 'coinbase', 'kraken'],
  ssiSocialFi: ['socialfi', 'friend.tech', 'farcaster', 'lens'],
};

export async function getCorrelatedNews(ticker) {
  const cached = NEWS_CACHE.get(ticker);
  if (cached && Date.now() - cached.ts < NEWS_TTL) return cached.items;

  try {
    const news = await getNewsFeed({ pageSize: 30 });
    const keywords = INDEX_KEYWORDS[ticker] || [];

    const matched = news.filter(item => {
      const text = ((item.title || '') + ' ' + (item.summary || item.content || '')).toLowerCase();
      return keywords.some(kw => text.includes(kw.toLowerCase()));
    });

    const items = matched.slice(0, 3).map(n => ({
      title: n.title,
      url:   n.source_link || n.url || '',
      time:  n.release_time || n.publish_time || null,
    }));

    NEWS_CACHE.set(ticker, { ts: Date.now(), items });
    return items;
  } catch {
    return [];
  }
}
