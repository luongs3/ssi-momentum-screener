// SignalCourt — receipts.js
// Hash-chained, HMAC-signed audit log.
// Same pattern as PatchPilot's receipts (proven 2026-07-03).

import { createHmac, createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const CHAIN_SECRET = process.env.RECEIPT_SECRET || 'signal-court-v1-secret';

function hmacSign(data) {
  return createHmac('sha256', CHAIN_SECRET).update(JSON.stringify(data)).digest('hex');
}

function sha256(data) {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

export class ReceiptChain {
  constructor(chainPath) {
    this.chainPath = chainPath;
    this.entries = existsSync(chainPath)
      ? JSON.parse(readFileSync(chainPath, 'utf8'))
      : [];
  }

  add(type, payload) {
    const prev = this.entries[this.entries.length - 1];
    const prevHash = prev ? prev.hash : '0'.repeat(64);
    const base = {
      id: randomBytes(4).toString('hex'),
      ts: Date.now(),
      type,
      payload,
      prevHash,
    };
    base.hash = sha256(base);
    base.sig = hmacSign(base);
    this.entries.push(base);
    writeFileSync(this.chainPath, JSON.stringify(this.entries, null, 2));
    return base;
  }

  verify() {
    let prev = '0'.repeat(64);
    for (const e of this.entries) {
      const { sig, hash, ...base } = e;
      // hash was computed over {id,ts,type,payload,prevHash} (no hash/sig yet)
      const expectedHash = sha256(base);
      if (hash !== expectedHash) return { ok: false, reason: `hash mismatch at id=${e.id}` };
      // sig was computed over {id,ts,type,payload,prevHash,hash}
      const withHash = { ...base, hash };
      const expectedSig = hmacSign(withHash);
      if (sig !== expectedSig) return { ok: false, reason: `sig mismatch at id=${e.id}` };
      if (base.prevHash !== prev) return { ok: false, reason: `chain break at id=${e.id}` };
      prev = hash;
    }
    return { ok: true, entries: this.entries.length };
  }

  last() { return this.entries[this.entries.length - 1]; }
  all() { return this.entries; }
}
