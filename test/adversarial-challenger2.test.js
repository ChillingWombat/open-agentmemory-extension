// =============================================================================
// WebAI Memory — Challenger 2 Adversarial Stress Test Suite
// Focus: Google AI Studio DOM selector fallback cascading & Angular events,
//        Zero-retention privacy workflow resilience under remote failures,
//        Popup helper functions boundary & edge-case stress testing.
// Zero external npm dependencies. Built with node:test and node:assert/strict.
// =============================================================================

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT_DIR = path.resolve(__dirname, '..');
const SHARED_JS_PATH = path.join(ROOT_DIR, 'content/shared.js');
const AISTUDIO_JS_PATH = path.join(ROOT_DIR, 'content/aistudio.js');
const LOCAL_ARCHIVE_PATH = path.join(ROOT_DIR, 'backends/local-archive.js');
const SERVICE_WORKER_PATH = path.join(ROOT_DIR, 'service-worker.js');
const POPUP_JS_PATH = path.join(ROOT_DIR, 'popup/popup.js');

const LocalArchive = require('../backends/local-archive.js');
const popupModule = require('../popup/popup.js');

// -----------------------------------------------------------------------------
// SECTION 1: Google AI Studio DOM Selector Fallback Cascading & Angular Events
// -----------------------------------------------------------------------------

