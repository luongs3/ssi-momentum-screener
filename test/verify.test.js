// SignalCourt — tests
import { strict as assert } from 'node:assert';
import { summarizeSentiment } from '../src/sosovalue.js';
import { ReceiptChain } from '../src/receipts.js';
import { getTickers, getSymbols, ping } from '../src/sodex.js';
import { rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP_CHAIN = join(__dirname, 'tmp-chain.json');

let passed = 0, failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}: ${e.message}`);
    failed++;
  }
}

async function runTests() {

console.log('\nSignalCourt test suite\n');

// ── Sentiment ───────────────────────────────────────────────────────────
console.log('Sentiment analysis');

await test('BULLISH when news contains bullish keywords', async () => {
  const news = [
    { title: 'Bitcoin ETF sees massive inflow', summary: 'Institutional adoption surges' },
    { title: 'BTC rally continues', summary: 'BTC breaks ATH' },
  ];
  const r = summarizeSentiment(news, { currency: 'BTC' });
  assert.equal(r.sentiment, 'BULLISH');
  assert(r.score > 0);
});

await test('BEARISH when news contains bearish keywords', async () => {
  const news = [
    { title: 'ETH crash wipes billions', summary: 'ETH sell-off accelerates' },
    { title: 'Liquidation cascade hits ETH', summary: 'ETH dump continues' },
  ];
  const r = summarizeSentiment(news, { currency: 'ETH' });
  assert.equal(r.sentiment, 'BEARISH');
  assert(r.score < 0);
});

await test('NEUTRAL when no signal keywords', async () => {
  const news = [{ title: 'Crypto conference held today', summary: 'Experts discuss trends' }];
  const r = summarizeSentiment(news);
  assert.equal(r.sentiment, 'NEUTRAL');
});

await test('Empty news returns NEUTRAL', async () => {
  const r = summarizeSentiment([]);
  assert.equal(r.sentiment, 'NEUTRAL');
  assert.equal(r.count, 0);
});

await test('Currency filter works', async () => {
  const news = [
    { title: 'Bitcoin surges to ATH rally', summary: 'BTC institutional adoption' },
    { title: 'Ethereum crashes', summary: 'ETH dump' },
  ];
  const r = summarizeSentiment(news, { currency: 'BTC' });
  // Only BTC-relevant articles should be counted
  assert.equal(r.sentiment, 'BULLISH');
});

// ── Receipt chain ───────────────────────────────────────────────────────
console.log('\nReceipt chain');

await test('Chain starts empty and verifies OK', async () => {
  if (existsSync(TMP_CHAIN)) rmSync(TMP_CHAIN);
  const chain = new ReceiptChain(TMP_CHAIN);
  const v = chain.verify();
  assert.equal(v.ok, true);
  assert.equal(v.entries, 0);
});

await test('Can add entries and verify chain integrity', async () => {
  const chain = new ReceiptChain(TMP_CHAIN);
  chain.add('test', { foo: 'bar' });
  chain.add('verdict', { claimId: 'c1', verdict: 'CONFIRMED' });
  const v = chain.verify();
  assert.equal(v.ok, true);
  assert.equal(v.entries, 2);
});

await test('Tampering breaks the chain', async () => {
  const { readFileSync, writeFileSync } = await import('node:fs');
  const entries = JSON.parse(readFileSync(TMP_CHAIN, 'utf8'));
  entries[0].payload.foo = 'TAMPERED';
  writeFileSync(TMP_CHAIN, JSON.stringify(entries));
  const chain = new ReceiptChain(TMP_CHAIN);
  const v = chain.verify();
  assert.equal(v.ok, false);
});

// ── SoDEX live ──────────────────────────────────────────────────────────
console.log('\nSoDEX testnet (live)');

await test('ping returns ok=true', async () => {
  const r = await ping();
  assert.equal(r.ok, true, `ping failed: ${r.err}`);
  assert(r.markets > 0, 'no markets returned');
});

await test('getSymbols returns array with name fields', async () => {
  const symbols = await getSymbols();
  assert(Array.isArray(symbols), 'not an array');
  assert(symbols.length > 0, 'empty');
  assert(symbols[0].name || symbols[0].symbol, 'no name field');
});

await test('getTickers returns array with price fields', async () => {
  const tickers = await getTickers();
  assert(Array.isArray(tickers), 'not an array');
  assert(tickers.length > 0, 'empty');
  assert(tickers[0].lastPx !== undefined || tickers[0].symbol, 'no price field');
});

// cleanup
if (existsSync(TMP_CHAIN)) rmSync(TMP_CHAIN);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
}

runTests().catch(e => { console.error(e); process.exit(1); });
