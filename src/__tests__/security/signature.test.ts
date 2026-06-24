/**
 * signature.test.ts — FIX 4: .hiv signature must be verified against the
 * HARDCODED trusted public key, never the pubkey.bin embedded in the file.
 */

import { describe, it, expect } from 'vitest';
import { zipSync } from 'fflate';
import { ed25519 } from '@noble/curves/ed25519.js';
import { verifyHivSignature, decodeBase64ToBytes, HIVA_ED25519_PUBLIC_KEY_B64 } from '@/utils/security';

function b64(bytes: Uint8Array): string {
  let s = '';
  for (const byte of bytes) s += String.fromCharCode(byte);
  return btoa(s);
}

// Build a test-realm Uint8Array. (fflate's strToU8 uses jsdom's TextEncoder,
// whose Uint8Array is a different realm and fails fflate's instanceof check —
// a jsdom-only artifact; production .hiv bytes are same-realm.)
function u8(text: string): Uint8Array {
  return Uint8Array.from(text, (c) => c.charCodeAt(0));
}

/** Replicates security.ts buildSignablePayload: sorted non-signature entries concatenated. */
function signablePayload(files: Record<string, Uint8Array>): Uint8Array {
  const keys = Object.keys(files).filter((k) => !k.includes('signature/')).sort();
  const parts = keys.map((k) => files[k]);
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

const CONTENT_FILES: Record<string, Uint8Array> = {
  'manifest.json': u8('{"version":"1.0.0"}'),
  'content/chunks.jsonl': u8('{"id":"c1"}'),
  'index/lexical.json': u8('{"en":{"index":{}}}'),
};

/** Build a signed .hiv ZIP: sign with `signerPriv`, embed `embeddedPub` as pubkey.bin. */
function makeSignedHiv(signerPriv: Uint8Array, embeddedPub: Uint8Array): Uint8Array {
  const sig = ed25519.sign(signablePayload(CONTENT_FILES), signerPriv);
  const files: Record<string, Uint8Array> = {
    ...CONTENT_FILES,
    'signature/sig.bin': sig,
    'signature/pubkey.bin': embeddedPub,
  };
  return zipSync(files);
}

describe('verifyHivSignature — hardcoded trust anchor', () => {
  // Legitimate signing keypair (would be the compiler's key in production).
  const legit = ed25519.keygen();
  const legitPriv = legit.secretKey;
  const legitPub = legit.publicKey;
  const legitPubB64 = b64(legitPub);

  // Attacker keypair.
  const attacker = ed25519.keygen();
  const attackerPriv = attacker.secretKey;
  const attackerPub = attacker.publicKey;

  it('REJECTS a file signed by an attacker who embeds their own pubkey.bin', () => {
    // Attacker signs with their key AND ships their own pubkey in the ZIP —
    // the old (broken) code would have accepted this.
    const malicious = makeSignedHiv(attackerPriv, attackerPub);
    expect(verifyHivSignature(malicious, legitPubB64)).toBe(false);
  });

  it('ACCEPTS a legit signature even when pubkey.bin in the ZIP is wrong (ZIP key ignored)', () => {
    // Signed by the legit key, but the embedded pubkey.bin is the attacker's.
    // Verification uses the hardcoded trusted key, so it still passes.
    const valid = makeSignedHiv(legitPriv, attackerPub);
    expect(verifyHivSignature(valid, legitPubB64)).toBe(true);
  });

  it('REJECTS an unsigned file (no signature/sig.bin)', () => {
    const unsigned = zipSync({ ...CONTENT_FILES });
    expect(verifyHivSignature(unsigned, legitPubB64)).toBe(false);
  });

  it('REJECTS when no trusted key is configured (fail closed)', () => {
    const valid = makeSignedHiv(legitPriv, legitPub);
    expect(verifyHivSignature(valid, '')).toBe(false);
  });

  it('ships the production signing public key (valid 32-byte Ed25519 key)', () => {
    // The hardcoded trust anchor must be present and well-formed; a bad/missing
    // key would silently fail-close every .hiv download.
    expect(HIVA_ED25519_PUBLIC_KEY_B64).toBe('yjgn16EdmlOMiUyx1lNaJ0pxXGoToRfs/lkFMGPvw6U=');
    const decoded = decodeBase64ToBytes(HIVA_ED25519_PUBLIC_KEY_B64);
    expect(decoded.length).toBe(32);
  });
});
