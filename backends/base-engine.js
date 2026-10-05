"use strict";
// =============================================================================
// WebAI Memory — Base Memory Engine
// Abstract interface and normalization contract for pluggable memory backends.
// =============================================================================
class BaseMemoryEngine {
    config;
    /**
     * @param config - Backend-specific engine configuration
     */
    constructor(config = {}) {
        this.config = config;
    }
    /**
     * Health / Connectivity Probe
     */
    async checkHealth() {
        throw new Error('BaseMemoryEngine.checkHealth() must be implemented by subclass');
    }
    /**
     * Observe conversation turn
     */
    async observe(turn) {
        throw new Error('BaseMemoryEngine.observe() must be implemented by subclass');
    }
    /**
     * Search / Recall memories
     */
    async search(queryParams) {
        throw new Error('BaseMemoryEngine.search() must be implemented by subclass');
    }
    /**
     * Session lifecycle start
     */
    async startSession(sessionParams) {
        return { ok: true };
    }
    /**
     * Session lifecycle end
     */
    async endSession(sessionParams) {
        return { ok: true };
    }
    /**
     * Returns web dashboard / management console URL for this engine.
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
