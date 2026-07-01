/**
 * moduleRegistry.ts — Module Registry
 *
 * In-memory registry of loaded modules, keyed by the intents they declare.
 * Routes CSO queries to the appropriate module based on IntentLayer.intent.
 */

import type { CognitiveStateObject } from '@/types/cso';
import type { ExecutableModule } from '@/types/module';

export class ModuleRegistry {
  private intentMap: Map<string, ExecutableModule> = new Map();
  private modules: Map<string, ExecutableModule> = new Map();

  /**
   * Register a module. Indexes it by each intent declared in its schema.
   * Throws if any declared intent is already claimed by another module.
   */
  registerModule(execModule: ExecutableModule): void {
    const moduleId = execModule.module.manifest.id;

    if (this.modules.has(moduleId)) {
      throw new Error(
        `Module "${moduleId}" is already registered. ` +
        `Unregister it first before re-registering.`
      );
    }

    for (const intentDecl of execModule.module.schema.intents) {
      const existingModule = this.intentMap.get(intentDecl.intent);
      if (existingModule) {
        const existingId = existingModule.module.manifest.id;
        throw new Error(
          `Intent collision: intent "${intentDecl.intent}" is claimed by both ` +
          `module "${existingId}" and module "${moduleId}". ` +
          `Two modules cannot handle the same intent — this is a configuration error.`
        );
      }
    }

    // All intents are clear — register
    for (const intentDecl of execModule.module.schema.intents) {
      this.intentMap.set(intentDecl.intent, execModule);
    }
    this.modules.set(moduleId, execModule);
  }

  /**
   * Route a CSO to the module that handles its intent.
   * Returns null if no module claims the intent.
   */
  routeToModule(cso: CognitiveStateObject): ExecutableModule | null {
    return this.intentMap.get(cso.intent.intent) ?? null;
  }

  /**
   * Unregister a module by id. Removes all its intent mappings.
   */
  unregisterModule(moduleId: string): void {
    const execModule = this.modules.get(moduleId);
    if (!execModule) return;

    for (const intentDecl of execModule.module.schema.intents) {
      this.intentMap.delete(intentDecl.intent);
    }
    this.modules.delete(moduleId);
  }

  /**
   * Get all registered modules.
   */
  getRegisteredModules(): ExecutableModule[] {
    return Array.from(this.modules.values());
  }

  /**
   * Get a module by id.
   */
  getModule(moduleId: string): ExecutableModule | undefined {
    return this.modules.get(moduleId);
  }

  /**
   * Get all intents currently claimed by registered modules.
   */
  getClaimedIntents(): string[] {
    return Array.from(this.intentMap.keys());
  }

  /**
   * Clear all registrations.
   */
  clear(): void {
    this.intentMap.clear();
    this.modules.clear();
  }
}
