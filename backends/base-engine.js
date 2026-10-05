// =============================================================================
// WebAI Memory — Base Memory Engine
// Abstract interface and normalization contract for pluggable memory backends.
// =============================================================================

/**
 * Normalized Memory Object Contract
 * @typedef {Object} NormalizedMemory
 * @property {string} id - Unique memory identifier
 * @property {string} title - Card headline / title for display
 * @property {string} [subtitle] - Secondary category, project, or source
 * @property {string} narrative - Body / main text content
 * @property {string[]} facts - Key bullet points / extracted facts
 * @property {number} [score] - Match relevance score
 * @property {string} [sessionId] - Originating session identifier
 * @property {string} [timestamp] - ISO timestamp string
 * @property {Object} [metadata] - Engine-specific raw metadata
 * @property {Object} [raw] - Original unmodified backend record
 */

class BaseMemoryEngine {
  /**
   * @param {Object} [config={}]
   */
  constructor(config = {}) {
    this.config = config;
  }

  /**
   * Health / Connectivity Probe
   * @returns {Promise<{ connected: boolean, engine: string, version?: string, error?: string }>}
   */
  async checkHealth() {
    throw new Error('BaseMemoryEngine.checkHealth() must be implemented by subclass');
  }

  /**
   * Observe conversation turn
   * @param {Object} turn
   * @param {string} [turn.platform]
   * @param {string} [turn.sessionId]
   * @param {string} [turn.content] - Full formatted content string
   * @param {string} [turn.userPrompt] - Distinct user prompt
   * @param {string} [turn.assistantResponse] - Distinct assistant response
   * @param {string} [turn.timestamp] - ISO timestamp
   * @returns {Promise<{ success: boolean, id?: string, error?: string }>}
   */
  async observe(turn) {
    throw new Error('BaseMemoryEngine.observe() must be implemented by subclass');
  }

  /**
   * Search / Recall memories
   * @param {Object} queryParams
   * @param {string} queryParams.query - Search query string
   * @param {number} [queryParams.limit] - Max number of items to return
   * @returns {Promise<{ results: NormalizedMemory[], error?: string }>}
   */
  async search(queryParams) {
    throw new Error('BaseMemoryEngine.search() must be implemented by subclass');
  }

  /**
   * Session lifecycle start
   * @param {Object} [sessionParams]
   * @returns {Promise<{ ok: boolean, error?: string }>}
   */
  async startSession(sessionParams) {
    return { ok: true };
  }

  /**
   * Session lifecycle end
   * @param {Object} [sessionParams]
   * @returns {Promise<{ ok: boolean, error?: string }>}
   */
  async endSession(sessionParams) {
    return { ok: true };
  }

  /**
   * Returns web dashboard / management console URL for this engine.
   * @returns {string}
   */
  getDashboardUrl() {
    return 'http://localhost:8000';
  }
}

if (typeof globalThis !== 'undefined') {
  globalThis.BaseMemoryEngine = BaseMemoryEngine;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BaseMemoryEngine };
}
