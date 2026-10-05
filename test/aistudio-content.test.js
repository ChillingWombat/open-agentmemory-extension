const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sharedJsPath = path.resolve('content/shared.js');
const aistudioJsPath = path.resolve('content/aistudio.js');

test('content/aistudio.js initializes OAM platform with robust Google AI Studio selectors', () => {
  let initializedConfig = null;
  const mockOAM = {
    initPlatform: (config) => {
      initializedConfig = config;
    },
  };

  const code = fs.readFileSync(aistudioJsPath, 'utf8');
  const context = vm.createContext({
    OAM: mockOAM,
    console,
  });

  vm.runInContext(code, context);

  assert.ok(initializedConfig, 'OAM.initPlatform was called');
  assert.equal(initializedConfig.platform, 'aistudio');

  // Verify conversation container selectors
  const requiredContainers = [
    'ms-chat-prompt',
    'ms-prompt-editor',
    '.chat-container',
    'mat-sidenav-content',
    'main',
    '[role="main"]',
    'body',
  ];
  for (const sel of requiredContainers) {
    assert.ok(
      initializedConfig.conversationSelectors.includes(sel),
      `conversationSelectors should include ${sel}`
    );
  }

  // Verify user message selectors
  const requiredUserSelectors = [
    'ms-chat-turn:has([data-turn-role="User"])',
    '[data-turn-role="User"] .turn-content',
    '[data-turn-role="User"]',
    '.user-turn',
    '.chat-turn-user',
  ];
  for (const sel of requiredUserSelectors) {
    assert.ok(
      initializedConfig.userMessageSelectors.includes(sel),
      `userMessageSelectors should include ${sel}`
    );
  }

  // Verify assistant/model message selectors
  const requiredAssistantSelectors = [
    'ms-chat-turn:has([data-turn-role="Model"])',
    '[data-turn-role="Model"] .turn-content',
    '[data-turn-role="Model"]',
    '.model-turn',
    '.chat-turn-model',
  ];
  for (const sel of requiredAssistantSelectors) {
    assert.ok(
      initializedConfig.assistantMessageSelectors.includes(sel),
      `assistantMessageSelectors should include ${sel}`
    );
  }

  // Verify input selectors
  const requiredInputs = [
    'ms-chunk-input textarea',
    'textarea[aria-label*="prompt" i]',
    'textarea[aria-label*="Type something" i]',
    'textarea[placeholder*="prompt" i]',
    '.prompt-box-container textarea',
    'textarea',
  ];
  for (const sel of requiredInputs) {
    assert.ok(
      initializedConfig.inputSelectors.includes(sel),
      `inputSelectors should include ${sel}`
    );
  }

  // Verify send/run button selectors
  const requiredButtons = [
    'button.run-button[aria-label*="Run" i]',
    'button[aria-label="Run prompt"]',
    'button[aria-label="Run"]',
    'button.run-button',
  ];
  for (const sel of requiredButtons) {
    assert.ok(
      initializedConfig.sendButtonSelectors.includes(sel),
      `sendButtonSelectors should include ${sel}`
    );
  }
});

test('content/shared.js prependContextToInput performs framework-safe injection for Angular/Material textareas', () => {
  const sharedCode = fs.readFileSync(sharedJsPath, 'utf8');

  const dispatchedEvents = [];
  let focusCalled = false;

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
    get value() { return this._value; }
    set value(v) { this._value = v; }
  }

  const mockTextarea = Object.create(MockHTMLTextAreaElement.prototype);
  mockTextarea.tagName = 'TEXTAREA';
  mockTextarea._value = 'Original user prompt';
  mockTextarea.focus = () => {
    focusCalled = true;
  };
  mockTextarea.dispatchEvent = (evt) => {
    dispatchedEvents.push(evt);
  };

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
    window: {
      addEventListener: () => {},
    },
    setTimeout: () => 1,
    clearTimeout: () => {},
    console,
  };

  const ctx = vm.createContext(sandbox);
  const OAM = vm.runInContext(`${sharedCode}\nOAM;`, ctx);

  assert.ok(OAM, 'OAM instance available');
  assert.equal(typeof OAM.prependContextToInput, 'function');

  OAM.prependContextToInput(mockTextarea, 'Project Alpha uses Python 3.12');

  assert.equal(focusCalled, true, 'inputEl.focus() must be called for framework focus');
  assert.ok(mockTextarea.value.includes('Project Alpha uses Python 3.12'), 'Context text must be inserted');
  assert.ok(mockTextarea.value.includes('Original user prompt'), 'Existing text must be preserved');
  assert.ok(mockTextarea.value.includes('[AgentMemory Context — selected from past sessions]'), 'Header present');
  assert.ok(mockTextarea.value.includes('[End AgentMemory Context]'), 'Footer present');

  const eventTypes = dispatchedEvents.map((e) => e.type);
  assert.ok(eventTypes.includes('input'), 'Dispatched synthetic input event');
  assert.ok(eventTypes.includes('change'), 'Dispatched synthetic change event');
  assert.ok(eventTypes.includes('resize'), 'Dispatched synthetic resize event');

  const inputEvents = dispatchedEvents.filter((e) => e instanceof MockInputEvent);
  assert.ok(inputEvents.length >= 1, 'Dispatched InputEvent with insertText metadata');
  assert.equal(inputEvents[0].inputType, 'insertText');
});

