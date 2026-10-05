// =============================================================================
// WebAI Memory — Stateful SPA Route Aliasing & Session Isolation Tests
// =============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT_DIR = path.resolve(__dirname, '..');
const SHARED_JS_PATH = path.join(ROOT_DIR, 'content/shared.js');

function createMockEnvironment(initialUrl = 'https://chatgpt.com/', platform = 'chatgpt') {
  const sentMessages = [];
  const eventListeners = {};
  const navigationListeners = {};

  const parsedInitial = new URL(initialUrl);

  const location = {
    href: initialUrl,
    origin: parsedInitial.origin,
    pathname: parsedInitial.pathname,
    search: parsedInitial.search,
    hash: parsedInitial.hash,
  };

  const history = {
    pushState(state, title, url) {
      if (url) {
        const resolved = new URL(url, location.origin);
        location.href = resolved.href;
        location.pathname = resolved.pathname;
        location.search = resolved.search;
        location.hash = resolved.hash;
      }
    },
    replaceState(state, title, url) {
      if (url) {
        const resolved = new URL(url, location.origin);
        location.href = resolved.href;
        location.pathname = resolved.pathname;
        location.search = resolved.search;
        location.hash = resolved.hash;
      }
    },
  };

  const window = {
    addEventListener(event, fn) {
      if (!eventListeners[event]) eventListeners[event] = [];
      eventListeners[event].push(fn);
    },
    removeEventListener(event, fn) {
      if (eventListeners[event]) {
        eventListeners[event] = eventListeners[event].filter((f) => f !== fn);
      }
    },
    dispatchEvent(event) {
      const type = typeof event === 'string' ? event : event.type;
      const list = eventListeners[type] || [];
      for (const fn of list) {
        fn(event);
      }
    },
    navigation: {
      addEventListener(event, fn) {
        if (!navigationListeners[event]) navigationListeners[event] = [];
        navigationListeners[event].push(fn);
      },
      dispatchEvent(event) {
        const type = typeof event === 'string' ? event : event.type;
        const list = navigationListeners[type] || [];
        for (const fn of list) {
          fn(event);
        }
      },
    },
    location,
    history,
  };

  const observedTargets = [];
  class MockMutationObserver {
    constructor(callback) {
      this.callback = callback;
    }
    observe(target, options) {
      observedTargets.push({ target, options });
    }
    disconnect() {}
  }

  const documentElement = { nodeName: 'HTML' };

  const document = {
    documentElement,
    body: { appendChild: () => {} },
    createElement: () => ({ style: {}, querySelector: () => null }),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
  };

  const chrome = {
    storage: {
      session: {
        get: (_keys, cb) => cb({}),
        remove: () => {},
      },
      local: {
        get: (_keys, cb) => cb({}),
      },
      onChanged: {
        addListener: () => {},
      },
    },
    runtime: {
      lastError: null,
      sendMessage: (msg, cb) => {
        sentMessages.push(msg);
        if (typeof cb === 'function') {
          cb({ success: true });
        }
      },
    },
  };

  const sandbox = {
    location,
    history,
    window,
    document,
    MutationObserver: MockMutationObserver,
    chrome,
    setTimeout: () => 1,
    clearTimeout: () => {},
    console,
    URL,
  };

  const context = vm.createContext(sandbox);
  const sharedCode = fs.readFileSync(SHARED_JS_PATH, 'utf8');
  const OAM = vm.runInContext(`${sharedCode}\nOAM;`, context);

  return {
    OAM,
    context,
    sandbox,
    location,
    history,
    window,
    sentMessages,
    observedTargets,
  };
}

const mockConfig = (platform) => ({
  platform,
  conversationSelectors: ['main'],
  userMessageSelectors: ['.user-msg'],
  assistantMessageSelectors: ['.assistant-msg'],
  inputSelectors: ['textarea'],
  sendButtonSelectors: ['button.send'],
});

// -----------------------------------------------------------------------------
// Unit Tests: extractThreadId across platforms
// -----------------------------------------------------------------------------

