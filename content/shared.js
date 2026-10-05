"use strict";
// =============================================================================
// WebAI Memory — Shared Content Script Utilities
// =============================================================================
/* global chrome */
const OAM = (() => {
    const DEBOUNCE_MS = 2000;
    const MAX_CONTENT_LENGTH = 32000;
    const CONTEXT_HEADER = '---\n[AgentMemory Context — selected from past sessions]\n---\n';
    const CONTEXT_FOOTER = '\n---\n[End AgentMemory Context]\n---\n\n';
    let _routeState = 'DRAFT';
    let _currentThreadId = null;
    let _lastUrl = typeof location !== 'undefined' ? location.href : '';
    let _currentConfig = null;
    let _reinitPage = null;
    let _routeTrackingInitialized = false;
    let _platform = 'unknown';
    let _sessionId = `draft_unknown_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    let _observedMessages = new Set();
    let _pendingMessages = new Set();
    let _debounceTimer = null;
    let _domObserver = null;
    let _domRetryTimer = null;
    let _hookTimer = null;
    let _queueListenerInitialized = false;
    let _sessionEnded = false;
    let _showNotifications = true;
    // ---------------------------------------------------------------------------
    // Queued context — synced from chrome.storage.session
    // ---------------------------------------------------------------------------
    let _queuedContext = null;
    function initQueueListener() {
        if (_queueListenerInitialized)
            return;
        _queueListenerInitialized = true;
        chrome.storage.session.get('oamQueuedContext', (data) => {
            _queuedContext = data.oamQueuedContext || null;
            if (_queuedContext)
                showContextBanner(_queuedContext);
        });
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'session' && 'oamQueuedContext' in changes) {
                _queuedContext = changes.oamQueuedContext.newValue || null;
                if (_queuedContext) {
                    showContextBanner(_queuedContext);
                }
                else {
                    removeContextBanner();
                }
            }
            if (area === 'local' && 'showNotifications' in changes) {
                _showNotifications = changes.showNotifications.newValue === true;
            }
        });
        chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (s) => {
            if (s) {
                if (s.showNotifications !== undefined)
                    _showNotifications = s.showNotifications === true;
            }
        });
    }
    function getQueuedContext() {
        return _queuedContext;
    }
    function clearQueuedContext() {
        _queuedContext = null;
        chrome.storage.session.remove(['oamQueuedContext', 'oamQueueCount']);
        removeContextBanner();
        chrome.runtime.sendMessage({ type: 'CONTEXT_SENT' });
    }
    // ---------------------------------------------------------------------------
    // Context banner
    // ---------------------------------------------------------------------------
    function showContextBanner(context) {
        removeContextBanner();
        const lines = context.split('\n').filter((l) => l.trim()).length;
        const banner = document.createElement('div');
        banner.id = 'oam-banner';
        Object.assign(banner.style, {
            position: 'fixed', bottom: '80px', right: '20px', zIndex: '999999',
            background: '#181818', border: '1px solid #494949', borderRadius: '8px',
            padding: '8px 14px', display: 'flex', alignItems: 'center', gap: '8px',
            fontSize: '12px', fontFamily: 'system-ui, sans-serif', color: '#e4e4e7',
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)', cursor: 'default', userSelect: 'none',
        });
        banner.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8ab4f8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
      <span><strong>${lines} line${lines === 1 ? '' : 's'}</strong> of memory queued for next prompt</span>
      <span id="oam-banner-close" style="margin-left:6px;color:#9aa0a6;cursor:pointer;display:inline-flex;align-items:center;line-height:1">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </span>
    `;
        const closeBtn = banner.querySelector('#oam-banner-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                clearQueuedContext();
            });
        }
        document.body.appendChild(banner);
    }
    function removeContextBanner() {
        const el = document.getElementById('oam-banner');
        if (el)
            el.remove();
    }
    // ---------------------------------------------------------------------------
    // Input manipulation
    // ---------------------------------------------------------------------------
    function prependContextToInput(inputEl, contextText, isRawAutoReply = false) {
        let fullContext = '';
        if (isRawAutoReply) {
            fullContext = contextText + '\n\n';
        }
        else if (contextText) {
            fullContext = CONTEXT_HEADER + contextText + CONTEXT_FOOTER;
        }
        if (!fullContext)
            return;
        if (inputEl.tagName === 'TEXTAREA') {
            if (typeof inputEl.focus === 'function') {
                inputEl.focus();
            }
            const nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
            if (nativeSetter && nativeSetter.set) {
                nativeSetter.set.call(inputEl, fullContext + inputEl.value);
            }
            else {
                inputEl.value = fullContext + inputEl.value;
            }
            inputEl.dispatchEvent(new Event('input', { bubbles: true }));
            inputEl.dispatchEvent(new Event('change', { bubbles: true }));
            if (typeof InputEvent !== 'undefined') {
                try {
                    inputEl.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: fullContext }));
                }
                catch {
                    // InputEvent construction fallback for mock or unsupported DOM environments
                }
            }
            inputEl.dispatchEvent(new Event('resize', { bubbles: true }));
        }
        else if (inputEl.isContentEditable || inputEl.classList.contains('ProseMirror')) {
            inputEl.focus();
            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(inputEl);
            range.collapse(true);
            if (selection) {
                selection.removeAllRanges();
                selection.addRange(range);
            }
            const textNode = document.createTextNode(fullContext);
            range.insertNode(textNode);
            range.selectNodeContents(inputEl);
            range.collapse(false);
            if (selection) {
                selection.removeAllRanges();
                selection.addRange(range);
            }
            inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }
    // ---------------------------------------------------------------------------
    // Route tracking & SPA thread extraction
    // ---------------------------------------------------------------------------
    function detectPlatformFromUrl(url) {
        try {
            const base = typeof location !== 'undefined' ? location.origin : 'http://localhost';
            const host = new URL(url, base).hostname.toLowerCase();
            if (host.includes('chatgpt.com'))
                return 'chatgpt';
            if (host.includes('claude.ai'))
                return 'claude';
            if (host.includes('gemini.google.com'))
                return 'gemini';
            if (host.includes('aistudio.google.com'))
                return 'aistudio';
            if (host.includes('grok.com') || host.includes('x.com'))
                return 'grok';
        }
        catch {
            // Fallback if URL parsing fails
        }
        return 'unknown';
    }
    function extractThreadId(url, platform, config) {
        if (config?.threadIdExtractor && typeof config.threadIdExtractor === 'function') {
            return config.threadIdExtractor(url);
        }
        try {
            const base = typeof location !== 'undefined' ? location.origin : 'http://localhost';
            const parsed = new URL(url, base);
            const pathname = parsed.pathname;
            const plat = (platform && platform !== 'unknown')
                ? platform.trim().toLowerCase()
                : detectPlatformFromUrl(url);
            switch (plat) {
                case 'chatgpt': {
                    // Matches /c/:uuid or /g/g-model/c/:uuid
                    const match = pathname.match(/\/c\/([a-zA-Z0-9_-]+)/);
                    return match ? match[1] : null;
                }
                case 'claude': {
                    // Matches /chat/:uuid
                    const match = pathname.match(/\/chat\/([a-zA-Z0-9_-]+)/);
                    return match ? match[1] : null;
                }
                case 'gemini': {
                    // Matches /app/:id where id is not empty or 'new'
                    const match = pathname.match(/^\/app\/([a-zA-Z0-9_-]+)/);
                    if (match && match[1] && match[1].toLowerCase() !== 'new') {
                        return match[1];
                    }
                    return null;
                }
                case 'aistudio': {
                    // Matches /prompts/:id where id is not 'new' or 'new_chat'
                    const match = pathname.match(/\/prompts\/([a-zA-Z0-9_-]+)/);
                    if (match && match[1] && !['new', 'new_chat'].includes(match[1].toLowerCase())) {
                        return match[1];
                    }
                    return null;
                }
                case 'grok': {
                    // Matches /c/:id or /chat/:id
                    const match = pathname.match(/\/(?:c|chat)\/([a-zA-Z0-9_-]+)/);
                    return match ? match[1] : null;
                }
                default: {
                    if (config?.threadPattern) {
                        const match = pathname.match(config.threadPattern);
                        return match ? match[1] : null;
                    }
                    return null;
                }
            }
        }
        catch {
            return null;
        }
    }
    function handleRouteChange(oldUrl, newUrl) {
        _lastUrl = newUrl;
        const newThreadId = extractThreadId(newUrl, _platform, _currentConfig);
        // If thread ID hasn't changed (e.g. query params, hash change, or remaining on root/same thread)
        if (newThreadId === _currentThreadId) {
            return;
        }
        // 1. DRAFT -> BOUND transition (first turn submitted, SPA URL transitions to thread)
        if (_routeState === 'DRAFT' && newThreadId !== null) {
            const oldSessionId = _sessionId;
            const newSessionId = `${_platform}_${newThreadId}`;
            _routeState = 'BOUND';
            _currentThreadId = newThreadId;
            _sessionId = newSessionId;
            sendToBackground({
                type: 'SESSION_ALIAS',
                oldSessionId,
                newSessionId,
                platform: _platform,
                threadId: newThreadId,
                url: typeof location !== 'undefined' ? location.href : newUrl,
            });
            if (typeof _reinitPage === 'function') {
                _reinitPage();
            }
            return;
        }
        // 2. Navigation between different threads or back to root -> transition through 'SWITCHED'
        _routeState = 'SWITCHED';
        if (!_sessionEnded) {
            sendToBackground({
                type: 'SESSION_END',
                sessionId: _sessionId,
            });
        }
        _observedMessages.clear();
        _pendingMessages.clear();
        clearTimeout(_domRetryTimer);
        clearTimeout(_debounceTimer);
        if (_domObserver) {
            _domObserver.disconnect();
            _domObserver = null;
        }
        _sessionEnded = false;
        if (newThreadId !== null) {
            // SWITCHED -> BOUND (switched to another thread)
            _currentThreadId = newThreadId;
            _sessionId = `${_platform}_${newThreadId}`;
            _routeState = 'BOUND';
            startSession();
            if (typeof _reinitPage === 'function') {
                _reinitPage();
            }
        }
        else {
            // SWITCHED -> DRAFT (navigated back to root / new chat)
            _currentThreadId = null;
            const rand = Math.random().toString(36).slice(2, 6);
            _sessionId = `draft_${_platform}_${Date.now()}_${rand}`;
            _routeState = 'DRAFT';
            startSession();
            if (typeof _reinitPage === 'function') {
                _reinitPage();
            }
        }
    }
    function initRouteTracking() {
        if (_routeTrackingInitialized)
            return;
        _routeTrackingInitialized = true;
        function checkRoute() {
            const currentUrl = typeof location !== 'undefined' ? location.href : '';
            if (!currentUrl || currentUrl === _lastUrl)
                return;
            const oldUrl = _lastUrl;
            handleRouteChange(oldUrl, currentUrl);
        }
        // 1. Monkey-patch history.pushState and history.replaceState with __oam_patched guard
        if (typeof history !== 'undefined') {
            const origPush = history.pushState;
            if (origPush && !origPush.__oam_patched) {
                history.pushState = function (...args) {
                    const ret = origPush.apply(this, args);
                    if (typeof location !== 'undefined' && args[2] && location.href === _lastUrl) {
                        try {
                            const base = location.origin || 'http://localhost';
                            location.href = new URL(args[2], base).href;
                        }
                        catch {
                            location.href = String(args[2]);
                        }
                    }
                    checkRoute();
                    return ret;
                };
                history.pushState.__oam_patched = true;
            }
            const origReplace = history.replaceState;
            if (origReplace && !origReplace.__oam_patched) {
                history.replaceState = function (...args) {
                    const ret = origReplace.apply(this, args);
                    if (typeof location !== 'undefined' && args[2] && location.href === _lastUrl) {
                        try {
                            const base = location.origin || 'http://localhost';
                            location.href = new URL(args[2], base).href;
                        }
                        catch {
                            location.href = String(args[2]);
                        }
                    }
                    checkRoute();
                    return ret;
                };
                history.replaceState.__oam_patched = true;
            }
        }
        // 2. Standard popstate and hashchange listeners
        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
            window.addEventListener('popstate', checkRoute);
            window.addEventListener('hashchange', checkRoute);
            // 3. Chromium Navigation API
            if (typeof window.navigation !== 'undefined' && typeof window.navigation.addEventListener === 'function') {
                try {
                    window.navigation.addEventListener('currententrychange', checkRoute);
                }
                catch {
                    // Navigation API listener fallback
                }
            }
        }
    }
    // ---------------------------------------------------------------------------
    // Background messaging
    // ---------------------------------------------------------------------------
    function sendToBackground(message) {
        return new Promise((resolve) => {
            try {
                chrome.runtime.sendMessage(message, (response) => {
                    if (chrome.runtime.lastError) {
                        resolve({ error: chrome.runtime.lastError.message });
                        return;
                    }
                    resolve(response || {});
                });
            }
            catch (e) {
                resolve({ error: e.message });
            }
        });
    }
    // ---------------------------------------------------------------------------
    // Auto-save
    // ---------------------------------------------------------------------------
    async function observeConversation(userText, aiText) {
        const fingerprint = hashSimple(`${userText}\n${aiText}`);
        if (_observedMessages.has(fingerprint) || _pendingMessages.has(fingerprint))
            return;
        _pendingMessages.add(fingerprint);
        const content = truncate(`User: ${userText}\n\nAssistant: ${aiText}`, MAX_CONTENT_LENGTH);
        const result = await sendToBackground({
            type: 'OBSERVE', platform: _platform, sessionId: _sessionId, content,
        });
        _pendingMessages.delete(fingerprint);
        if (result && !result.error && !result.skipped && result.showToast) {
            _observedMessages.add(fingerprint);
            showToast('Saved to memory');
        }
        else if (result && !result.error) {
            _observedMessages.add(fingerprint);
        }
    }
    // ---------------------------------------------------------------------------
    // DOM observation
    // ---------------------------------------------------------------------------
    function observeDOM(containerSelector, messageExtractor) {
        clearTimeout(_domRetryTimer);
        clearTimeout(_debounceTimer);
        if (_domObserver) {
            _domObserver.disconnect();
            _domObserver = null;
        }
        function tryAttach() {
            const container = document.querySelector(containerSelector);
            if (!container) {
                _domRetryTimer = setTimeout(tryAttach, 2000);
                return;
            }
            _domObserver = new MutationObserver(() => {
                clearTimeout(_debounceTimer);
                _debounceTimer = setTimeout(() => {
                    const pairs = messageExtractor();
                    for (const pair of pairs) {
                        if (pair.user && pair.ai)
                            observeConversation(pair.user, pair.ai);
                    }
                }, DEBOUNCE_MS);
            });
            _domObserver.observe(container, { childList: true, subtree: true, characterData: true });
            setTimeout(() => {
                const pairs = messageExtractor();
                for (const pair of pairs) {
                    if (pair.user && pair.ai)
                        observeConversation(pair.user, pair.ai);
                }
            }, 3000);
        }
        tryAttach();
    }
    function queryFirst(selectors) {
        for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element)
                return element;
        }
        return null;
    }
    function queryAll(selectors) {
        for (const selector of selectors) {
            const elements = document.querySelectorAll(selector);
            if (elements.length)
                return [...elements];
        }
        return [];
    }
    function initPlatform(config) {
        _platform = config.platform;
        _currentConfig = config;
        _lastUrl = typeof location !== 'undefined' ? location.href : '';
        const initialThreadId = extractThreadId(_lastUrl, _platform, config);
        if (initialThreadId) {
            _routeState = 'BOUND';
            _currentThreadId = initialThreadId;
            _sessionId = `${_platform}_${initialThreadId}`;
        }
        else {
            _routeState = 'DRAFT';
            _currentThreadId = null;
            const rand = Math.random().toString(36).slice(2, 6);
            _sessionId = `draft_${_platform}_${Date.now()}_${rand}`;
        }
        _sessionEnded = false;
        startSession();
        initQueueListener();
        const getText = (element) => element ? (element.innerText || element.textContent || '') : '';
        function extractMessagePairs() {
            const userMessages = queryAll(config.userMessageSelectors);
            const assistantMessages = queryAll(config.assistantMessageSelectors);
            const pairs = [];
            for (let i = 0; i < Math.min(userMessages.length, assistantMessages.length); i++) {
                const user = getText(userMessages[i]).trim();
                const ai = getText(assistantMessages[i]).trim();
                if (user && ai.length > 5)
                    pairs.push({ user, ai });
            }
            return pairs;
        }
        function attachSendHooks() {
            clearTimeout(_hookTimer);
            const button = queryFirst(config.sendButtonSelectors);
            const input = queryFirst(config.inputSelectors);
            function prependQueuedContext() {
                const queued = getQueuedContext();
                if (!queued)
                    return;
                const currentInput = queryFirst(config.inputSelectors);
                if (!currentInput) return;
                prependContextToInput(currentInput, queued);
                clearQueuedContext();
                showToast('Memory context sent with prompt');
            }
            if (button && !button.dataset.oamHooked) {
                button.dataset.oamHooked = 'true';
                button.addEventListener('click', prependQueuedContext, { capture: true });
            }
            if (input && !input.dataset.oamHooked) {
                input.dataset.oamHooked = 'true';
                input.addEventListener('keydown', (event) => {
                    const isSubmitKey = (event.key === 'Enter' && !event.shiftKey && !event.isComposing) ||
                        (event.key === 'Enter' && (event.ctrlKey || event.metaKey));
                    if (isSubmitKey) {
                        prependQueuedContext();
                    }
                }, { capture: true });
            }
            _hookTimer = setTimeout(attachSendHooks, button || input ? 5000 : 2000);
        }
        function initializePage() {
            const containerSelector = config.conversationSelectors.find((selector) => document.querySelector(selector)) || config.conversationSelectors[0];
            observeDOM(containerSelector, extractMessagePairs);
            attachSendHooks();
        }
        _reinitPage = initializePage;
        setTimeout(initializePage, 1500);
        initRouteTracking();
        window.addEventListener('pagehide', (event) => {
            if (!event.persisted && !_sessionEnded) {
                _sessionEnded = true;
                sendToBackground({ type: 'SESSION_END', sessionId: _sessionId });
            }
        });
    }
    // ---------------------------------------------------------------------------
    // Toast
    // ---------------------------------------------------------------------------
    function showToast(message) {
        if (!_showNotifications)
            return;
        const existing = document.getElementById('oam-toast');
        if (existing)
            existing.remove();
        const toast = document.createElement('div');
        toast.id = 'oam-toast';
        toast.textContent = message;
        Object.assign(toast.style, {
            position: 'fixed', bottom: '24px', right: '24px', padding: '8px 16px',
            borderRadius: '6px', background: '#202020', border: '1px solid #494949',
            color: '#e4e4e7', fontSize: '12px', fontFamily: 'system-ui, sans-serif',
            zIndex: '999999', boxShadow: '0 4px 16px rgba(0,0,0,0.5)', opacity: '0',
            transform: 'translateY(8px)', transition: 'all 0.25s ease', pointerEvents: 'none',
        });
        document.body.appendChild(toast);
        requestAnimationFrame(() => requestAnimationFrame(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateY(0)';
        }));
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(8px)';
            setTimeout(() => toast.remove(), 250);
        }, 2500);
    }
    // ---------------------------------------------------------------------------
    // Utilities
    // ---------------------------------------------------------------------------
    function truncate(str, maxLen) {
        return str.length <= maxLen ? str : str.slice(0, maxLen) + '\n... [truncated]';
    }
    function hashSimple(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash |= 0;
        }
        return hash.toString(36);
    }
    function startSession() {
        sendToBackground({
            type: 'SESSION_START', platform: _platform, sessionId: _sessionId, project: `${_platform}-web`,
        });
    }
    return {
        get sessionId() { return _sessionId; },
        set platform(p) { _platform = p; },
        get platform() { return _platform; },
        get routeState() { return _routeState; },
        get threadId() { return _currentThreadId; },
        get observedMessages() { return _observedMessages; },
        get pendingMessages() { return _pendingMessages; },
        initQueueListener,
        getQueuedContext,
        clearQueuedContext,
        prependContextToInput,
        sendToBackground,
        observeConversation,
        observeDOM,
        initPlatform,
        startSession,
        showToast,
        truncate,
        hashSimple,
        extractThreadId,
        handleRouteChange,
        initRouteTracking,
    };
})();
