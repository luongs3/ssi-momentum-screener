// Unit tests for SSI Momentum Screener engine
import { normalize, computeScore, momentum } from '../src/screener.js';
import assert from 'node:assert';
import { test } from 'node:test';

test('normalize empty produces 0.5 for all', () => {
  const result = normalize([5, 5, 5]);
  assert.deepStrictEqual(result, [0.5, 0.5, 0.5]);
});

test('normalize spreads values correctly', () => {
  const result = normalize([0, 5, 10]);
  assert.strictEqual(result[0], 0);
  assert.strictEqual(result[1], 0.5);
  assert.strictEqual(result[2], 1.0);
});

test('computeScore weights correctly', () => {
  const s = computeScore({ change_pct_24h: 0.1, roi_7d: 0.2, roi_1m: 0.3 });
  // 0.1*0.5 + 0.2*0.3 + 0.3*0.2 = 0.05 + 0.06 + 0.06 = 0.17
  assert.ok(Math.abs(s - 0.17) < 0.0001);
});

test('computeScore handles missing fields', () => {
  const s = computeScore({});
  assert.strictEqual(s, 0);
});

test('momentum STRONG UP at score >= 0.7', () => {
  const m = momentum(0.85);
  assert.strictEqual(m.css, 'strong-up');
});

test('momentum UP at 0.55-0.7', () => {
  assert.strictEqual(momentum(0.6).css, 'up');
});

test('momentum NEUTRAL at 0.45-0.55', () => {
  assert.strictEqual(momentum(0.5).css, 'neutral');
});

test('momentum DOWN at 0.3-0.45', () => {
  assert.strictEqual(momentum(0.35).css, 'down');
});

test('momentum STRONG DOWN at < 0.3', () => {
  assert.strictEqual(momentum(0.1).css, 'strong-down');
});

test('computeScore positive when all metrics positive', () => {
  const s = computeScore({ change_pct_24h: 0.05, roi_7d: 0.10, roi_1m: 0.08 });
  assert.ok(s > 0);
});

test('computeScore negative when all metrics negative', () => {
  const s = computeScore({ change_pct_24h: -0.05, roi_7d: -0.10, roi_1m: -0.08 });
  assert.ok(s < 0);
});
