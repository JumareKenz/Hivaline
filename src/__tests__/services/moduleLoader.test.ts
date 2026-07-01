/**
 * moduleLoader.test.ts — Tests for module validation and signature enforcement
 *
 * NOTE: fflate's zipSync produces corrupt output in jsdom (known issue).
 * Tests validate the exported validation functions directly and test
 * loadModule's error handling via its validation layer.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { validateManifest, validateSchema, setSignatureEnforcement } from '@/services/moduleLoader';

function makeValidManifest() {
  return {
    id: 'test-module',
    name: 'Test Module',
    version: '1.0.0',
    domain: 'testing',
    languages: ['en'],
    targetRoles: ['chew'],
    offline: { supported: true, assetsBundled: true },
  };
}

function makeValidSchema() {
  return {
    intents: [
      { intent: 'TEST_INTENT', requiredSlots: ['patientAge'] },
    ],
    outputShape: {
      providesChunkId: true,
      providesSources: true,
      confidenceTiers: ['HIGH', 'LOW'],
    },
  };
}

describe('moduleLoader', () => {
  beforeEach(() => {
    setSignatureEnforcement('OFF');
  });

  describe('validateManifest', () => {
    it('accepts a valid manifest and returns typed object', () => {
      const result = validateManifest(makeValidManifest());

      expect(result.id).toBe('test-module');
      expect(result.name).toBe('Test Module');
      expect(result.version).toBe('1.0.0');
      expect(result.domain).toBe('testing');
      expect(result.languages).toEqual(['en']);
      expect(result.targetRoles).toEqual(['chew']);
      expect(result.offline.supported).toBe(true);
      expect(result.offline.assetsBundled).toBe(true);
    });

    it('throws when input is not an object', () => {
      expect(() => validateManifest(null)).toThrow('not a valid object');
      expect(() => validateManifest('string')).toThrow('not a valid object');
    });

    it('throws when id is missing or empty', () => {
      expect(() => validateManifest({ ...makeValidManifest(), id: '' })).toThrow('"id" is required');
      expect(() => validateManifest({ ...makeValidManifest(), id: undefined })).toThrow('"id" is required');
    });

    it('throws when name is missing or empty', () => {
      expect(() => validateManifest({ ...makeValidManifest(), name: '' })).toThrow('"name" is required');
    });

    it('throws when version is missing', () => {
      expect(() => validateManifest({ ...makeValidManifest(), version: '' })).toThrow('"version" is required');
    });

    it('throws when domain is missing', () => {
      expect(() => validateManifest({ ...makeValidManifest(), domain: '' })).toThrow('"domain" is required');
    });

    it('throws when languages is empty array', () => {
      expect(() => validateManifest({ ...makeValidManifest(), languages: [] })).toThrow('"languages" is required');
    });

    it('throws when languages is not an array', () => {
      expect(() => validateManifest({ ...makeValidManifest(), languages: 'en' })).toThrow('"languages" is required');
    });

    it('throws when targetRoles is empty', () => {
      expect(() => validateManifest({ ...makeValidManifest(), targetRoles: [] })).toThrow('"targetRoles" is required');
    });

    it('throws when offline is missing', () => {
      expect(() => validateManifest({ ...makeValidManifest(), offline: undefined })).toThrow('"offline" is required');
    });

    it('throws when offline.supported is not boolean', () => {
      expect(() => validateManifest({ ...makeValidManifest(), offline: { supported: 'yes', assetsBundled: true } }))
        .toThrow('"offline.supported" is required');
    });

    it('throws when offline.assetsBundled is not boolean', () => {
      expect(() => validateManifest({ ...makeValidManifest(), offline: { supported: true, assetsBundled: 'yes' } }))
        .toThrow('"offline.assetsBundled" is required');
    });

    it('preserves optional fields when present', () => {
      const manifest = { ...makeValidManifest(), contentHash: 'abc123', compiledAt: '2024-06-01T00:00:00Z' };
      const result = validateManifest(manifest);
      expect(result.contentHash).toBe('abc123');
      expect(result.compiledAt).toBe('2024-06-01T00:00:00Z');
    });
  });

  describe('validateSchema', () => {
    it('accepts a valid schema and returns typed object', () => {
      const result = validateSchema(makeValidSchema());

      expect(result.intents).toHaveLength(1);
      expect(result.intents[0].intent).toBe('TEST_INTENT');
      expect(result.intents[0].requiredSlots).toEqual(['patientAge']);
      expect(result.outputShape.providesChunkId).toBe(true);
      expect(result.outputShape.providesSources).toBe(true);
      expect(result.outputShape.confidenceTiers).toEqual(['HIGH', 'LOW']);
    });

    it('throws when input is not an object', () => {
      expect(() => validateSchema(null)).toThrow('not a valid object');
      expect(() => validateSchema(42)).toThrow('not a valid object');
    });

    it('throws when intents is empty array', () => {
      expect(() => validateSchema({ ...makeValidSchema(), intents: [] }))
        .toThrow('"intents" is required and must be a non-empty array');
    });

    it('throws when intents is not an array', () => {
      expect(() => validateSchema({ ...makeValidSchema(), intents: 'CLINICAL' }))
        .toThrow('"intents" is required and must be a non-empty array');
    });

    it('throws when intent declaration is not an object', () => {
      expect(() => validateSchema({ ...makeValidSchema(), intents: ['string'] }))
        .toThrow('intents[0] is not a valid object');
    });

    it('throws when intent field is missing from declaration', () => {
      expect(() => validateSchema({ ...makeValidSchema(), intents: [{ requiredSlots: [] }] }))
        .toThrow('intents[0].intent is required');
    });

    it('throws when intent field is empty string', () => {
      expect(() => validateSchema({ ...makeValidSchema(), intents: [{ intent: '', requiredSlots: [] }] }))
        .toThrow('intents[0].intent is required');
    });

    it('throws when requiredSlots is missing', () => {
      expect(() => validateSchema({ ...makeValidSchema(), intents: [{ intent: 'X' }] }))
        .toThrow('intents[0].requiredSlots is required');
    });

    it('throws when outputShape is missing', () => {
      expect(() => validateSchema({ intents: [{ intent: 'X', requiredSlots: [] }] }))
        .toThrow('"outputShape" is required');
    });

    it('throws when outputShape.providesChunkId is not boolean', () => {
      expect(() => validateSchema({
        intents: [{ intent: 'X', requiredSlots: [] }],
        outputShape: { providesChunkId: 'yes', providesSources: true, confidenceTiers: ['HIGH'] },
      })).toThrow('"outputShape.providesChunkId" is required');
    });

    it('throws when outputShape.providesSources is not boolean', () => {
      expect(() => validateSchema({
        intents: [{ intent: 'X', requiredSlots: [] }],
        outputShape: { providesChunkId: true, providesSources: 'no', confidenceTiers: ['HIGH'] },
      })).toThrow('"outputShape.providesSources" is required');
    });

    it('throws when confidenceTiers is empty', () => {
      expect(() => validateSchema({
        intents: [{ intent: 'X', requiredSlots: [] }],
        outputShape: { providesChunkId: true, providesSources: true, confidenceTiers: [] },
      })).toThrow('"outputShape.confidenceTiers" is required');
    });

    it('preserves optionalSlots when present', () => {
      const schema = {
        ...makeValidSchema(),
        intents: [{ intent: 'X', requiredSlots: ['age'], optionalSlots: ['weight'] }],
      };
      const result = validateSchema(schema);
      expect(result.intents[0].optionalSlots).toEqual(['weight']);
    });

    it('preserves csoVersion when present', () => {
      const schema = { ...makeValidSchema(), csoVersion: '1.0.0' };
      const result = validateSchema(schema);
      expect(result.csoVersion).toBe('1.0.0');
    });

    it('handles multiple intent declarations', () => {
      const schema = {
        ...makeValidSchema(),
        intents: [
          { intent: 'CLINICAL', requiredSlots: [] },
          { intent: 'URGENT', requiredSlots: ['chiefComplaint'] },
        ],
      };
      const result = validateSchema(schema);
      expect(result.intents).toHaveLength(2);
      expect(result.intents[1].intent).toBe('URGENT');
      expect(result.intents[1].requiredSlots).toEqual(['chiefComplaint']);
    });
  });

  describe('signature enforcement configuration', () => {
    it('setSignatureEnforcement changes the enforcement level', async () => {
      setSignatureEnforcement('ENFORCE');
      const mod = await import('@/services/moduleLoader');
      expect(mod.MODULE_SIGNATURE_ENFORCEMENT).toBe('ENFORCE');
      setSignatureEnforcement('OFF');
    });
  });
});
