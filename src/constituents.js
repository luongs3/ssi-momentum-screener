// SSI constituent cache — per-index token breakdown from SoSoValue API
// GET /indices/{ticker}/constituents → [{currency_id, symbol, weight}]
// Cached 1h (data rarely changes). Used for the drill-down panel in the cockpit.

import { SOSOVALUE_BASE, apiKey } from './sosovalue.js';

const CACHE = new Map(); // ticker → { ts, data }
const TTL   = 60 * 60 * 1000; // 1h

// Delay helper (avoids rate-limit)
const delay = ms => new Promise(r => setTimeout(r, ms));

// Hardcoded fallback — constituent symbols from sosovalue.com docs
// Used if the API call fails or key isn't set
const FALLBACK = {
  ssiMAG7:     ['bitcoin','ethereum','binance-coin','xrp','solana','dogecoin','cardano'],
  ssiDeFi:     ['chainlink','uniswap','aave','ondo-finance','pancakeswap','maker','compound'],
  ssiAI:       ['fetch-ai','render-token','bittensor','ocean-protocol','singularitynet'],
  ssiLayer1:   ['solana','avalanche-2','near-protocol','aptos','sui'],
  ssiLayer2:   ['arbitrum','optimism','polygon','starknet','base'],
  ssiMeme:     ['dogecoin','shiba-inu','pepe','bonk','floki'],
  ssiRWA:      ['ondo-finance','mantra','centrifuge','goldfinch','maple'],
  ssiDePIN:    ['helium','hivemapper','io-net','akash-network','filecoin'],
  ssiNFT:      ['immutable-x','blur','decentraland','axie-infinity','sandbox'],
  ssiGameFi:   ['axie-infinity','gala','illuvium','immutable-x','beam'],
  ssiPayFi:    ['ripple','stellar','nano','celo','algorand'],
  ssiCeFi:     ['binance-coin','crypto-com-chain','ftx-token','kucoin-shares'],
  ssiSocialFi: ['friend-tech','farcaster','lens-protocol','galxe'],
};

export async function getConstituents(ticker) {
  const cached = CACHE.get(ticker);
  if (cached && Date.now() - cached.ts < TTL) return cached.data;

  const key = apiKey();
  if (!key) return FALLBACK[ticker]?.map(s => ({ symbol: s, weight: null })) || [];

  try {
    await delay(200); // small gap before each constituent call
    const url = `${SOSOVALUE_BASE}/indices/${ticker}/constituents`;
    const res = await fetch(url, { headers: { 'x-soso-api-key': key } });
    const body = await res.json();

    if (body.code !== 0) throw new Error(`code ${body.code}`);

    const data = (body.data || []).map(c => ({
      symbol: c.symbol,
      weight: c.weight,
      currencyId: c.currency_id,
    }));

    CACHE.set(ticker, { ts: Date.now(), data });
    return data;
  } catch {
    // Fall back to hardcoded list
    const fallback = (FALLBACK[ticker] || []).map(s => ({ symbol: s, weight: null }));
    CACHE.set(ticker, { ts: Date.now() - TTL + 5 * 60 * 1000, data: fallback }); // retry in 5min
    return fallback;
  }
}
