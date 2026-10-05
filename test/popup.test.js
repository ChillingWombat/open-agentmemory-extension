// =============================================================================
// WebAI Memory — Popup & Settings UI Test Suite
// Zero external npm dependencies. Uses Node.js built-in node:test and node:assert/strict.
// =============================================================================

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT_DIR = path.resolve(__dirname, '..');
const POPUP_HTML_PATH = path.join(ROOT_DIR, 'popup/popup.html');
const POPUP_CSS_PATH = path.join(ROOT_DIR, 'popup/popup.css');
const POPUP_JS_PATH = path.join(ROOT_DIR, 'popup/popup.js');

const popupModule = require('../popup/popup.js');

// -----------------------------------------------------------------------------
// Test Helpers: Mock DOM & Chrome Environment for Popup
// -----------------------------------------------------------------------------

function createMockClassList(initialClasses = []) {
  const set = new Set(initialClasses);
  return {
    add(...cls) { cls.forEach((c) => set.add(c)); },
    remove(...cls) { cls.forEach((c) => set.delete(c)); },
    contains(cls) { return set.has(cls); },
    toggle(cls, force) {
      if (force !== undefined) {
        if (force) set.add(cls); else set.delete(cls);
        return force;
      }
      if (set.has(cls)) { set.delete(cls); return false; }
      set.add(cls); return true;
    },
    toString() { return Array.from(set).join(' '); },
  };
}

class MockElement {
  constructor(tagName = 'div', id = '', classList = []) {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.classList = createMockClassList(classList);
    this.children = [];
    this.parentElement = null;
    this.listeners = {};
    this.attributes = {};
    this.dataset = {};
    this.value = '';
    this.checked = false;
    this.textContent = '';
    this._innerHTML = '';
    this.style = {};
  }

  get innerHTML() {
    return this._innerHTML || '';
  }

  set innerHTML(val) {
    this._innerHTML = String(val || '');
    if (!val) {
      this.children = [];
    }
  }

  get className() {
    return this.classList.toString();
  }

  set className(val) {
    this.classList = createMockClassList(String(val || '').split(/\s+/).filter(Boolean));
  }

  setAttribute(name, val) {
    this.attributes[name] = String(val);
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  hasAttribute(name) {
    return name in this.attributes;
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }

  addEventListener(event, fn) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
  }

  removeEventListener(event, fn) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter((f) => f !== fn);
  }

  dispatchEvent(event) {
    const evt = typeof event === 'string' ? { type: event } : event;
    if (typeof evt.stopPropagation !== 'function') evt.stopPropagation = () => {};
    if (typeof evt.preventDefault !== 'function') evt.preventDefault = () => {};
    const fns = this.listeners[evt.type] || [];
    for (const fn of fns) {
      fn(evt);
    }
  }

  click() {
    this.dispatchEvent('click');
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentElement = null;
    }
    return child;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const results = [];
    const walk = (node) => {
      if (matchesSelector(node, selector)) results.push(node);
      for (const ch of node.children) walk(ch);
    };
    for (const ch of this.children) walk(ch);
    return results;
  }

  closest(selector) {
    let cur = this;
    while (cur) {
      if (matchesSelector(cur, selector)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }
}

function matchesSelector(el, sel) {
  if (!el || !sel) return false;
  if (sel.startsWith('#')) return el.id === sel.slice(1);
  if (sel.startsWith('.')) return el.classList.contains(sel.slice(1));
  if (sel.includes('[name=')) {
    const match = sel.match(/\[name="?([^"\]]+)"?\]/);
    if (match && el.getAttribute('name') === match[1]) return true;
  }
  if (sel.includes('[data-tab=')) {
    const match = sel.match(/\[data-tab="?([^"\]]+)"?\]/);
    if (match && el.dataset.tab === match[1]) return true;
  }
  if (sel.includes('[data-platform=')) {
    const match = sel.match(/\[data-platform="?([^"\]]+)"?\]/);
    if (match && el.dataset.platform === match[1]) return true;
  }
  return el.tagName.toLowerCase() === sel.toLowerCase();
}

function createMockDocument() {
  const elementsById = new Map();
  const allElements = [];

  function register(el) {
    if (el.id) elementsById.set(el.id, el);
    allElements.push(el);
    return el;
  }

  const body = register(new MockElement('body', 'body'));

  return {
    body,
    getElementById(id) {
      return elementsById.get(id) || null;
    },
    createElement(tagName) {
      return register(new MockElement(tagName));
    },
    querySelectorAll(selector) {
      return allElements.filter((el) => matchesSelector(el, selector));
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    },
    addEventListener() {},
    register,
  };
}