test('extractThreadId: accurately parses thread IDs across ChatGPT, Claude, Gemini, AI Studio, and Grok', () => {
  const env = createMockEnvironment();
  const OAM = env.OAM;

  // ChatGPT
  assert.equal(OAM.extractThreadId('https://chatgpt.com/', 'chatgpt'), null);
  assert.equal(OAM.extractThreadId('https://chatgpt.com/c/6701b2c3-4d5e-6f7a-8b9c-0d1e2f3a4b5c', 'chatgpt'), '6701b2c3-4d5e-6f7a-8b9c-0d1e2f3a4b5c');
  assert.equal(OAM.extractThreadId('https://chatgpt.com/g/g-model123/c/6701b2c3-4d5e-6f7a-8b9c-0d1e2f3a4b5c', 'chatgpt'), '6701b2c3-4d5e-6f7a-8b9c-0d1e2f3a4b5c');

  // Claude
  assert.equal(OAM.extractThreadId('https://claude.ai/', 'claude'), null);
  assert.equal(OAM.extractThreadId('https://claude.ai/new', 'claude'), null);
  assert.equal(OAM.extractThreadId('https://claude.ai/chat/550e8400-e29b-41d4-a716-446655440000', 'claude'), '550e8400-e29b-41d4-a716-446655440000');

  // Gemini
  assert.equal(OAM.extractThreadId('https://gemini.google.com/app', 'gemini'), null);
  assert.equal(OAM.extractThreadId('https://gemini.google.com/app/', 'gemini'), null);
  assert.equal(OAM.extractThreadId('https://gemini.google.com/app/new', 'gemini'), null);
  assert.equal(OAM.extractThreadId('https://gemini.google.com/app/1a2b3c4d5e6f7g', 'gemini'), '1a2b3c4d5e6f7g');

  // AI Studio
  assert.equal(OAM.extractThreadId('https://aistudio.google.com/', 'aistudio'), null);
  assert.equal(OAM.extractThreadId('https://aistudio.google.com/prompts/new', 'aistudio'), null);
  assert.equal(OAM.extractThreadId('https://aistudio.google.com/prompts/new_chat', 'aistudio'), null);
  assert.equal(OAM.extractThreadId('https://aistudio.google.com/prompts/prompt_xyz_123', 'aistudio'), 'prompt_xyz_123');

  // Grok
  assert.equal(OAM.extractThreadId('https://grok.com/', 'grok'), null);
  assert.equal(OAM.extractThreadId('https://grok.com/c/grok_thread_01', 'grok'), 'grok_thread_01');
  assert.equal(OAM.extractThreadId('https://grok.com/chat/grok_thread_02', 'grok'), 'grok_thread_02');

  // Custom extractor in config
  const customConfig = {
    threadIdExtractor: (url) => url.includes('custom_') ? 'custom_extracted_id' : null,
  };
  assert.equal(OAM.extractThreadId('https://custom.ai/custom_123', 'custom', customConfig), 'custom_extracted_id');

  // Custom threadPattern regex in config
  const regexConfig = {
    threadPattern: /\/session\/([a-zA-Z0-9]+)/,
  };
  assert.equal(OAM.extractThreadId('https://custom.ai/session/sess987', 'custom', regexConfig), 'sess987');
});

// -----------------------------------------------------------------------------
// Unit Tests: Initial page load routing states
// -----------------------------------------------------------------------------

test('Initial page load on root starts in DRAFT state with ephemeral draft session ID', () => {
  const env = createMockEnvironment('https://chatgpt.com/', 'chatgpt');
  const OAM = env.OAM;

  OAM.initPlatform(mockConfig('chatgpt'));

  assert.equal(OAM.routeState, 'DRAFT', 'Must be in DRAFT state when loaded on root');
  assert.equal(OAM.threadId, null, 'threadId must be null in DRAFT state');
  assert.match(OAM.sessionId, /^draft_chatgpt_\d+_[a-z0-9]+$/, 'sessionId must follow draft_${platform}_${Date.now()}_${rand} pattern');

  // Dispatches SESSION_START for draft session
  const startMsg = env.sentMessages.find((m) => m.type === 'SESSION_START');
  assert.ok(startMsg, 'Must dispatch SESSION_START');
  assert.equal(startMsg.sessionId, OAM.sessionId);
  assert.equal(startMsg.platform, 'chatgpt');

  // Zero aliasing performed on initial root load
  const aliasMsg = env.sentMessages.find((m) => m.type === 'SESSION_ALIAS');
  assert.equal(aliasMsg, undefined, 'Must not dispatch SESSION_ALIAS on initial root load');
});

