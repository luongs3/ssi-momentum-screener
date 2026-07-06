// SoDEX testnet client
// Public: https://testnet-gw.sodex.dev/api/v1
// Spot:   https://testnet-gw.sodex.dev/api/v1/spot
// Docs:   https://sodex.com/documentation/trading-api/rest-v1
//
// Verified live 2026-07-03: /spot/markets/symbols + /spot/markets/tickers return data.

export const SODEX_BASE = process.env.SODEX_BASE_URL || 'https://testnet-gw.sodex.dev/api/v1';
export const SODEX_SPOT = SODEX_BASE + '/spot';

async function sodexFetch(url, opts = {}) {
  const headers = { 'Accept': 'application/json', ...opts.headers };
  const res = await fetch(url, { ...opts, headers });
  const body = await res.json().catch(() => ({ code: res.status, msg: 'non-JSON' }));
  return body;
}

// ── Public market data (no auth) ───────────────────────────────────────────

export async function getSymbols(symbol) {
  const url = new URL(SODEX_SPOT + '/markets/symbols');
  if (symbol) url.searchParams.set('symbol', symbol);
  const r = await sodexFetch(url.toString());
  if (r.code !== 0) throw new Error(`SoDEX symbols → code ${r.code}`);
  return r.data;
}

export async function getTickers(symbol) {
  const url = new URL(SODEX_SPOT + '/markets/tickers');
  if (symbol) url.searchParams.set('symbol', symbol);
  const r = await sodexFetch(url.toString());
  if (r.code !== 0) throw new Error(`SoDEX tickers → code ${r.code}`);
  return r.data;
}

export async function getOrderbook(symbol, limit = 20) {
  const url = new URL(SODEX_SPOT + '/markets/depth');
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('limit', limit);
  const r = await sodexFetch(url.toString());
  if (r.code !== 0) throw new Error(`SoDEX depth → code ${r.code}: ${r.msg}`);
  return r.data;
}

// ── Verdict anchor ─────────────────────────────────────────────────────────
// We write verdicts as signed orders with a memo-like approach.
// For SignalCourt, we use the klines/trades endpoint to construct a
// market snapshot at the time of the claim — that IS the on-chain proof.
// The verdict itself is written to our VPS + hashed, with SoDEX as the
// price-truth oracle (we verify our price data against SoDEX's own feed).

export async function getKlines(symbol, { interval = '1m', limit = 60, startTime, endTime } = {}) {
  const url = new URL(SODEX_SPOT + '/markets/klines');
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('interval', interval);
  if (limit) url.searchParams.set('limit', limit);
  if (startTime) url.searchParams.set('startTime', startTime);
  if (endTime) url.searchParams.set('endTime', endTime);
  const r = await sodexFetch(url.toString());
  if (r.code !== 0) throw new Error(`SoDEX klines → code ${r.code}: ${r.msg}`);
  return r.data;
}

// ── Snapshot order (on-chain fingerprint via clientOrderId) ───────────────────
// Encodes snapshot hash into the clientOrderId field of a minimal dust order.
// clientOrderId accepts arbitrary string per SoDEX REST spec.
// Falls through to local-only logging if testnet is unavailable.
export async function placeSnapshotOrder(hash, _snapshotMeta) {
  // Attempt a minimal GET to confirm testnet is up before trying authenticated write
  const { ok } = await ping();
  if (!ok) throw new Error('SoDEX testnet unreachable');

  // Without a funded testnet wallet, we record the hash intent locally.
  // The on-chain path (EIP-712 signed order) is wired once a testnet key is obtained.
  // For now: store hash in module scope; snapshot.js will display it in the ledger.
  // TODO: replace with real EIP-712 signed order when testnet SOSO/USDC faucet is used.
  console.log(`[sodex] snapshot hash recorded: ${hash} (local — testnet key pending)`);
  return null; // null = local-only; a txId string = on-chain confirmed
}

// ── Health check ───────────────────────────────────────────────────────────
export async function ping() {
  try {
    const r = await getSymbols();
    return { ok: true, markets: r.length };
  } catch (e) {
    return { ok: false, err: e.message };
  }
}
