// =============================================================================
// WebAI Memory — AgentMemory Engine
// Adapter client for loopback AgentMemory daemon (http://localhost:3111/agentmemory/*).
// =============================================================================

const BaseEngineClass = (typeof BaseMemoryEngine !== 'undefined')
  ? BaseMemoryEngine
  : (typeof globalThis !== 'undefined' && globalThis.BaseMemoryEngine)
    ? globalThis.BaseMemoryEngine
    : (typeof require !== 'undefined')
      ? require('./base-engine.js').BaseMemoryEngine
      : class {};

class AgentMemoryEngine extends BaseEngineClass {
  /**
   * @param {Object} [config={}]
   * @param {string} [config.apiUrl='http://localhost:3111']
   * @param {string} [config.secret='']
   * @param {number} [config.timeout=10000]
   */
  constructor(config = {}) {
    super(config);
    this.apiUrl = this.normalizeUrl(config.apiUrl || 'http://localhost:3111');
    this.secret = String(config.secret || '').trim();
    this.timeout = config.timeout || 10000;
  }

  /**
   * Enforces loopback-only HTTP address to prevent credential leakage.
   * @param {string} value
   * @returns {string} origin
   */
  normalizeUrl(value) {
    const url = new URL(String(value || '').trim());
    const isLoopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';

    if (url.protocol !== 'http:' || !isLoopback || url.username || url.password) {
      throw new Error('AgentMemory URL must be an http://localhost or http://127.0.0.1 address');
    }

    return url.origin;
  }

  /**
   * @private
   */
  _authHeaders() {
    const h = { 'Content-Type': 'application/json' };
    if (this.secret) {
      h['Authorization'] = `Bearer ${this.secret}`;
    }
    return h;
  }

  /**
   * @private
   */
  async _request(endpoint, { method = 'POST', body, timeout = this.timeout } = {}) {
    try {
      const res = await fetch(`${this.apiUrl}/agentmemory/${endpoint}`, {
        method,
        headers: this._authHeaders(),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeout),
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          error: payload.error || `AgentMemory returned HTTP ${res.status}`,
          status: res.status,
        };
      }
      return payload;
    } catch (err) {
      return { error: err.message };
    }
  }

  /**
   * @returns {Promise<{ connected: boolean, engine: string, version?: string, error?: string }>}
   */
  async checkHealth() {
    const health = await this._request('health', { method: 'GET', timeout: 3000 });
    return {
      connected: !health.error,
      engine: 'agentmemory',
      version: health.version,
      error: health.error,
    };
  }

  /**
   * @param {Object} turn
   * @returns {Promise<{ success: boolean, id?: string, error?: string }>}
   */
  async observe(turn) {
    const platform = turn.platform || 'unknown';
    let prompt = turn.content;
    if (!prompt && turn.userPrompt && turn.assistantResponse) {
      prompt = `User: ${turn.userPrompt}\n\nAssistant: ${turn.assistantResponse}`;
    }

    const payload = {
      hookType: 'prompt_submit',
      sessionId: turn.sessionId || `web_${platform}_${Date.now().toString(36)}`,
      project: `${platform}-web`,
      cwd: `browser:${platform}`,
      timestamp: turn.timestamp || new Date().toISOString(),
      data: { prompt: prompt || '' },
    };

    const res = await this._request('observe', { body: payload });
    if (res.error) {
      return { success: false, error: res.error, status: res.status };
    }
    return { success: true, ...res };
  }

  /**
   * @param {Object} queryParams
   * @param {string} queryParams.query
   * @param {number} [queryParams.limit=3]
   * @returns {Promise<{ results: NormalizedMemory[], error?: string }>}
   */
  async search({ query, limit = 3 }) {
    const res = await this._request('search', { body: { query, limit } });
    if (res.error) {
      return { results: [], error: res.error, status: res.status };
    }

    const rawItems = Array.isArray(res.results) ? res.results : [];
    const normalized = rawItems.map((item) => {
      const obs = item.observation || item;
      return {
        id: obs.id || (obs.sessionId ? `${obs.sessionId}_${obs.timestamp || ''}` : `agentmem_${Math.random().toString(36).slice(2)}`),
        title: obs.title || obs.subtitle || 'Memory',
        subtitle: obs.subtitle || '',
        narrative: obs.narrative || '',
        facts: Array.isArray(obs.facts) ? obs.facts : [],
        score: typeof obs.score === 'number' ? obs.score : (typeof item.score === 'number' ? item.score : undefined),
        sessionId: obs.sessionId || '',
        timestamp: obs.timestamp || '',
        metadata: obs,
        raw: item,
      };
    });

    return { results: normalized };
  }

  /**
   * @param {Object} sessionParams
   */
  async startSession({ sessionId, platform, project }) {
    return this._request('session/start', {
      body: {
        sessionId,
        project: project || `${platform || 'unknown'}-web`,
        cwd: `browser:${platform || 'unknown'}`,
      },
    });
  }

  /**
   * @param {Object} sessionParams
   */
  async endSession({ sessionId }) {
    return this._request('session/end', { body: { sessionId } });
  }

  /**
   * @returns {string}
   */
  getDashboardUrl() {
    return 'http://localhost:3113';
  }
}

if (typeof globalThis !== 'undefined') {
  globalThis.AgentMemoryEngine = AgentMemoryEngine;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AgentMemoryEngine };
}