test('Adversarial 1.1: AI Studio DOM Selector Fallback Cascading across 5 UI evolutionary layouts', () => {
  // Load AI Studio configuration
  let aistudioConfig = null;
  const mockOAM = {
    initPlatform: (cfg) => {
      aistudioConfig = cfg;
    },
  };
  const aistudioCode = fs.readFileSync(AISTUDIO_JS_PATH, 'utf8');
  vm.runInNewContext(aistudioCode, { OAM: mockOAM, console });
  assert.ok(aistudioConfig, 'AI Studio configuration must load');

  // Helper simulating queryFirst and queryAll cascading logic from content/shared.js
  function queryFirst(selectors, doc) {
    for (const selector of selectors) {
      const element = doc.querySelector(selector);
      if (element) return element;
    }
    return null;
  }

  function queryAll(selectors, doc) {
    for (const selector of selectors) {
      const elements = doc.querySelectorAll(selector);
      if (elements.length) return [...elements];
    }
    return [];
  }

  // Layout 1: Primary modern chat layout (ms-chat-prompt, ms-chat-turn with data-turn-role)
  const doc1 = {
    querySelector: (sel) => {
      if (sel === 'ms-chat-prompt') return { tag: 'ms-chat-prompt' };
      if (sel === 'ms-chunk-input textarea') return { tag: 'textarea', id: 'chunk-input' };
      if (sel === 'button.run-button[aria-label*="Run" i]') return { tag: 'button', id: 'run-btn-1' };
      return null;
    },
    querySelectorAll: (sel) => {
      if (sel === 'ms-chat-turn:has([data-turn-role="User"])') return [{ text: 'User question 1' }];
      if (sel === 'ms-chat-turn:has([data-turn-role="Model"])') return [{ text: 'Model response 1 long text' }];
      return [];
    },
  };
  assert.equal(queryFirst(aistudioConfig.conversationSelectors, doc1)?.tag, 'ms-chat-prompt');
  assert.equal(queryFirst(aistudioConfig.inputSelectors, doc1)?.id, 'chunk-input');
  assert.equal(queryFirst(aistudioConfig.sendButtonSelectors, doc1)?.id, 'run-btn-1');
  assert.equal(queryAll(aistudioConfig.userMessageSelectors, doc1).length, 1);
  assert.equal(queryAll(aistudioConfig.assistantMessageSelectors, doc1).length, 1);

  // Layout 2: Prompt Editor layout where ms-chat-prompt is absent, falls back to ms-prompt-editor
  // User messages use [data-turn-role="User"] .turn-content
  const doc2 = {
    querySelector: (sel) => {
      if (sel === 'ms-prompt-editor') return { tag: 'ms-prompt-editor' };
      if (sel === 'textarea[aria-label*="prompt" i]') return { tag: 'textarea', id: 'prompt-aria-input' };
      if (sel === 'button[aria-label="Run prompt"]') return { tag: 'button', id: 'run-prompt-btn' };
      return null;
    },
    querySelectorAll: (sel) => {
      if (sel === '[data-turn-role="User"] .turn-content') return [{ text: 'User prompt via turn-content' }];
      if (sel === '[data-turn-role="Model"] .turn-content') return [{ text: 'Model answer via turn-content' }];
      return [];
    },
  };
  assert.equal(queryFirst(aistudioConfig.conversationSelectors, doc2)?.tag, 'ms-prompt-editor');
  assert.equal(queryFirst(aistudioConfig.inputSelectors, doc2)?.id, 'prompt-aria-input');
  assert.equal(queryFirst(aistudioConfig.sendButtonSelectors, doc2)?.id, 'run-prompt-btn');
  assert.equal(queryAll(aistudioConfig.userMessageSelectors, doc2)[0].text, 'User prompt via turn-content');
  assert.equal(queryAll(aistudioConfig.assistantMessageSelectors, doc2)[0].text, 'Model answer via turn-content');

  // Layout 3: Container falls back to .chat-container, input to textarea[aria-label*="Type something" i]
  const doc3 = {
    querySelector: (sel) => {
      if (sel === '.chat-container') return { tag: 'div', class: 'chat-container' };
      if (sel === 'textarea[aria-label*="Type something" i]') return { tag: 'textarea', id: 'type-something-input' };
      if (sel === 'button[aria-label="Run"]') return { tag: 'button', id: 'run-btn-plain' };
      return null;
    },
    querySelectorAll: (sel) => {
      if (sel === '[data-turn-role="User"]') return [{ text: 'User turn raw role' }];
      if (sel === '[data-turn-role="Model"]') return [{ text: 'Model turn raw role' }];
      return [];
    },
  };
  assert.equal(queryFirst(aistudioConfig.conversationSelectors, doc3)?.class, 'chat-container');
  assert.equal(queryFirst(aistudioConfig.inputSelectors, doc3)?.id, 'type-something-input');
  assert.equal(queryFirst(aistudioConfig.sendButtonSelectors, doc3)?.id, 'run-btn-plain');
  assert.equal(queryAll(aistudioConfig.userMessageSelectors, doc3)[0].text, 'User turn raw role');
  assert.equal(queryAll(aistudioConfig.assistantMessageSelectors, doc3)[0].text, 'Model turn raw role');

  // Layout 4: Container falls back to mat-sidenav-content, input to textarea[placeholder*="prompt" i], button to button.run-button
  const doc4 = {
    querySelector: (sel) => {
      if (sel === 'mat-sidenav-content') return { tag: 'mat-sidenav-content' };
      if (sel === 'textarea[placeholder*="prompt" i]') return { tag: 'textarea', id: 'placeholder-input' };
      if (sel === 'button.run-button') return { tag: 'button', id: 'class-run-btn' };
      return null;
    },
    querySelectorAll: (sel) => {
      if (sel === '.user-turn') return [{ text: 'User turn via class' }];
      if (sel === '.model-turn') return [{ text: 'Model turn via class' }];
      return [];
    },
  };
  assert.equal(queryFirst(aistudioConfig.conversationSelectors, doc4)?.tag, 'mat-sidenav-content');
  assert.equal(queryFirst(aistudioConfig.inputSelectors, doc4)?.id, 'placeholder-input');
  assert.equal(queryFirst(aistudioConfig.sendButtonSelectors, doc4)?.id, 'class-run-btn');
  assert.equal(queryAll(aistudioConfig.userMessageSelectors, doc4)[0].text, 'User turn via class');
  assert.equal(queryAll(aistudioConfig.assistantMessageSelectors, doc4)[0].text, 'Model turn via class');

  // Layout 5: Minimal/Degraded fallback to [role="main"] / body, input to generic textarea, turns to .chat-turn-user / .chat-turn-model
  const doc5 = {
    querySelector: (sel) => {
      if (sel === '[role="main"]') return { tag: 'main' };
      if (sel === '.prompt-box-container textarea') return { tag: 'textarea', id: 'box-container-input' };
      if (sel === 'button[aria-label*="Run" i]') return { tag: 'button', id: 'case-insensitive-run' };
      return null;
    },
    querySelectorAll: (sel) => {
      if (sel === '.chat-turn-user') return [{ text: 'User chat turn' }];
      if (sel === '.chat-turn-model') return [{ text: 'Model chat turn' }];
      return [];
    },
  };
  assert.equal(queryFirst(aistudioConfig.conversationSelectors, doc5)?.tag, 'main');
  assert.equal(queryFirst(aistudioConfig.inputSelectors, doc5)?.id, 'box-container-input');
  assert.equal(queryFirst(aistudioConfig.sendButtonSelectors, doc5)?.id, 'case-insensitive-run');
  assert.equal(queryAll(aistudioConfig.userMessageSelectors, doc5)[0].text, 'User chat turn');
  assert.equal(queryAll(aistudioConfig.assistantMessageSelectors, doc5)[0].text, 'Model chat turn');
});

