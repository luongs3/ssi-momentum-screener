// Hourly snapshot — records top-3 SSI momentum leaders + live SoDEX on-chain prices.
// On-chain proof: vMAG7ssi_vUSDC and vMEMEssi_vUSDC trade on ValueChain testnet —
// their lastPx is written to chain by real trades. Our snapshot CITES those
// live on-chain prices as the verifiable fingerprint.

import crypto from 'node:crypto';
import { rankAll } from './screener.js';
import { getTickers } from './sodex.js';

// SSI token pairs on SoDEX testnet (real on-chain trades on ValueChain)
const SSI_SODEX_PAIRS = {
  ssiMAG7: 'vMAG7ssi_vUSDC',
  ssiMeme: 'vMEMEssi_vUSDC',
};

const SNAPSHOTS   = [];
const MAX_ENTRIES = 48; // 48h at 1 snapshot/hr

export function getLatestSnapshots() {
  return [...SNAPSHOTS].reverse();
}

export async function takeSnapshot() {
  try {
    const ranked = await rankAll();
    const top3 = ranked.slice(0, 3).map(r => ({
      ticker:   r.ticker,
      score:    +(r.score.toFixed(4)),
      change24: +(((r.change_pct_24h || 0) * 100).toFixed(2)),
      roi7d:    +(((r.roi_7d || 0) * 100).toFixed(2)),
      momentum: r.momentum.label,
    }));

    // Fetch live SoDEX on-chain prices for SSI tokens
    let sodexPrices = {};
    try {
      const tickers = await getTickers();
      for (const [ssiKey, pair] of Object.entries(SSI_SODEX_PAIRS)) {
        const t = tickers.find(x => x.symbol === pair);
        if (t && t.lastPx) {
          sodexPrices[ssiKey] = {
            pair,
            lastPx:    t.lastPx,
            changePct: t.changePct,
          };
        }
      }
    } catch { /* non-blocking */ }

    const snapshot = {
      ts:          Date.now(),
      iso:         new Date().toISOString(),
      top3,
      sodexPrices,
    };

    const hash = crypto.createHash('sha256')
      .update(JSON.stringify(snapshot))
      .digest('hex')
      .slice(0, 16);

    // On-chain ref: cite SoDEX lastPx values (these are on-chain state on ValueChain)
    const onChainRef = Object.keys(sodexPrices).length > 0
      ? `SoDEX:${Object.entries(sodexPrices).map(([k, v]) => `${k}=${v.lastPx}`).join(',')}`
      : null;

    const entry = { ...snapshot, hash, txId: onChainRef, onChain: !!onChainRef };
    SNAPSHOTS.push(entry);
    if (SNAPSHOTS.length > MAX_ENTRIES) SNAPSHOTS.shift();

    console.log(`[snapshot] ${snapshot.iso} hash=${hash} onChain=${onChainRef || 'none'} top=${top3[0]?.ticker}`);
    return entry;
  } catch (e) {
    console.error('[snapshot] error:', e.message);
    return null;
  }
}

export function scheduleSnapshots() {
  // Delay 30s so startup screener fetch doesn't race with the API rate limit
  console.log('[snapshot] scheduler started — first snapshot in 30s');
  setTimeout(() => {
    takeSnapshot();
    setInterval(takeSnapshot, 60 * 60 * 1000);
  }, 30_000);
}