test('Initial page load directly on thread URL starts in BOUND state without aliasing', () => {
  const threadUrl = 'https://chatgpt.com/c/6701b2c3-4d5e-6f7a-8b9c-0d1e2f3a4b5c';
  const env = createMockEnvironment(threadUrl, 'chatgpt');
  const OAM = env.OAM;

  OAM.initPlatform(mockConfig('chatgpt'));

  assert.equal(OAM.routeState, 'BOUND', 'Must be directly in BOUND state when loaded on thread URL');
  assert.equal(OAM.threadId, '6701b2c3-4d5e-6f7a-8b9c-0d1e2f3a4b5c');
  assert.equal(OAM.sessionId, 'chatgpt_6701b2c3-4d5e-6f7a-8b9c-0d1e2f3a4b5c');

  // Dispatches SESSION_START for canonical thread session
  const startMsg = env.sentMessages.find((m) => m.type === 'SESSION_START');
  assert.ok(startMsg, 'Must dispatch SESSION_START');
  assert.equal(startMsg.sessionId, 'chatgpt_6701b2c3-4d5e-6f7a-8b9c-0d1e2f3a4b5c');

  // No SESSION_ALIAS on direct thread load
  const aliasMsg = env.sentMessages.find((m) => m.type === 'SESSION_ALIAS');
  assert.equal(aliasMsg, undefined, 'Must not dispatch SESSION_ALIAS when directly loaded on thread URL');
});

// -----------------------------------------------------------------------------
// Unit Tests: History pushState and replaceState aliasing
// -----------------------------------------------------------------------------

test('history.pushState from root to thread triggers DRAFT -> BOUND transition and dispatches SESSION_ALIAS message', () => {
  const env = createMockEnvironment('https://chatgpt.com/', 'chatgpt');
  const OAM = env.OAM;

  OAM.initPlatform(mockConfig('chatgpt'));
  assert.equal(OAM.routeState, 'DRAFT');
  const oldDraftId = OAM.sessionId;

  // Verify monkey-patching guard
  assert.equal(env.history.pushState.__oam_patched, true, 'pushState must be flagged with __oam_patched');

  // User submits prompt 1, ChatGPT router updates location bar via pushState
  env.history.pushState(null, '', 'https://chatgpt.com/c/new-thread-uuid-1234');

  assert.equal(OAM.routeState, 'BOUND', 'Route state must transition to BOUND');
  assert.equal(OAM.threadId, 'new-thread-uuid-1234');
  assert.equal(OAM.sessionId, 'chatgpt_new-thread-uuid-1234');

  // Verify SESSION_ALIAS dispatched to background service worker
  const aliasMsg = env.sentMessages.find((m) => m.type === 'SESSION_ALIAS');
  assert.ok(aliasMsg, 'Must dispatch SESSION_ALIAS on DRAFT -> BOUND transition');
  assert.equal(aliasMsg.oldSessionId, oldDraftId);
  assert.equal(aliasMsg.newSessionId, 'chatgpt_new-thread-uuid-1234');
  assert.equal(aliasMsg.platform, 'chatgpt');
  assert.equal(aliasMsg.threadId, 'new-thread-uuid-1234');
  assert.equal(aliasMsg.url, 'https://chatgpt.com/c/new-thread-uuid-1234');
});