function setupMockPopupHarness(initialSettings = {}, statusResponse = { connected: true, activeEngine: 'agentmemory', apiUrl: 'http://localhost:3111' }) {
  const doc = createMockDocument();

  // Create UI elements matching popup.html
  const expandTabBtn = doc.register(new MockElement('button', 'expand-tab-btn'));
  const statusBadge = doc.register(new MockElement('div', 'status-badge', ['status-badge', 'checking']));
  const statusText = doc.register(new MockElement('span', 'status-text'));
  const apiUrlDisplay = doc.register(new MockElement('p', 'api-url-display'));
  const dashboardLink = doc.register(new MockElement('a', 'dashboard-link'));
  const offlineBanner = doc.register(new MockElement('div', 'offline-banner', ['offline-banner', 'hidden']));
  const offlineTitle = doc.register(new MockElement('div', 'offline-title'));
  const offlineHint = doc.register(new MockElement('p', 'offline-hint'));
  const daemonCodeBlock = doc.register(new MockElement('div', 'daemon-code-block'));
  const copyCmdBtn = doc.register(new MockElement('button', 'copy-cmd-btn'));

  const queueBanner = doc.register(new MockElement('div', 'queue-banner', ['queue-banner', 'hidden']));
  const queueLabel = doc.register(new MockElement('span', 'queue-label'));
  const queueClearBtn = doc.register(new MockElement('button', 'queue-clear-btn'));
  const attachBar = doc.register(new MockElement('div', 'attach-bar', ['attach-bar', 'hidden']));
  const attachCount = doc.register(new MockElement('span', 'attach-count'));
  const attachBtn = doc.register(new MockElement('button', 'attach-btn'));

  // Tabs
  const tabMemories = doc.register(new MockElement('button', 'tab-btn-memories', ['tab', 'active']));
  tabMemories.dataset.tab = 'memories';
  const tabHistory = doc.register(new MockElement('button', 'tab-btn-history', ['tab']));
  tabHistory.dataset.tab = 'history';
  const tabSettings = doc.register(new MockElement('button', 'tab-btn-settings', ['tab']));
  tabSettings.dataset.tab = 'settings';

  const panelMemories = doc.register(new MockElement('div', 'tab-memories', ['tab-panel', 'active']));
  const panelHistory = doc.register(new MockElement('div', 'tab-history', ['tab-panel']));
  const panelSettings = doc.register(new MockElement('div', 'tab-settings', ['tab-panel']));

  // Memories tab
  const quickAddBtn = doc.register(new MockElement('button', 'quick-add-btn'));
  const searchInput = doc.register(new MockElement('input', 'search-input'));
  const searchBtn = doc.register(new MockElement('button', 'search-btn'));
  const searchResults = doc.register(new MockElement('div', 'search-results', ['results-list']));

  // Quick Add Modal
  const quickAddModal = doc.register(new MockElement('div', 'quick-add-modal', ['modal-overlay', 'hidden']));
  const addMemoryTitle = doc.register(new MockElement('input', 'add-memory-title'));
  const addMemoryNarrative = doc.register(new MockElement('textarea', 'add-memory-narrative'));
  const addMemoryCategory = doc.register(new MockElement('input', 'add-memory-category'));
  const addMemoryError = doc.register(new MockElement('div', 'add-memory-error', ['modal-error', 'hidden']));
  const addMemoryCancelBtn = doc.register(new MockElement('button', 'add-memory-cancel-btn'));
  const addMemorySaveBtn = doc.register(new MockElement('button', 'add-memory-save-btn'));
  const addMemoryCloseBtn = doc.register(new MockElement('button', 'add-memory-close-btn'));

  // Edit Memory Modal
  const editMemoryModal = doc.register(new MockElement('div', 'edit-memory-modal', ['modal-overlay', 'hidden']));
  const editMemoryTitle = doc.register(new MockElement('input', 'edit-memory-title'));
  const editMemoryNarrative = doc.register(new MockElement('textarea', 'edit-memory-narrative'));
  const editMemoryCategory = doc.register(new MockElement('input', 'edit-memory-category'));
  const editMemoryError = doc.register(new MockElement('div', 'edit-memory-error', ['modal-error', 'hidden']));
  const editMemoryCancelBtn = doc.register(new MockElement('button', 'edit-memory-cancel-btn'));
  const editMemorySaveBtn = doc.register(new MockElement('button', 'edit-memory-save-btn'));
  const editMemoryCloseBtn = doc.register(new MockElement('button', 'edit-memory-close-btn'));

  // History tab
  const historySearchBox = doc.register(new MockElement('div', 'history-search-box', ['search-box']));
  const historySearchInput = doc.register(new MockElement('input', 'history-search-input'));
  historySearchBox.appendChild(historySearchInput);
  const historySearchBtn = doc.register(new MockElement('button', 'history-search-btn'));
  historySearchBox.appendChild(historySearchBtn);

  const platformFilters = doc.register(new MockElement('div', 'platform-filters', ['filter-pills']));
  const platforms = ['all', 'aistudio', 'gemini', 'chatgpt', 'claude', 'grok'];
  platforms.forEach((p, idx) => {
    const pill = doc.register(new MockElement('button', `pill-${p}`, ['pill', ...(idx === 0 ? ['active'] : [])]));
    pill.dataset.platform = p;
    platformFilters.appendChild(pill);
  });

  const historyActionsBar = doc.register(new MockElement('div', 'history-actions-bar', ['history-actions-bar']));
  const historyCountLabel = doc.register(new MockElement('span', 'history-count-label', ['history-count']));
  const historyExportBtn = doc.register(new MockElement('button', 'history-export-btn'));
  const historyClearBtn = doc.register(new MockElement('button', 'history-clear-btn'));

  const historySessionsList = doc.register(new MockElement('div', 'history-sessions-list', ['sessions-list']));

  const sessionDetailView = doc.register(new MockElement('div', 'session-detail-view', ['session-detail-view', 'hidden']));
  const detailBackBtn = doc.register(new MockElement('button', 'detail-back-btn'));
  const detailPlatformBadge = doc.register(new MockElement('span', 'detail-platform-badge', ['platform-badge']));
  const detailSessionTitle = doc.register(new MockElement('span', 'detail-session-title'));
  const detailDeleteBtn = doc.register(new MockElement('button', 'detail-delete-btn'));
  const detailTurnsContainer = doc.register(new MockElement('div', 'detail-turns-container', ['turns-container']));
  sessionDetailView.appendChild(detailBackBtn);
  sessionDetailView.appendChild(detailPlatformBadge);
  sessionDetailView.appendChild(detailSessionTitle);
  sessionDetailView.appendChild(detailDeleteBtn);
  sessionDetailView.appendChild(detailTurnsContainer);

  // Settings tab
  const engineAgentMemory = doc.register(new MockElement('input', 'engine-agentmemory'));
  engineAgentMemory.setAttribute('name', 'engine');
  engineAgentMemory.value = 'agentmemory';
  engineAgentMemory.checked = true;

  const engineMem0Cloud = doc.register(new MockElement('input', 'engine-mem0-cloud'));
  engineMem0Cloud.setAttribute('name', 'engine');
  engineMem0Cloud.value = 'mem0-cloud';

  const engineMem0SelfHosted = doc.register(new MockElement('input', 'engine-mem0-selfhosted'));
  engineMem0SelfHosted.setAttribute('name', 'engine');
  engineMem0SelfHosted.value = 'mem0-selfhosted';

  const engineHindsight = doc.register(new MockElement('input', 'engine-hindsight'));
  engineHindsight.setAttribute('name', 'engine');
  engineHindsight.value = 'hindsight';

  const engineCognee = doc.register(new MockElement('input', 'engine-cognee'));
  engineCognee.setAttribute('name', 'engine');
  engineCognee.value = 'cognee';

  const agentMemoryFields = doc.register(new MockElement('div', 'agentmemory-fields', ['settings-group', 'engine-fields-group']));
  const mem0Fields = doc.register(new MockElement('div', 'mem0-fields', ['settings-group', 'engine-fields-group', 'hidden']));
  const hindsightFields = doc.register(new MockElement('div', 'hindsight-fields', ['settings-group', 'engine-fields-group', 'hidden']));
  const cogneeFields = doc.register(new MockElement('div', 'cognee-fields', ['settings-group', 'engine-fields-group', 'hidden']));
  const mem0UrlContainer = doc.register(new MockElement('div', 'mem0-url-container'));

  const apiUrlInput = doc.register(new MockElement('input', 'api-url'));
  apiUrlInput.value = 'http://localhost:3111';
  const apiSecretInput = doc.register(new MockElement('input', 'api-secret'));
  const mem0ApiUrlInput = doc.register(new MockElement('input', 'mem0-api-url'));
  mem0ApiUrlInput.value = 'http://localhost:8000';
  const mem0ApiKeyInput = doc.register(new MockElement('input', 'mem0-api-key'));
  const mem0UserIdInput = doc.register(new MockElement('input', 'mem0-user-id'));
  const mem0OrgIdInput = doc.register(new MockElement('input', 'mem0-org-id'));
  const mem0ProjectIdInput = doc.register(new MockElement('input', 'mem0-project-id'));

  const hindsightApiUrlInput = doc.register(new MockElement('input', 'hindsight-api-url'));
  hindsightApiUrlInput.value = 'http://localhost:8888';
  const hindsightApiKeyInput = doc.register(new MockElement('input', 'hindsight-api-key'));
  const hindsightBankIdInput = doc.register(new MockElement('input', 'hindsight-bank-id'));
  hindsightBankIdInput.value = 'default';

  const cogneeApiUrlInput = doc.register(new MockElement('input', 'cognee-api-url'));
  cogneeApiUrlInput.value = 'http://localhost:8000';
  const cogneeApiKeyInput = doc.register(new MockElement('input', 'cognee-api-key'));
  const cogneeDatasetNameInput = doc.register(new MockElement('input', 'cognee-dataset-name'));
  cogneeDatasetNameInput.value = 'main';

  const aistudioSave = doc.register(new MockElement('input', 'aistudio-save'));
  aistudioSave.checked = true;
  const geminiSave = doc.register(new MockElement('input', 'gemini-save'));
  geminiSave.checked = true;
  const chatgptSave = doc.register(new MockElement('input', 'chatgpt-save'));
  chatgptSave.checked = true;
  const claudeSave = doc.register(new MockElement('input', 'claude-save'));
  claudeSave.checked = true;
  const grokSave = doc.register(new MockElement('input', 'grok-save'));
  grokSave.checked = true;

  const localArchiveEnabled = doc.register(new MockElement('input', 'local-archive-enabled'));
  localArchiveEnabled.checked = true;
  const archiveStats = doc.register(new MockElement('span', 'archive-stats'));
  const settingsExportHistoryBtn = doc.register(new MockElement('button', 'settings-export-history-btn'));
  const settingsClearHistoryBtn = doc.register(new MockElement('button', 'settings-clear-history-btn'));

  const showNotifications = doc.register(new MockElement('input', 'show-notifications'));
  const settingsFeedback = doc.register(new MockElement('p', 'settings-feedback', ['hidden']));
  const settingsError = doc.register(new MockElement('p', 'settings-error', ['hidden']));
  const saveSettingsBtn = doc.register(new MockElement('button', 'save-settings'));

  // Dispatched messages tracker
  const createdTabs = [];
  const dispatchedMessages = [];
  let settingsState = {
    activeEngine: 'agentmemory',
    apiUrl: 'http://localhost:3111',
    secret: '',
    mem0ApiUrl: 'https://api.mem0.ai/v1',
    mem0ApiKey: '',
    mem0UserId: 'default_user',
    hindsightApiUrl: 'http://localhost:8888',
    hindsightApiKey: '',
    hindsightBankId: 'default',
    cogneeApiUrl: 'http://localhost:8000',
    cogneeApiKey: '',
    cogneeDatasetName: 'main',
    aistudioAutoSave: true,
    geminiAutoSave: true,
    chatgptAutoSave: true,
    claudeAutoSave: true,
    grokAutoSave: true,
    localArchiveEnabled: true,
    showNotifications: false,
    ...initialSettings,
  };

  const sessionStore = {};
  const mockSessions = [
    {
      id: 'sess-1',
      platform: 'aistudio',
      title: 'Prompt engineering for Gemini 1.5 Pro',
      createdAt: '2026-10-05T03:00:00Z',
      updatedAt: '2026-10-05T03:05:00Z',
      turnCount: 2,
      snippet: 'Here is how to optimize system instructions...',
    },
    {
      id: 'sess-2',
      platform: 'gemini',
      title: 'Quantum computing algorithms',
      createdAt: '2026-10-05T02:00:00Z',
      updatedAt: '2026-10-05T02:10:00Z',
      turnCount: 4,
      snippet: 'Shor algorithm achieves exponential speedup...',
    },
  ];

  const mockTurns = {
    'sess-1': [
      {
        turnId: 't-1',
        timestamp: '2026-10-05T03:00:00Z',
        userText: 'How do system instructions work in AI Studio?',
        assistantText: 'System instructions guide model behavior without consuming chat history.',
      },
      {
        turnId: 't-2',
        timestamp: '2026-10-05T03:05:00Z',
        userText: 'Can they include code examples?',
        assistantText: 'Yes, few-shot examples can be included.',
      },
    ],
  };

  const mockChrome = {
    runtime: {
      lastError: null,
      sendMessage(message, callback) {
        dispatchedMessages.push(message);
        setTimeout(() => {
          switch (message.type) {
            case 'STATUS':
              callback(statusResponse);
              break;
            case 'GET_SETTINGS':
              callback(settingsState);
              break;
            case 'SET_SETTINGS':
              Object.assign(settingsState, message.settings || {});
              callback({ ok: true, settings: settingsState });
              break;
            case 'GET_LOCAL_SESSIONS': {
              let res = [...mockSessions];
              if (message.platform && message.platform !== 'all') {
                res = res.filter((s) => s.platform === message.platform);
              }
              if (message.query) {
                const q = message.query.toLowerCase();
                res = res.filter((s) => (s.title && s.title.toLowerCase().includes(q)) || (s.snippet && s.snippet.toLowerCase().includes(q)));
              }
              callback({ sessions: res });
              break;
            }
            case 'GET_LOCAL_SESSION_DETAILS': {
              const session = mockSessions.find((s) => s.id === message.sessionId) || null;
              const turns = mockTurns[message.sessionId] || [];
              callback({ session, turns });
              break;
            }
            case 'DELETE_LOCAL_SESSION': {
              const idx = mockSessions.findIndex((s) => s.id === message.sessionId);
              if (idx !== -1) mockSessions.splice(idx, 1);
              callback({ success: true });
              break;
            }
            case 'CLEAR_LOCAL_HISTORY': {
              mockSessions.length = 0;
              callback({ success: true });
              break;
            }
            case 'EXPORT_LOCAL_HISTORY': {
              callback({ data: JSON.stringify({ sessions: mockSessions }), filename: 'history.json' });
              break;
            }
            case 'SEARCH': {
              callback({
                results: [
                  {
                    id: 'mem-1',
                    title: 'System Design',
                    narrative: 'Microservices architecture with gRPC',
                    facts: ['gRPC', 'Protobuf'],
                    sessionId: 's-arch',
                  },
                ],
              });
              break;
            }
            case 'SET_QUEUE_COUNT': {
              sessionStore.oamQueueCount = message.count;
              callback({ ok: true });
              break;
            }
            case 'ADD_MEMORY': {
              callback({ success: true, id: 'new-memory-101' });
              break;
            }
            case 'UPDATE_MEMORY': {
              callback({ success: true, id: message.id });
              break;
            }
            case 'DELETE_MEMORY': {
              callback({ success: true, id: message.id });
              break;
            }
            default:
              callback({ ok: true });
          }
        }, 0);
      },
    },
    tabs: {
      create(opts) {
        createdTabs.push(opts);
      },
    },
    storage: {
      session: {
        async get(keys) {
          const res = {};
          const list = Array.isArray(keys) ? keys : [keys];
          for (const k of list) {
            if (k in sessionStore) res[k] = sessionStore[k];
          }
          return res;
        },
        async set(obj) {
          Object.assign(sessionStore, obj);
        },
        async remove(keys) {
          const list = Array.isArray(keys) ? keys : [keys];
          for (const k of list) delete sessionStore[k];
        },
      },
      local: {
        async get() { return {}; },
        async set() {},
      },
    },
  };

  return {
    doc,
    elements: {
      statusBadge,
      statusText,
      apiUrlDisplay,
      dashboardLink,
      offlineBanner,
      queueBanner,
      queueLabel,
      queueClearBtn,
      attachBar,
      attachCount,
      attachBtn,
      tabMemories,
      tabHistory,
      tabSettings,
      panelMemories,
      panelHistory,
      panelSettings,
      searchInput,
      searchBtn,
      searchResults,
      historySearchInput,
      historySearchBtn,
      platformFilters,
      historyCountLabel,
      historyExportBtn,
      historyClearBtn,
      historySessionsList,
      sessionDetailView,
      detailBackBtn,
      detailPlatformBadge,
      detailSessionTitle,
      detailDeleteBtn,
      detailTurnsContainer,
      engineAgentMemory,
      engineMem0Cloud,
      engineMem0SelfHosted,
      engineHindsight,
      engineCognee,
      agentMemoryFields,
      mem0Fields,
      hindsightFields,
      cogneeFields,
      mem0UrlContainer,
      apiUrlInput,
      apiSecretInput,
      mem0ApiUrlInput,
      mem0ApiKeyInput,
      mem0UserIdInput,
      mem0OrgIdInput,
      mem0ProjectIdInput,
      hindsightApiUrlInput,
      hindsightApiKeyInput,
      hindsightBankIdInput,
      cogneeApiUrlInput,
      cogneeApiKeyInput,
      cogneeDatasetNameInput,
      aistudioSave,
      geminiSave,
      chatgptSave,
      claudeSave,
      grokSave,
      localArchiveEnabled,
      archiveStats,
      settingsExportHistoryBtn,
      settingsClearHistoryBtn,
      showNotifications,
      settingsFeedback,
      settingsError,
      saveSettingsBtn,
      expandTabBtn,
      quickAddBtn,
      quickAddModal,
      addMemoryTitle,
      addMemoryNarrative,
      addMemoryCategory,
      addMemoryError,
      addMemoryCancelBtn,
      addMemorySaveBtn,
      addMemoryCloseBtn,
      editMemoryModal,
      editMemoryTitle,
      editMemoryNarrative,
      editMemoryCategory,
      editMemoryError,
      editMemoryCancelBtn,
      editMemorySaveBtn,
      editMemoryCloseBtn,
    },
    createdTabs,
    dispatchedMessages,
    mockChrome,
    mockSessions,
    sessionStore,
  };
}