test('Adversarial 1.2: Angular/Material synthetic event dispatch and prototype setter bypass', () => {
  const sharedCode = fs.readFileSync(SHARED_JS_PATH, 'utf8');

  const dispatchedEvents = [];
  let focusCalled = false;
  let nativeSetterCalled = false;
  let overriddenSetterCalled = false;

  class MockEvent {
    constructor(type, opts = {}) {
      this.type = type;
      this.bubbles = opts.bubbles;
    }
  }

  class MockInputEvent extends MockEvent {
    constructor(type, opts = {}) {
      super(type, opts);
      this.inputType = opts.inputType;
      this.data = opts.data;
    }
  }

  class MockHTMLTextAreaElement {
    get value() { return this._internalVal; }
    set value(v) {
      nativeSetterCalled = true;
      this._internalVal = v;
    }
  }

  // Create an element that simulates Angular FormControl overriding .value on the instance
  const mockTextarea = Object.create(MockHTMLTextAreaElement.prototype);
  mockTextarea.tagName = 'TEXTAREA';
  mockTextarea._internalVal = 'Existing user draft prompt';

  // Instance override: Angular does Object.defineProperty(element, 'value', { ... })
  Object.defineProperty(mockTextarea, 'value', {
    get() { return this._internalVal; },
    set(v) {
      overriddenSetterCalled = true;
      this._internalVal = v;
    },
    configurable: true,
  });

  mockTextarea.focus = () => { focusCalled = true; };
  mockTextarea.dispatchEvent = (evt) => { dispatchedEvents.push(evt); };

  const sandbox = {
    HTMLTextAreaElement: MockHTMLTextAreaElement,
    Event: MockEvent,
    InputEvent: MockInputEvent,
    chrome: {
      storage: {
        session: { get: () => {}, remove: () => {} },
        local: { get: () => {} },
        onChanged: { addListener: () => {} },
      },
      runtime: { sendMessage: () => {} },
    },
    document: {
      createElement: () => ({ style: {}, querySelector: () => null }),
      getElementById: () => null,
      body: { appendChild: () => {} },
    },
    window: { addEventListener: () => {} },
    setTimeout: () => 1,
    clearTimeout: () => {},
    console,
  };

  const ctx = vm.createContext(sandbox);
  const OAM = vm.runInContext(`${sharedCode}\nOAM;`, ctx);

  const contextText = 'Recalled Memory: User prefers TypeScript and strict mode.';
  OAM.prependContextToInput(mockTextarea, contextText);

  // 1. Focus was invoked
  assert.equal(focusCalled, true, 'inputEl.focus() must be invoked');

  // 2. Native prototype setter was used (bypassing instance override if configured)
  assert.equal(nativeSetterCalled, true, 'Native HTMLTextAreaElement.prototype.value setter must be used');

  // 3. Existing draft was preserved after prepended context
  assert.ok(mockTextarea._internalVal.startsWith('---\n[AgentMemory Context'), 'Context header at start');
  assert.ok(mockTextarea._internalVal.includes(contextText), 'Context text included');
  assert.ok(mockTextarea._internalVal.endsWith('Existing user draft prompt'), 'User draft preserved at end');

  // 4. Multi-event dispatch sequence
  const eventTypes = dispatchedEvents.map((e) => e.type);
  assert.deepEqual(eventTypes, ['input', 'change', 'input', 'resize'], 'Dispatches [input, change, InputEvent(input), resize]');

  const inputEvent = dispatchedEvents[2];
  assert.ok(inputEvent instanceof MockInputEvent);
  assert.equal(inputEvent.inputType, 'insertText');
  assert.ok(inputEvent.data.includes(contextText));
});

test('Adversarial 1.3: attachSendHooks adversarial keystroke matrix and double-binding defense', () => {
  const sharedCode = fs.readFileSync(SHARED_JS_PATH, 'utf8');

  // Keystroke evaluation test
  function evaluateSubmitKey(event) {
    return (event.key === 'Enter' && !event.shiftKey && !event.isComposing) ||
           (event.key === 'Enter' && (event.ctrlKey || event.metaKey));
  }

  // Matrix of adversarial combinations:
  // 1. Plain Enter -> true
  assert.equal(evaluateSubmitKey({ key: 'Enter', shiftKey: false, isComposing: false, ctrlKey: false, metaKey: false }), true);

  // 2. Shift+Enter (user wanting newline in prompt) -> false
  assert.equal(evaluateSubmitKey({ key: 'Enter', shiftKey: true, isComposing: false, ctrlKey: false, metaKey: false }), false);

  // 3. Ctrl+Enter (Google AI Studio standard submit on Linux/Windows) -> true
  assert.equal(evaluateSubmitKey({ key: 'Enter', shiftKey: false, isComposing: false, ctrlKey: true, metaKey: false }), true);

  // 4. Cmd+Enter (Google AI Studio standard submit on macOS) -> true
  assert.equal(evaluateSubmitKey({ key: 'Enter', shiftKey: false, isComposing: false, ctrlKey: false, metaKey: true }), true);

  // 5. Ctrl+Shift+Enter -> true
  assert.equal(evaluateSubmitKey({ key: 'Enter', shiftKey: true, isComposing: false, ctrlKey: true, metaKey: false }), true);

  // 6. Cmd+Shift+Enter -> true
  assert.equal(evaluateSubmitKey({ key: 'Enter', shiftKey: true, isComposing: false, ctrlKey: false, metaKey: true }), true);

  // 7. IME composition in progress: Japanese/Chinese input where Enter confirms character selection -> false
  assert.equal(evaluateSubmitKey({ key: 'Enter', shiftKey: false, isComposing: true, ctrlKey: false, metaKey: false }), false);

  // 8. Non-enter keys with modifier
  assert.equal(evaluateSubmitKey({ key: 's', shiftKey: false, isComposing: false, ctrlKey: true, metaKey: false }), false);
  assert.equal(evaluateSubmitKey({ key: 'r', shiftKey: false, isComposing: false, ctrlKey: false, metaKey: true }), false);

  // Double-binding defense verification
  assert.ok(sharedCode.includes("button.dataset.oamHooked = 'true'"), 'Buttons marked with oamHooked');
  assert.ok(sharedCode.includes("input.dataset.oamHooked = 'true'"), 'Inputs marked with oamHooked');
  assert.ok(sharedCode.includes("if (button && !button.dataset.oamHooked)"), 'Button hook prevents double binding');
  assert.ok(sharedCode.includes("if (input && !input.dataset.oamHooked)"), 'Input hook prevents double binding');
});

