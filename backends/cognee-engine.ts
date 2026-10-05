// =============================================================================
// WebAI Memory — Cognee Engine
// Adapter client for Cognee graph memory service (http://localhost:8000).
// =============================================================================

const BaseEngineClassForCognee = (typeof BaseMemoryEngine !== 'undefined')
  ? BaseMemoryEngine
  : (typeof globalThis !== 'undefined' && (globalThis as any).BaseMemoryEngine)
    ? (globalThis as any).BaseMemoryEngine
    : (typeof require !== 'undefined')
      ? require('./base-engine.js').BaseMemoryEngine
      : class {};

class CogneeEngine extends (BaseEngineClassForCognee as typeof BaseMemoryEngine) {
  apiUrl: string;
  apiKey: string;
  datasetName: string;
  timeout: number;

  constructor(config: Record<string, any> = {}) {
    super(config);
    this.apiUrl = this.normalizeUrl(config.apiUrl || 'http://localhost:8000');
    this.apiKey = String(config.apiKey || '').trim();
    this.datasetName = String(config.datasetName || 'main').trim();
    this.timeout = config.timeout || 10000;
  }

  /**
   * Validates and normalizes Cognee endpoints.
   */
  normalizeUrl(value: string): string {
    let raw = String(value || 'http://localhost:8000').trim();
    raw = raw.replace(/\/+$/, '');

    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('Cognee URL must use http:// or https://');
    }