// -----------------------------------------------------------------------------
// 1. Structural & Asset Integrity Tests
// -----------------------------------------------------------------------------

test('Popup Asset Integrity: popup.html contains all 3 tabs, engine controls, and history elements', () => {
  assert.ok(fs.existsSync(POPUP_HTML_PATH), 'popup.html must exist');
  const html = fs.readFileSync(POPUP_HTML_PATH, 'utf8');

  // Verify 3 tabs
  assert.match(html, /data-tab="memories"/, 'Memories tab button present');
  assert.match(html, /data-tab="history"/, 'Local History tab button present');
  assert.match(html, /data-tab="settings"/, 'Settings tab button present');
  assert.match(html, /id="tab-memories"/, 'Memories panel present');
  assert.match(html, /id="tab-history"/, 'Local History panel present');
  assert.match(html, /id="tab-settings"/, 'Settings panel present');

  // Verify status indicator
  assert.match(html, /id="status-badge"/, 'status-badge element present');
  assert.match(html, /id="status-text"/, 'status-text element present');
  assert.match(html, /id="api-url-display"/, 'api-url-display element present');

  // Verify engine switcher
  assert.match(html, /id="engine-agentmemory"/, 'AgentMemory engine radio present');
  assert.match(html, /id="engine-mem0-cloud"/, 'Mem0 Cloud engine radio present');
  assert.match(html, /id="engine-mem0-selfhosted"/, 'Mem0 Self-Hosted engine radio present');
  assert.match(html, /id="engine-hindsight"/, 'Hindsight engine radio present');
  assert.match(html, /id="engine-cognee"/, 'Cognee engine radio present');
  assert.match(html, /id="agentmemory-fields"/, 'AgentMemory fields container present');
  assert.match(html, /id="mem0-fields"/, 'Mem0 fields container present');
  assert.match(html, /id="hindsight-fields"/, 'Hindsight fields container present');
  assert.match(html, /id="cognee-fields"/, 'Cognee fields container present');

  // Verify fields are card grouped with settings-group
  assert.match(html, /id="mem0-fields"[^>]*class="[^"]*settings-group/, 'Mem0 fields wrapped in settings-group card');
  assert.match(html, /id="agentmemory-fields"[^>]*class="[^"]*settings-group/, 'AgentMemory fields wrapped in settings-group card');
  assert.match(html, /id="hindsight-fields"[^>]*class="[^"]*settings-group/, 'Hindsight fields wrapped in settings-group card');
  assert.match(html, /id="cognee-fields"[^>]*class="[^"]*settings-group/, 'Cognee fields wrapped in settings-group card');

  // Verify default port representations
  assert.match(html, /localhost:8000/, 'Port 8000 present in engine options');
  assert.match(html, /localhost:3111/, 'Port 3111 present in engine options');
  assert.match(html, /localhost:8888/, 'Port 8888 present in engine options');

  // Verify platform auto-save toggles
  assert.match(html, /id="aistudio-save"/, 'Google AI Studio toggle present');
  assert.match(html, /id="gemini-save"/, 'Gemini toggle present');
  assert.match(html, /id="chatgpt-save"/, 'ChatGPT toggle present');
  assert.match(html, /id="claude-save"/, 'Claude toggle present');
  assert.match(html, /id="grok-save"/, 'Grok toggle present');

  // Verify Local History browser controls
  assert.match(html, /id="history-search-input"/, 'Transcript search input present');
  assert.match(html, /data-platform="all"/, 'All platform pill present');
  assert.match(html, /data-platform="aistudio"/, 'AI Studio platform pill present');
  assert.match(html, /id="history-export-btn"/, 'History Export button present');
  assert.match(html, /id="history-clear-btn"/, 'History Clear button present');
  assert.match(html, /id="history-sessions-list"/, 'Sessions list container present');
  assert.match(html, /id="session-detail-view"/, 'Session detail view present');
  assert.match(html, /id="detail-turns-container"/, 'Turns container present');

  // Verify M2.4 CRUD modals and expand tab button
  assert.match(html, /id="expand-tab-btn"/, 'Expand to Tab button present');
  assert.match(html, /id="quick-add-btn"/, 'Quick Add Memory button present');
  assert.match(html, /id="quick-add-modal"/, 'Quick Add modal dialog present');
  assert.match(html, /id="edit-memory-modal"/, 'Edit Memory modal dialog present');

  // Verify scripts
  assert.match(html, /src="\.\.\/backends\/local-archive\.js"/, 'local-archive.js script tag present');
  assert.match(html, /src="popup\.js"/, 'popup.js script tag present');
});