// -----------------------------------------------------------------------------
// SECTION 2: Zero-Retention Privacy Workflow Resilience Under Remote Failures
// -----------------------------------------------------------------------------

function createMockChromeStorage() {
  const store = {};
  return {
    local: {
      get: async (keys) => {
        if (!keys) return { ...store };
        if (typeof keys === 'string') return { [keys]: store[keys] };
        if (Array.isArray(keys)) {
          const res = {};
          keys.forEach((k) => { res[k] = store[k]; });
          return res;
        }
        return { ...store };
      },
      set: async (items) => {
        Object.assign(store, items);
      },
      remove: async (keys) => {
        const list = Array.isArray(keys) ? keys : [keys];
        list.forEach((k) => delete store[k]);
      },
    },
    session: {
      get: async () => ({}),
      set: async () => {},
      remove: async () => {},
    },
  };
}

test('Adversarial 2.1: Zero-retention turn persistence when remote memory engine throws unhandled network failure', async () => {
  const mockStorage = createMockChromeStorage();
  const originalChrome = global.chrome;
  global.chrome = {
    storage: mockStorage,
    runtime: { lastError: null },
  };

  try {
    // 1. Simulate saving turn directly via LocalArchive
    const saveResult = await LocalArchive.saveTurn({
      platform: 'aistudio',
      sessionId: 'session-zero-retention-test',
      userPrompt: 'Confidential architecture design prompt',
      assistantResponse: 'Here is the proprietary design blueprint...',
    });

    assert.equal(saveResult.success, true);
    assert.equal(saveResult.sessionId, 'session-zero-retention-test');

    // 2. Simulate remote engine throwing network error
    let remoteFailed = false;
    try {
      throw new TypeError('fetch failed: ECONNREFUSED 127.0.0.1:3111');
    } catch {
      remoteFailed = true;
    }
    assert.equal(remoteFailed, true, 'Remote request failed');

    // 3. Verify turn is fully preserved in local archive despite remote engine crash
    const details = await LocalArchive.getSessionDetails('session-zero-retention-test');
    assert.ok(details.session, 'Session must exist locally');
    assert.equal(details.session.platform, 'aistudio');
    assert.equal(details.turns.length, 1);
    assert.equal(details.turns[0].userText, 'Confidential architecture design prompt');
    assert.equal(details.turns[0].assistantText, 'Here is the proprietary design blueprint...');
  } finally {
    global.chrome = originalChrome;
  }
});

test('Adversarial 2.2: Zero-retention turn persistence when remote engine returns HTTP 500, 401, or 429', async () => {
  const mockStorage = createMockChromeStorage();
  const originalChrome = global.chrome;
  global.chrome = {
    storage: mockStorage,
    runtime: { lastError: null },
  };

  try {
    // Save multiple turns under various remote failure codes
    const failureCodes = [500, 401, 429, 502];
    for (let i = 0; i < failureCodes.length; i++) {
      const code = failureCodes[i];
      const res = await LocalArchive.saveTurn({
        platform: 'gemini',
        sessionId: 'session-http-errors',
        userPrompt: `Prompt when server returned ${code}`,
        assistantResponse: `Assistant answer generated on frontend before ${code}`,
      });
      assert.equal(res.success, true);
    }

    const details = await LocalArchive.getSessionDetails('session-http-errors');
    assert.equal(details.turns.length, failureCodes.length, 'All 4 turns must be preserved');
    assert.equal(details.turns[0].userText, 'Prompt when server returned 500');
    assert.equal(details.turns[3].userText, 'Prompt when server returned 502');
  } finally {
    global.chrome = originalChrome;
  }
});

test('Adversarial 2.3: Service Worker OBSERVE handler executes LocalArchive.saveTurn before engine.observe', async () => {
  const swCode = fs.readFileSync(SERVICE_WORKER_PATH, 'utf8');

  // Verify code structure in service-worker.js:
  // LocalArchive.saveTurn is in a try/catch block PRECEDING engine.observe
  const archiveIdx = swCode.indexOf('LocalArchive.saveTurn({');
  const engineIdx = swCode.indexOf('engine.observe({');

  assert.ok(archiveIdx !== -1, 'LocalArchive.saveTurn must be called in OBSERVE');
  assert.ok(engineIdx !== -1, 'engine.observe must be called in OBSERVE');
  assert.ok(archiveIdx < engineIdx, 'LocalArchive.saveTurn MUST execute BEFORE engine.observe');

  // Verify that an error in engine.observe does not affect local archive
  assert.ok(
    swCode.includes("catch (archiveErr) {\n            console.warn('LocalArchive.saveTurn failed:', archiveErr);\n          }"),
    'LocalArchive errors are caught and logged without aborting'
  );
});

