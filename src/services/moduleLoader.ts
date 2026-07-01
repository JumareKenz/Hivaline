/**
 * moduleLoader.ts — Module bundle loader
 *
 * Parses .hiva module ZIP bundles, validates manifest and schema against
 * defined types, verifies Ed25519 signatures, and returns typed Module objects.
 */

import { unzipSync, strFromU8 } from 'fflate';
import { verifyHivSignature, getTrustedPublicKeyB64 } from '@/utils/security';
import type {
  ModuleManifest,
  ModuleSchema,
  ModuleConfig,
  ModuleAssets,
  HivaModule,
  SignatureEnforcement,
} from '@/types/module';

export let MODULE_SIGNATURE_ENFORCEMENT: SignatureEnforcement = 'WARN';

export function setSignatureEnforcement(level: SignatureEnforcement): void {
  MODULE_SIGNATURE_ENFORCEMENT = level;
}

function getFile(files: Record<string, Uint8Array>, path: string): Uint8Array | undefined {
  const clean = path.replace(/^\/+/, '').replace(/\/+$/, '');
  for (const key of Object.keys(files)) {
    const k = key.replace(/^\/+/, '').replace(/\/+$/, '');
    if (k === clean) {
      const entry = files[key];
      if (entry && entry.byteLength > 0) {
        return entry;
      }
    }
  }
  return undefined;
}

function parseJSON<T>(files: Record<string, Uint8Array>, path: string): T | undefined {
  const raw = getFile(files, path);
  if (!raw) return undefined;
  return JSON.parse(strFromU8(raw)) as T;
}

export function validateManifest(raw: unknown): ModuleManifest {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Module manifest.json is not a valid object');
  }

  const m = raw as Record<string, unknown>;

  if (typeof m.id !== 'string' || m.id.length === 0) {
    throw new Error('Module manifest.json: "id" is required and must be a non-empty string');
  }
  if (typeof m.name !== 'string' || m.name.length === 0) {
    throw new Error('Module manifest.json: "name" is required and must be a non-empty string');
  }
  if (typeof m.version !== 'string' || m.version.length === 0) {
    throw new Error('Module manifest.json: "version" is required and must be a non-empty string');
  }
  if (typeof m.domain !== 'string' || m.domain.length === 0) {
    throw new Error('Module manifest.json: "domain" is required and must be a non-empty string');
  }
  if (!Array.isArray(m.languages) || m.languages.length === 0) {
    throw new Error('Module manifest.json: "languages" is required and must be a non-empty array');
  }
  if (!Array.isArray(m.targetRoles) || m.targetRoles.length === 0) {
    throw new Error('Module manifest.json: "targetRoles" is required and must be a non-empty array');
  }
  if (!m.offline || typeof m.offline !== 'object') {
    throw new Error('Module manifest.json: "offline" is required and must be an object');
  }

  const offline = m.offline as Record<string, unknown>;
  if (typeof offline.supported !== 'boolean') {
    throw new Error('Module manifest.json: "offline.supported" is required and must be a boolean');
  }
  if (typeof offline.assetsBundled !== 'boolean') {
    throw new Error('Module manifest.json: "offline.assetsBundled" is required and must be a boolean');
  }

  return {
    id: m.id as string,
    name: m.name as string,
    version: m.version as string,
    domain: m.domain as string,
    languages: m.languages as string[],
    targetRoles: m.targetRoles as string[],
    offline: {
      supported: offline.supported as boolean,
      assetsBundled: offline.assetsBundled as boolean,
    },
    contentHash: typeof m.contentHash === 'string' ? m.contentHash : undefined,
    compiledAt: typeof m.compiledAt === 'string' ? m.compiledAt : undefined,
  };
}

export function validateSchema(raw: unknown): ModuleSchema {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Module schema.json is not a valid object');
  }

  const s = raw as Record<string, unknown>;

  if (!Array.isArray(s.intents) || s.intents.length === 0) {
    throw new Error('Module schema.json: "intents" is required and must be a non-empty array');
  }

  for (let i = 0; i < s.intents.length; i++) {
    const intent = s.intents[i] as Record<string, unknown>;
    if (!intent || typeof intent !== 'object') {
      throw new Error(`Module schema.json: intents[${i}] is not a valid object`);
    }
    if (typeof intent.intent !== 'string' || (intent.intent as string).length === 0) {
      throw new Error(`Module schema.json: intents[${i}].intent is required and must be a non-empty string`);
    }
    if (!Array.isArray(intent.requiredSlots)) {
      throw new Error(`Module schema.json: intents[${i}].requiredSlots is required and must be an array`);
    }
  }

  if (!s.outputShape || typeof s.outputShape !== 'object') {
    throw new Error('Module schema.json: "outputShape" is required and must be an object');
  }

  const out = s.outputShape as Record<string, unknown>;
  if (typeof out.providesChunkId !== 'boolean') {
    throw new Error('Module schema.json: "outputShape.providesChunkId" is required and must be a boolean');
  }
  if (typeof out.providesSources !== 'boolean') {
    throw new Error('Module schema.json: "outputShape.providesSources" is required and must be a boolean');
  }
  if (!Array.isArray(out.confidenceTiers) || out.confidenceTiers.length === 0) {
    throw new Error('Module schema.json: "outputShape.confidenceTiers" is required and must be a non-empty array');
  }

  return {
    intents: (s.intents as Array<Record<string, unknown>>).map(i => ({
      intent: i.intent as string,
      requiredSlots: i.requiredSlots as string[],
      optionalSlots: Array.isArray(i.optionalSlots) ? i.optionalSlots as string[] : undefined,
    })),
    outputShape: {
      providesChunkId: out.providesChunkId as boolean,
      providesSources: out.providesSources as boolean,
      confidenceTiers: out.confidenceTiers as Array<'LOW' | 'MEDIUM' | 'HIGH'>,
    },
    csoVersion: typeof s.csoVersion === 'string' ? s.csoVersion : undefined,
  };
}