test('Popup Asset Integrity: popup.css defines compliant body width, speech bubbles, and badges', () => {
  assert.ok(fs.existsSync(POPUP_CSS_PATH), 'popup.css must exist');
  const css = fs.readFileSync(POPUP_CSS_PATH, 'utf8');

  // Width compliance ~380-400px
  const widthMatch = css.match(/width:\s*(\d+)px/);
  assert.ok(widthMatch, 'body width must be declared in px');
  const widthVal = parseInt(widthMatch[1], 10);
  assert.ok(widthVal >= 380 && widthVal <= 400, `Body width ${widthVal}px must be between 380px and 400px`);

  // Verify speech bubble classes
  assert.match(css, /\.turn-bubble/, 'CSS contains .turn-bubble');
  assert.match(css, /\.turn-bubble\.user/, 'CSS contains .turn-bubble.user');
  assert.match(css, /\.turn-bubble\.assistant/, 'CSS contains .turn-bubble.assistant');

  // Verify platform badges and filter pills
  assert.match(css, /\.platform-badge/, 'CSS contains .platform-badge');
  assert.match(css, /\.filter-pills/, 'CSS contains .filter-pills');
  assert.match(css, /\.pill\.active/, 'CSS contains .pill.active');
  assert.match(css, /\.engine-selector/, 'CSS contains .engine-selector');

  // Verify M2.4 Modals, Full-tab, and Dark Mode CSS
  assert.match(css, /\.modal-overlay/, 'CSS contains .modal-overlay');
  assert.match(css, /\.modal-card/, 'CSS contains .modal-card');
  assert.match(css, /\.card-action-btn/, 'CSS contains .card-action-btn');
  assert.match(css, /\.btn-delete-memory/, 'CSS contains .btn-delete-memory');
  assert.match(css, /tab-view/, 'CSS contains tab-view full tab rules');
  assert.match(css, /prefers-color-scheme:\s*dark/, 'CSS contains dark mode media query');
  assert.match(css, /theme-dark/, 'CSS contains theme-dark class rules');
});

// -----------------------------------------------------------------------------
// 2. Unit Logic Tests (Pure Helpers)
// -----------------------------------------------------------------------------

test('popup/popup.js: esc() sanitizes HTML injection characters', () => {
  const unsafe = '<script>alert("xss")</script>&"\'';
  const safe = popupModule.esc(unsafe);
  assert.equal(safe.includes('<script>'), false);
  assert.ok(safe.includes('&lt;script&gt;'));
});

test('popup/popup.js: stableId() generates deterministic ID for identical memory objects', () => {
  const itemA = { id: 'm1', title: 'Test Title', narrative: 'Body', sessionId: 's1' };
  const itemB = { id: 'm1', title: 'Test Title', narrative: 'Body', sessionId: 's1' };
  const itemC = { id: 'm2', title: 'Different', narrative: 'Body', sessionId: 's2' };

  assert.equal(popupModule.stableId(itemA), popupModule.stableId(itemB));
  assert.notEqual(popupModule.stableId(itemA), popupModule.stableId(itemC));
});

test('popup/popup.js: formatRelativeTime() returns human-readable intervals', () => {
  const now = new Date();
  const m5 = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
  const h2 = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();

  assert.equal(popupModule.formatRelativeTime(m5), '5m ago');
  assert.equal(popupModule.formatRelativeTime(h2), '2h ago');
  assert.equal(popupModule.formatRelativeTime(null), '');
});

