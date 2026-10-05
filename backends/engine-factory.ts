// =============================================================================
// WebAI Memory — Engine Factory
// Instantiates active memory engine based on configuration.
// Default engine: Local Mem0 (http://localhost:8000).
// =============================================================================

function resolveAgentMemoryEngine(): any {
  if (typeof AgentMemoryEngine !== 'undefined') return AgentMemoryEngine;
  if (typeof globalThis !== 'undefined' && (globalThis as any).AgentMemoryEngine) return (globalThis as any).AgentMemoryEngine;
  if (typeof require !== 'undefined') return require('./agentmemory-engine.js').AgentMemoryEngine;
  throw new Error('AgentMemoryEngine is not defined');
}

function resolveMem0Engine(): any {
  if (typeof Mem0Engine !== 'undefined') return Mem0Engine;
  if (typeof globalThis !== 'undefined' && (globalThis as any).Mem0Engine) return (globalThis as any).Mem0Engine;
  if (typeof require !== 'undefined') return require('./mem0-engine.js').Mem0Engine;
  throw new Error('Mem0Engine is not defined');
}

function resolveHindsightEngine(): any {
  if (typeof HindsightEngine !== 'undefined') return HindsightEngine;
  if (typeof globalThis !== 'undefined' && (globalThis as any).HindsightEngine) return (globalThis as any).HindsightEngine;
  if (typeof require !== 'undefined') return require('./hindsight-engine.js').HindsightEngine;
  throw new Error('HindsightEngine is not defined');
}

function resolveCogneeEngine(): any {
  if (typeof CogneeEngine !== 'undefined') return CogneeEngine;
  if (typeof globalThis !== 'undefined' && (globalThis as any).CogneeEngine) return (globalThis as any).CogneeEngine;
  if (typeof require !== 'undefined') return require('./cognee-engine.js').CogneeEngine;
  throw new Error('CogneeEngine is not defined');
}

class EngineFactory {
  /**
   * Instantiates the configured engine.
   * Defaults to Local Mem0 (http://localhost:8000).
   */
  static createEngine(settings: Record<string, any> = {}): BaseMemoryEngine {
    const activeEngine = String(settings.activeEngine || 'mem0').trim().toLowerCase();

    if (activeEngine === 'agentmemory') {
      const AgentMemoryClass = resolveAgentMemoryEngine();
      return new AgentMemoryClass({
        apiUrl: settings.apiUrl || 'http://localhost:3111',
        secret: settings.secret || '',
      });
    }

    if (activeEngine === 'hindsight') {
      const HindsightClass = resolveHindsightEngine();
      return new HindsightClass({
        apiUrl: settings.hindsightApiUrl || 'http://localhost:8888',
        apiKey: settings.hindsightApiKey || '',
        bankId: settings.hindsightBankId || 'default',
      });
    }

    if (activeEngine === 'cognee') {
      const CogneeClass = resolveCogneeEngine();
      return new CogneeClass({
        apiUrl: settings.cogneeApiUrl || 'http://localhost:8000',
        apiKey: settings.cogneeApiKey || '',
        datasetName: settings.cogneeDatasetName || 'main',
      });
    }

    const Mem0Class = resolveMem0Engine();
    return new Mem0Class({
      apiUrl: settings.mem0ApiUrl || 'http://localhost:8000',
      apiKey: settings.mem0ApiKey || '',
      userId: settings.mem0UserId || 'default_user',
      orgId: settings.mem0OrgId || '',
      projectId: settings.mem0ProjectId || '',
    });
  }
}

if (typeof globalThis !== 'undefined') {
  (globalThis as any).EngineFactory = EngineFactory;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { EngineFactory };
}