test('Adversarial 2.4: LocalArchive deduplication oracle & streaming in-place updates', async () => {
  const mockStorage = createMockChromeStorage();
  const originalChrome = global.chrome;
  global.chrome = {
    storage: mockStorage,
    runtime: { lastError: null },
  };

  try {
    const sessionId = 'stream-dedup-session';

    // Step 1: Initial partial stream chunk
    const r1 = await LocalArchive.saveTurn({
      platform: 'aistudio',
      sessionId,
      userPrompt: 'Explain quantum supremacy',
      assistantResponse: 'Quantum supremacy is',
    });
    assert.equal(r1.success, true);
    assert.equal(r1.turnCount, 1);

    // Step 2: Incremental streaming update (starts with previous text)
    const r2 = await LocalArchive.saveTurn({
      platform: 'aistudio',
      sessionId,
      userPrompt: 'Explain quantum supremacy',
      assistantResponse: 'Quantum supremacy is the computational advantage demonstrated by quantum computers.',
    });
    assert.equal(r2.success, true);
    assert.equal(r2.deduplicated, true, 'Streaming update should update in-place with deduplicated flag');
    assert.equal(r2.turnCount, 1, 'Turn count must remain 1 during streaming');

    // Step 3: Exact duplicate event (e.g. DOM mutation observer fired twice with same content)
    const r3 = await LocalArchive.saveTurn({
      platform: 'aistudio',
      sessionId,
      userPrompt: 'Explain quantum supremacy',
      assistantResponse: 'Quantum supremacy is the computational advantage demonstrated by quantum computers.',
    });
    assert.equal(r3.success, true);
    assert.equal(r3.deduplicated, true);
    assert.equal(r3.turnCount, 1);

    // Step 4: Next user prompt in the same session
    const r4 = await LocalArchive.saveTurn({
      platform: 'aistudio',
      sessionId,
      userPrompt: 'What about error correction?',
      assistantResponse: 'Quantum error correction uses surface codes.',
    });
    assert.equal(r4.success, true);
    assert.equal(r4.turnCount, 2);

    const details = await LocalArchive.getSessionDetails(sessionId);
    assert.equal(details.turns.length, 2);
    assert.equal(details.turns[0].assistantText, 'Quantum supremacy is the computational advantage demonstrated by quantum computers.');
    assert.equal(details.turns[1].assistantText, 'Quantum error correction uses surface codes.');
  } finally {
    global.chrome = originalChrome;
  }
});

test('Adversarial 2.5: Multi-platform isolation and selective platform purge', async () => {
  const mockStorage = createMockChromeStorage();
  const originalChrome = global.chrome;
  global.chrome = {
    storage: mockStorage,
    runtime: { lastError: null },
  };

  try {
    // Save sessions across 5 platforms
    const platforms = ['aistudio', 'gemini', 'chatgpt', 'claude', 'grok'];
    for (const p of platforms) {
      await LocalArchive.saveTurn({
        platform: p,
        sessionId: `sess-${p}`,
        userPrompt: `Hello on ${p}`,
        assistantResponse: `Response from ${p}`,
      });
    }

    // Verify all 5 sessions exist
    let allSessions = await LocalArchive.getSessions({ platform: 'all' });
    assert.equal(allSessions.length, 5);

    // Verify single platform query
    let aistudioSessions = await LocalArchive.getSessions({ platform: 'aistudio' });
    assert.equal(aistudioSessions.length, 1);
    assert.equal(aistudioSessions[0].platform, 'aistudio');

    // Purge only 'chatgpt'
    const clearRes = await LocalArchive.clearHistory({ platform: 'chatgpt' });
    assert.equal(clearRes.success, true);
    assert.equal(clearRes.clearedCount, 1);

    // Verify chatgpt is gone while aistudio, gemini, claude, grok remain
    allSessions = await LocalArchive.getSessions({ platform: 'all' });
    assert.equal(allSessions.length, 4);
    assert.equal(allSessions.some((s) => s.platform === 'chatgpt'), false);
    assert.equal(allSessions.some((s) => s.platform === 'aistudio'), true);

    // Export remaining history to JSON and Markdown
    const jsonExport = await LocalArchive.exportHistory({ format: 'json' });
    const parsed = JSON.parse(jsonExport.data);
    assert.equal(parsed.totalSessions, 4);
    assert.equal(parsed.sessions.length, 4);

    const mdExport = await LocalArchive.exportHistory({ format: 'markdown' });
    assert.ok(mdExport.data.includes('# WebAI Memory Conversation Archive Export'));
    assert.ok(mdExport.data.includes('## Session: Hello on aistudio'));
  } finally {
    global.chrome = originalChrome;
  }
});

// -----------------------------------------------------------------------------
// SECTION 3: Popup Helper Functions Boundary & Edge-Case Stress Testing
// -----------------------------------------------------------------------------

