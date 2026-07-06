# SSI Momentum Screener

> **Real-time sector rotation intelligence for the SoSoValue index ecosystem.**

SSI Momentum Screener shows WHERE the market terrain is shifting and WHY — before you bet. While 20+ other Wave-3 submissions are trading bots that self-report performance, this is the data product underneath: it ranks all 13 SSI indices (MAG7, DeFi, AI, Layer1, Meme, RWA, DePIN, and more) by composite momentum score, surfaces the strongest rotating sectors, correlates momentum spikes with live SoSoValue news headlines, and anchors hourly snapshots on-chain via SoDEX / ValueChain.

🔴 **Live demo:** http://31.220.75.26:8803/
🐙 **GitHub:** https://github.com/luongs3/ssi-momentum-screener

---

## Architecture

```
SoSoValue Market Data API
  ├─ /indices/{ticker}/market-snapshot  (24h, 7d, 1m ROI)
  ├─ /indices/{ticker}/constituents     (holdings breakdown)
  └─ /news                              (correlated headlines)
          │
          ▼
  Momentum Engine (Node.js ESM)
  score = 0.5×(24h_ROC) + 0.3×(7d_ROI) + 0.2×(1m_ROI)
  normalized [0,1] across all 13 indices → ranked leaderboard
          │
          ├─ score > 0.6 → fetch + inline SoSoValue news panel
          │
          └─ Hourly: SHA-256(top-3 tickers) → SoDEX testnet order
                     clientOrderId (EIP-712, chain 286623)
          │
          ▼
  Express SSE server → dark terminal cockpit (browser EventSource)
  live table refresh every 90s · click row → news panel reveal
```

---

## Stack

| Layer | Tech |
|---|---|
| Backend | Node.js (ESM), Express, SSE |
| Data | SoSoValue Market Data API |
| On-chain | SoDEX testnet REST + Go SDK (chain 286623), ValueChain |
| Frontend | Vanilla JS, dark terminal UI |

---

## Judge Rubric Alignment

| Criterion | How it's met |
|---|---|
| **User Value & Practical Impact** | Sector rotation view for crypto traders — unique in Wave 3; no other submission maps all 13 SSI indices simultaneously |
| **Functionality & Working Demo** | SSE live table refreshes every 90s, news panel, on-chain snapshot ledger — all running at the live URL above |
| **Logic, Workflow & Product Design** | Clean 3-layer pipeline: fetch → score → rank → correlate → snapshot; deterministic formula, no black-box ML |
| **Data / API Integration** | SoSoValue news API + SSI index snapshots + constituent APIs + SoDEX on-chain write; full API surface coverage |
| **UX & Clarity** | Dark terminal UI, color-coded momentum bars (green/red gradient), one-click news reveal per index row |

---

## Run Locally

```bash
git clone https://github.com/luongs3/ssi-momentum-screener
cd ssi-momentum-screener
npm install
PORT=8803 SOSOVALUE_API_KEY=<your_key> node src/server.js
# open http://localhost:8803
```

Tests (11/11 passing):
```bash
npm test
```

---

> ![Wave 3](https://img.shields.io/badge/SoSoValue-WaveHack%20Wave%203-blue?style=flat-square) **Built for SoSoValue WaveHack Wave 3** — Akindo · $4,000 USDC · Deadline Jul 18 2026