test('popup/popup.js: formatPlatformName() formats known platform keys correctly', () => {
  assert.equal(popupModule.formatPlatformName('aistudio'), 'AI Studio');
  assert.equal(popupModule.formatPlatformName('gemini'), 'Gemini');
  assert.equal(popupModule.formatPlatformName('chatgpt'), 'ChatGPT');
  assert.equal(popupModule.formatPlatformName('claude'), 'Claude');
  assert.equal(popupModule.formatPlatformName('grok'), 'Grok');
  assert.equal(popupModule.formatPlatformName('custom-agent'), 'custom-agent');
});

// -----------------------------------------------------------------------------
// 3. Controller & Interactive Behavior Tests
// -----------------------------------------------------------------------------

test('Popup Controller: initializes status badge, loads settings, and sets active engine', async () => {
  const harness = setupMockPopupHarness(
    { activeEngine: 'mem0', mem0ApiUrl: 'https://api.mem0.ai/v1', mem0ApiKey: 'm0-test-key' },
    { connected: true, activeEngine: 'mem0', apiUrl: 'https://api.mem0.ai/v1' }
  );

  const sandbox = {
    document: harness.doc,
    window: {},
    chrome: harness.mockChrome,
    navigator: { clipboard: { writeText: async () => {} } },
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Blob,
    URL,
  };

  const code = fs.readFileSync(POPUP_JS_PATH, 'utf8');
  vm.runInNewContext(code, sandbox);

  // Allow async promises to resolve
  await new Promise((r) => setTimeout(r, 20));

  // Verify STATUS check was dispatched
  const statusMsg = harness.dispatchedMessages.find((m) => m.type === 'STATUS');
  assert.ok(statusMsg, 'STATUS message was dispatched');

  // Verify badge updated to Mem0 Connected
  assert.equal(harness.elements.statusBadge.classList.contains('connected'), true);
  assert.equal(harness.elements.statusText.textContent, 'Mem0: Connected');
  assert.match(harness.elements.apiUrlDisplay.textContent, /Mem0 · api\.mem0\.ai/);

  // Verify settings were bound to UI inputs
  assert.equal(harness.elements.engineMem0Cloud.checked, true);
  assert.equal(harness.elements.mem0ApiKeyInput.value, 'm0-test-key');
  assert.equal(harness.elements.mem0Fields.classList.contains('hidden'), false);
  assert.equal(harness.elements.agentMemoryFields.classList.contains('hidden'), true);
});

test('Popup Controller: tab switching switches active tab classes and panels', async () => {
  const harness = setupMockPopupHarness();
  const sandbox = {
    document: harness.doc,
    window: {},
    chrome: harness.mockChrome,
    navigator: { clipboard: { writeText: async () => {} } },
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };

  const code = fs.readFileSync(POPUP_JS_PATH, 'utf8');
  vm.runInNewContext(code, sandbox);
  await new Promise((r) => setTimeout(r, 20));

  // Click Local History tab
  harness.elements.tabHistory.dispatchEvent('click');
  assert.equal(harness.elements.tabHistory.classList.contains('active'), true);
  assert.equal(harness.elements.tabMemories.classList.contains('active'), false);
  assert.equal(harness.elements.panelHistory.classList.contains('active'), true);
  assert.equal(harness.elements.panelMemories.classList.contains('active'), false);

  // Click Settings tab
  harness.elements.tabSettings.dispatchEvent('click');
  assert.equal(harness.elements.tabSettings.classList.contains('active'), true);
  assert.equal(harness.elements.tabHistory.classList.contains('active'), false);
  assert.equal(harness.elements.panelSettings.classList.contains('active'), true);
  assert.equal(harness.elements.panelHistory.classList.contains('active'), false);
});

test('Popup Controller: engine switcher dynamically updates credential field visibility', async () => {
  const harness = setupMockPopupHarness();
  const sandbox = {
    document: harness.doc,
    window: {},
    chrome: harness.mockChrome,
    navigator: { clipboard: { writeText: async () => {} } },
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };

  const code = fs.readFileSync(POPUP_JS_PATH, 'utf8');
  vm.runInNewContext(code, sandbox);
  await new Promise((r) => setTimeout(r, 20));

  // Select Mem0 Cloud
  harness.elements.engineAgentMemory.checked = false;
  harness.elements.engineMem0Cloud.checked = true;
  harness.elements.engineMem0Cloud.dispatchEvent('change');

  assert.equal(harness.elements.agentMemoryFields.classList.contains('hidden'), true);
  assert.equal(harness.elements.mem0Fields.classList.contains('hidden'), false);
  assert.equal(harness.elements.hindsightFields.classList.contains('hidden'), true);
  assert.equal(harness.elements.cogneeFields.classList.contains('hidden'), true);

  // Select Hindsight
  harness.elements.engineMem0Cloud.checked = false;
  harness.elements.engineHindsight.checked = true;
  harness.elements.engineHindsight.dispatchEvent('change');

  assert.equal(harness.elements.hindsightFields.classList.contains('hidden'), false);
  assert.equal(harness.elements.mem0Fields.classList.contains('hidden'), true);
  assert.equal(harness.elements.agentMemoryFields.classList.contains('hidden'), true);
  assert.equal(harness.elements.cogneeFields.classList.contains('hidden'), true);

  // Select Cognee
  harness.elements.engineHindsight.checked = false;
  harness.elements.engineCognee.checked = true;
  harness.elements.engineCognee.dispatchEvent('change');

  assert.equal(harness.elements.cogneeFields.classList.contains('hidden'), false);
  assert.equal(harness.elements.hindsightFields.classList.contains('hidden'), true);
  assert.equal(harness.elements.mem0Fields.classList.contains('hidden'), true);
  assert.equal(harness.elements.agentMemoryFields.classList.contains('hidden'), true);

  // Select AgentMemory
  harness.elements.engineCognee.checked = false;
  harness.elements.engineAgentMemory.checked = true;
  harness.elements.engineAgentMemory.dispatchEvent('change');

  assert.equal(harness.elements.agentMemoryFields.classList.contains('hidden'), false);
  assert.equal(harness.elements.cogneeFields.classList.contains('hidden'), true);
  assert.equal(harness.elements.mem0Fields.classList.contains('hidden'), true);
});

test('Popup Controller: auto-loads recent memories on launch and when search is cleared', async () => {
  const harness = setupMockPopupHarness();
  const sandbox = {
    document: harness.doc,
    window: {},
    chrome: harness.mockChrome,
    navigator: { clipboard: { writeText: async () => {} } },
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };

  const code = fs.readFileSync(POPUP_JS_PATH, 'utf8');
  vm.runInNewContext(code, sandbox);
  await new Promise((r) => setTimeout(r, 20));

  // 1. Verify SEARCH with empty query was dispatched on boot
  const initialSearch = harness.dispatchedMessages.find((m) => m.type === 'SEARCH' && m.query === '');
  assert.ok(initialSearch, 'SEARCH with empty query was dispatched on boot to load recent memories');
  assert.equal(harness.elements.searchResults.children.length, 1);

  // 2. Perform search with query
  harness.elements.searchInput.value = 'graph neural networks';
  harness.elements.searchBtn.dispatchEvent('click');
  await new Promise((r) => setTimeout(r, 20));

  const manualSearch = harness.dispatchedMessages.find((m) => m.type === 'SEARCH' && m.query === 'graph neural networks');
  assert.ok(manualSearch, 'Manual search was dispatched');

  // 3. Clear search input and verify recent memories are reloaded
  harness.elements.searchInput.value = '';
  harness.elements.searchInput.dispatchEvent('input');
  await new Promise((r) => setTimeout(r, 20));

  const reloadSearch = harness.dispatchedMessages.filter((m) => m.type === 'SEARCH' && m.query === '');
  assert.ok(reloadSearch.length >= 2, 'SEARCH with empty query was dispatched when search input was cleared');
});