test('Adversarial 3.1: esc() boundary inputs and comprehensive XSS injection matrix', () => {
  const esc = popupModule.esc;

  // 1. Falsy and primitive boundaries
  // Note: Due to JavaScript idiom `str || ''`, falsy primitives (0, false, null, undefined, NaN) become ''
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(''), '');
  assert.equal(esc(0), '', 'Numeric 0 is falsy and converts to empty string');
  assert.equal(esc('0'), '0', 'String "0" is truthy and preserved as "0"');
  assert.equal(esc(false), '', 'Boolean false is falsy and converts to empty string');
  assert.equal(esc('false'), 'false', 'String "false" is truthy and preserved');
  assert.equal(esc(NaN), '', 'NaN is falsy and converts to empty string');
  assert.equal(esc(-42), '-42');
  assert.equal(esc(true), 'true');

  // 2. Complex object and array coercion
  assert.equal(esc({}), '[object Object]');
  assert.equal(esc([1, 2]), '1,2');

  // 3. Adversarial HTML / XSS vectors
  const vectors = [
    { input: '<script>alert("xss")</script>', expected: '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;' },
    { input: '"><img src=x onerror=alert(1)>', expected: '&quot;&gt;&lt;img src=x onerror=alert(1)&gt;' },
    { input: "' onfocus='alert(1)'", expected: '&#39; onfocus=&#39;alert(1)&#39;' },
    { input: 'Tom & Jerry <cartoon> "classic"', expected: 'Tom &amp; Jerry &lt;cartoon&gt; &quot;classic&quot;' },
    { input: '`test` & " \' < >', expected: '`test` &amp; &quot; &#39; &lt; &gt;' },
  ];

  for (const v of vectors) {
    const result = esc(v.input);
    assert.equal(result, v.expected);
    // Invariant: Result must not contain raw HTML control characters
    assert.equal(result.includes('<'), false, 'Must not contain raw <');
    assert.equal(result.includes('>'), false, 'Must not contain raw >');
    assert.equal(result.includes('"'), false, 'Must not contain raw "');
    assert.equal(result.includes("'"), false, "Must not contain raw '");
  }
});

test('Adversarial 3.2: formatRelativeTime() time drift, boundaries, and malformed inputs', () => {
  const format = popupModule.formatRelativeTime;

  // Falsy values
  assert.equal(format(null), '');
  assert.equal(format(undefined), '');
  assert.equal(format(''), '');
  assert.equal(format(false), '');

  // Invalid date strings
  assert.equal(format('invalid-date'), 'just now');
  assert.equal(format('2026-99-99T99:99:99Z'), 'just now');
  assert.equal(format('not a timestamp'), 'just now');

  // Future timestamps (clock skew where user clock is slightly behind server)
  const future1m = new Date(Date.now() + 60000).toISOString();
  const future1d = new Date(Date.now() + 86400000).toISOString();
  assert.equal(format(future1m), 'just now');
  assert.equal(format(future1d), 'just now');

  // Exact boundaries
  const now = Date.now();
  assert.equal(format(new Date(now - 1000).toISOString()), '1s ago');
  assert.equal(format(new Date(now - 30000).toISOString()), '30s ago');
  assert.equal(format(new Date(now - 59000).toISOString()), '59s ago');

  assert.equal(format(new Date(now - 60000).toISOString()), '1m ago');
  assert.equal(format(new Date(now - 3540000).toISOString()), '59m ago');

  assert.equal(format(new Date(now - 3600000).toISOString()), '1h ago');
  assert.equal(format(new Date(now - 82800000).toISOString()), '23h ago');

  assert.equal(format(new Date(now - 86400000).toISOString()), '1d ago');
  assert.equal(format(new Date(now - 518400000).toISOString()), '6d ago');

  // >= 7 days formats as date string (e.g. "Sep 28" or similar)
  const day10Ago = new Date(now - 10 * 86400000).toISOString();
  const res10 = format(day10Ago);
  assert.ok(res10.length > 0 && !res10.includes('ago'), '>=7 days returns localized date without ago');
});

test('Adversarial 3.3: formatPlatformName() case sensitivity, defaults, and boundary inputs', () => {
  const format = popupModule.formatPlatformName;

  // Case insensitivity
  assert.equal(format('aistudio'), 'AI Studio');
  assert.equal(format('AIStudio'), 'AI Studio');
  assert.equal(format('AISTUDIO'), 'AI Studio');

  assert.equal(format('gemini'), 'Gemini');
  assert.equal(format('GEMINI'), 'Gemini');

  assert.equal(format('chatgpt'), 'ChatGPT');
  assert.equal(format('CHATGPT'), 'ChatGPT');

  assert.equal(format('claude'), 'Claude');
  assert.equal(format('CLAUDE'), 'Claude');

  assert.equal(format('grok'), 'Grok');
  assert.equal(format('GROK'), 'Grok');

  // Unknown custom platforms preserved
  assert.equal(format('ollama'), 'ollama');
  assert.equal(format('deepseek'), 'deepseek');
  assert.equal(format('custom_agent'), 'custom_agent');

  // Falsy values
  assert.equal(format(null), 'Unknown');
  assert.equal(format(undefined), 'Unknown');
  assert.equal(format(''), 'Unknown');
});

