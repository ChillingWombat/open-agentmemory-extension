// =============================================================================
// WebAI Memory — Hindsight Engine
// Adapter client for Hindsight agent memory service (http://localhost:8888).
// =============================================================================

const BaseEngineClassForHindsight = (typeof BaseMemoryEngine !== 'undefined')
  ? BaseMemoryEngine
  : (typeof globalThis !== 'undefined' && (globalThis as any).BaseMemoryEngine)
    ? (globalThis as any).BaseMemoryEngine
    : (typeof require !== 'undefined')
      ? require('./base-engine.js').BaseMemoryEngine
      : class {};

class HindsightEngine extends (BaseEngineClassForHindsight as typeof BaseMemoryEngine) {
  apiUrl: string;
  apiKey: string;
  bankId: string;
  timeout: number;

  constructor(config: Record<string, any> = {}) {
    super(config);
    this.apiUrl = this.normalizeUrl(config.apiUrl || 'http://localhost:8888');
    this.apiKey = String(config.apiKey || '').trim();
    this.bankId = String(config.bankId || 'default').trim();
    this.timeout = config.timeout || 10000;
  }

  /**
   * Validates and normalizes Hindsight endpoints.
   */
  normalizeUrl(value: string): string {
    let raw = String(value || 'http://localhost:8888').trim();
    raw = raw.replace(/\/+$/, '');

    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('Hindsight URL must use http:// or https://');
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
   * Health probe: verifies connectivity to Hindsight API server.
   */
  async checkHealth(): Promise<HealthCheckResult> {
    try {
      let url = this._resolveEndpoint('health');
      let res: Response | null = await fetch(url, {
        method: 'GET',
        headers: this._headers(),
        signal: AbortSignal.timeout(3000),
      }).catch(() => null);

      if (!res || !res.ok) {
        const fallbackUrl = this._resolveEndpoint('api/v1/health');
        const fallbackRes: Response | null = await fetch(fallbackUrl, {
          method: 'GET',
          headers: this._headers(),
          signal: AbortSignal.timeout(3000),
        }).catch(() => null);
        if (fallbackRes) res = fallbackRes;
      }

      if (res && res.ok) {
        const data: any = await res.json().catch(() => ({}));
        return { connected: true, engine: 'hindsight', version: data.version || 'v1' };
      }

      if (res && (res.status === 401 || res.status === 403)) {
        return {
          connected: false,
          engine: 'hindsight',
          error: `Invalid Hindsight API Key (HTTP ${res.status})`,
        };
      }

      if (res) {
        const data: any = await res.json().catch(() => ({}));
        return {
          connected: false,
          engine: 'hindsight',
          error: data.message || data.error || `Hindsight returned HTTP ${res.status}`,
        };
      }

      return { connected: false, engine: 'hindsight', error: 'Failed to connect to Hindsight service' };
    } catch (err: any) {
      return { connected: false, engine: 'hindsight', error: err.message };
    }
  }

  /**
   * Retain / Observe conversation turn.
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
        bank_id: this.bankId || 'default',
        content,
        text: content,
        context: {
          platform: turn.platform || 'unknown',
          sessionId: turn.sessionId || '',
          timestamp: turn.timestamp || new Date().toISOString(),
        },
        metadata: {
          platform: turn.platform || 'unknown',
          sessionId: turn.sessionId || '',
          project: `${turn.platform || 'unknown'}-web`,
          timestamp: turn.timestamp || new Date().toISOString(),
        },
      };

      let url = this._resolveEndpoint('retain');
      let res = await fetch(url, {
        method: 'POST',
        headers: this._headers(),
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!res.ok && res.status === 404) {
        url = this._resolveEndpoint('api/v1/retain');
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
          error: data.message || data.error || `Hindsight returned HTTP ${res.status}`,
          status: res.status,
        };
      }

      return { success: true, ...data };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Recall / Search memories or retrieve recent memories when query is empty.
   */
  async search({ query = '', limit = 5 }: { query?: string; limit?: number } = {}): Promise<SearchResponse> {
    try {
      const q = String(query || '').trim();

      // If query is empty, try listing recent memories via GET /memories or /api/v1/memories first
      if (!q) {
        try {
          let listUrl = `${this._resolveEndpoint('memories')}?bank_id=${encodeURIComponent(this.bankId || 'default')}&limit=${encodeURIComponent(limit)}`;
          let listRes = await fetch(listUrl, {
            method: 'GET',
            headers: this._headers(),
            signal: AbortSignal.timeout(this.timeout),
          });
          if (!listRes.ok && listRes.status === 404) {
            listUrl = `${this._resolveEndpoint('api/v1/memories')}?bank_id=${encodeURIComponent(this.bankId || 'default')}&limit=${encodeURIComponent(limit)}`;
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
          // Fall through to recall
        }
      }

      const payload = {
        bank_id: this.bankId || 'default',
        query: q,
        limit,
        top_k: limit,
      };

      let url = this._resolveEndpoint('recall');
      let res = await fetch(url, {
        method: 'POST',
        headers: this._headers(),
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!res.ok && res.status === 404) {
        url = this._resolveEndpoint('api/v1/recall');
        res = await fetch(url, {
          method: 'POST',
          headers: this._headers(),
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(this.timeout),
        });
      }

      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        // If recall returned 404 on empty query, try GET /memories fallback
        if (!q && res.status === 404) {
          try {
            const listUrl = `${this._resolveEndpoint('memories')}?bank_id=${encodeURIComponent(this.bankId || 'default')}&limit=${encodeURIComponent(limit)}`;
            const listRes = await fetch(listUrl, {
              method: 'GET',
              headers: this._headers(),
              signal: AbortSignal.timeout(this.timeout),
            });
            if (listRes.ok) {
              const listData: any = await listRes.json();
              const items: any[] = Array.isArray(listData) ? listData : (listData.results || listData.memories || []);
              return { results: items.map((item) => this._normalizeItem(item)) };
            }
          } catch {
            // Ignore
          }
        }

        return {
          results: [],
          error: data.message || data.error || `Hindsight returned HTTP ${res.status}`,
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
   * Normalizes a Hindsight recall / memory item into NormalizedMemory.
   * @private
   */
  _normalizeItem(item: any): NormalizedMemory {
    if (!item) {
      return {
        id: `hindsight_${Math.random().toString(36).slice(2)}`,
        title: 'Hindsight Memory',
        subtitle: `hindsight · ${this.bankId || 'default'}`,
        narrative: '',
        facts: [],
      };
    }
    if (typeof item === 'string') {
      const text = item.trim();
      return {
        id: `hindsight_${Math.random().toString(36).slice(2)}`,
        title: text.length > 50 ? `${text.slice(0, 47)}...` : (text || 'Hindsight Memory'),
        subtitle: `hindsight · ${this.bankId || 'default'}`,
        narrative: text,
        facts: text ? [text] : [],
        score: undefined,
        sessionId: '',
        timestamp: '',
        metadata: { text },
        raw: item,
      };
    }
    const text = item.text || item.content || item.narrative || item.memory || '';
    const title = item.title
      || item.metadata?.title
      || item.topic
      || (text.length > 50 ? `${text.slice(0, 47)}...` : text)
      || 'Hindsight Memory';
    const subtitle = item.subtitle
      || item.metadata?.platform
      || (item.bank_id ? `hindsight · ${item.bank_id}` : `hindsight · ${this.bankId || 'default'}`);
    const facts = Array.isArray(item.facts)
      ? item.facts
      : (Array.isArray(item.metadata?.facts) ? item.metadata.facts : (text ? [text] : []));
    const score = typeof item.score === 'number'
      ? Math.round(item.score * 1000) / 1000
      : undefined;

    return {
      id: String(item.id || item.memory_id || `hindsight_${Math.random().toString(36).slice(2)}`),
      title,
      subtitle,
      narrative: text,
      facts,
      score,
      sessionId: item.sessionId || item.metadata?.sessionId || item.context?.sessionId || '',
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
   * Adds a memory directly via POST /retain (fallback POST /api/v1/retain).
   */
  async addMemory({ title = '', narrative = '', category = '', metadata = {} }: {
    title?: string;
    narrative: string;
    category?: string;
    metadata?: Record<string, any>;
  }): Promise<MemoryCrudResponse> {
    try {
      const payload = {
        bank_id: this.bankId || 'default',
        content: narrative,
        text: narrative,
        title: title || 'Manual Memory',
        context: {
          category: category || 'manual',
          source: 'manual_popup',
          timestamp: new Date().toISOString(),
        },
        metadata: {
          title: title || 'Manual Memory',
          category: category || 'manual',
          source: 'manual_popup',
          timestamp: new Date().toISOString(),
          ...metadata,
        },
      };

      let url = this._resolveEndpoint('retain');
      let res: Response | null = await fetch(url, {
        method: 'POST',
        headers: this._headers(),
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeout),
      }).catch(() => null);

      if (!res || (!res.ok && res.status === 404)) {
        url = this._resolveEndpoint('api/v1/retain');
        const fallbackRes = await fetch(url, {
          method: 'POST',
          headers: this._headers(),
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(this.timeout),
        }).catch(() => null);
        if (fallbackRes) res = fallbackRes;
      }

      if (!res) {
        return { success: false, error: 'Failed to connect to Hindsight service' };
      }

      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          success: false,
          error: data.message || data.error || `Hindsight returned HTTP ${res.status}`,
          status: res.status,
        };
      }

      return { success: true, id: String(data.id || data.memory_id || `hindsight_${Date.now()}`) };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Updates a memory via PUT /memories/:id (fallback PUT /api/v1/memories/:id).
   */
  async updateMemory(id: string, updates: {
    title?: string;
    narrative?: string;
    category?: string;
    metadata?: Record<string, any>;
  }): Promise<MemoryCrudResponse> {
    try {
      const payload = {
        bank_id: this.bankId || 'default',
        content: updates.narrative,
        text: updates.narrative,
        title: updates.title || '',
        metadata: {
          title: updates.title,
          category: updates.category,
          ...updates.metadata,
        },
      };

      let url = `${this._resolveEndpoint('memories')}/${encodeURIComponent(id)}`;
      let res: Response | null = await fetch(url, {
        method: 'PUT',
        headers: this._headers(),
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeout),
      }).catch(() => null);

      if (!res || (!res.ok && res.status === 404)) {
        url = `${this._resolveEndpoint('api/v1/memories')}/${encodeURIComponent(id)}`;
        const fallbackRes = await fetch(url, {
          method: 'PUT',
          headers: this._headers(),
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(this.timeout),
        }).catch(() => null);
        if (fallbackRes) res = fallbackRes;
      }

      if (!res) {
        return { success: false, error: 'Failed to connect to Hindsight service' };
      }

      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          success: false,
          error: data.message || data.error || `Hindsight returned HTTP ${res.status}`,
          status: res.status,
        };
      }

      return { success: true, id };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Deletes a memory via DELETE /memories/:id?bank_id=... (fallback DELETE /api/v1/memories/:id?bank_id=...).
   */
  async deleteMemory(id: string): Promise<MemoryCrudResponse> {
    try {
      const bankParam = encodeURIComponent(this.bankId || 'default');
      let url = `${this._resolveEndpoint('memories')}/${encodeURIComponent(id)}?bank_id=${bankParam}`;
      let res: Response | null = await fetch(url, {
        method: 'DELETE',
        headers: this._headers(),
        signal: AbortSignal.timeout(this.timeout),
      }).catch(() => null);

      if (!res || (!res.ok && res.status === 404)) {
        url = `${this._resolveEndpoint('api/v1/memories')}/${encodeURIComponent(id)}?bank_id=${bankParam}`;
        const fallbackRes = await fetch(url, {
          method: 'DELETE',
          headers: this._headers(),
          signal: AbortSignal.timeout(this.timeout),
        }).catch(() => null);
        if (fallbackRes) res = fallbackRes;
      }

      if (!res) {
        return { success: false, error: 'Failed to connect to Hindsight service' };
      }

      if (!res.ok) {
        const data: any = await res.json().catch(() => ({}));
        return {
          success: false,
          error: data.message || data.error || `Hindsight returned HTTP ${res.status}`,
          status: res.status,
        };
      }

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Returns dashboard URL
   */
  getDashboardUrl(): string {
    return this.apiUrl;
  }
}

if (typeof globalThis !== 'undefined') {
  (globalThis as any).HindsightEngine = HindsightEngine;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { HindsightEngine };
}