test('Popup Controller: loads and saves settings for Hindsight and Cognee', async () => {
  // Test Hindsight loading & saving
  const harnessHs = setupMockPopupHarness(
    {
      activeEngine: 'hindsight',
      hindsightApiUrl: 'http://localhost:8888',
      hindsightApiKey: 'hs-secret-key',
      hindsightBankId: 'vault-1',
    },
    { connected: true, activeEngine: 'hindsight', apiUrl: 'http://localhost:8888' }
  );
  const sandboxHs = {
    document: harnessHs.doc,
    window: {},
    chrome: harnessHs.mockChrome,
    navigator: { clipboard: { writeText: async () => {} } },
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };

  const code = fs.readFileSync(POPUP_JS_PATH, 'utf8');
  vm.runInNewContext(code, sandboxHs);
  await new Promise((r) => setTimeout(r, 20));

  assert.equal(harnessHs.elements.engineHindsight.checked, true);
  assert.equal(harnessHs.elements.hindsightFields.classList.contains('hidden'), false);
  assert.equal(harnessHs.elements.hindsightApiKeyInput.value, 'hs-secret-key');
  assert.equal(harnessHs.elements.hindsightBankIdInput.value, 'vault-1');
  assert.equal(harnessHs.elements.statusText.textContent, 'Hindsight: Connected');

  // Change and save
  harnessHs.elements.hindsightBankIdInput.value = 'vault-2';
  harnessHs.elements.saveSettingsBtn.dispatchEvent('click');
  await new Promise((r) => setTimeout(r, 30));

  const saveMsgHs = harnessHs.dispatchedMessages.find((m) => m.type === 'SET_SETTINGS' && m.settings?.hindsightBankId === 'vault-2');
  assert.ok(saveMsgHs, 'SET_SETTINGS for Hindsight was dispatched');
  assert.equal(saveMsgHs.settings.activeEngine, 'hindsight');

  // Test Cognee loading & saving
  const harnessCg = setupMockPopupHarness(
    {
      activeEngine: 'cognee',
      cogneeApiUrl: 'http://localhost:8000',
      cogneeApiKey: 'cg-secret-key',
      cogneeDatasetName: 'graph-main',
    },
    { connected: true, activeEngine: 'cognee', apiUrl: 'http://localhost:8000' }
  );
  const sandboxCg = {
    document: harnessCg.doc,
    window: {},
    chrome: harnessCg.mockChrome,
    navigator: { clipboard: { writeText: async () => {} } },
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };

  vm.runInNewContext(code, sandboxCg);
  await new Promise((r) => setTimeout(r, 20));

  assert.equal(harnessCg.elements.engineCognee.checked, true);
  assert.equal(harnessCg.elements.cogneeFields.classList.contains('hidden'), false);
  assert.equal(harnessCg.elements.cogneeApiKeyInput.value, 'cg-secret-key');
  assert.equal(harnessCg.elements.cogneeDatasetNameInput.value, 'graph-main');
  assert.equal(harnessCg.elements.statusText.textContent, 'Cognee: Connected');

  // Change and save
  harnessCg.elements.cogneeDatasetNameInput.value = 'graph-updated';
  harnessCg.elements.saveSettingsBtn.dispatchEvent('click');
  await new Promise((r) => setTimeout(r, 30));

  const saveMsgCg = harnessCg.dispatchedMessages.find((m) => m.type === 'SET_SETTINGS' && m.settings?.cogneeDatasetName === 'graph-updated');
  assert.ok(saveMsgCg, 'SET_SETTINGS for Cognee was dispatched');
  assert.equal(saveMsgCg.settings.activeEngine, 'cognee');
});

test('Popup Controller: auto-save toggles dispatch immediate SET_SETTINGS updates', async () => {
  const harness = setupMockPopupHarness();
  const sandbox = {
    document: harness.doc,
    window: {},
    chrome: harness.mockChrome,
    navigator: { clipboard: { writeText: async () => {} } },
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };

  const code = fs.readFileSync(POPUP_JS_PATH, 'utf8');
  vm.runInNewContext(code, sandbox);
  await new Promise((r) => setTimeout(r, 20));

  // Toggle AI Studio auto-save to false
  harness.elements.aistudioSave.checked = false;
  harness.elements.aistudioSave.dispatchEvent('change');
  await new Promise((r) => setTimeout(r, 10));

  const updateMsg = harness.dispatchedMessages.find(
    (m) => m.type === 'SET_SETTINGS' && m.settings && 'aistudioAutoSave' in m.settings
  );
  assert.ok(updateMsg, 'SET_SETTINGS for aistudioAutoSave was dispatched');
  assert.equal(updateMsg.settings.aistudioAutoSave, false);
});

test('Popup Controller: Save & Test Connection dispatches settings and updates status', async () => {
  const harness = setupMockPopupHarness();
  const sandbox = {
    document: harness.doc,
    window: {},
    chrome: harness.mockChrome,
    navigator: { clipboard: { writeText: async () => {} } },
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };

  const code = fs.readFileSync(POPUP_JS_PATH, 'utf8');
  vm.runInNewContext(code, sandbox);
  await new Promise((r) => setTimeout(r, 20));

  harness.elements.apiUrlInput.value = 'http://127.0.0.1:3111';
  harness.elements.apiSecretInput.value = 'new-secret-123';
  harness.elements.saveSettingsBtn.dispatchEvent('click');

  await new Promise((r) => setTimeout(r, 30));

  const saveMsg = harness.dispatchedMessages.find(
    (m) => m.type === 'SET_SETTINGS' && m.settings && m.settings.secret === 'new-secret-123'
  );
  assert.ok(saveMsg, 'SET_SETTINGS with new secret was dispatched');
  assert.equal(saveMsg.settings.apiUrl, 'http://127.0.0.1:3111');
  assert.equal(saveMsg.settings.localArchiveEnabled, true);
});

test('Popup Controller: loads local history sessions and renders session cards with platform badges', async () => {
  const harness = setupMockPopupHarness();
  const sandbox = {
    document: harness.doc,
    window: {},
    chrome: harness.mockChrome,
    navigator: { clipboard: { writeText: async () => {} } },
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };

  const code = fs.readFileSync(POPUP_JS_PATH, 'utf8');
  vm.runInNewContext(code, sandbox);
  await new Promise((r) => setTimeout(r, 20));

  // Switch to history tab
  harness.elements.tabHistory.dispatchEvent('click');
  await new Promise((r) => setTimeout(r, 20));

  // Verify GET_LOCAL_SESSIONS message was dispatched
  const getSessionsMsg = harness.dispatchedMessages.find((m) => m.type === 'GET_LOCAL_SESSIONS');
  assert.ok(getSessionsMsg, 'GET_LOCAL_SESSIONS was dispatched');

  // Verify sessions were rendered into historySessionsList
  assert.equal(harness.elements.historySessionsList.children.length, 2);
  const firstCard = harness.elements.historySessionsList.children[0];
  assert.equal(firstCard.getAttribute('data-session-id'), 'sess-1');
  assert.match(firstCard.innerHTML, /AI Studio/);
  assert.match(firstCard.innerHTML, /Prompt engineering for Gemini 1\.5 Pro/);
});