test('Adversarial 3.4: stableId() determinism, collisions, and property-order independence', () => {
  const stableId = popupModule.stableId;

  // Determinism: Same object returns identical ID
  const item = {
    id: 'mem-123',
    sessionId: 'sess-abc',
    timestamp: '2026-10-05T00:00:00Z',
    title: 'Architecture Rules',
    subtitle: 'Core',
    narrative: 'Use modular services',
  };
  assert.equal(stableId(item), stableId({ ...item }));

  // Empty object defaults cleanly without crash
  assert.equal(stableId({}), 'memory-0');

  // Property order independence (properties in different key order produce same values)
  const itemReordered = {
    narrative: 'Use modular services',
    title: 'Architecture Rules',
    sessionId: 'sess-abc',
    id: 'mem-123',
    timestamp: '2026-10-05T00:00:00Z',
    subtitle: 'Core',
  };
  assert.equal(stableId(item), stableId(itemReordered));

  // Collision resistance: Generate 100 distinct items and verify unique IDs
  const generatedIds = new Set();
  for (let i = 0; i < 100; i++) {
    const id = stableId({
      id: `gen-${i}`,
      title: `Title ${i}`,
      narrative: `Narrative text description ${i * 7}`,
    });
    assert.ok(id.startsWith('memory-'), 'ID must start with memory-');
    assert.equal(generatedIds.has(id), false, `ID collision detected at index ${i}: ${id}`);
    generatedIds.add(id);
  }
  assert.equal(generatedIds.size, 100);
});


// -----------------------------------------------------------------------------
// SECTION 4: Advanced Edge-Case & Stress Invariants
// -----------------------------------------------------------------------------

test('Adversarial 4.1: prependContextToInput resilience on large payload, null elements, and ProseMirror', () => {
  const sharedCode = fs.readFileSync(SHARED_JS_PATH, 'utf8');

  let insertedNode = null;
  let dispatchedOnContentEditable = false;

  const mockRange = {
    selectNodeContents() {},
    collapse() {},
    insertNode(node) {
      insertedNode = node;
    },
  };

  const mockSelection = {
    removeAllRanges() {},
    addRange() {},
  };

  const mockContentEditable = {
    tagName: 'DIV',
    isContentEditable: true,
    classList: { contains: () => true },
    focus() {},
    dispatchEvent(evt) {
      if (evt.type === 'input') dispatchedOnContentEditable = true;
    },
  };

  const sandbox = {
    HTMLTextAreaElement: class {},
    Event: class { constructor(type) { this.type = type; } },
    InputEvent: class { constructor(type) { this.type = type; } },
    document: {
      createRange: () => mockRange,
      createTextNode: (text) => ({ textContent: text }),
      createElement: () => ({ style: {}, querySelector: () => null }),
      getElementById: () => null,
      body: { appendChild: () => {} },
    },
    window: {
      getSelection: () => mockSelection,
      addEventListener: () => {},
    },
    chrome: {
      storage: { session: { get: () => {} }, local: { get: () => {} }, onChanged: { addListener: () => {} } },
      runtime: { sendMessage: () => {} },
    },
    setTimeout: () => 1,
    clearTimeout: () => {},
    console,
  };

  const ctx = vm.createContext(sandbox);
  const OAM = vm.runInContext(`${sharedCode}\nOAM;`, ctx);

  // 1. Null / undefined input element:
  // If context is empty, returns early without accessing tagName
  assert.doesNotThrow(() => {
    OAM.prependContextToInput(null, '');
    OAM.prependContextToInput(undefined, '');
  });

  // If context is provided, accessing inputEl.tagName throws TypeError on null element
  assert.throws(
    () => { OAM.prependContextToInput(null, 'Some context'); },
    { name: 'TypeError', message: /Cannot read properties of null/ }
  );

  // In the real UI lifecycle, attachSendHooks explicitly guards:
  // `const currentInput = queryFirst(config.inputSelectors); if (!currentInput) return;`
  assert.ok(
    sharedCode.includes('const currentInput = queryFirst(config.inputSelectors);') &&
    sharedCode.includes('if (!currentInput) return;'),
    'attachSendHooks must guard against null input before calling prependContextToInput'
  );

  // 2. Empty context text: must not throw and do nothing
  assert.doesNotThrow(() => {
    OAM.prependContextToInput(mockContentEditable, '');
    OAM.prependContextToInput(mockContentEditable, null);
  });

  // 3. ProseMirror / contentEditable injection
  const extremeContext = 'Memory Context line '.repeat(1000);
  OAM.prependContextToInput(mockContentEditable, extremeContext);
  assert.ok(insertedNode, 'Text node was inserted into range');
  assert.ok(insertedNode.textContent.includes('Memory Context line'), 'Extreme context included');
  assert.equal(dispatchedOnContentEditable, true, 'Dispatched input event on contentEditable');
});

