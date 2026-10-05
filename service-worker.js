"use strict";
// =============================================================================
// WebAI Memory — Service Worker
// Central message router between content scripts, popup, and the memory backends.
// Default engine: Local Mem0 (http://localhost:8000).
// =============================================================================
importScripts('backends/base-engine.js', 'backends/agentmemory-engine.js', 'backends/mem0-engine.js', 'backends/hindsight-engine.js', 'backends/cognee-engine.js', 'backends/engine-factory.js', 'backends/local-archive.js');
const DEFAULT_API_URL = 'http://localhost:3111';
const DEFAULT_MEM0_API_URL = 'http://localhost:8000';
const DEFAULT_HINDSIGHT_API_URL = 'http://localhost:8888';
const DEFAULT_COGNEE_API_URL = 'http://localhost:8000';
let _isConnected = false;
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function getSettings() {
    const defaults = {
        activeEngine: 'mem0',
        mem0ApiUrl: DEFAULT_MEM0_API_URL,
        mem0ApiKey: '',
        mem0UserId: 'default_user',
        mem0OrgId: '',
        mem0ProjectId: '',
        apiUrl: DEFAULT_API_URL,
        secret: '',
        hindsightApiUrl: DEFAULT_HINDSIGHT_API_URL,
        hindsightApiKey: '',
        hindsightBankId: 'default',
        cogneeApiUrl: DEFAULT_COGNEE_API_URL,
        cogneeApiKey: '',
        cogneeDatasetName: 'main',
        geminiAutoSave: true,
        chatgptAutoSave: true,
        claudeAutoSave: true,
        grokAutoSave: true,
        aistudioAutoSave: true,
        localArchiveEnabled: true,
        showNotifications: false,
    };
    const stored = await chrome.storage.local.get(Object.keys(defaults));
    return { ...defaults, ...stored };
}
function getActiveEngine(settings) {
    return EngineFactory.createEngine(settings);
}
function normalizeApiUrl(value) {
    const url = new URL(String(value || '').trim());
    const isLoopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol !== 'http:' || !isLoopback || url.username || url.password) {
        throw new Error('AgentMemory URL must be an http://localhost or http://127.0.0.1 address');
    }
    return url.origin;
}
function authHeaders(secret) {
    const h = { 'Content-Type': 'application/json' };
    if (secret)
        h['Authorization'] = `Bearer ${secret}`;
    return h;
}
async function apiRequest(endpoint, { method = 'POST', body, timeout = 10000 } = {}) {
    const settings = await getSettings();
    const engine = getActiveEngine(settings);
    if (typeof engine._request === 'function') {
        return engine._request(endpoint, { method, body, timeout });
    }
    return { error: 'Direct apiRequest not supported by active engine' };
}
async function apiPost(endpoint, body) {
    return apiRequest(endpoint, { body });
}
async function getQueueCount() {
    const stored = await chrome.storage.session.get('oamQueueCount');
    return Number.isInteger(stored.oamQueueCount) ? stored.oamQueueCount : 0;
}
// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------
async function updateBadge() {
    const settings = await getSettings();
    const engine = getActiveEngine(settings);
    const [health, badgeCount] = await Promise.all([
        engine.checkHealth().catch((err) => ({ connected: false, error: err.message })),
        getQueueCount(),
    ]);
    _isConnected = !!health.connected;
    if (!_isConnected) {
        if (chrome.action?.setIcon) {
            try {
                chrome.action.setIcon({
                    path: {
                        16: 'icons/icon-16.png',
                        48: 'icons/icon-48.png',
                        128: 'icons/icon-128.png',
                    },
                });
            }
            catch (_) { }
        }
        chrome.action.setBadgeText({ text: '!' });
        chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
    }
    else if (badgeCount > 0) {
        if (chrome.action?.setIcon) {
            try {
                chrome.action.setIcon({
                    path: {
                        16: 'icons/icon-16.png',
                        48: 'icons/icon-48.png',
                        128: 'icons/icon-128.png',
                    },
                });
            }
            catch (_) { }
        }
        chrome.action.setBadgeText({ text: String(badgeCount) });
        chrome.action.setBadgeBackgroundColor({ color: '#6366f1' }); // Indigo for queued items
    }
    else {
        // In Chromium, non-empty badge text renders a huge ~12px native block covering the 16px toolbar icon.
        // Setting text to '' removes the giant native overlay, while the connected icon displays
        // a crisp, miniature status indicator.
        if (chrome.action?.setIcon) {
            try {
                chrome.action.setIcon({
                    path: {
                        16: 'icons/icon-connected-16.png',
                        48: 'icons/icon-connected-48.png',
                        128: 'icons/icon-connected-128.png',
                    },
                });
            }
            catch (_) { }
        }
        chrome.action.setBadgeText({ text: '' });
    }
}
// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
        try {
            switch (message.type) {
                // -- Observe: save a conversation turn to memory --
                case 'OBSERVE': {
                    const settings = await getSettings();
                    const platform = message.platform || 'unknown';
                    if (platform === 'gemini' && !settings.geminiAutoSave) {
                        sendResponse({ skipped: true });
                        return;
                    }
                    if (platform === 'chatgpt' && !settings.chatgptAutoSave) {
                        sendResponse({ skipped: true });
                        return;
                    }
                    if (platform === 'claude' && !settings.claudeAutoSave) {
                        sendResponse({ skipped: true });
                        return;
                    }
                    if (platform === 'grok' && !settings.grokAutoSave) {
                        sendResponse({ skipped: true });
                        return;
                    }
                    if (platform === 'aistudio' && !settings.aistudioAutoSave) { sendResponse({ skipped: true }); return; }
                    // Client-side zero-retention conversation archiving
                    if (settings.localArchiveEnabled !== false) {
                        try {
                            if (typeof LocalArchive !== 'undefined' && typeof LocalArchive.saveTurn === 'function') {
                                await LocalArchive.saveTurn({
                                    platform,
                                    sessionId: message.sessionId,
                                    content: message.content,
                                    userPrompt: message.userPrompt,
                                    assistantResponse: message.assistantResponse,
                                    timestamp: message.timestamp || new Date().toISOString(),
                                });
                            }
                        }
                        catch (archiveErr) {
            console.warn('LocalArchive.saveTurn failed:', archiveErr);
          }
                    }
                    const engine = getActiveEngine(settings);
                    const result = await engine.observe({
                        platform,
                        sessionId: message.sessionId,
                        content: message.content,
                        userPrompt: message.userPrompt,
                        assistantResponse: message.assistantResponse,
                        timestamp: message.timestamp || new Date().toISOString(),
                    });
                    sendResponse({ ...result, showToast: settings.showNotifications });
                    return;
                }
                // -- Search: recall relevant memories --
                case 'SEARCH': {
                    const settings = await getSettings();
                    const engine = getActiveEngine(settings);
                    const result = await engine.search({
                        query: message.query !== undefined ? message.query : '',
                        limit: message.limit || (settings.activeEngine === 'agentmemory' ? 3 : 5),
                    });
                    sendResponse(result);
                    return;
                }
                // -- Session lifecycle --
                case 'SESSION_START': {
                    const settings = await getSettings();
                    const engine = getActiveEngine(settings);
                    const result = await engine.startSession({
                        sessionId: message.sessionId,
                        platform: message.platform,
                        project: message.project,
                    });
                    sendResponse(result);
                    return;
                }
                case 'SESSION_END': {
                    const settings = await getSettings();
                    const engine = getActiveEngine(settings);
                    const result = await engine.endSession({
                        sessionId: message.sessionId,
                    });
                    sendResponse(result);
                    return;
                }
                // -- Status: health check for popup --
                case 'STATUS': {
                    const settings = await getSettings();
                    const engine = getActiveEngine(settings);
                    const health = await engine.checkHealth();
                    _isConnected = !health.error && !!health.connected;
                    let activeUrl = engine.apiUrl || settings.mem0ApiUrl;
                    if (settings.activeEngine === 'agentmemory')
                        activeUrl = engine.apiUrl || settings.apiUrl;
                    else if (settings.activeEngine === 'hindsight')
                        activeUrl = engine.apiUrl || settings.hindsightApiUrl;
                    else if (settings.activeEngine === 'cognee')
                        activeUrl = engine.apiUrl || settings.cogneeApiUrl;
                    const dashboardUrl = typeof engine.getDashboardUrl === 'function' ? engine.getDashboardUrl() : activeUrl;
                    sendResponse({
                        connected: _isConnected,
                        activeEngine: settings.activeEngine || 'mem0',
                        apiUrl: activeUrl,
                        dashboardUrl,
                        version: health.version,
                        error: health.error,
                    });
                    return;
                }
                // -- Get/set settings --
                case 'GET_SETTINGS': {
                    const settings = await getSettings();
                    sendResponse(settings);
                    return;
                }
                case 'SET_SETTINGS': {
                    const next = {};
                    const incoming = message.settings || {};
                    const booleanKeys = [
                        'geminiAutoSave',
                        'chatgptAutoSave',
                        'claudeAutoSave',
                        'grokAutoSave',
                        'aistudioAutoSave',
                        'localArchiveEnabled',
                        'showNotifications',
                    ];
                    if ('activeEngine' in incoming) {
                        const val = String(incoming.activeEngine || '').trim().toLowerCase();
                        if (['mem0', 'agentmemory', 'hindsight', 'cognee'].includes(val)) {
                            next.activeEngine = val;
                        }
                    }
                    if ('apiUrl' in incoming)
                        next.apiUrl = normalizeApiUrl(incoming.apiUrl);
                    if ('secret' in incoming)
                        next.secret = String(incoming.secret || '').trim();
                    if ('mem0ApiUrl' in incoming) {
                        const raw = String(incoming.mem0ApiUrl || '').trim();
                        const url = new URL(raw);
                        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
                            throw new Error('Mem0 URL must use http:// or https://');
                        }
                        next.mem0ApiUrl = raw.replace(/\/+$/, '');
                    }
                    if ('mem0ApiKey' in incoming)
                        next.mem0ApiKey = String(incoming.mem0ApiKey || '').trim();
                    if ('mem0UserId' in incoming)
                        next.mem0UserId = String(incoming.mem0UserId || '').trim();
                    if ('mem0OrgId' in incoming)
                        next.mem0OrgId = String(incoming.mem0OrgId || '').trim();
                    if ('mem0ProjectId' in incoming)
                        next.mem0ProjectId = String(incoming.mem0ProjectId || '').trim();
                    if ('hindsightApiUrl' in incoming) {
                        const raw = String(incoming.hindsightApiUrl || '').trim();
                        const url = new URL(raw);
                        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
                            throw new Error('Hindsight URL must use http:// or https://');
                        }
                        next.hindsightApiUrl = raw.replace(/\/+$/, '');
                    }
                    if ('hindsightApiKey' in incoming)
                        next.hindsightApiKey = String(incoming.hindsightApiKey || '').trim();
                    if ('hindsightBankId' in incoming)
                        next.hindsightBankId = String(incoming.hindsightBankId || '').trim();
                    if ('cogneeApiUrl' in incoming) {
                        const raw = String(incoming.cogneeApiUrl || '').trim();
                        const url = new URL(raw);
                        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
                            throw new Error('Cognee URL must use http:// or https://');
                        }
                        next.cogneeApiUrl = raw.replace(/\/+$/, '');
                    }
                    if ('cogneeApiKey' in incoming)
                        next.cogneeApiKey = String(incoming.cogneeApiKey || '').trim();
                    if ('cogneeDatasetName' in incoming)
                        next.cogneeDatasetName = String(incoming.cogneeDatasetName || '').trim();
                    for (const key of booleanKeys) {
                        if (key in incoming)
                            next[key] = incoming[key] === true;
                    }
                    await chrome.storage.local.set(next);
                    await updateBadge();
                    sendResponse({ ok: true, settings: next });
                    return;
                }
                // -- Queue Count (for Badge) --
                case 'SET_QUEUE_COUNT': {
                    const count = Math.max(0, Number.parseInt(String(message.count), 10) || 0);
                    await chrome.storage.session.set({ oamQueueCount: count });
                    await updateBadge();
                    sendResponse({ ok: true });
                    return;
                }
                case 'CONTEXT_SENT': {
                    await chrome.storage.session.remove('oamQueueCount');
                    await updateBadge();
                    sendResponse({ ok: true });
                    return;
                }
                // -- Local Archive Operations --
                case 'GET_LOCAL_SESSIONS': {
                    if (typeof LocalArchive !== 'undefined' && typeof LocalArchive.getSessions === 'function') {
                        const sessions = await LocalArchive.getSessions({
                            platform: message.platform,
                            query: message.query,
                            limit: message.limit,
                            offset: message.offset,
                        });
                        sendResponse({ sessions });
                    }
                    else {
                        sendResponse({ sessions: [] });
                    }
                    return;
                }
                case 'GET_SESSION_DETAILS':
                case 'GET_LOCAL_SESSION_DETAILS': {
                    if (typeof LocalArchive !== 'undefined' && typeof LocalArchive.getSessionDetails === 'function') {
                        const details = await LocalArchive.getSessionDetails(message.sessionId);
                        sendResponse(details || { session: null, turns: [] });
                    }
                    else {
                        sendResponse({ session: null, turns: [] });
                    }
                    return;
                }
                case 'DELETE_SESSION':
                case 'DELETE_LOCAL_SESSION': {
                    if (typeof LocalArchive !== 'undefined' && typeof LocalArchive.deleteSession === 'function') {
                        const result = await LocalArchive.deleteSession(message.sessionId);
                        sendResponse(result);
                    }
                    else {
                        sendResponse({ success: false, error: 'LocalArchive not available' });
                    }
                    return;
                }
                case 'CLEAR_LOCAL_HISTORY': {
                    if (typeof LocalArchive !== 'undefined' && typeof LocalArchive.clearHistory === 'function') {
                        const result = await LocalArchive.clearHistory({ platform: message.platform });
                        sendResponse(result);
                    }
                    else {
                        sendResponse({ success: false, error: 'LocalArchive not available' });
                    }
                    return;
                }
                case 'EXPORT_LOCAL_HISTORY': {
                    if (typeof LocalArchive !== 'undefined' && typeof LocalArchive.exportHistory === 'function') {
                        const result = await LocalArchive.exportHistory({
                            format: message.format || 'json',
                            platform: message.platform,
                            sessionId: message.sessionId,
                        });
                        sendResponse(result);
                    }
                    else {
                        sendResponse({ error: 'LocalArchive not available' });
                    }
                    return;
                }
                default:
                    sendResponse({ error: `Unknown message type: ${message.type}` });
            }
        }
        catch (err) {
            sendResponse({ error: err.message });
        }
    })();
    return true;
});
// Check connection on install and periodically
chrome.runtime.onInstalled.addListener(() => {
    updateBadge();
    chrome.alarms.create('statusCheck', { periodInMinutes: 1 });
});
chrome.runtime.onStartup.addListener(() => {
    updateBadge();
    chrome.alarms.create('statusCheck', { periodInMinutes: 1 });
});
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'statusCheck')
        updateBadge();
});