function verifySignature(bundleBytes: Uint8Array, moduleId: string): boolean {
  if (MODULE_SIGNATURE_ENFORCEMENT === 'OFF') {
    return false;
  }

  const pubKey = getTrustedPublicKeyB64();
  const isValid = verifyHivSignature(bundleBytes, pubKey);

  if (!isValid && MODULE_SIGNATURE_ENFORCEMENT === 'WARN') {
    // eslint-disable-next-line no-console
    console.warn(
      `[ModuleLoader] Signature verification FAILED for module "${moduleId}". ` +
      `Enforcement is WARN — module will load but is not cryptographically verified. ` +
      `This may be due to the non-reproducible ZIP deflate issue (see updateService.ts:175). ` +
      `Set MODULE_SIGNATURE_ENFORCEMENT=ENFORCE to reject unsigned/invalid modules.`
    );
  }

  if (!isValid && MODULE_SIGNATURE_ENFORCEMENT === 'ENFORCE') {
    throw new Error(
      `Module "${moduleId}" failed Ed25519 signature verification. ` +
      `MODULE_SIGNATURE_ENFORCEMENT is ENFORCE — refusing to load.`
    );
  }

  return isValid;
}

/**
 * Load a module from a ZIP bundle (ArrayBuffer or Uint8Array).
 * Validates manifest.json and schema.json, verifies signature per enforcement policy.
 */
export function loadModule(bundleInput: ArrayBuffer | Uint8Array): HivaModule {
  const bundleBytes = bundleInput instanceof Uint8Array
    ? bundleInput
    : new Uint8Array(bundleInput);
  const files = unzipSync(bundleBytes);

  // Parse and validate manifest
  const manifestRaw = parseJSON<unknown>(files, 'manifest.json');
  if (manifestRaw === undefined) {
    throw new Error('Module bundle is missing manifest.json');
  }
  const manifest = validateManifest(manifestRaw);

  // Parse and validate schema
  const schemaRaw = parseJSON<unknown>(files, 'schema.json');
  if (schemaRaw === undefined) {
    throw new Error(`Module "${manifest.id}" bundle is missing schema.json`);
  }
  const schema = validateSchema(schemaRaw);

  // Signature verification
  const signatureVerified = verifySignature(bundleBytes, manifest.id);

  // Load optional assets
  const assets: ModuleAssets = {};

  const chunksRaw = getFile(files, 'knowledge/chunks.bin');
  if (chunksRaw) {
    const ab = new ArrayBuffer(chunksRaw.byteLength);
    new Uint8Array(ab).set(chunksRaw);
    assets.chunks = ab;
  }

  const embeddingsRaw = getFile(files, 'knowledge/embeddings.bin');
  if (embeddingsRaw) {
    const ab = new ArrayBuffer(embeddingsRaw.byteLength);
    new Uint8Array(ab).set(embeddingsRaw);
    assets.embeddings = ab;
  }

  const sourcesRaw = parseJSON<{ sources: Array<{ name: string; url?: string; year?: number }> }>(files, 'knowledge/sources.json');
  if (sourcesRaw) {
    assets.sources = sourcesRaw.sources ?? [];
  }

  const rulesRaw = parseJSON<Record<string, unknown>>(files, 'logic/rules.json');
  if (rulesRaw) {
    assets.rules = rulesRaw;
  }

  const workflowsRaw = parseJSON<Record<string, unknown>>(files, 'logic/workflows.json');
  if (workflowsRaw) {
    assets.workflows = workflowsRaw;
  }

  const configRaw = parseJSON<ModuleConfig>(files, 'config.json');
  if (configRaw) {
    assets.config = configRaw;
  }

  return {
    manifest,
    schema,
    assets,
    signatureVerified,
  };
}