test('history.replaceState from root to thread triggers DRAFT -> BOUND transition and dispatches SESSION_ALIAS message', () => {
  const env = createMockEnvironment('https://claude.ai/new', 'claude');
  const OAM = env.OAM;

  OAM.initPlatform(mockConfig('claude'));
  assert.equal(OAM.routeState, 'DRAFT');
  const oldDraftId = OAM.sessionId;

  assert.equal(env.history.replaceState.__oam_patched, true, 'replaceState must be flagged with __oam_patched');

  // Claude router invokes replaceState to establish thread URL
  env.history.replaceState(null, '', 'https://claude.ai/chat/claude-thread-xyz');

  assert.equal(OAM.routeState, 'BOUND');
  assert.equal(OAM.threadId, 'claude-thread-xyz');
  assert.equal(OAM.sessionId, 'claude_claude-thread-xyz');

  const aliasMsg = env.sentMessages.find((m) => m.type === 'SESSION_ALIAS');
  assert.ok(aliasMsg, 'Must dispatch SESSION_ALIAS on replaceState');
  assert.equal(aliasMsg.oldSessionId, oldDraftId);
  assert.equal(aliasMsg.newSessionId, 'claude_claude-thread-xyz');
});

// -----------------------------------------------------------------------------
// Unit Tests: Multi-thread navigation and deduplication cache isolation
// -----------------------------------------------------------------------------

test('Route change between distinct threads triggers SWITCHED -> BOUND, sends SESSION_END, and flushes deduplication caches', () => {
  const env = createMockEnvironment('https://chatgpt.com/c/thread-alpha', 'chatgpt');
  const OAM = env.OAM;

  OAM.initPlatform(mockConfig('chatgpt'));
  assert.equal(OAM.routeState, 'BOUND');
  assert.equal(OAM.sessionId, 'chatgpt_thread-alpha');

  // Populate deduplication caches in thread alpha
  OAM.observedMessages.add('hash_message_turn_1');
  OAM.pendingMessages.add('hash_pending_turn');
  assert.equal(OAM.observedMessages.size, 1);
  assert.equal(OAM.pendingMessages.size, 1);

  // User clicks another thread in the sidebar
  env.history.pushState(null, '', 'https://chatgpt.com/c/thread-beta');

  // 1. Departed session ended
  const endMsgs = env.sentMessages.filter((m) => m.type === 'SESSION_END');
  assert.equal(endMsgs.length, 1, 'Must dispatch exactly one SESSION_END');
  assert.equal(endMsgs[0].sessionId, 'chatgpt_thread-alpha', 'Must end departed session');

  // 2. In-memory deduplication caches flushed
  assert.equal(OAM.observedMessages.size, 0, '_observedMessages must be completely flushed on thread switch');
  assert.equal(OAM.pendingMessages.size, 0, '_pendingMessages must be completely flushed on thread switch');

  // 3. New thread bound
  assert.equal(OAM.routeState, 'BOUND');
  assert.equal(OAM.threadId, 'thread-beta');
  assert.equal(OAM.sessionId, 'chatgpt_thread-beta');

  // 4. New session started
  const startMsgs = env.sentMessages.filter((m) => m.type === 'SESSION_START');
  const newStartMsg = startMsgs[startMsgs.length - 1];
  assert.equal(newStartMsg.sessionId, 'chatgpt_thread-beta');
});

test('Navigation from thread back to root triggers SWITCHED -> DRAFT and resets thread session', () => {
  const env = createMockEnvironment('https://gemini.google.com/app/gemini-thread-10', 'gemini');
  const OAM = env.OAM;

  OAM.initPlatform(mockConfig('gemini'));
  assert.equal(OAM.routeState, 'BOUND');
  assert.equal(OAM.sessionId, 'gemini_gemini-thread-10');

  OAM.observedMessages.add('hash_previous_chat');
  assert.equal(OAM.observedMessages.size, 1);

  // User clicks "+ New Chat" returning to root /app
  env.history.pushState(null, '', 'https://gemini.google.com/app');

  // Departed session ended
  const endMsg = env.sentMessages.find((m) => m.type === 'SESSION_END');
  assert.ok(endMsg);
  assert.equal(endMsg.sessionId, 'gemini_gemini-thread-10');

  // Cache cleared
  assert.equal(OAM.observedMessages.size, 0);

  // Transitions to DRAFT with new ephemeral session
  assert.equal(OAM.routeState, 'DRAFT');
  assert.equal(OAM.threadId, null);
  assert.match(OAM.sessionId, /^draft_gemini_\d+_[a-z0-9]+$/);

  // New draft session started
  const startMsgs = env.sentMessages.filter((m) => m.type === 'SESSION_START');
  const lastStartMsg = startMsgs[startMsgs.length - 1];
  assert.equal(lastStartMsg.sessionId, OAM.sessionId);
});