test('Popup Controller: expanding a session renders speech bubbles for user and assistant', async () => {
  const harness = setupMockPopupHarness();
  const sandbox = {
    document: harness.doc,
    window: {},
    chrome: harness.mockChrome,
    navigator: { clipboard: { writeText: async () => {} } },
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };

  const code = fs.readFileSync(POPUP_JS_PATH, 'utf8');
  vm.runInNewContext(code, sandbox);
  await new Promise((r) => setTimeout(r, 20));

  // Switch to history tab
  harness.elements.tabHistory.dispatchEvent('click');
  await new Promise((r) => setTimeout(r, 20));

  // Click on the first session card
  const firstCard = harness.elements.historySessionsList.children[0];
  firstCard.dispatchEvent('click');
  await new Promise((r) => setTimeout(r, 30));

  // Verify GET_LOCAL_SESSION_DETAILS was dispatched
  const getDetailsMsg = harness.dispatchedMessages.find(
    (m) => m.type === 'GET_LOCAL_SESSION_DETAILS' && m.sessionId === 'sess-1'
  );
  assert.ok(getDetailsMsg, 'GET_LOCAL_SESSION_DETAILS was dispatched for sess-1');

  // Verify detail view is visible and list is hidden
  assert.equal(harness.elements.sessionDetailView.classList.contains('hidden'), false);
  assert.equal(harness.elements.historySessionsList.classList.contains('hidden'), true);

  // Verify dialogue turns speech bubbles rendered
  const turns = harness.elements.detailTurnsContainer.children;
  assert.equal(turns.length, 4); // 2 user turns + 2 assistant turns
  assert.equal(turns[0].classList.contains('user'), true);
  assert.match(turns[0].innerHTML, /How do system instructions work in AI Studio\?/);
  assert.equal(turns[1].classList.contains('assistant'), true);
  assert.match(turns[1].innerHTML, /System instructions guide model behavior/);

  // Click back button to return to list
  harness.elements.detailBackBtn.dispatchEvent('click');
  assert.equal(harness.elements.sessionDetailView.classList.contains('hidden'), true);
  assert.equal(harness.elements.historySessionsList.classList.contains('hidden'), false);
});

test('Popup Controller: platform filter pill queries filtered sessions', async () => {
  const harness = setupMockPopupHarness();
  const sandbox = {
    document: harness.doc,
    window: {},
    chrome: harness.mockChrome,
    navigator: { clipboard: { writeText: async () => {} } },
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };

  const code = fs.readFileSync(POPUP_JS_PATH, 'utf8');
  vm.runInNewContext(code, sandbox);
  await new Promise((r) => setTimeout(r, 20));

  harness.elements.tabHistory.dispatchEvent('click');
  await new Promise((r) => setTimeout(r, 20));

  // Click AI Studio filter pill
  const aiStudioPill = harness.doc.getElementById('pill-aistudio');
  assert.ok(aiStudioPill, 'pill-aistudio exists');
  aiStudioPill.dispatchEvent('click');
  await new Promise((r) => setTimeout(r, 20));

  const filterMsg = harness.dispatchedMessages.filter(
    (m) => m.type === 'GET_LOCAL_SESSIONS' && m.platform === 'aistudio'
  );
  assert.ok(filterMsg.length > 0, 'GET_LOCAL_SESSIONS with platform=aistudio was dispatched');
});

test('Popup Controller: history export and clear actions dispatch respective messages', async () => {
  let confirmed = false;
  const harness = setupMockPopupHarness();
  const sandbox = {
    document: harness.doc,
    window: {},
    chrome: harness.mockChrome,
    navigator: { clipboard: { writeText: async () => {} } },
    confirm: () => { confirmed = true; return true; },
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Blob: class { constructor(parts) { this.parts = parts; } },
    URL: { createObjectURL: () => 'blob:mock', revokeObjectURL: () => {} },
  };

  const code = fs.readFileSync(POPUP_JS_PATH, 'utf8');
  vm.runInNewContext(code, sandbox);
  await new Promise((r) => setTimeout(r, 20));

  // Export history
  harness.elements.historyExportBtn.dispatchEvent('click');
  await new Promise((r) => setTimeout(r, 20));

  const exportMsg = harness.dispatchedMessages.find((m) => m.type === 'EXPORT_LOCAL_HISTORY');
  assert.ok(exportMsg, 'EXPORT_LOCAL_HISTORY was dispatched');

  // Clear history
  harness.elements.historyClearBtn.dispatchEvent('click');
  await new Promise((r) => setTimeout(r, 20));

  assert.equal(confirmed, true, 'Confirm prompt was shown');
  const clearMsg = harness.dispatchedMessages.find((m) => m.type === 'CLEAR_LOCAL_HISTORY');
  assert.ok(clearMsg, 'CLEAR_LOCAL_HISTORY was dispatched');
});