    return raw;
  }

  /**
   * @private
   */
  _headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) {
      if (this.apiKey.startsWith('Bearer ')) {
        h['Authorization'] = this.apiKey;
      } else {
        h['Authorization'] = `Bearer ${this.apiKey}`;
      }
      h['X-Api-Key'] = this.apiKey;
    }
    return h;
  }

  /**
   * @private
   */
  _resolveEndpoint(subpath: string): string {
    const base = this.apiUrl.replace(/\/+$/, '');
    const cleanSubpath = String(subpath || '').replace(/^\/+/, '');
    return `${base}/${cleanSubpath}`;
  }

  /**
   * Health probe: verifies connectivity to Cognee API server.
   */
  async checkHealth(): Promise<HealthCheckResult> {
    try {
      let res: Response | null = null;
      try {
        res = await fetch(this._resolveEndpoint('api/v1/health'), {
          method: 'GET',
          headers: this._headers(),
          signal: AbortSignal.timeout(3000),
        });
      } catch {
        res = null;
      }

      if (!res || !res.ok) {
        try {
          res = await fetch(this._resolveEndpoint('health'), {
            method: 'GET',
            headers: this._headers(),
            signal: AbortSignal.timeout(3000),
          });
        } catch {
          // Fall through
        }
      }

      if (res && res.ok) {
        const data: any = await res.json().catch(() => ({}));
        return { connected: true, engine: 'cognee', version: data.version || 'v1' };
      }

      if (res && (res.status === 401 || res.status === 403)) {
        return {
          connected: false,
          engine: 'cognee',
          error: `Invalid Cognee API Key (HTTP ${res.status})`,
        };
      }

      if (res) {
        const data: any = await res.json().catch(() => ({}));
        return {
          connected: false,
          engine: 'cognee',
          error: data.message || data.error || `Cognee returned HTTP ${res.status}`,
        };
      }

      return { connected: false, engine: 'cognee', error: 'Failed to connect to Cognee endpoint' };
    } catch (err: any) {
      return { connected: false, engine: 'cognee', error: err.message };
    }
  }

  /**
   * Observe conversation turn: ingests and optionally cognifies memory.
   */
  async observe(turn: Partial<ConversationTurn>): Promise<ObserveResponse> {
    try {
      let content = turn.content;
      if (!content && turn.userPrompt && turn.assistantResponse) {
        content = `User: ${turn.userPrompt}\n\nAssistant: ${turn.assistantResponse}`;
      } else if (!content && turn.userPrompt) {
        content = String(turn.userPrompt);
      } else if (!content && turn.assistantResponse) {
        content = String(turn.assistantResponse);
      }
      content = String(content || '').trim();

      const payload = {
        data: content,
        text: content,
        datasetName: this.datasetName || 'main',
        metadata: {
          platform: turn.platform || 'unknown',
          sessionId: turn.sessionId || '',
          timestamp: turn.timestamp || new Date().toISOString(),
        },
      };

      let url = this._resolveEndpoint('api/v1/add');
      let res = await fetch(url, {
        method: 'POST',
        headers: this._headers(),
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!res.ok && res.status === 404) {
        url = this._resolveEndpoint('add');
        res = await fetch(url, {
          method: 'POST',
          headers: this._headers(),
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(this.timeout),
        });
      }

      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          success: false,
          error: data.message || data.error || `Cognee returned HTTP ${res.status}`,
          status: res.status,
        };
      }

      // Background cognify trigger if supported
      try {
        const cognifyUrl = this._resolveEndpoint('api/v1/cognify');
        fetch(cognifyUrl, {
          method: 'POST',
          headers: this._headers(),
          body: JSON.stringify({ datasets: [this.datasetName || 'main'] }),
          signal: AbortSignal.timeout(2000),
        }).catch(() => {});
      } catch {
        // Ignore
      }

      return { success: true, ...data };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Search / Recall memories or retrieve recent memories when query is empty.
   */
  async search({ query = '', limit = 5 }: { query?: string; limit?: number } = {}): Promise<SearchResponse> {
    try {
      const q = String(query || '').trim();

      // If query is empty, try listing memories via GET /api/v1/memories or /memories first
      if (!q) {
        try {
          let listUrl = `${this._resolveEndpoint('api/v1/memories')}?datasetName=${encodeURIComponent(this.datasetName || 'main')}&limit=${encodeURIComponent(limit)}`;
          let listRes = await fetch(listUrl, {
            method: 'GET',
            headers: this._headers(),
            signal: AbortSignal.timeout(this.timeout),
          });
          if (!listRes.ok && listRes.status === 404) {
            listUrl = `${this._resolveEndpoint('memories')}?datasetName=${encodeURIComponent(this.datasetName || 'main')}&limit=${encodeURIComponent(limit)}`;
            listRes = await fetch(listUrl, {
              method: 'GET',
              headers: this._headers(),
              signal: AbortSignal.timeout(this.timeout),
            });
          }
          if (listRes.ok) {
            const listData: any = await listRes.json();
            const items: any[] = Array.isArray(listData) ? listData : (listData.results || listData.memories || []);
            return { results: items.map((item) => this._normalizeItem(item)) };
          }
        } catch {
          // Fall through
        }
      }

      const payload = {
        query: q || '*',
        datasets: [this.datasetName || 'main'],
        top_k: limit,
        limit,
      };

      let url = this._resolveEndpoint('api/v1/search');
      let res = await fetch(url, {
        method: 'POST',
        headers: this._headers(),
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!res.ok && res.status === 404) {
        url = this._resolveEndpoint('search');
        res = await fetch(url, {
          method: 'POST',
          headers: this._headers(),
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(this.timeout),
        });
      }

      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          results: [],
          error: data.message || data.error || `Cognee returned HTTP ${res.status}`,
          status: res.status,
        };
      }

      const items: any[] = Array.isArray(data) ? data : (data.results || data.memories || data.data || []);
      return { results: items.map((item) => this._normalizeItem(item)) };
    } catch (err: any) {
      return { results: [], error: err.message };
    }
  }

  /**
   * Normalizes Cognee search / dataset item into NormalizedMemory.
   * @private
   */
  _normalizeItem(item: any): NormalizedMemory {
    if (!item) {
      return {
        id: `cognee_${Math.random().toString(36).slice(2)}`,
        title: 'Cognee Memory',
        subtitle: `cognee · ${this.datasetName || 'main'}`,
        narrative: '',
        facts: [],
      };
    }
    if (typeof item === 'string') {
      const text = item.trim();
      return {
        id: `cognee_${Math.random().toString(36).slice(2)}`,
        title: text.length > 50 ? `${text.slice(0, 47)}...` : (text || 'Cognee Memory'),
        subtitle: `cognee · ${this.datasetName || 'main'}`,
        narrative: text,
        facts: text ? [text] : [],
        score: undefined,
        sessionId: '',
        timestamp: '',
        metadata: { text },
        raw: item,
      };
    }
    const text = item.text || item.content || item.data || item.narrative || item.memory || item.search_result || '';
    const title = item.title
      || item.metadata?.title
      || (text.length > 50 ? `${text.slice(0, 47)}...` : text)
      || 'Cognee Memory';
    const subtitle = item.subtitle
      || item.metadata?.platform
      || (item.datasetName ? `cognee · ${item.datasetName}` : `cognee · ${this.datasetName || 'main'}`);
    const facts = Array.isArray(item.facts)
      ? item.facts
      : (Array.isArray(item.metadata?.facts) ? item.metadata.facts : (text ? [text] : []));
    const score = typeof item.score === 'number'
      ? Math.round(item.score * 1000) / 1000
      : undefined;

    return {
      id: String(item.id || item.memory_id || `cognee_${Math.random().toString(36).slice(2)}`),
      title,
      subtitle,
      narrative: text,
      facts,
      score,
      sessionId: item.sessionId || item.metadata?.sessionId || '',
      timestamp: item.timestamp || item.created_at || item.metadata?.timestamp || '',
      metadata: item.metadata || item,
      raw: item,
    };
  }

  async startSession(): Promise<{ ok: boolean }> {
    return { ok: true };
  }

  async endSession(): Promise<{ ok: boolean }> {
    return { ok: true };
  }

  /**
   * Returns dashboard URL
   */
  getDashboardUrl(): string {
    return this.apiUrl;
  }
}

if (typeof globalThis !== 'undefined') {
  (globalThis as any).CogneeEngine = CogneeEngine;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CogneeEngine };
}
