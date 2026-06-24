/**
 * security.ts — .hiv signature trust anchor (Ed25519)
 *
 * The trusted public key is HARDCODED in the app and is the ONLY key used to
 * verify a .hiv signature. The `signature/pubkey.bin` embedded inside the .hiv
 * is deliberately ignored: trusting an in-file key lets an attacker ship their
 * own key + a matching signature and pass verification. The real integrity
 * anchor is this hardcoded key (plus TLS + the SHA-256 from /version).
 */

import { unzipSync } from 'fflate';
import { ed25519 } from '@noble/curves/ed25519.js';

/**
 * Production Ed25519 public key (base64), matching the compiler's signing key
 * (HIVA_SIGNING_PUBLIC_KEY). Hardcoded so a tampered .hiv cannot supply its own
 * key. If this is ever rotated on the compiler, update it here and ship an app
 * release — otherwise signature verification will reject all new .hiv files.
 */
export const HIVA_ED25519_PUBLIC_KEY_B64 = 'yjgn16EdmlOMiUyx1lNaJ0pxXGoToRfs/lkFMGPvw6U=';

/**
 * Resolve the trusted public key (base64).
 * In development only, a build-time `VITE_HIVA_PUBLIC_KEY` may override it for
 * local testing with a dev keypair. In production the hardcoded constant is the
 * only source — no override is possible.
 */
export function getTrustedPublicKeyB64(): string {
  if (import.meta.env.DEV) {
    const override = import.meta.env.VITE_HIVA_PUBLIC_KEY;
    if (override) return override;
  }
  return HIVA_ED25519_PUBLIC_KEY_B64;
}

/** Decode a base64 string to raw bytes (browser/WebView). */
export function decodeBase64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Build the deterministic signable payload: every ZIP entry except the
 * signature/ directory, concatenated in sorted-key order. Must match the
 * compiler's signing algorithm exactly.
 */
function buildSignablePayload(zip: Record<string, Uint8Array>): Uint8Array {
  const filtered: Record<string, Uint8Array> = {};
  for (const [key, value] of Object.entries(zip)) {
    if (!key.includes('signature/') && !key.includes('/signature/')) {
      filtered[key] = value;
    }
  }
  const parts = Object.keys(filtered).sort().map((k) => filtered[k]);
  const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    combined.set(part, offset);
    offset += part.length;
  }
  return combined;
}

/**
 * Verify a .hiv file's Ed25519 signature against a TRUSTED public key.
 *
 * Security properties:
 *  - The signature (`signature/sig.bin`) is read from the file, but the public
 *    key is the caller-supplied trusted key — the file's own `pubkey.bin` is
 *    never used for verification.
 *  - Fail-closed: returns false if there is no signature, no trusted key, or
 *    on any error. There is NO unsigned/dev bypass.
 *
 * @param hivBytes raw .hiv ZIP bytes
 * @param trustedPubKeyB64 base64-encoded trusted Ed25519 public key
 */
export function verifyHivSignature(hivBytes: Uint8Array, trustedPubKeyB64: string): boolean {
  try {
    if (!trustedPubKeyB64) return false; // fail closed: no trust anchor configured

    const zip = unzipSync(hivBytes);
    const sigRaw = zip['signature/sig.bin'] ?? zip['/signature/sig.bin'];
    if (!sigRaw) return false; // unsigned files are never accepted

    const trustedKey = decodeBase64ToBytes(trustedPubKeyB64);
    if (trustedKey.length === 0) return false;

    const signable = buildSignablePayload(zip);
    return ed25519.verify(sigRaw, signable, trustedKey);
  } catch {
    return false;
  }
}
