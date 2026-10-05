// =============================================================================
// WebAI Memory — Shared Content Script Utilities
// =============================================================================

/* global chrome */

const OAM = (() => {
  const DEBOUNCE_MS = 2000;
  const MAX_CONTENT_LENGTH = 32000;
  const CONTEXT_HEADER = '---\n[AgentMemory Context — selected from past sessions]\n---\n';
  const CONTEXT_FOOTER = '\n---\n[End AgentMemory Context]\n---\n\n';

  let _sessionId = `web_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  let _platform = 'unknown';
  let _observedMessages = new Set();
  let _pendingMessages = new Set();
  let _debounceTimer = null;
  let _domObserver = null;
  let _domRetryTimer = null;
  let _hookTimer = null;
  let _navigationObserver = null;
  let _queueListenerInitialized = false;
  let _sessionEnded = false;
  let _showNotifications = true;

  // ---------------------------------------------------------------------------
  // Queued context — synced from chrome.storage.session
  // ---------------------------------------------------------------------------
  let _queuedContext = null;

  function initQueueListener() {
    if (_queueListenerInitialized) return;
    _queueListenerInitialized = true;

    chrome.storage.session.get('oamQueuedContext', (data) => {
      _queuedContext = data.oamQueuedContext || null;
      if (_queuedContext) showContextBanner(_queuedContext);
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'session' && 'oamQueuedContext' in changes) {
        _queuedContext = changes.oamQueuedContext.newValue || null;
        if (_queuedContext) {
          showContextBanner(_queuedContext);
        } else {
          removeContextBanner();
        }
      }

      if (area === 'local' && 'showNotifications' in changes) {
        _showNotifications = changes.showNotifications.newValue === true;
      }
    });

    chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (s) => {
      if (s) {
        if (s.showNotifications !== undefined) _showNotifications = s.showNotifications === true;
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
    const lines = context.split('\n').filter(l => l.trim()).length;
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
      <span style="font-size:14px">📎</span>
      <span><strong>${lines} line${lines === 1 ? '' : 's'}</strong> of memory queued for next prompt</span>
      <span id="oam-banner-close" style="margin-left:6px;color:#7D7D7D;font-size:14px;line-height:1">×</span>
    `;
    banner.querySelector('#oam-banner-close').addEventListener('click', (e) => {
      e.stopPropagation();
      clearQueuedContext();
    });
    document.body.appendChild(banner);
  }

  function removeContextBanner() {
    const el = document.getElementById('oam-banner');
    if (el) el.remove();
  }

  // ---------------------------------------------------------------------------
  // Input manipulation
  // ---------------------------------------------------------------------------

  function prependContextToInput(inputEl, contextText, isRawAutoReply = false) {
    let fullContext = '';

    if (isRawAutoReply) {
      fullContext = contextText + '\n\n';
    } else if (contextText) {
      fullContext = CONTEXT_HEADER + contextText + CONTEXT_FOOTER;
    }

    if (!fullContext) return;

    if (inputEl.tagName === 'TEXTAREA') {
      if (typeof inputEl.focus === 'function') {
        inputEl.focus();
      }
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
      if (nativeSetter && nativeSetter.set) {
        nativeSetter.set.call(inputEl, fullContext + inputEl.value);
      } else {
        inputEl.value = fullContext + inputEl.value;
      }
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
      if (typeof InputEvent !== 'undefined') {
        try {
          inputEl.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: fullContext }));
        } catch {
          // InputEvent construction fallback for mock or unsupported DOM environments
        }
      }
      inputEl.dispatchEvent(new Event('resize', { bubbles: true }));

    } else if (inputEl.isContentEditable || inputEl.classList.contains('ProseMirror')) {
      inputEl.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(inputEl);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);

      const textNode = document.createTextNode(fullContext);
      range.insertNode(textNode);

      range.selectNodeContents(inputEl);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);

      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
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
      } catch (e) {
        resolve({ error: e.message });
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Auto-save
  // ---------------------------------------------------------------------------

  async function observeConversation(userText, aiText) {
    const fingerprint = hashSimple(`${userText.slice(0, 2000)}\n${aiText.slice(0, 2000)}`);
    if (_observedMessages.has(fingerprint) || _pendingMessages.has(fingerprint)) return;
    _pendingMessages.add(fingerprint);

    const content = truncate(`User: ${userText}\n\nAssistant: ${aiText}`, MAX_CONTENT_LENGTH);
    const result = await sendToBackground({
      type: 'OBSERVE', platform: _platform, sessionId: _sessionId, content,
    });
    _pendingMessages.delete(fingerprint);

    if (result && !result.error && !result.skipped && result.showToast) {
      _observedMessages.add(fingerprint);
      showToast('💾 Saved to memory');
    } else if (result && !result.error) {
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
            if (pair.user && pair.ai) observeConversation(pair.user, pair.ai);
          }
        }, DEBOUNCE_MS);
      });

      _domObserver.observe(container, { childList: true, subtree: true, characterData: true });

      setTimeout(() => {
        const pairs = messageExtractor();
        for (const pair of pairs) {
          if (pair.user && pair.ai) observeConversation(pair.user, pair.ai);
        }
      }, 3000);
    }
    tryAttach();
  }

  function queryFirst(selectors) {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) return element;
    }
    return null;
  }

  function queryAll(selectors) {
    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      if (elements.length) return [...elements];
    }
    return [];
  }

  function initPlatform(config) {
    _platform = config.platform;
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
        if (user && ai.length > 5) pairs.push({ user, ai });
      }

      return pairs;
    }

    function attachSendHooks() {
      clearTimeout(_hookTimer);

      const button = queryFirst(config.sendButtonSelectors);
      const input = queryFirst(config.inputSelectors);

      function prependQueuedContext() {
        const queued = getQueuedContext();
        if (!queued) return;

        const currentInput = queryFirst(config.inputSelectors);
        if (!currentInput) return;

        prependContextToInput(currentInput, queued);
        clearQueuedContext();
        showToast('📎 Memory context sent with prompt');
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
      const containerSelector = config.conversationSelectors.find(
        (selector) => document.querySelector(selector)
      ) || config.conversationSelectors[0];
      observeDOM(containerSelector, extractMessagePairs);
      attachSendHooks();
    }

    setTimeout(initializePage, 1500);

    if (!_navigationObserver) {
      let lastUrl = location.href;
      _navigationObserver = new MutationObserver(() => {
        if (location.href === lastUrl) return;
        lastUrl = location.href;
        setTimeout(initializePage, 1000);
      });
      _navigationObserver.observe(document.documentElement, { childList: true, subtree: true });
    }

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
    if (!_showNotifications) return;

    const existing = document.getElementById('oam-toast');
    if (existing) existing.remove();

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
      toast.style.opacity = '1'; toast.style.transform = 'translateY(0)';
    }));
    setTimeout(() => {
      toast.style.opacity = '0'; toast.style.transform = 'translateY(8px)';
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
      hash = ((hash << 5) - hash) + str.charCodeAt(i); hash |= 0;
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
  };
})();