test('content/shared.js attachSendHooks supports Ctrl+Enter and Cmd+Enter triggers alongside plain Enter', () => {
  const sharedCode = fs.readFileSync(sharedJsPath, 'utf8');

  // Verify the exact source code pattern in attachSendHooks
  assert.ok(
    sharedCode.includes("(event.key === 'Enter' && !event.shiftKey && !event.isComposing) ||") &&
    sharedCode.includes("(event.key === 'Enter' && (event.ctrlKey || event.metaKey))"),
    'attachSendHooks must support plain Enter, Ctrl+Enter, and Cmd+Enter'
  );

  // Function to evaluate isSubmitKey condition as implemented
  function testSubmitTrigger(event) {
    return (event.key === 'Enter' && !event.shiftKey && !event.isComposing) ||
           (event.key === 'Enter' && (event.ctrlKey || event.metaKey));
  }

  // Plain Enter submits
  assert.equal(testSubmitTrigger({ key: 'Enter', shiftKey: false, isComposing: false, ctrlKey: false, metaKey: false }), true);

  // Ctrl+Enter submits (Windows / Linux AI Studio standard)
  assert.equal(testSubmitTrigger({ key: 'Enter', shiftKey: false, isComposing: false, ctrlKey: true, metaKey: false }), true);

  // Cmd+Enter submits (macOS AI Studio standard)
  assert.equal(testSubmitTrigger({ key: 'Enter', shiftKey: false, isComposing: false, ctrlKey: false, metaKey: true }), true);

  // Ctrl+Enter even if shiftKey is pressed submits
  assert.equal(testSubmitTrigger({ key: 'Enter', shiftKey: true, isComposing: false, ctrlKey: true, metaKey: false }), true);

  // Shift+Enter alone does NOT submit (inserts newline)
  assert.equal(testSubmitTrigger({ key: 'Enter', shiftKey: true, isComposing: false, ctrlKey: false, metaKey: false }), false);

  // Composing IME enter does NOT submit
  assert.equal(testSubmitTrigger({ key: 'Enter', shiftKey: false, isComposing: true, ctrlKey: false, metaKey: false }), false);

  // Other keys do NOT submit
  assert.equal(testSubmitTrigger({ key: 'Tab', shiftKey: false, isComposing: false, ctrlKey: false, metaKey: false }), false);
  assert.equal(testSubmitTrigger({ key: 'a', shiftKey: false, isComposing: false, ctrlKey: true, metaKey: false }), false);
});

test('manifest.json registers Google AI Studio host permissions and content scripts', () => {
  const manifest = JSON.parse(fs.readFileSync(path.resolve('manifest.json'), 'utf8'));

  assert.ok(
    manifest.host_permissions.includes('https://aistudio.google.com/*'),
    'manifest.json host_permissions must include https://aistudio.google.com/*'
  );

  const aistudioScript = manifest.content_scripts.find((cs) =>
    cs.matches && cs.matches.includes('https://aistudio.google.com/*')
  );
  assert.ok(aistudioScript, 'content_scripts must have an entry matching https://aistudio.google.com/*');
  assert.ok(aistudioScript.js.includes('content/shared.js'), 'content_scripts must load content/shared.js');
  assert.ok(aistudioScript.js.includes('content/aistudio.js'), 'content_scripts must load content/aistudio.js');
  assert.equal(aistudioScript.run_at, 'document_idle');
});

test('service-worker.js OBSERVE handler respects aistudioAutoSave toggle', async () => {
  const swCode = fs.readFileSync(path.resolve('service-worker.js'), 'utf8');

  // Verify settings default and boolean keys
  assert.ok(swCode.includes('aistudioAutoSave: true'), 'aistudioAutoSave defaults to true');
  assert.ok(swCode.includes("'aistudioAutoSave'"), 'aistudioAutoSave in booleanKeys');

  // Verify OBSERVE handler skips capture when aistudioAutoSave is false
  assert.ok(
    swCode.includes("if (platform === 'aistudio' && !settings.aistudioAutoSave) { sendResponse({ skipped: true }); return; }"),
    'OBSERVE handler must check aistudioAutoSave toggle'
  );
});