test('Popup Controller: memory search, card selection, and attach bar queue context', async () => {
  const harness = setupMockPopupHarness();
  const sandbox = {
    document: harness.doc,
    window: {},
    chrome: harness.mockChrome,
    navigator: { clipboard: { writeText: async () => {} } },
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };

  const code = fs.readFileSync(POPUP_JS_PATH, 'utf8');
  vm.runInNewContext(code, sandbox);
  await new Promise((r) => setTimeout(r, 20));

  // Search memories
  harness.elements.searchInput.value = 'microservices';
  harness.elements.searchBtn.dispatchEvent('click');
  await new Promise((r) => setTimeout(r, 20));

  const searchMsg = harness.dispatchedMessages.find((m) => m.type === 'SEARCH' && m.query === 'microservices');
  assert.ok(searchMsg, 'SEARCH message was dispatched');

  // Verify memory card rendered
  assert.equal(harness.elements.searchResults.children.length, 1);
  const card = harness.elements.searchResults.children[0];

  // Click card to select it
  card.dispatchEvent('click');
  assert.equal(harness.elements.attachBar.classList.contains('hidden'), false);
  assert.equal(harness.elements.attachCount.textContent, '1 selected');

  // Click attach button to queue context
  harness.elements.attachBtn.dispatchEvent('click');
  await new Promise((r) => setTimeout(r, 20));

  // Verify queued context stored in session
  assert.ok(harness.sessionStore.oamQueuedContext, 'oamQueuedContext was set in session storage');
  assert.match(harness.sessionStore.oamQueuedContext, /### System Design/);
  assert.match(harness.sessionStore.oamQueuedContext, /Key facts: gRPC; Protobuf/);

  // Verify badge count updated
  assert.equal(harness.sessionStore.oamQueueCount, 1);
});

test('Popup Controller: doSearch safely handles HTMLCollection with read-only length property and Escape key clears search', async () => {
  const harness = setupMockPopupHarness();

  // Simulate real browser DOM where element.children is an HTMLCollection whose length property is read-only
  const mockHtmlCollection = {};
  Object.defineProperty(mockHtmlCollection, 'length', {
    value: 0,
    writable: false,
    configurable: false,
  });
  harness.elements.searchResults.children = mockHtmlCollection;

  const sandbox = {
    document: harness.doc,
    window: {},
    chrome: harness.mockChrome,
    navigator: { clipboard: { writeText: async () => {} } },
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };

  const code = fs.readFileSync(POPUP_JS_PATH, 'utf8');
  // Must not throw TypeError: Cannot assign to read only property 'length'
  assert.doesNotThrow(() => {
    vm.runInNewContext(code, sandbox);
  });
  await new Promise((r) => setTimeout(r, 20));

  // Test Escape key clears search input and calls doSearch('')
  harness.elements.searchInput.value = 'query to escape';
  harness.elements.searchInput.dispatchEvent({ type: 'keydown', key: 'Escape' });
  await new Promise((r) => setTimeout(r, 20));

  assert.equal(harness.elements.searchInput.value, '', 'Escape key should clear search input');
  const emptySearches = harness.dispatchedMessages.filter((m) => m.type === 'SEARCH' && m.query === '');
  assert.ok(emptySearches.length >= 2, 'doSearch("") must be dispatched on Escape');
});

test('Popup Controller: Quick Add Memory modal opens, validates input, and dispatches ADD_MEMORY', async () => {
  const harness = setupMockPopupHarness();
  const sandbox = {
    document: harness.doc,
    window: {},
    chrome: harness.mockChrome,
    navigator: { clipboard: { writeText: async () => {} } },
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };

  const code = fs.readFileSync(POPUP_JS_PATH, 'utf8');
  vm.runInNewContext(code, sandbox);
  await new Promise((r) => setTimeout(r, 20));

  // 1. Open Quick Add Modal
  harness.elements.quickAddBtn.dispatchEvent('click');
  assert.equal(harness.elements.quickAddModal.classList.contains('hidden'), false, 'Modal should be visible');

  // 2. Validate empty narrative
  harness.elements.addMemoryNarrative.value = '   ';
  harness.elements.addMemorySaveBtn.dispatchEvent('click');
  await new Promise((r) => setTimeout(r, 10));

  assert.equal(harness.elements.addMemoryError.classList.contains('hidden'), false, 'Error message should be shown');
  assert.equal(harness.elements.addMemoryError.textContent, 'Narrative is required');
  assert.equal(harness.dispatchedMessages.some((m) => m.type === 'ADD_MEMORY'), false, 'No message should be sent without narrative');

  // 3. Fill narrative and submit
  harness.elements.addMemoryTitle.value = 'Architecture Decision';
  harness.elements.addMemoryNarrative.value = 'Use event sourcing with CQRS';
  harness.elements.addMemoryCategory.value = 'architecture';

  harness.elements.addMemorySaveBtn.dispatchEvent('click');
  await new Promise((r) => setTimeout(r, 20));

  const addMsg = harness.dispatchedMessages.find((m) => m.type === 'ADD_MEMORY');
  assert.ok(addMsg, 'ADD_MEMORY message was dispatched');
  assert.equal(addMsg.title, 'Architecture Decision');
  assert.equal(addMsg.narrative, 'Use event sourcing with CQRS');
  assert.equal(addMsg.category, 'architecture');

  // Modal closed on success
  assert.equal(harness.elements.quickAddModal.classList.contains('hidden'), true, 'Modal should be closed after save');

  // 4. Test cancel button closes modal
  harness.elements.quickAddBtn.dispatchEvent('click');
  assert.equal(harness.elements.quickAddModal.classList.contains('hidden'), false);
  harness.elements.addMemoryCancelBtn.dispatchEvent('click');
  assert.equal(harness.elements.quickAddModal.classList.contains('hidden'), true, 'Cancel button closes modal');
});

test('Popup Controller: memory card inline edit opens edit modal and dispatches UPDATE_MEMORY', async () => {
  const harness = setupMockPopupHarness();
  const sandbox = {
    document: harness.doc,
    window: {},
    chrome: harness.mockChrome,
    navigator: { clipboard: { writeText: async () => {} } },
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };

  const code = fs.readFileSync(POPUP_JS_PATH, 'utf8');
  vm.runInNewContext(code, sandbox);
  await new Promise((r) => setTimeout(r, 30));

  // Verify memory card rendered
  assert.equal(harness.elements.searchResults.children.length, 1);
  const card = harness.elements.searchResults.children[0];

  // Find edit button inside card
  const editBtn = card.querySelector('.btn-edit-memory');
  assert.ok(editBtn, 'Edit button should exist on memory card');

  // Click edit button
  editBtn.dispatchEvent('click');
  assert.equal(harness.elements.editMemoryModal.classList.contains('hidden'), false, 'Edit modal opens');
  assert.equal(harness.elements.editMemoryTitle.value, 'System Design', 'Title prefilled');
  assert.equal(harness.elements.editMemoryNarrative.value, 'Microservices architecture with gRPC', 'Narrative prefilled');

  // Update narrative
  harness.elements.editMemoryNarrative.value = 'Updated narrative: gRPC streaming architecture';
  harness.elements.editMemorySaveBtn.dispatchEvent('click');
  await new Promise((r) => setTimeout(r, 20));

  const updateMsg = harness.dispatchedMessages.find((m) => m.type === 'UPDATE_MEMORY');
  assert.ok(updateMsg, 'UPDATE_MEMORY message was dispatched');
  assert.equal(updateMsg.id, 'mem-1');
  assert.equal(updateMsg.narrative, 'Updated narrative: gRPC streaming architecture');
  assert.equal(harness.elements.editMemoryModal.classList.contains('hidden'), true, 'Edit modal closed');
});

test('Popup Controller: memory card inline delete prompts confirmation and dispatches DELETE_MEMORY', async () => {
  const harness = setupMockPopupHarness();
  const sandbox = {
    document: harness.doc,
    window: {},
    chrome: harness.mockChrome,
    navigator: { clipboard: { writeText: async () => {} } },
    confirm: () => true,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };

  const code = fs.readFileSync(POPUP_JS_PATH, 'utf8');
  vm.runInNewContext(code, sandbox);
  await new Promise((r) => setTimeout(r, 30));

  assert.equal(harness.elements.searchResults.children.length, 1);
  const card = harness.elements.searchResults.children[0];

  // First select the card so it is in selectedMemories
  card.dispatchEvent('click');
  assert.equal(harness.elements.attachCount.textContent, '1 selected');

  const deleteBtn = card.querySelector('.btn-delete-memory');
  assert.ok(deleteBtn, 'Delete button should exist on memory card');

  deleteBtn.dispatchEvent('click');
  await new Promise((r) => setTimeout(r, 20));

  const deleteMsg = harness.dispatchedMessages.find((m) => m.type === 'DELETE_MEMORY');
  assert.ok(deleteMsg, 'DELETE_MEMORY message was dispatched');
  assert.equal(deleteMsg.id, 'mem-1');

  // Selection cleared
  assert.equal(harness.elements.attachBar.classList.contains('hidden'), true, 'Attach bar should be hidden when selected memory is deleted');
});

test('Popup Controller: Expand to Tab creates new browser tab with popup/popup.html?view=tab', async () => {
  const harness = setupMockPopupHarness();
  const sandbox = {
    document: harness.doc,
    window: {},
    chrome: harness.mockChrome,
    navigator: { clipboard: { writeText: async () => {} } },
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };

  const code = fs.readFileSync(POPUP_JS_PATH, 'utf8');
  vm.runInNewContext(code, sandbox);
  await new Promise((r) => setTimeout(r, 20));

  harness.elements.expandTabBtn.dispatchEvent('click');

  assert.equal(harness.createdTabs.length, 1, 'Should call chrome.tabs.create');
  assert.equal(harness.createdTabs[0].url, 'popup/popup.html?view=tab');
});

test('Popup Controller: tab-view query param adds tab-view class to html/body and hides expand button', async () => {
  const harness = setupMockPopupHarness();
  const mockLocation = {
    search: '?view=tab',
    href: 'chrome-extension://abcdef/popup/popup.html?view=tab',
  };

  const sandbox = {
    document: harness.doc,
    window: { location: mockLocation },
    chrome: harness.mockChrome,
    navigator: { clipboard: { writeText: async () => {} } },
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };

  const code = fs.readFileSync(POPUP_JS_PATH, 'utf8');
  vm.runInNewContext(code, sandbox);
  await new Promise((r) => setTimeout(r, 20));

  assert.equal(harness.doc.body.classList.contains('tab-view'), true, 'body must have tab-view class');
  assert.equal(harness.elements.expandTabBtn.classList.contains('hidden'), true, 'Expand button must be hidden in tab view');
});

test('Popup Controller: prefers-color-scheme: dark activates dark mode', async () => {
  const harness = setupMockPopupHarness();
  const sandbox = {
    document: harness.doc,
    window: {
      matchMedia: (q) => ({
        matches: q === '(prefers-color-scheme: dark)',
        addEventListener: () => {},
      }),
    },
    chrome: harness.mockChrome,
    navigator: { clipboard: { writeText: async () => {} } },
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };

  const code = fs.readFileSync(POPUP_JS_PATH, 'utf8');
  vm.runInNewContext(code, sandbox);
  await new Promise((r) => setTimeout(r, 20));

  assert.equal(harness.doc.body.classList.contains('theme-dark'), true, 'body must have theme-dark class');
  assert.equal(harness.doc.body.getAttribute('data-theme'), 'dark', 'body must have data-theme=dark');
});

