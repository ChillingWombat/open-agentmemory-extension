// =============================================================================
// WebAI Memory — Base Memory Engine
// Abstract interface and normalization contract for pluggable memory backends.
// =============================================================================

class BaseMemoryEngine {
  config: Record<string, any>;

  /**
   * @param config - Backend-specific engine configuration
   */
  constructor(config: Record<string, any> = {}) {
    this.config = config;
  }

  /**
   * Health / Connectivity Probe
   */
  async checkHealth(): Promise<HealthCheckResult> {
    throw new Error('BaseMemoryEngine.checkHealth() must be implemented by subclass');
  }

  /**
   * Observe conversation turn
   */
  async observe(turn: Partial<ConversationTurn>): Promise<ObserveResponse> {
    throw new Error('BaseMemoryEngine.observe() must be implemented by subclass');
  }

  /**
   * Search / Recall memories
   */
  async search(queryParams: { query: string; limit?: number }): Promise<SearchResponse> {
    throw new Error('BaseMemoryEngine.search() must be implemented by subclass');
  }

  /**
   * Session lifecycle start
   */
  async startSession(sessionParams?: Record<string, any>): Promise<{ ok: boolean; error?: string }> {
    return { ok: true };
  }

  /**
   * Session lifecycle end
   */
  async endSession(sessionParams?: Record<string, any>): Promise<{ ok: boolean; error?: string }> {
    return { ok: true };
  }

  /**
   * Session lifecycle alias (draft session to permanent thread)
   */
  async aliasSession(sessionParams?: {
    oldSessionId: string;
    newSessionId: string;
    platform?: string;
    threadId?: string;
    url?: string;
  }): Promise<{ ok: boolean; error?: string }> {
    return { ok: true };
  }

  /**
   * Directly add a single memory
   */
  async addMemory(memory: {
    title?: string;
    narrative: string;
    category?: string;
    metadata?: Record<string, any>;
  }): Promise<MemoryCrudResponse> {
    throw new Error('BaseMemoryEngine.addMemory() must be implemented by subclass');
  }

  /**
   * Update an existing memory by ID
   */
  async updateMemory(
    id: string,
    updates: {
      title?: string;
      narrative?: string;
      category?: string;
      metadata?: Record<string, any>;
    }
  ): Promise<MemoryCrudResponse> {
    throw new Error('BaseMemoryEngine.updateMemory() must be implemented by subclass');
  }

  /**
   * Delete an existing memory by ID
   */
  async deleteMemory(id: string): Promise<MemoryCrudResponse> {
    throw new Error('BaseMemoryEngine.deleteMemory() must be implemented by subclass');
  }

  /**
   * Returns web dashboard / management console URL for this engine.
   */
  getDashboardUrl(): string {
    return 'http://localhost:8000';
  }
}

if (typeof globalThis !== 'undefined') {
  (globalThis as any).BaseMemoryEngine = BaseMemoryEngine;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BaseMemoryEngine };
}