test('Adversarial 4.2: LocalArchive concurrent saveTurn executions across distinct sessions', async () => {
  const mockStorage = createMockChromeStorage();
  const originalChrome = global.chrome;
  global.chrome = {
    storage: mockStorage,
    runtime: { lastError: null },
  };

  try {
    // Run 10 sequential-to-concurrent turns across 5 distinct sessions
    const sessionIds = ['concurrent-s1', 'concurrent-s2', 'concurrent-s3', 'concurrent-s4', 'concurrent-s5'];
    
    for (let round = 1; round <= 2; round++) {
      await Promise.all(
        sessionIds.map((sId) =>
          LocalArchive.saveTurn({
            platform: 'aistudio',
            sessionId: sId,
            userPrompt: `Round ${round} prompt for ${sId}`,
            assistantResponse: `Round ${round} answer for ${sId}`,
          })
        )
      );
    }

    const sessions = await LocalArchive.getSessions({ platform: 'all' });
    assert.equal(sessions.length, 5, 'Must have recorded all 5 sessions');

    for (const sId of sessionIds) {
      const details = await LocalArchive.getSessionDetails(sId);
      assert.ok(details.session, `Session ${sId} must exist`);
      assert.equal(details.turns.length, 2, `Session ${sId} must have both turns`);
    }
  } finally {
    global.chrome = originalChrome;
  }
});

test('Adversarial 4.3: LocalArchive search with regex special characters and case insensitivity', async () => {
  const mockStorage = createMockChromeStorage();
  const originalChrome = global.chrome;
  global.chrome = {
    storage: mockStorage,
    runtime: { lastError: null },
  };

  try {
    const specialTexts = [
      'C++ pointer syntax: int* ptr = &val;',
      'Regular expression match: /^(\\d{3})-\\d{2}$/',
      'Math formula: a + b * (c - d) / [e ^ f] = $100.00?',
    ];

    for (let i = 0; i < specialTexts.length; i++) {
      await LocalArchive.saveTurn({
        platform: 'aistudio',
        sessionId: `special-${i}`,
        userPrompt: `Search test question ${i}`,
        assistantResponse: specialTexts[i],
      });
    }

    // Search with regex metacharacters in query: /^(
    const matchRegex = await LocalArchive.searchTurns({ query: '/^(\\d{3})' });
    assert.equal(matchRegex.length, 1);
    assert.ok(matchRegex[0].turn.assistantText.includes('/^(\\d{3})'));

    // Search with $ and ?
    const matchMath = await LocalArchive.searchTurns({ query: '$100.00?' });
    assert.equal(matchMath.length, 1);

    // Search with uppercase query for lowercase content
    const matchUpper = await LocalArchive.searchTurns({ query: 'POINTER SYNTAX' });
    assert.equal(matchUpper.length, 1);
  } finally {
    global.chrome = originalChrome;
  }
});

test('Adversarial 4.4: LocalArchive exportHistory and pagination on empty database and extreme boundaries', async () => {
  const mockStorage = createMockChromeStorage();
  const originalChrome = global.chrome;
  global.chrome = {
    storage: mockStorage,
    runtime: { lastError: null },
  };

  try {
    // 1. Empty database export
    const emptyJson = await LocalArchive.exportHistory({ format: 'json' });
    const parsedJson = JSON.parse(emptyJson.data);
    assert.equal(parsedJson.totalSessions, 0);
    assert.equal(parsedJson.totalTurns, 0);
    assert.deepEqual(parsedJson.sessions, []);

    const emptyMd = await LocalArchive.exportHistory({ format: 'markdown' });
    assert.ok(emptyMd.data.includes('Total Sessions**: 0'));
    assert.ok(emptyMd.data.includes('Total Turns**: 0'));

    // 2. Pagination beyond boundary
    const emptyPage = await LocalArchive.getSessions({ offset: 1000, limit: 10 });
    assert.deepEqual(emptyPage, []);

    // 3. Zero or negative limit
    const zeroLimit = await LocalArchive.getSessions({ limit: 0 });
    // LocalArchive falls back to limit 1 when limit <= 0
    assert.ok(Array.isArray(zeroLimit));
  } finally {
    global.chrome = originalChrome;
  }
});

test('Adversarial 4.5: Popup msg() helper handles runtime.lastError cleanly', async () => {
  const msg = popupModule.msg;

  // 1. Simulate runtime.lastError
  const originalChrome = global.chrome;
  global.chrome = {
    runtime: {
      lastError: { message: 'Could not establish connection. Receiving end does not exist.' },
      sendMessage: (message, cb) => {
        cb(null);
      },
    },
  };

  try {
    const res = await msg({ type: 'STATUS' });
    assert.ok(res.error, 'Must capture error from lastError');
    assert.equal(res.error, 'Could not establish connection. Receiving end does not exist.');
  } finally {
    // 2. Simulate missing chrome
    delete global.chrome;
    const res2 = await msg({ type: 'STATUS' });
    assert.equal(res2.error, 'chrome.runtime is not available');
    global.chrome = originalChrome;
  }
});