// -----------------------------------------------------------------------------
// Unit Tests: Browser popstate & navigation event handling
// -----------------------------------------------------------------------------

test('Browser popstate navigation updates route state and switches sessions correctly', () => {
  const env = createMockEnvironment('https://claude.ai/chat/chat-alpha', 'claude');
  const OAM = env.OAM;

  OAM.initPlatform(mockConfig('claude'));
  assert.equal(OAM.routeState, 'BOUND');
  assert.equal(OAM.sessionId, 'claude_chat-alpha');

  // Simulate user pressing Browser Back button
  env.location.href = 'https://claude.ai/chat/chat-history-prev';
  env.location.pathname = '/chat/chat-history-prev';
  env.window.dispatchEvent({ type: 'popstate' });

  assert.equal(OAM.routeState, 'BOUND');
  assert.equal(OAM.threadId, 'chat-history-prev');
  assert.equal(OAM.sessionId, 'claude_chat-history-prev');

  const endMsg = env.sentMessages.find((m) => m.type === 'SESSION_END');
  assert.ok(endMsg);
  assert.equal(endMsg.sessionId, 'claude_chat-alpha');

  const startMsgs = env.sentMessages.filter((m) => m.type === 'SESSION_START');
  assert.equal(startMsgs[startMsgs.length - 1].sessionId, 'claude_chat-history-prev');
});

test('Navigation API currententrychange event triggers route change when available', () => {
  const env = createMockEnvironment('https://grok.com/', 'grok');
  const OAM = env.OAM;

  OAM.initPlatform(mockConfig('grok'));
  assert.equal(OAM.routeState, 'DRAFT');
  const oldDraftId = OAM.sessionId;

  // Simulate Blink Navigation API event
  env.location.href = 'https://grok.com/c/grok-entry-change-123';
  env.location.pathname = '/c/grok-entry-change-123';
  env.window.navigation.dispatchEvent({ type: 'currententrychange' });

  assert.equal(OAM.routeState, 'BOUND');
  assert.equal(OAM.threadId, 'grok-entry-change-123');
  assert.equal(OAM.sessionId, 'grok_grok-entry-change-123');

  const aliasMsg = env.sentMessages.find((m) => m.type === 'SESSION_ALIAS');
  assert.ok(aliasMsg);
  assert.equal(aliasMsg.oldSessionId, oldDraftId);
  assert.equal(aliasMsg.newSessionId, 'grok_grok-entry-change-123');
});

test('In-page query param or hash changes without altering thread ID do not trigger session thrashing', () => {
  const env = createMockEnvironment('https://chatgpt.com/c/thread-steady', 'chatgpt');
  const OAM = env.OAM;

  OAM.initPlatform(mockConfig('chatgpt'));
  assert.equal(OAM.routeState, 'BOUND');
  assert.equal(OAM.sessionId, 'chatgpt_thread-steady');

  const initialMessageCount = env.sentMessages.length;

  // In-page navigation: query param change (e.g. ?model=gpt-4o) and hash change
  env.history.pushState(null, '', 'https://chatgpt.com/c/thread-steady?model=gpt-4o#turn-3');

  // Verify state remained identical and no session events dispatched
  assert.equal(OAM.routeState, 'BOUND');
  assert.equal(OAM.threadId, 'thread-steady');
  assert.equal(OAM.sessionId, 'chatgpt_thread-steady');
  assert.equal(env.sentMessages.length, initialMessageCount, 'No redundant messages should be sent');
});

test('Subtree MutationObserver on document.documentElement is removed to prevent DOM thrashing', () => {
  const env = createMockEnvironment('https://chatgpt.com/', 'chatgpt');
  const OAM = env.OAM;

  OAM.initPlatform(mockConfig('chatgpt'));

  // Ensure document.documentElement is NOT observed with { childList: true, subtree: true }
  const docElementObserved = env.observedTargets.some((item) => {
    return item.target === env.sandbox.document.documentElement && item.options && item.options.subtree;
  });

  assert.equal(docElementObserved, false, 'document.documentElement must not be observed with subtree MutationObserver');
});
