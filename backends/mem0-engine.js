"use strict";
// =============================================================================
// WebAI Memory — Mem0 Engine
// Adapter client for Mem0 Cloud (https://api.mem0.ai/v1) and local/self-hosted instances.
// =============================================================================
const BaseEngineClassForMem0 = (typeof BaseMemoryEngine !== 'undefined')
    ? BaseMemoryEngine
    : (typeof globalThis !== 'undefined' && globalThis.BaseMemoryEngine)
        ? globalThis.BaseMemoryEngine
        : (typeof require !== 'undefined')
            ? require('./base-engine.js').BaseMemoryEngine
            : class {
            };
class Mem0Engine extends BaseEngineClassForMem0 {
    apiUrl;
    apiKey;
    userId;
    orgId;
    projectId;
    timeout;
    isConsoleMode;
    constructor(config = {}) {
        super(config);
        this.apiUrl = this.normalizeUrl(config.apiUrl || 'https://api.mem0.ai/v1');
        this.apiKey = String(config.apiKey || '').trim();
        this.userId = String(config.userId || 'default_user').trim();
        this.orgId = String(config.orgId || '').trim();
        this.projectId = String(config.projectId || '').trim();
        this.timeout = config.timeout || 10000;
        this.isConsoleMode = false;
    }
    /**
     * Validates and normalizes Mem0 endpoints (supports http and https).
     */
    normalizeUrl(value) {
        let raw = String(value || 'https://api.mem0.ai/v1').trim();
        raw = raw.replace(/\/+$/, '');
        const url = new URL(raw);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            throw new Error('Mem0 URL must use http:// or https://');
        }
        // Default to /v1 on Mem0 Cloud if omitted
        if (url.hostname === 'api.mem0.ai' && (!url.pathname || url.pathname === '/' || !url.pathname.startsWith('/v1'))) {
            return `${url.origin}/v1`;
        }
        return raw;
    }
    /**
     * Constructs authorization and tracking headers.
     * @private
     */
    _headers() {
        const h = { 'Content-Type': 'application/json' };
        if (this.apiKey) {
            if (this.apiKey.startsWith('Bearer ') || this.apiKey.startsWith('Token ')) {
                h['Authorization'] = this.apiKey;
            }
            else {
                h['Authorization'] = `Token ${this.apiKey}`;
            }
        }
        if (this.orgId)
            h['X-Org-Id'] = this.orgId;
        if (this.projectId)
            h['X-Project-Id'] = this.projectId;
        return h;
    }
    /**
     * Appends relative subpath to normalized base URL.
     * @private
     */
    _resolveEndpoint(subpath) {
        const base = this.apiUrl.replace(/\/+$/, '');
        const cleanSubpath = String(subpath || '').replace(/^\/+/, '');
        return `${base}/${cleanSubpath}`;
    }
    /**
     * Health probe: verifies connectivity to standard Mem0 or local console.
     */
    async checkHealth() {
        try {
            const isLoopback = this.apiUrl.includes('127.0.0.1') || this.apiUrl.includes('localhost');
            // If local console without an API key, check /api/memories first
            if (isLoopback && !this.apiKey) {
                try {
                    const localUrl = `${this.apiUrl.replace(/\/+$/, '')}/api/memories`;
                    const localRes = await fetch(localUrl, {
                        method: 'GET',
                        headers: { 'Content-Type': 'application/json' },
                        signal: AbortSignal.timeout(3000),
                    });
                    if (localRes.ok) {
                        this.isConsoleMode = true;
                        return { connected: true, engine: 'mem0', version: 'local-console' };
                    }
                }
                catch {
                    // Fall through to standard probe
                }
            }
            // Standard Mem0 endpoint probe
            const url = `${this._resolveEndpoint('memories')}?limit=1&user_id=${encodeURIComponent(this.userId)}`;
            const res = await fetch(url, {
                method: 'GET',
                headers: this._headers(),
                signal: AbortSignal.timeout(4000),
            });
            if (res.ok) {
                this.isConsoleMode = false;
                return { connected: true, engine: 'mem0', version: 'v1' };
            }
            if (res.status === 401 || res.status === 403) {
                return {
                    connected: false,
                    engine: 'mem0',
                    error: `Invalid Mem0 API Key (HTTP ${res.status})`,
                };
            }
            // Fallback for local console if standard probe gave 404
            if (isLoopback) {
                try {
                    const localUrl = `${this.apiUrl.replace(/\/+$/, '')}/api/memories`;
                    const localRes = await fetch(localUrl, {
                        method: 'GET',
                        headers: { 'Content-Type': 'application/json' },
                        signal: AbortSignal.timeout(2000),
                    });
                    if (localRes.ok) {
                        this.isConsoleMode = true;
                        return { connected: true, engine: 'mem0', version: 'local-console' };
                    }
                }
                catch {
                    // Ignore
                }
            }
            const data = await res.json().catch(() => ({}));
            return {
                connected: false,
                engine: 'mem0',
                error: data.message || data.error || `Mem0 returned HTTP ${res.status}`,
            };
        }
        catch (err) {
            return { connected: false, engine: 'mem0', error: err.message };
        }
    }
    /**
     * Splits turn content into user and assistant dialogue blocks.
     * @private
     */
    _parseMessages(turn) {
        if (turn.userPrompt && turn.assistantResponse) {
            return [
                { role: 'user', content: String(turn.userPrompt).trim() },
                { role: 'assistant', content: String(turn.assistantResponse).trim() },
            ];
        }
        const content = String(turn.content || '').trim();
        const match = content.match(/^User:\s*([\s\S]*?)\n\nAssistant:\s*([\s\S]*)$/i);
        if (match) {
            return [
                { role: 'user', content: match[1].trim() },
                { role: 'assistant', content: match[2].trim() },
            ];
        }
        if (turn.userPrompt) {
            return [{ role: 'user', content: String(turn.userPrompt).trim() }];
        }
        return [{ role: 'user', content }];
    }
    /**
     * Ingests conversation turn as memories via local POST /api/add or standard POST /memories.
     */
    async observe(turn) {
        try {
            const messages = this._parseMessages(turn);
            const isLoopback = this.apiUrl.includes('127.0.0.1') || this.apiUrl.includes('localhost');
            // Local console mode: POST /api/add
            if ((this.isConsoleMode || isLoopback) && !this.apiKey) {
                try {
                    const localAddUrl = `${this.apiUrl.replace(/\/+$/, '')}/api/add`;
                    const rawContent = String(turn.content || messages.map((m) => `${m.role}: ${m.content}`).join('\n\n')).trim();
                    const localRes = await fetch(localAddUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            content: rawContent,
                            category: 'auto_session_memory',
                            project: `${turn.platform || 'web'}-session`,
                            concepts: turn.platform || '',
                        }),
                        signal: AbortSignal.timeout(this.timeout),
                    });
                    if (localRes.ok) {
                        const data = await localRes.json().catch(() => ({}));
                        return { success: true, ...data };
                    }
                }
                catch {
                    // Fall through to standard
                }
            }
            // Standard Mem0 POST /memories
            const payload = {
                messages,
                user_id: this.userId,
                metadata: {
                    platform: turn.platform || 'unknown',
                    sessionId: turn.sessionId || '',
                    project: `${turn.platform || 'unknown'}-web`,
                    cwd: `browser:${turn.platform || 'unknown'}`,
                    timestamp: turn.timestamp || new Date().toISOString(),
                },
            };
            if (this.orgId)
                payload.org_id = this.orgId;
            if (this.projectId)
                payload.project_id = this.projectId;
            const url = this._resolveEndpoint('memories');
            const res = await fetch(url, {
                method: 'POST',
                headers: this._headers(),
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(this.timeout),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                return {
                    success: false,
                    error: data.message || data.error || `Mem0 returned HTTP ${res.status}`,
                    status: res.status,
                };
            }
            return { success: true, ...data };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    }
    /**
     * Recalls memories via local GET /api/search or standard POST /memories/search.
     */
    async search({ query = '', limit = 5 } = {}) {
        try {
            const q = String(query || '').trim();
            const isLoopback = this.apiUrl.includes('127.0.0.1') || this.apiUrl.includes('localhost');
            // If query is empty, retrieve recent memories via GET /memories
            if (!q) {
                if ((this.isConsoleMode || isLoopback) && !this.apiKey) {
                    try {
                        const localMemoriesUrl = `${this.apiUrl.replace(/\/+$/, '')}/api/memories?limit=${encodeURIComponent(limit)}`;
                        const localRes = await fetch(localMemoriesUrl, {
                            method: 'GET',
                            headers: { 'Content-Type': 'application/json' },
                            signal: AbortSignal.timeout(this.timeout),
                        });
                        if (localRes.ok) {
                            const data = await localRes.json();
                            const items = Array.isArray(data) ? data : (data.results || data.memories || []);
                            return { results: items.map((item) => this._normalizeItem(item)) };
                        }
                    }
                    catch {
                        // Fall through
                    }
                }
                try {
                    let listUrl = `${this._resolveEndpoint('memories')}?limit=${encodeURIComponent(limit)}&user_id=${encodeURIComponent(this.userId)}`;
                    if (this.orgId)
                        listUrl += `&org_id=${encodeURIComponent(this.orgId)}`;
                    if (this.projectId)
                        listUrl += `&project_id=${encodeURIComponent(this.projectId)}`;
                    const listRes = await fetch(listUrl, {
                        method: 'GET',
                        headers: this._headers(),
                        signal: AbortSignal.timeout(this.timeout),
                    });
                    if (listRes.ok) {
                        const listData = await listRes.json();
                        const items = Array.isArray(listData) ? listData : (listData.results || listData.memories || []);
                        return { results: items.map((item) => this._normalizeItem(item)) };
                    }
                }
                catch {
                    // Fall through
                }
            }
            // Local console mode: GET /api/search?q=...&limit=...
            if ((this.isConsoleMode || isLoopback) && !this.apiKey) {
                try {
                    const localSearchUrl = `${this.apiUrl.replace(/\/+$/, '')}/api/search?q=${encodeURIComponent(q)}&limit=${encodeURIComponent(limit)}`;
                    const localRes = await fetch(localSearchUrl, {
                        method: 'GET',
                        headers: { 'Content-Type': 'application/json' },
                        signal: AbortSignal.timeout(this.timeout),
                    });
                    if (localRes.ok) {
                        const data = await localRes.json();
                        const items = Array.isArray(data) ? data : (data.results || data.memories || []);
                        const normalized = items.map((item) => this._normalizeItem(item));
                        return { results: normalized };
                    }
                }
                catch {
                    // Fall through to standard
                }
            }
            // Standard Mem0 POST /memories/search
            const payload = {
                query: q,
                user_id: this.userId,
                limit,
            };
            if (this.orgId)
                payload.org_id = this.orgId;
            if (this.projectId)
                payload.project_id = this.projectId;
            const url = this._resolveEndpoint('memories/search');
            const res = await fetch(url, {
                method: 'POST',
                headers: this._headers(),
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(this.timeout),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                // If 404 on loopback, attempt /api/search fallback
                if (res.status === 404 && isLoopback) {
                    try {
                        const fbUrl = `${this.apiUrl.replace(/\/+$/, '')}/api/search?q=${encodeURIComponent(query)}&limit=${encodeURIComponent(limit)}`;
                        const fbRes = await fetch(fbUrl, { method: 'GET', signal: AbortSignal.timeout(this.timeout) });
                        if (fbRes.ok) {
                            const fbData = await fbRes.json();
                            const items = Array.isArray(fbData) ? fbData : (fbData.results || []);
                            return { results: items.map((item) => this._normalizeItem(item)) };
                        }
                    }
                    catch {
                        // Ignore
                    }
                }
                return {
                    results: [],
                    error: data.message || data.error || `Mem0 returned HTTP ${res.status}`,
                    status: res.status,
                };
            }
            const items = Array.isArray(data) ? data : (data.results || data.data || []);
            const normalized = items.map((item) => this._normalizeItem(item));
            return { results: normalized };
        }
        catch (err) {
            return { results: [], error: err.message };
        }
    }
    /**
     * Normalizes a memory item from either standard Mem0 API or local console.
     * @private
     */
    _normalizeItem(item) {
        if (!item) {
            return {
                id: `mem0_${Math.random().toString(36).slice(2)}`,
                title: 'Mem0 Memory',
                subtitle: 'mem0',
                narrative: '',
                facts: [],
            };
        }
        if (typeof item === 'string') {
            const text = item.trim();
            return {
                id: `mem0_${Math.random().toString(36).slice(2)}`,
                title: text.length > 50 ? `${text.slice(0, 47)}...` : (text || 'Mem0 Memory'),
                subtitle: 'mem0',
                narrative: text,
                facts: text ? [text] : [],
                score: undefined,
                sessionId: this.userId || '',
                timestamp: '',
                metadata: { text },
                raw: item,
            };
        }
        const text = item.memory || item.content || item.text || '';
        const title = item.metadata?.title
            || (Array.isArray(item.categories) && item.categories[0])
            || item.project
            || item.category
            || (text.length > 50 ? `${text.slice(0, 47)}...` : text)
            || 'Mem0 Memory';
        const subtitle = item.metadata?.project
            || item.metadata?.category
            || (Array.isArray(item.categories) && item.categories[0])
            || (item.category ? `mem0 · ${item.category}` : '')
            || 'mem0';
        const facts = Array.isArray(item.metadata?.facts)
            ? item.metadata.facts
            : (text ? [text] : []);
        const score = typeof item.score === 'number'
            ? Math.round(item.score * 1000) / 1000
            : undefined;
        return {
            id: String(item.id || item.memory_id || `mem0_${Math.random().toString(36).slice(2)}`),
            title,
            subtitle,
            narrative: text,
            facts,
            score,
            sessionId: item.metadata?.sessionId || item.project || item.user_id || this.userId,
            timestamp: item.created_at || item.updated_at || item.metadata?.timestamp || '',
            metadata: item.metadata || {
                category: item.category,
                project: item.project,
                source: item.source,
                concepts: item.concepts,
            },
            raw: item,
        };
    }
    /**
     * Session start (no-op for stateless Mem0).
     */
    async startSession() {
        return { ok: true };
    }
    /**
     * Session end (no-op for stateless Mem0).
     */
    async endSession() {
        return { ok: true };
    }
    /**
     * Adds a memory directly via Local Console POST /api/add or Cloud POST /memories.
     */
    async addMemory({ title = '', narrative = '', category = '', metadata = {} }) {
        try {
            const isLoopback = this.apiUrl.includes('127.0.0.1') || this.apiUrl.includes('localhost');
            // Local console mode: POST /api/add
            if ((this.isConsoleMode || isLoopback) && !this.apiKey) {
                try {
                    const localAddUrl = `${this.apiUrl.replace(/\/+$/, '')}/api/add`;
                    const localRes = await fetch(localAddUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            content: narrative,
                            category: category || 'manual_memory',
                            project: title || 'manual_memory',
                            concepts: category || '',
                        }),
                        signal: AbortSignal.timeout(this.timeout),
                    });
                    if (localRes.ok) {
                        const data = await localRes.json().catch(() => ({}));
                        const id = data.id || data.memory_id || (Array.isArray(data.results) ? data.results[0]?.id : undefined) || `mem0_${Date.now()}`;
                        return { success: true, id: String(id) };
                    }
                }
                catch {
                    // Fall through to standard endpoint
                }
            }
            // Standard / Cloud Mem0 POST /memories
            const payload = {
                messages: [{ role: 'user', content: narrative }],
                user_id: this.userId,
                metadata: {
                    title: title || '',
                    category: category || 'manual_memory',
                    source: 'manual_popup',
                    timestamp: new Date().toISOString(),
                    ...metadata,
                },
            };
            if (this.orgId)
                payload.org_id = this.orgId;
            if (this.projectId)
                payload.project_id = this.projectId;
            const url = this._resolveEndpoint('memories');
            const res = await fetch(url, {
                method: 'POST',
                headers: this._headers(),
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(this.timeout),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                return {
                    success: false,
                    error: data.message || data.error || `Mem0 returned HTTP ${res.status}`,
                    status: res.status,
                };
            }
            const id = Array.isArray(data)
                ? (data[0]?.id || data[0]?.memory_id)
                : (data.id || data.memory_id || (Array.isArray(data.results) ? data.results[0]?.id : undefined) || `mem0_${Date.now()}`);
            return { success: true, id: String(id) };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    }
    /**
     * Updates an existing memory via Local Console (PUT /api/memories/:id or POST /api/update) or Cloud (PUT /memories/:id).
     */
    async updateMemory(id, updates) {
        try {
            const isLoopback = this.apiUrl.includes('127.0.0.1') || this.apiUrl.includes('localhost');
            // Local console mode
            if ((this.isConsoleMode || isLoopback) && !this.apiKey) {
                try {
                    const localUpdateUrl = `${this.apiUrl.replace(/\/+$/, '')}/api/update`;
                    const localRes = await fetch(localUpdateUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            id,
                            content: updates.narrative,
                            title: updates.title,
                            category: updates.category,
                        }),
                        signal: AbortSignal.timeout(this.timeout),
                    });
                    if (localRes.ok)
                        return { success: true, id };
                    const localPutUrl = `${this.apiUrl.replace(/\/+$/, '')}/api/memories/${encodeURIComponent(id)}`;
                    const putRes = await fetch(localPutUrl, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            content: updates.narrative,
                            title: updates.title,
                            category: updates.category,
                        }),
                        signal: AbortSignal.timeout(this.timeout),
                    });
                    if (putRes.ok)
                        return { success: true, id };
                }
                catch {
                    // Fall through
                }
            }
            // Standard / Cloud Mem0 PUT /memories/:id
            const url = `${this._resolveEndpoint('memories')}/${encodeURIComponent(id)}`;
            const payload = {
                text: updates.narrative,
                metadata: {
                    title: updates.title,
                    category: updates.category,
                    ...updates.metadata,
                },
            };
            const res = await fetch(url, {
                method: 'PUT',
                headers: this._headers(),
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(this.timeout),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                return {
                    success: false,
                    error: data.message || data.error || `Mem0 returned HTTP ${res.status}`,
                    status: res.status,
                };
            }
            return { success: true, id };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    }
    /**
     * Deletes a memory via Local Console (DELETE /api/memories/:id or POST /api/delete) or Cloud (DELETE /memories/:id).
     */
    async deleteMemory(id) {
        try {
            const isLoopback = this.apiUrl.includes('127.0.0.1') || this.apiUrl.includes('localhost');
            // Local console mode
            if ((this.isConsoleMode || isLoopback) && !this.apiKey) {
                try {
                    const localDelUrl = `${this.apiUrl.replace(/\/+$/, '')}/api/delete`;
                    const localRes = await fetch(localDelUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id }),
                        signal: AbortSignal.timeout(this.timeout),
                    });
                    if (localRes.ok)
                        return { success: true };
                    const localDeleteUrl = `${this.apiUrl.replace(/\/+$/, '')}/api/memories/${encodeURIComponent(id)}`;
                    const delRes = await fetch(localDeleteUrl, {
                        method: 'DELETE',
                        headers: { 'Content-Type': 'application/json' },
                        signal: AbortSignal.timeout(this.timeout),
                    });
                    if (delRes.ok)
                        return { success: true };
                }
                catch {
                    // Fall through
                }
            }
            // Standard / Cloud Mem0 DELETE /memories/:id
            const url = `${this._resolveEndpoint('memories')}/${encodeURIComponent(id)}`;
            const res = await fetch(url, {
                method: 'DELETE',
                headers: this._headers(),
                signal: AbortSignal.timeout(this.timeout),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                return {
                    success: false,
                    error: data.message || data.error || `Mem0 returned HTTP ${res.status}`,
                    status: res.status,
                };
            }
            return { success: true };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    }
    /**
     * Returns web dashboard URL
     */
    getDashboardUrl() {
        const isLocal = !this.apiUrl || this.apiUrl.includes('127.0.0.1') || this.apiUrl.includes('localhost');
        return isLocal ? this.apiUrl : 'https://app.mem0.ai';
    }
}
if (typeof globalThis !== 'undefined') {
    globalThis.Mem0Engine = Mem0Engine;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Mem0Engine };
}
