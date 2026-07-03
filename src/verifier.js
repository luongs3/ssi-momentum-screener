// SignalCourt — verifier.js
// Core logic: take a claim, reconstruct the SoSoValue data context,
// produce a CONFIRMED / DISPUTED / UNPROVABLE verdict.
//
// A "claim" is:
//   { id, agent, symbol, direction: "LONG"|"SHORT", signal_basis: "NEWS"|"INDEX"|"BOTH",
//     currency?: string, indexId?: string, submittedAt: ms-timestamp }
//
// Verdict:
//   CONFIRMED  — SoSoValue data at submission time supports the claimed direction
//   DISPUTED   — SoSoValue data contradicts the claimed direction
//   UNPROVABLE — insufficient data to reconstruct (old timestamp, no API key, etc.)

import { getNewsFeed, getFeaturedNews, getIndexSnapshot, getIndexList, getMarketSnapshot, summarizeSentiment } from './sosovalue.js';
import { getTickers } from './sodex.js';

export async function verifyClaim(claim, { events } = {}) {
  const emit = (type, data) => { if (events) events(type, data); };

  emit('step', { step: 'INGEST', msg: `Auditing claim ${claim.id} from agent "${claim.agent}"` });
  emit('step', { step: 'INGEST', msg: `Claimed: ${claim.direction} ${claim.symbol} based on ${claim.signal_basis}` });

  const evidence = {};
  const warnings = [];

  // ── Step 1: SoSoValue News ─────────────────────────────────────────────
  if (claim.signal_basis === 'NEWS' || claim.signal_basis === 'BOTH') {
    emit('step', { step: 'SOSOVALUE_NEWS', msg: 'Fetching SoSoValue news feed...' });
    try {
      const [feed, featured] = await Promise.all([
        getNewsFeed({ limit: 30, currency: claim.currency }),
        getFeaturedNews({ limit: 10, currency: claim.currency }),
      ]);
      const allNews = [...(feed || []), ...(featured || [])];
      const sent = summarizeSentiment(allNews, { currency: claim.currency });
      evidence.news = sent;
      emit('step', { step: 'SOSOVALUE_NEWS', msg: `News sentiment: ${sent.sentiment} (score ${sent.score > 0 ? '+' : ''}${sent.score}, ${sent.count} relevant articles)` });
    } catch (e) {
      warnings.push(`News fetch failed: ${e.message}`);
      emit('step', { step: 'SOSOVALUE_NEWS', msg: `Warning: ${e.message} — using NEUTRAL` });
      evidence.news = { sentiment: 'NEUTRAL', score: 0, count: 0 };
    }
  }

  // ── Step 2: SSI Index ─────────────────────────────────────────────────
  if (claim.signal_basis === 'INDEX' || claim.signal_basis === 'BOTH') {
    emit('step', { step: 'SSI_INDEX', msg: 'Fetching SoSoValue SSI index snapshot...' });
    try {
      // Get index list first if no indexId specified
      let indexId = claim.indexId;
      if (!indexId) {
        const indexes = await getIndexList();
        const idx = (indexes || []).find(i => {
          const name = (i.name || i.indexName || '').toLowerCase();
          return name.includes('btc') || name.includes('crypto') || name.includes('defi');
        }) || (indexes || [])[0];
        if (idx) indexId = idx.id || idx.indexId;
      }

      if (indexId) {
        const snapshot = await getIndexSnapshot({ indexId });
        const change = parseFloat(snapshot?.change || snapshot?.changePercent || '0');
        evidence.index = { indexId, change, snapshot };
        const indexSignal = change > 0 ? 'BULLISH' : change < 0 ? 'BEARISH' : 'NEUTRAL';
        emit('step', { step: 'SSI_INDEX', msg: `SSI index ${indexId}: ${change > 0 ? '+' : ''}${change.toFixed(2)}% → ${indexSignal}` });
        evidence.indexSignal = indexSignal;
      } else {
        warnings.push('No index available');
        evidence.indexSignal = 'NEUTRAL';
      }
    } catch (e) {
      warnings.push(`Index fetch failed: ${e.message}`);
      emit('step', { step: 'SSI_INDEX', msg: `Warning: ${e.message} — using NEUTRAL` });
      evidence.indexSignal = 'NEUTRAL';
    }
  }

  // ── Step 3: SoDEX market price check ─────────────────────────────────
  emit('step', { step: 'SODEX_PRICE', msg: `Checking SoDEX testnet price for ${claim.symbol}...` });
  try {
    const tickers = await getTickers(claim.symbol);
    const ticker = Array.isArray(tickers) ? tickers[0] : tickers;
    if (ticker) {
      const changePct = parseFloat(ticker.changePct || '0');
      evidence.sodex = { symbol: claim.symbol, lastPx: ticker.lastPx, changePct };
      emit('step', { step: 'SODEX_PRICE', msg: `${claim.symbol} @ ${ticker.lastPx} USDC (24h: ${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%)` });
    }
  } catch (e) {
    warnings.push(`SoDEX price check failed: ${e.message}`);
    emit('step', { step: 'SODEX_PRICE', msg: `Warning: ${e.message}` });
  }

  // ── Step 4: Verdict ───────────────────────────────────────────────────
  emit('step', { step: 'VERDICT', msg: 'Computing verdict...' });

  let dataSupports = null; // true = supports direction, false = contradicts, null = unknown

  if (claim.signal_basis === 'NEWS' && evidence.news) {
    const s = evidence.news.sentiment;
    if (s === 'NEUTRAL' || evidence.news.count === 0) dataSupports = null;
    else dataSupports = (claim.direction === 'LONG' && s === 'BULLISH') ||
                        (claim.direction === 'SHORT' && s === 'BEARISH');
  } else if (claim.signal_basis === 'INDEX' && evidence.indexSignal) {
    const s = evidence.indexSignal;
    if (s === 'NEUTRAL') dataSupports = null;
    else dataSupports = (claim.direction === 'LONG' && s === 'BULLISH') ||
                        (claim.direction === 'SHORT' && s === 'BEARISH');
  } else if (claim.signal_basis === 'BOTH') {
    // Both signals must agree
    const newsSent = evidence.news?.sentiment || 'NEUTRAL';
    const idxSent = evidence.indexSignal || 'NEUTRAL';
    if (newsSent === 'NEUTRAL' && idxSent === 'NEUTRAL') {
      dataSupports = null;
    } else {
      // At least one is non-neutral — count votes
      let bullishVotes = 0, bearishVotes = 0;
      if (newsSent === 'BULLISH') bullishVotes++;
      if (newsSent === 'BEARISH') bearishVotes++;
      if (idxSent === 'BULLISH') bullishVotes++;
      if (idxSent === 'BEARISH') bearishVotes++;
      const dominant = bullishVotes > bearishVotes ? 'BULLISH' : bearishVotes > bullishVotes ? 'BEARISH' : 'NEUTRAL';
      if (dominant === 'NEUTRAL') dataSupports = null;
      else dataSupports = (claim.direction === 'LONG' && dominant === 'BULLISH') ||
                          (claim.direction === 'SHORT' && dominant === 'BEARISH');
    }
  }

  let verdict;
  if (dataSupports === true) verdict = 'CONFIRMED';
  else if (dataSupports === false) verdict = 'DISPUTED';
  else verdict = 'UNPROVABLE';

  const result = {
    claimId: claim.id,
    agent: claim.agent,
    symbol: claim.symbol,
    direction: claim.direction,
    signal_basis: claim.signal_basis,
    verdict,
    evidence,
    warnings,
    auditedAt: Date.now(),
  };

  emit('verdict', result);
  return result;
}
