/**
 * mediChatModule.ts — Wraps the existing clinical Q&A pipeline as an ExecutableModule
 *
 * The MediChat clinical logic (hybridSearch, answerAssembler, etc.) becomes the
 * first module loaded into the registry. From the Core's perspective, it is
 * indistinguishable from any future third-party module.
 *
 * This wrapper does NOT rewrite hybridSearch or answerAssembler internals —
 * it delegates to the existing ConversationEngine.respond() and maps the
 * result into the ExecutableModule contract.
 */

import type { HIVFile } from '@/types/hiv';
import type { CognitiveStateObject } from '@/types/cso';
import type {
  HivaModule,
  ModuleManifest,
  ModuleSchema,
  ExecutableModule,
  ModuleExecuteResult,
} from '@/types/module';
import { ConversationEngine } from '@/services/conversationEngine';

const MEDICHAT_MODULE_ID = 'hiva-medichat-clinical';

const MEDICHAT_INTENTS = [
  'CLINICAL',
  'DEFINE',
  'DETAIL',
  'PROCEDURE',
  'REFERRAL',
  'SCOPE',
  'URGENT',
  'HEADING_LOOKUP',
  'AFFIRM',
  'NEGATE',
];

function buildManifest(hivFile: HIVFile): ModuleManifest {
  return {
    id: MEDICHAT_MODULE_ID,
    name: 'HIVA MediChat Clinical',
    version: hivFile.manifest.version,
    domain: 'clinical-medicine',
    languages: hivFile.manifest.languages,
    targetRoles: ['chew', 'supervisor'],
    offline: {
      supported: true,
      assetsBundled: true,
    },
    contentHash: hivFile.manifest.sha256,
    compiledAt: hivFile.manifest.created_at,
  };
}

function buildSchema(): ModuleSchema {
  return {
    intents: MEDICHAT_INTENTS.map(intent => ({
      intent,
      requiredSlots: [],
      optionalSlots: ['patientAge', 'patientWeight', 'chiefComplaint', 'currentDrug'],
    })),
    outputShape: {
      providesChunkId: true,
      providesSources: true,
      confidenceTiers: ['LOW', 'MEDIUM', 'HIGH'],
    },
    csoVersion: '1.0.0',
  };
}

/**
 * Create an ExecutableModule wrapping the existing ConversationEngine.
 * The engine instance is shared — session state persists across calls.
 */
export function createMediChatModule(hivFile: HIVFile): ExecutableModule {
  const engine = new ConversationEngine(hivFile);
  const manifest = buildManifest(hivFile);
  const schema = buildSchema();

  const hivaModule: HivaModule = {
    manifest,
    schema,
    assets: {},
    signatureVerified: false,
  };

  return {
    module: hivaModule,
    async execute(cso: CognitiveStateObject): Promise<ModuleExecuteResult> {
      const response = await engine.respond(cso.request.rawInput);
      const lastCSO = engine.getLastCSO();

      return {
        moduleResponse: lastCSO?.moduleResponse ?? {
          chunkId: response.chunkId,
          score: null,
          confidenceGateFired: false,
          vectorTier: 'none',
          topBm25Score: null,
          topVectorScore: null,
          vectorGatePassed: false,
          source: response.source,
          chunkDisplayTitle: null,
        },
        generationControl: {
          confidenceTier: lastCSO?.generationControl.confidenceTier ?? (response.chunkId ? 'HIGH' : 'LOW'),
          escalationFlag: lastCSO?.generationControl.escalationFlag ?? false,
        },
        responseText: response.message,
        sources: response.source ? [response.source] : [],
        suggestedFollowUps: response.suggestedFollowUps,
        verified: !!response.chunkId,
      };
    },
  };
}

export { MEDICHAT_MODULE_ID, MEDICHAT_INTENTS };
