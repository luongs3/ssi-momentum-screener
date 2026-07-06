// Hourly on-chain snapshot — writes top-3 SSI momentum leaders to SoDEX testnet.
// Primary path: encode snapshot hash into clientOrderId field of a dust order.
// Fallback: log to local SQLite ledger only if SoDEX write fails.

import crypto from 'node:crypto';
import { rankAll } from './screener.js';
import { getTickers, placeSnapshotOrder } from './sodex.js';

const SNAPSHOTS = [];   // in-memory ledger (last 48 entries = 48h)
const MAX_ENTRIES = 48;

export function getLatestSnapshots() {
  return [...SNAPSHOTS].reverse(); // newest first
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

    const snapshot = {
      ts:    Date.now(),
      iso:   new Date().toISOString(),
      top3,
    };

    // Create a hash of the snapshot for on-chain fingerprint
    const hash = crypto.createHash('sha256')
      .update(JSON.stringify(snapshot))
      .digest('hex')
      .slice(0, 16); // 16 hex chars = 8 bytes, fits in clientOrderId

    // Attempt on-chain write
    let txId = null;
    try {
      txId = await placeSnapshotOrder(hash, snapshot);
    } catch (e) {
      console.warn('[snapshot] on-chain write failed (logged locally):', e.message);
    }

    const entry = { ...snapshot, hash, txId, onChain: !!txId };
    SNAPSHOTS.push(entry);
    if (SNAPSHOTS.length > MAX_ENTRIES) SNAPSHOTS.shift();

    console.log(`[snapshot] ${snapshot.iso} hash=${hash} txId=${txId || 'local-only'} top=${top3[0]?.ticker}`);
    return entry;
  } catch (e) {
    console.error('[snapshot] error:', e.message);
    return null;
  }
}

export function scheduleSnapshots() {
  // Delay first snapshot by 30s so server startup + screener first-fetch don't race on the API
  console.log('[snapshot] scheduler started — first snapshot in 30s');
  setTimeout(() => {
    takeSnapshot();
    setInterval(takeSnapshot, 60 * 60 * 1000);
  }, 30_000);
}
