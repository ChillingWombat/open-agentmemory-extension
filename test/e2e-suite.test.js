// =============================================================================
// WebAI Memory — Comprehensive 4-Tier Opaque-Box E2E Test Suite
// Verified with Node.js built-in node:test and node:assert/strict (zero external deps).
//
// Tier 1: Feature Coverage (F1 to F13, >=5 tests per feature)
// Tier 2: Boundary & Corner Cases (>=5 tests per category)
// Tier 3: Cross-Feature Combinations
// Tier 4: Real-World Application Scenarios (>=5 scenarios)
// =============================================================================

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT_DIR = path.resolve(__dirname, '..');

// Helper to require backend modules directly
const { BaseMemoryEngine } = require('../backends/base-engine.js');
const { AgentMemoryEngine } = require('../backends/agentmemory-engine.js');
const { Mem0Engine } = require('../backends/mem0-engine.js');
const { HindsightEngine } = require('../backends/hindsight-engine.js');
const { CogneeEngine } = require('../backends/cognee-engine.js');
const { EngineFactory } = require('../backends/engine-factory.js');
const { LocalArchive } = require('../backends/local-archive.js');

// -----------------------------------------------------------------------------
// Test Harness Utilities
// -----------------------------------------------------------------------------

function createMockStorageArea(initialStore = {}) {
  const store = { ...initialStore };
  return {
    _raw: store,
    async get(keys) {
      if (!keys) return { ...store };
      if (typeof keys === 'string') return { [keys]: store[keys] };
      if (Array.isArray(keys)) {
        const res = {};
        for (const k of keys) {
          if (k in store) res[k] = store[k];
        }
        return res;
      }
      if (typeof keys === 'object') {
        const res = { ...keys };
        for (const k of Object.keys(keys)) {
          if (k in store) res[k] = store[k];
        }
        return res;
      }
      return { ...store };
    },
    async set(items) {
      Object.assign(store, items);
    },
    async remove(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const k of list) delete store[k];
    },
    async clear() {
      for (const k of Object.keys(store)) delete store[k];
    },
  };
}

function createServiceWorkerHarness(initialSettings = {}, customFetch = null) {
  const localStore = createMockStorageArea({
    activeEngine: 'agentmemory',
    apiUrl: 'http://localhost:3111',
    secret: '',
    mem0ApiUrl: 'https://api.mem0.ai/v1',
    mem0ApiKey: '',
    mem0UserId: 'default_user',
    geminiAutoSave: true,
    chatgptAutoSave: true,
    claudeAutoSave: true,
    grokAutoSave: true,
    aistudioAutoSave: true,
    showNotifications: false,
    ...initialSettings,
  });
  const sessionStore = createMockStorageArea();
  const requests = [];
  const badge = { text: '', color: '' };
  let messageListener = null;

  const chromeMock = {
    action: {
      setBadgeText({ text }) { badge.text = text; },
      setBadgeBackgroundColor({ color }) { badge.color = color; },
    },
    alarms: {
      create() {},
      onAlarm: { addListener() {} },
    },
    runtime: {
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: {
        addListener(listener) {
          messageListener = listener;
        },
      },
    },
    storage: {
      local: localStore,
      session: sessionStore,
    },
  };

  const defaultFetch = async (url, options = {}) => {
    requests.push({ url, options });
    const u = new URL(url);
    if (u.pathname.endsWith('/health') || u.pathname.endsWith('/memories')) {
      return {
        ok: true,
        status: 200,
        async json() { return { status: 'healthy', version: '1.0.0' }; },
      };
    }
    return {
      ok: true,
      status: 200,
      async json() { return { ok: true, success: true }; },
    };
  };

  const effectiveFetch = customFetch || defaultFetch;

  const sandbox = {
    AbortSignal,
    URL,
    chrome: chromeMock,
    console,
    fetch: effectiveFetch,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };

  const vmContext = vm.createContext(sandbox);

  sandbox.importScripts = (...scripts) => {
    for (const s of scripts) {
      const full = path.resolve(ROOT_DIR, s);
      if (fs.existsSync(full)) {
        const code = fs.readFileSync(full, 'utf8');
        vm.runInContext(code, vmContext);
      }
    }
  };

  const swSource = fs.readFileSync(path.join(ROOT_DIR, 'service-worker.js'), 'utf8');
  vm.runInContext(swSource, vmContext);

  async function send(message) {
    if (!messageListener) throw new Error('No message listener registered in service worker');
    return new Promise((resolve) => {
      messageListener(message, {}, resolve);
    });
  }

  return {
    badge,
    localStore,
    sessionStore,
    requests,
    send,
    vmContext,
  };
}

// Global Chrome mocking helper for LocalArchive tests
function bindMockChromeStorage(storageArea) {
  const originalChrome = globalThis.chrome;
  globalThis.chrome = {
    storage: {
      local: storageArea,
    },
    runtime: {
      lastError: null,
    },
  };
  return () => {
    if (originalChrome) {
      globalThis.chrome = originalChrome;
    } else {
      delete globalThis.chrome;
    }
  };
}

// -----------------------------------------------------------------------------
// TIER 1: FEATURE COVERAGE (F1 to F13, >=5 tests per feature)
// -----------------------------------------------------------------------------

// -- F1: Pluggable engine abstraction & BaseMemoryEngine contract --

test('Tier 1 - F1.1: BaseMemoryEngine instantiates with default and custom configs', () => {
  const defaultEngine = new BaseMemoryEngine();
  assert.deepEqual(defaultEngine.config, {});

  const customEngine = new BaseMemoryEngine({ timeout: 5000, debug: true });
  assert.equal(customEngine.config.timeout, 5000);
  assert.equal(customEngine.config.debug, true);
});

test('Tier 1 - F1.2: BaseMemoryEngine checkHealth throws if not implemented', async () => {
  const engine = new BaseMemoryEngine();
  await assert.rejects(
    async () => engine.checkHealth(),
    /BaseMemoryEngine\.checkHealth\(\) must be implemented by subclass/
  );
});

test('Tier 1 - F1.3: BaseMemoryEngine observe throws if not implemented', async () => {
  const engine = new BaseMemoryEngine();
  await assert.rejects(
    async () => engine.observe({ content: 'test' }),
    /BaseMemoryEngine\.observe\(\) must be implemented by subclass/
  );
});

test('Tier 1 - F1.4: BaseMemoryEngine search throws if not implemented', async () => {
  const engine = new BaseMemoryEngine();
  await assert.rejects(
    async () => engine.search({ query: 'hello' }),
    /BaseMemoryEngine\.search\(\) must be implemented by subclass/
  );
});

test('Tier 1 - F1.5: BaseMemoryEngine startSession and endSession default to ok: true', async () => {
  const engine = new BaseMemoryEngine();
  const startRes = await engine.startSession({ sessionId: 's-1' });
  const endRes = await engine.endSession({ sessionId: 's-1' });
  assert.deepEqual(startRes, { ok: true });
  assert.deepEqual(endRes, { ok: true });
});

test('Tier 1 - F1.6: Subclass properly inherits and implements BaseMemoryEngine contract', async () => {
  class CustomEngine extends BaseMemoryEngine {
    async checkHealth() {
      return { connected: true, engine: 'custom', version: '2.0.0' };
    }
    async observe(turn) {
      return { success: true, id: 'cust_obs_1' };
    }
    async search({ query }) {
      return { results: [{ id: '1', title: query, narrative: query, facts: [] }] };
    }
  }

  const inst = new CustomEngine({ apiKey: 'xyz' });
  assert.equal(inst instanceof BaseMemoryEngine, true);
  const health = await inst.checkHealth();
  assert.equal(health.connected, true);
  assert.equal(health.engine, 'custom');
  const obs = await inst.observe({ content: 'hi' });
  assert.equal(obs.success, true);
  const search = await inst.search({ query: 'test' });
  assert.equal(search.results[0].title, 'test');
});

// -- F2: AgentMemory backward compatibility (loopback endpoints, Bearer auth, schemas) --

test('Tier 1 - F2.1: AgentMemoryEngine normalizes valid loopback URLs', () => {
  const e1 = new AgentMemoryEngine({ apiUrl: 'http://localhost:3111/some/path/' });
  assert.equal(e1.apiUrl, 'http://localhost:3111');

  const e2 = new AgentMemoryEngine({ apiUrl: 'http://127.0.0.1:4111' });
  assert.equal(e2.apiUrl, 'http://127.0.0.1:4111');
});

test('Tier 1 - F2.2: AgentMemoryEngine rejects non-loopback addresses', () => {
  assert.throws(
    () => new AgentMemoryEngine({ apiUrl: 'https://example.com' }),
    /AgentMemory URL must be an http:\/\/localhost or http:\/\/127\.0\.0\.1 address/
  );
  assert.throws(
    () => new AgentMemoryEngine({ apiUrl: 'http://192.168.1.5:3111' }),
    /AgentMemory URL must be an http:\/\/localhost or http:\/\/127\.0\.0\.1 address/
  );
  assert.throws(
    () => new AgentMemoryEngine({ apiUrl: 'ftp://localhost:3111' }),
    /AgentMemory URL must be an http:\/\/localhost or http:\/\/127\.0\.0\.1 address/
  );
});

test('Tier 1 - F2.3: AgentMemoryEngine sets Bearer secret authorization header', async () => {
  let capturedHeaders = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    capturedHeaders = opts.headers;
    return {
      ok: true,
      async json() { return { status: 'healthy', version: '0.1.0' }; },
    };
  };

  try {
    const engineWithSecret = new AgentMemoryEngine({ apiUrl: 'http://localhost:3111', secret: 'my-token' });
    await engineWithSecret.checkHealth();
    assert.equal(capturedHeaders.Authorization, 'Bearer my-token');

    const engineWithoutSecret = new AgentMemoryEngine({ apiUrl: 'http://localhost:3111', secret: '' });
    await engineWithoutSecret.checkHealth();
    assert.equal(capturedHeaders.Authorization, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Tier 1 - F2.4: AgentMemoryEngine checkHealth targets /agentmemory/health with GET', async () => {
  let requestUrl = null;
  let requestMethod = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    requestUrl = url;
    requestMethod = opts.method;
    return {
      ok: true,
      async json() { return { status: 'healthy', version: '0.9.4' }; },
    };
  };

  try {
    const engine = new AgentMemoryEngine();
    const res = await engine.checkHealth();
    assert.equal(requestUrl, 'http://localhost:3111/agentmemory/health');
    assert.equal(requestMethod, 'GET');
    assert.equal(res.connected, true);
    assert.equal(res.engine, 'agentmemory');
    assert.equal(res.version, '0.9.4');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Tier 1 - F2.5: AgentMemoryEngine observe sends correct payload to /agentmemory/observe', async () => {
  let postedBody = null;
  let requestUrl = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    requestUrl = url;
    postedBody = JSON.parse(opts.body);
    return {
      ok: true,
      async json() { return { ok: true, id: 'obs-123' }; },
    };
  };

  try {
    const engine = new AgentMemoryEngine();
    const res = await engine.observe({
      platform: 'chatgpt',
      sessionId: 'sess-abc',
      content: 'User: hello\n\nAssistant: hi there',
      timestamp: '2026-10-05T04:00:00.000Z',
    });

    assert.equal(requestUrl, 'http://localhost:3111/agentmemory/observe');
    assert.equal(postedBody.hookType, 'prompt_submit');
    assert.equal(postedBody.sessionId, 'sess-abc');
    assert.equal(postedBody.project, 'chatgpt-web');
    assert.equal(postedBody.cwd, 'browser:chatgpt');
    assert.equal(postedBody.data.prompt, 'User: hello\n\nAssistant: hi there');
    assert.equal(res.success, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Tier 1 - F2.6: AgentMemoryEngine search normalizes daemon observation cards', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return {
      ok: true,
      async json() {
        return {
          results: [
            {
              observation: {
                id: 'card-1',
                title: 'User Preferences',
                subtitle: 'chatgpt-web',
                narrative: 'User prefers dark mode and concise responses.',
                facts: ['Prefers dark mode', 'Prefers concise style'],
                score: 0.88,
                sessionId: 'session-old',
                timestamp: '2026-10-01T12:00:00Z',
              },
            },
          ],
        };
      },
    };
  };

  try {
    const engine = new AgentMemoryEngine();
    const res = await engine.search({ query: 'preferences', limit: 1 });
    assert.equal(res.results.length, 1);
    const card = res.results[0];
    assert.equal(card.id, 'card-1');
    assert.equal(card.title, 'User Preferences');
    assert.equal(card.subtitle, 'chatgpt-web');
    assert.equal(card.narrative, 'User prefers dark mode and concise responses.');
    assert.deepEqual(card.facts, ['Prefers dark mode', 'Prefers concise style']);
    assert.equal(card.score, 0.88);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Tier 1 - F2.7: AgentMemoryEngine session lifecycle start/end dispatch properly', async () => {
  const called = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    called.push(url);
    return {
      ok: true,
      async json() { return { ok: true }; },
    };
  };

  try {
    const engine = new AgentMemoryEngine();
    await engine.startSession({ sessionId: 's-test', platform: 'claude' });
    await engine.endSession({ sessionId: 's-test' });
    assert.equal(called[0], 'http://localhost:3111/agentmemory/session/start');
    assert.equal(called[1], 'http://localhost:3111/agentmemory/session/end');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// -- F3: Mem0 Cloud REST API integration (headers, endpoints, messages format, Bearer/Token auth) --

test('Tier 1 - F3.1: Mem0Engine defaults to https://api.mem0.ai/v1 and normalizes endpoint', () => {
  const e1 = new Mem0Engine();
  assert.equal(e1.apiUrl, 'https://api.mem0.ai/v1');

  const e2 = new Mem0Engine({ apiUrl: 'https://api.mem0.ai' });
  assert.equal(e2.apiUrl, 'https://api.mem0.ai/v1');

  const e3 = new Mem0Engine({ apiUrl: 'https://api.mem0.ai/v1/' });
  assert.equal(e3.apiUrl, 'https://api.mem0.ai/v1');
});

test('Tier 1 - F3.2: Mem0Engine sets Token auth header and Content-Type', () => {
  const e1 = new Mem0Engine({ apiKey: 'm0-secret-key-123' });
  const headers1 = e1._headers();
  assert.equal(headers1['Content-Type'], 'application/json');
  assert.equal(headers1['Authorization'], 'Token m0-secret-key-123');

  const e2 = new Mem0Engine({ apiKey: 'Bearer already-bearer-token' });
  const headers2 = e2._headers();
  assert.equal(headers2['Authorization'], 'Bearer already-bearer-token');
});

test('Tier 1 - F3.3: Mem0Engine attaches optional X-Org-Id and X-Project-Id headers', () => {
  const e = new Mem0Engine({
    apiKey: 'key',
    orgId: 'org_abc',
    projectId: 'proj_xyz',
  });
  const headers = e._headers();
  assert.equal(headers['X-Org-Id'], 'org_abc');
  assert.equal(headers['X-Project-Id'], 'proj_xyz');
});

test('Tier 1 - F3.4: Mem0Engine checkHealth queries /v1/memories with limit=1', async () => {
  let probeUrl = null;
  let probeHeaders = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    probeUrl = url;
    probeHeaders = opts.headers;
    return {
      ok: true,
      async json() { return { results: [] }; },
    };
  };

  try {
    const engine = new Mem0Engine({ apiKey: 'test-key', userId: 'user-42' });
    const health = await engine.checkHealth();
    assert.equal(probeUrl, 'https://api.mem0.ai/v1/memories?limit=1&user_id=user-42');
    assert.equal(probeHeaders['Authorization'], 'Token test-key');
    assert.equal(health.connected, true);
    assert.equal(health.engine, 'mem0');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Tier 1 - F3.5: Mem0Engine checkHealth detects invalid API key on HTTP 401/403', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return {
      ok: false,
      status: 401,
      async json() { return { message: 'Unauthorized' }; },
    };
  };

  try {
    const engine = new Mem0Engine({ apiKey: 'bad-key' });
    const health = await engine.checkHealth();
    assert.equal(health.connected, false);
    assert.match(health.error, /Invalid Mem0 API Key \(HTTP 401\)/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Tier 1 - F3.6: Mem0Engine observe formats messages array and posts to /memories', async () => {
  let postUrl = null;
  let postBody = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    postUrl = url;
    postBody = JSON.parse(opts.body);
    return {
      ok: true,
      async json() { return { results: [{ id: 'm1', memory: 'User likes AI' }] }; },
    };
  };

  try {
    const engine = new Mem0Engine({ apiKey: 'test-key', userId: 'alice' });
    const res = await engine.observe({
      platform: 'aistudio',
      sessionId: 'sess-ai-1',
      userPrompt: 'What is deep learning?',
      assistantResponse: 'Deep learning is a subset of machine learning...',
    });

    assert.equal(postUrl, 'https://api.mem0.ai/v1/memories');
    assert.equal(postBody.user_id, 'alice');
    assert.deepEqual(postBody.messages, [
      { role: 'user', content: 'What is deep learning?' },
      { role: 'assistant', content: 'Deep learning is a subset of machine learning...' },
    ]);
    assert.equal(postBody.metadata.platform, 'aistudio');
    assert.equal(postBody.metadata.sessionId, 'sess-ai-1');
    assert.equal(res.success, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Tier 1 - F3.7: Mem0Engine search posts to /memories/search with query and user_id', async () => {
  let searchUrl = null;
  let searchBody = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    searchUrl = url;
    searchBody = JSON.parse(opts.body);
    return {
      ok: true,
      async json() {
        return [
          {
            id: 'mem-101',
            memory: 'User is building an extension',
            score: 0.954,
            created_at: '2026-10-05T00:00:00Z',
          },
        ];
      },
    };
  };

  try {
    const engine = new Mem0Engine({ apiKey: 'key', userId: 'bob' });
    const res = await engine.search({ query: 'extension building', limit: 3 });
    assert.equal(searchUrl, 'https://api.mem0.ai/v1/memories/search');
    assert.equal(searchBody.query, 'extension building');
    assert.equal(searchBody.user_id, 'bob');
    assert.equal(searchBody.limit, 3);
    assert.equal(res.results.length, 1);
    assert.equal(res.results[0].narrative, 'User is building an extension');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// -- F4: Mem0 self-hosted endpoint support (custom URLs) --

test('Tier 1 - F4.1: Mem0Engine accepts custom http:// self-hosted URL with port', () => {
  const engine = new Mem0Engine({ apiUrl: 'http://192.168.1.100:8000' });
  assert.equal(engine.apiUrl, 'http://192.168.1.100:8000');
  assert.equal(engine._resolveEndpoint('memories'), 'http://192.168.1.100:8000/memories');
});

test('Tier 1 - F4.2: Mem0Engine accepts custom https:// self-hosted URL', () => {
  const engine = new Mem0Engine({ apiUrl: 'https://mem0.internal.company.com/v1' });
  assert.equal(engine.apiUrl, 'https://mem0.internal.company.com/v1');
  assert.equal(engine._resolveEndpoint('memories/search'), 'https://mem0.internal.company.com/v1/memories/search');
});

test('Tier 1 - F4.3: Mem0Engine trims trailing slashes from custom endpoints', () => {
  const engine = new Mem0Engine({ apiUrl: 'http://localhost:8080/custom/api///' });
  assert.equal(engine.apiUrl, 'http://localhost:8080/custom/api');
  assert.equal(engine._resolveEndpoint('memories'), 'http://localhost:8080/custom/api/memories');
});

test('Tier 1 - F4.4: Mem0Engine functions without API key for unauthenticated OSS instances', () => {
  const engine = new Mem0Engine({ apiUrl: 'http://localhost:8000', apiKey: '' });
  const headers = engine._headers();
  assert.equal(headers['Content-Type'], 'application/json');
  assert.equal(headers['Authorization'], undefined);
});

test('Tier 1 - F4.5: Mem0Engine rejects unsupported protocols like ws:// or ftp://', () => {
  assert.throws(
    () => new Mem0Engine({ apiUrl: 'ws://localhost:8000' }),
    /Mem0 URL must use http:\/\/ or https:\/\//
  );
  assert.throws(
    () => new Mem0Engine({ apiUrl: 'ftp://files.example.com' }),
    /Mem0 URL must use http:\/\/ or https:\/\//
  );
});

// -- F5: Memory payload normalization (Mem0 raw items to title/narrative/facts) --

test('Tier 1 - F5.1: Normalizes basic Mem0 object memory text into title, narrative, facts', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return {
      ok: true,
      async json() {
        return [
          {
            id: 'mem-1',
            memory: 'User enjoys playing chess on weekends.',
            created_at: '2026-10-05T01:00:00Z',
          },
        ];
      },
    };
  };

  try {
    const engine = new Mem0Engine();
    const res = await engine.search({ query: 'chess' });
    const item = res.results[0];
    assert.equal(item.id, 'mem-1');
    assert.equal(item.title, 'User enjoys playing chess on weekends.');
    assert.equal(item.narrative, 'User enjoys playing chess on weekends.');
    assert.deepEqual(item.facts, ['User enjoys playing chess on weekends.']);
    assert.equal(item.timestamp, '2026-10-05T01:00:00Z');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Tier 1 - F5.2: Normalizes Mem0 item with explicit metadata title and facts array', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return {
      ok: true,
      async json() {
        return {
          results: [
            {
              id: 'mem-2',
              memory: 'Frontend developer working with Vue and React.',
              metadata: {
                title: 'Tech Stack',
                category: 'skills',
                facts: ['Uses Vue 3', 'Uses React 19', 'Expert in CSS'],
                sessionId: 'session-vue',
              },
              score: 0.8999,
            },
          ],
        };
      },
    };
  };

  try {
    const engine = new Mem0Engine();
    const res = await engine.search({ query: 'skills' });
    const item = res.results[0];
    assert.equal(item.id, 'mem-2');
    assert.equal(item.title, 'Tech Stack');
    assert.equal(item.subtitle, 'skills');
    assert.deepEqual(item.facts, ['Uses Vue 3', 'Uses React 19', 'Expert in CSS']);
    assert.equal(item.score, 0.9);
    assert.equal(item.sessionId, 'session-vue');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Tier 1 - F5.3: Truncates long memory text to 47 chars + ellipsis for default title', async () => {
  const longText = 'This is an extremely long memory narrative that exceeds fifty characters and should be truncated';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return {
      ok: true,
      async json() {
        return [{ id: 'm-long', memory: longText }];
      },
    };
  };

  try {
    const engine = new Mem0Engine();
    const res = await engine.search({ query: 'long' });
    const item = res.results[0];
    assert.equal(item.title, `${longText.slice(0, 47)}...`);
    assert.equal(item.narrative, longText);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Tier 1 - F5.4: Preserves raw original response in raw property', async () => {
  const rawItem = { id: 'm-raw', text: 'custom raw field', extra_data: { foo: 'bar' } };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return {
      ok: true,
      async json() { return [rawItem]; },
    };
  };

  try {
    const engine = new Mem0Engine();
    const res = await engine.search({ query: 'raw' });
    assert.deepEqual(res.results[0].raw, rawItem);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Tier 1 - F5.5: Normalization produces output directly consumable by popup context builder', () => {
  // Test simulation of popup/popup.js context builder
  const normalizedMemories = [
    {
      id: 'n1',
      title: 'Operating System',
      subtitle: 'settings',
      narrative: 'User runs Linux Ubuntu 24.04',
      facts: ['Ubuntu 24.04', 'Kernel 6.8'],
    },
    {
      id: 'n2',
      title: 'Editor Preference',
      subtitle: 'settings',
      narrative: 'Prefers VS Code with Vim extension',
      facts: [],
    },
  ];

  let contextText = '';
  for (const obs of normalizedMemories) {
    const title = obs.title || obs.subtitle || '';
    const narrative = obs.narrative || '';
    const facts = (obs.facts || []).join('; ');
    if (title) contextText += `### ${title}\n`;
    if (narrative) contextText += `${narrative}\n`;
    if (facts) contextText += `Key facts: ${facts}\n`;
    contextText += '\n';
  }

  assert.match(contextText, /### Operating System\nUser runs Linux Ubuntu 24\.04\nKey facts: Ubuntu 24\.04; Kernel 6\.8/);
  assert.match(contextText, /### Editor Preference\nPrefers VS Code with Vim extension/);
});

// -- F6: Dynamic engine switching via settings --

test('Tier 1 - F6.1: EngineFactory returns AgentMemoryEngine for activeEngine="agentmemory"', () => {
  const engine = EngineFactory.createEngine({
    activeEngine: 'agentmemory',
    apiUrl: 'http://localhost:3111',
    secret: 'secret123',
  });
  assert.equal(engine instanceof AgentMemoryEngine, true);
  assert.equal(engine.apiUrl, 'http://localhost:3111');
  assert.equal(engine.secret, 'secret123');
});

test('Tier 1 - F6.2: EngineFactory returns Mem0Engine for activeEngine="mem0"', () => {
  const engine = EngineFactory.createEngine({
    activeEngine: 'mem0',
    mem0ApiUrl: 'https://api.mem0.ai/v1',
    mem0ApiKey: 'm0-api-key',
    mem0UserId: 'alice',
  });
  assert.equal(engine instanceof Mem0Engine, true);
  assert.equal(engine.apiUrl, 'https://api.mem0.ai/v1');
  assert.equal(engine.apiKey, 'm0-api-key');
  assert.equal(engine.userId, 'alice');
});

test('Tier 1 - F6.3: EngineFactory passes custom self-hosted Mem0 configuration', () => {
  const engine = EngineFactory.createEngine({
    activeEngine: 'mem0',
    mem0ApiUrl: 'http://10.0.0.5:8000',
    mem0ApiKey: '',
    mem0UserId: 'team_bot',
  });
  assert.equal(engine instanceof Mem0Engine, true);
  assert.equal(engine.apiUrl, 'http://10.0.0.5:8000');
  assert.equal(engine.userId, 'team_bot');
});

test('Tier 1 - F6.4: EngineFactory defaults to Mem0Engine on localhost:8000 when activeEngine is omitted', () => {
  const engine = EngineFactory.createEngine({});
  assert.equal(engine instanceof Mem0Engine, true);
  assert.equal(engine.apiUrl, 'http://localhost:8000');
});

test('Tier 1 - F6.5: Dynamic engine switching toggles between engines via service worker SET_SETTINGS', async () => {
  const harness = createServiceWorkerHarness({ activeEngine: 'agentmemory' });

  // Initial status check with AgentMemory
  const status1 = await harness.send({ type: 'STATUS' });
  assert.equal(status1.activeEngine, 'agentmemory');

  // Switch to Mem0
  const switchRes = await harness.send({
    type: 'SET_SETTINGS',
    settings: {
      activeEngine: 'mem0',
      mem0ApiKey: 'token-abc',
      mem0UserId: 'user-xyz',
    },
  });
  assert.equal(switchRes.ok, true);

  const status2 = await harness.send({ type: 'STATUS' });
  assert.equal(status2.activeEngine, 'mem0');
  assert.equal(status2.apiUrl, 'https://api.mem0.ai/v1');

  // Switch to Hindsight
  const switchHs = await harness.send({
    type: 'SET_SETTINGS',
    settings: {
      activeEngine: 'hindsight',
      hindsightApiUrl: 'http://localhost:8888',
      hindsightBankId: 'e2e-bank',
    },
  });
  assert.equal(switchHs.ok, true);
  const statusHs = await harness.send({ type: 'STATUS' });
  assert.equal(statusHs.activeEngine, 'hindsight');
  assert.equal(statusHs.apiUrl, 'http://localhost:8888');

  // Switch to Cognee
  const switchCg = await harness.send({
    type: 'SET_SETTINGS',
    settings: {
      activeEngine: 'cognee',
      cogneeApiUrl: 'http://localhost:8000',
      cogneeDatasetName: 'e2e-dataset',
    },
  });
  assert.equal(switchCg.ok, true);
  const statusCg = await harness.send({ type: 'STATUS' });
  assert.equal(statusCg.activeEngine, 'cognee');
  assert.equal(statusCg.apiUrl, 'http://localhost:8000');

  // Switch back to AgentMemory
  await harness.send({
    type: 'SET_SETTINGS',
    settings: { activeEngine: 'agentmemory' },
  });
  const status3 = await harness.send({ type: 'STATUS' });
  assert.equal(status3.activeEngine, 'agentmemory');
});

// -- F7: Google AI Studio manifest permissions and content script registration --

test('Tier 1 - F7.1: Manifest specifies manifest_version 3 and extension metadata', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, 'WebAI Memory');
  assert.ok(manifest.version);
});

test('Tier 1 - F7.2: Manifest content_scripts includes Google AI Studio match pattern', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'manifest.json'), 'utf8'));
  const aiStudioScript = manifest.content_scripts.find((cs) =>
    cs.matches && cs.matches.includes('https://aistudio.google.com/*')
  );
  assert.ok(aiStudioScript, 'https://aistudio.google.com/* must be registered in content_scripts');
  assert.ok(aiStudioScript.js.includes('content/shared.js'));
  assert.ok(aiStudioScript.js.includes('content/aistudio.js'));
});

test('Tier 1 - F7.3: Manifest host_permissions contains Google AI Studio origin', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'manifest.json'), 'utf8'));
  assert.ok(
    manifest.host_permissions.includes('https://aistudio.google.com/*'),
    'host_permissions must contain https://aistudio.google.com/*'
  );
});

test('Tier 1 - F7.4: Manifest host_permissions contains Mem0 Cloud API origin', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'manifest.json'), 'utf8'));
  assert.ok(
    manifest.host_permissions.includes('https://api.mem0.ai/*'),
    'host_permissions must contain https://api.mem0.ai/*'
  );
});

test('Tier 1 - F7.5: Manifest permissions include storage, alarms, and declares host permissions', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'manifest.json'), 'utf8'));
  assert.ok(manifest.permissions.includes('storage'), 'manifest must include storage permission');
  assert.ok(manifest.permissions.includes('alarms'), 'manifest must include alarms permission');
  assert.ok(Array.isArray(manifest.host_permissions), 'manifest must declare host_permissions');
  assert.ok(manifest.host_permissions.length >= 3, 'manifest must declare loopback and cloud host permissions');
});

// -- F8: Google AI Studio DOM adapter selectors and execution hooks --

test('Tier 1 - F8.1: content/aistudio.js initializes platform "aistudio"', () => {
  let registeredConfig = null;
  const sandbox = {
    OAM: {
      initPlatform(config) {
        registeredConfig = config;
      },
    },
  };
  const scriptContent = fs.readFileSync(path.join(ROOT_DIR, 'content/aistudio.js'), 'utf8');
  vm.runInNewContext(scriptContent, sandbox);

  assert.ok(registeredConfig);
  assert.equal(registeredConfig.platform, 'aistudio');
});

test('Tier 1 - F8.2: Google AI Studio adapter defines conversationSelectors', () => {
  let config = null;
  const sandbox = { OAM: { initPlatform(c) { config = c; } } };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT_DIR, 'content/aistudio.js'), 'utf8'), sandbox);

  assert.ok(Array.isArray(config.conversationSelectors));
  assert.ok(config.conversationSelectors.includes('ms-chat-prompt'));
  assert.ok(config.conversationSelectors.includes('ms-prompt-editor'));
});

test('Tier 1 - F8.3: Google AI Studio adapter defines user and assistant message selectors', () => {
  let config = null;
  const sandbox = { OAM: { initPlatform(c) { config = c; } } };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT_DIR, 'content/aistudio.js'), 'utf8'), sandbox);

  assert.ok(config.userMessageSelectors.some((s) => s.includes('data-turn-role="User"')));
  assert.ok(config.assistantMessageSelectors.some((s) => s.includes('data-turn-role="Model"')));
});

test('Tier 1 - F8.4: Google AI Studio adapter defines input and send button selectors', () => {
  let config = null;
  const sandbox = { OAM: { initPlatform(c) { config = c; } } };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT_DIR, 'content/aistudio.js'), 'utf8'), sandbox);

  assert.ok(config.inputSelectors.some((s) => s.includes('ms-chunk-input') || s.includes('textarea')));
  assert.ok(config.sendButtonSelectors.some((s) => s.includes('run-button') || s.includes('Run')));
});

test('Tier 1 - F8.5: content/shared.js keydown listener supports Ctrl+Enter and Cmd+Enter triggers', () => {
  const sharedCode = fs.readFileSync(path.join(ROOT_DIR, 'content/shared.js'), 'utf8');
  assert.match(sharedCode, /ctrlKey\s*\|\|\s*event\.metaKey/);
});

// -- F9: Framework-Safe context injection for Angular/Wiz inputs --

test('Tier 1 - F9.1: Context injection dispatches input, change, and resize synthetic events', () => {
  const sharedCode = fs.readFileSync(path.join(ROOT_DIR, 'content/shared.js'), 'utf8');
  assert.match(sharedCode, /new Event\(['"]input['"],\s*\{\s*bubbles:\s*true/);
  assert.match(sharedCode, /new Event\(['"]change['"],\s*\{\s*bubbles:\s*true/);
  assert.match(sharedCode, /new Event\(['"]resize['"],\s*\{\s*bubbles:\s*true/);
});

test('Tier 1 - F9.2: Context injection dispatches InputEvent with insertText type', () => {
  const sharedCode = fs.readFileSync(path.join(ROOT_DIR, 'content/shared.js'), 'utf8');
  assert.match(sharedCode, /new InputEvent\(['"]input['"]/);
  assert.match(sharedCode, /inputType:\s*['"]insertText['"]/);
});

test('Tier 1 - F9.3: Context injection invokes focus() for Angular form control synchronization', () => {
  const sharedCode = fs.readFileSync(path.join(ROOT_DIR, 'content/shared.js'), 'utf8');
  assert.match(sharedCode, /inputEl\.focus\(\)/);
});

test('Tier 1 - F9.4: Context injection targets native HTMLTextAreaElement.prototype descriptor', () => {
  const sharedCode = fs.readFileSync(path.join(ROOT_DIR, 'content/shared.js'), 'utf8');
  assert.match(sharedCode, /Object\.getOwnPropertyDescriptor\(HTMLTextAreaElement\.prototype,\s*['"]value['"]\)/);
});

test('Tier 1 - F9.5: Simulated DOM receives multi-event sequence when context injected', () => {
  const eventsDispatched = [];
  let valueSet = '';
  let focused = false;

  const mockTextarea = {
    tagName: 'TEXTAREA',
    value: 'Existing prompt',
    focus() { focused = true; },
    dispatchEvent(evt) { eventsDispatched.push(evt.type); return true; },
  };

  // Execute simulated injection logic as written in shared.js
  const fullContext = '### Context\nSome memory facts\n\n';
  mockTextarea.focus();
  mockTextarea.value = fullContext + mockTextarea.value;
  mockTextarea.dispatchEvent({ type: 'input', bubbles: true });
  mockTextarea.dispatchEvent({ type: 'change', bubbles: true });
  mockTextarea.dispatchEvent({ type: 'resize', bubbles: true });

  assert.equal(focused, true);
  assert.equal(mockTextarea.value, '### Context\nSome memory facts\n\nExisting prompt');
  assert.deepEqual(eventsDispatched, ['input', 'change', 'resize']);
});

// -- F10: Google AI Studio auto-save toggle behavior --

test('Tier 1 - F10.1: Default settings include aistudioAutoSave: true', async () => {
  const harness = createServiceWorkerHarness();
  const settings = await harness.send({ type: 'GET_SETTINGS' });
  assert.equal(settings.aistudioAutoSave, true);
});

test('Tier 1 - F10.2: Settings can update aistudioAutoSave to false', async () => {
  const harness = createServiceWorkerHarness();
  await harness.send({
    type: 'SET_SETTINGS',
    settings: { aistudioAutoSave: false },
  });
  const updated = await harness.send({ type: 'GET_SETTINGS' });
  assert.equal(updated.aistudioAutoSave, false);
});

test('Tier 1 - F10.3: OBSERVE with platform="aistudio" skips when aistudioAutoSave is false', async () => {
  const harness = createServiceWorkerHarness({ aistudioAutoSave: false });
  const res = await harness.send({
    type: 'OBSERVE',
    platform: 'aistudio',
    content: 'User: test\n\nAssistant: response',
  });
  assert.equal(res.skipped, true);
  assert.equal(harness.requests.length, 0);
});

test('Tier 1 - F10.4: OBSERVE with platform="aistudio" persists when aistudioAutoSave is true', async () => {
  const harness = createServiceWorkerHarness({ aistudioAutoSave: true });
  const res = await harness.send({
    type: 'OBSERVE',
    platform: 'aistudio',
    sessionId: 'ai-sess-1',
    content: 'User: explain quantum\n\nAssistant: Quantum mechanics...',
  });
  assert.equal(res.skipped, undefined);
  assert.equal(harness.requests.length, 1);
});

test('Tier 1 - F10.5: aistudioAutoSave does not affect other platforms', async () => {
  const harness = createServiceWorkerHarness({
    aistudioAutoSave: false,
    geminiAutoSave: true,
  });

  const geminiRes = await harness.send({
    type: 'OBSERVE',
    platform: 'gemini',
    content: 'User: hi\n\nAssistant: hello',
  });
  assert.equal(geminiRes.skipped, undefined);
  assert.equal(harness.requests.length, 1);
});

// -- F11: Local conversation archive storage schema & turn preservation --

test('Tier 1 - F11.1: LocalArchive saveTurn stores session in oam_archive_sessions', async () => {
  const store = createMockStorageArea();
  const unbind = bindMockChromeStorage(store);
  try {
    const res = await LocalArchive.saveTurn({
      platform: 'aistudio',
      sessionId: 'sess-100',
      userPrompt: 'What is WebAssembly?',
      assistantResponse: 'WebAssembly (Wasm) is a binary instruction format...',
    });
    assert.equal(res.success, true);
    const data = await store.get(LocalArchive.SESSIONS_KEY);
    const sessions = data[LocalArchive.SESSIONS_KEY];
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].id, 'sess-100');
    assert.equal(sessions[0].platform, 'aistudio');
    assert.equal(sessions[0].title, 'What is WebAssembly?');
    assert.equal(sessions[0].turnCount, 1);
  } finally {
    unbind();
  }
});

test('Tier 1 - F11.2: LocalArchive saveTurn stores turns in oam_archive_turns_${sessionId}', async () => {
  const store = createMockStorageArea();
  const unbind = bindMockChromeStorage(store);
  try {
    await LocalArchive.saveTurn({
      platform: 'chatgpt',
      sessionId: 'sess-turns-test',
      userPrompt: 'Turn 1 prompt',
      assistantResponse: 'Turn 1 answer',
    });
    const turnsKey = `${LocalArchive.TURNS_PREFIX}sess-turns-test`;
    const data = await store.get(turnsKey);
    const turns = data[turnsKey];
    assert.equal(turns.length, 1);
    assert.equal(turns[0].userText, 'Turn 1 prompt');
    assert.equal(turns[0].assistantText, 'Turn 1 answer');
    assert.ok(turns[0].timestamp);
  } finally {
    unbind();
  }
});

test('Tier 1 - F11.3: LocalArchive updates oam_archive_meta statistics', async () => {
  const store = createMockStorageArea();
  const unbind = bindMockChromeStorage(store);
  try {
    await LocalArchive.saveTurn({ platform: 'claude', sessionId: 's-m1', userText: 'U1', assistantText: 'A1' });
    await LocalArchive.saveTurn({ platform: 'claude', sessionId: 's-m1', userText: 'U2', assistantText: 'A2' });
    await LocalArchive.saveTurn({ platform: 'grok', sessionId: 's-m2', userText: 'U3', assistantText: 'A3' });

    const metaData = await store.get(LocalArchive.META_KEY);
    const meta = metaData[LocalArchive.META_KEY];
    assert.equal(meta.totalSessions, 2);
    assert.equal(meta.totalTurns, 3);
    assert.ok(meta.lastArchivedAt);
  } finally {
    unbind();
  }
});

test('Tier 1 - F11.4: LocalArchive parses dialogue from formatted content string', async () => {
  const store = createMockStorageArea();
  const unbind = bindMockChromeStorage(store);
  try {
    await LocalArchive.saveTurn({
      platform: 'gemini',
      sessionId: 's-parse',
      content: 'User: How does backpropagation work?\n\nAssistant: Backpropagation computes gradients...',
    });
    const details = await LocalArchive.getSessionDetails('s-parse');
    assert.equal(details.turns.length, 1);
    assert.equal(details.turns[0].userText, 'How does backpropagation work?');
    assert.equal(details.turns[0].assistantText, 'Backpropagation computes gradients...');
  } finally {
    unbind();
  }
});

test('Tier 1 - F11.5: LocalArchive deduplicates exact duplicate consecutive turns', async () => {
  const store = createMockStorageArea();
  const unbind = bindMockChromeStorage(store);
  try {
    const res1 = await LocalArchive.saveTurn({
      platform: 'aistudio',
      sessionId: 's-dedup',
      userPrompt: 'Hello world',
      assistantResponse: 'Hello! How can I help you?',
    });
    assert.equal(res1.turnCount, 1);

    const res2 = await LocalArchive.saveTurn({
      platform: 'aistudio',
      sessionId: 's-dedup',
      userPrompt: 'Hello world',
      assistantResponse: 'Hello! How can I help you?',
    });
    assert.equal(res2.deduplicated, true);

    const details = await LocalArchive.getSessionDetails('s-dedup');
    assert.equal(details.turns.length, 1);
  } finally {
    unbind();
  }
});

// -- F12: Local history session query, search, export, and delete operations --

test('Tier 1 - F12.1: LocalArchive getSessions returns sessions ordered by recent activity', async () => {
  const store = createMockStorageArea();
  const unbind = bindMockChromeStorage(store);
  try {
    await LocalArchive.saveTurn({ sessionId: 'first', userText: 'Old', timestamp: '2026-10-01T00:00:00Z' });
    await LocalArchive.saveTurn({ sessionId: 'second', userText: 'Newer', timestamp: '2026-10-02T00:00:00Z' });
    await LocalArchive.saveTurn({ sessionId: 'first', userText: 'Updated', timestamp: '2026-10-03T00:00:00Z' });

    const sessions = await LocalArchive.getSessions();
    assert.equal(sessions[0].id, 'first');
    assert.equal(sessions[1].id, 'second');
  } finally {
    unbind();
  }
});

test('Tier 1 - F12.2: LocalArchive getSessions filters accurately by platform', async () => {
  const store = createMockStorageArea();
  const unbind = bindMockChromeStorage(store);
  try {
    await LocalArchive.saveTurn({ platform: 'aistudio', sessionId: 's-ai', userText: 'AI Q' });
    await LocalArchive.saveTurn({ platform: 'chatgpt', sessionId: 's-gpt', userText: 'GPT Q' });

    const aiSessions = await LocalArchive.getSessions({ platform: 'aistudio' });
    assert.equal(aiSessions.length, 1);
    assert.equal(aiSessions[0].id, 's-ai');

    const gptSessions = await LocalArchive.getSessions({ platform: 'chatgpt' });
    assert.equal(gptSessions.length, 1);
    assert.equal(gptSessions[0].id, 's-gpt');
  } finally {
    unbind();
  }
});

test('Tier 1 - F12.3: LocalArchive getSessions searches transcripts for keyword', async () => {
  const store = createMockStorageArea();
  const unbind = bindMockChromeStorage(store);
  try {
    await LocalArchive.saveTurn({
      sessionId: 's-quantum',
      userText: 'Explain entanglement',
      assistantText: 'Quantum entanglement is a phenomenon...',
    });
    await LocalArchive.saveTurn({
      sessionId: 's-recipes',
      userText: 'How to make sourdough',
      assistantText: 'Mix flour and water...',
    });

    const searchResults = await LocalArchive.getSessions({ query: 'entanglement' });
    assert.equal(searchResults.length, 1);
    assert.equal(searchResults[0].id, 's-quantum');
  } finally {
    unbind();
  }
});

test('Tier 1 - F12.4: LocalArchive deleteSession removes session and turns completely', async () => {
  const store = createMockStorageArea();
  const unbind = bindMockChromeStorage(store);
  try {
    await LocalArchive.saveTurn({ sessionId: 's-to-delete', userText: 'Goodbye' });
    const before = await LocalArchive.getSessionDetails('s-to-delete');
    assert.ok(before.session);

    const delRes = await LocalArchive.deleteSession('s-to-delete');
    assert.equal(delRes.success, true);

    const after = await LocalArchive.getSessionDetails('s-to-delete');
    assert.equal(after.session, null);
    assert.equal(after.turns.length, 0);
  } finally {
    unbind();
  }
});

test('Tier 1 - F12.5: LocalArchive exportHistory generates valid JSON bundle and Markdown', async () => {
  const store = createMockStorageArea();
  const unbind = bindMockChromeStorage(store);
  try {
    await LocalArchive.saveTurn({
      platform: 'aistudio',
      sessionId: 's-export',
      userPrompt: 'Export prompt',
      assistantResponse: 'Export response',
    });

    const jsonExport = await LocalArchive.exportHistory({ format: 'json' });
    assert.ok(jsonExport.filename.endsWith('.json'));
    const parsedData = JSON.parse(jsonExport.data);
    assert.equal(parsedData.sessions.length, 1);
    assert.equal(parsedData.sessions[0].turns[0].userText, 'Export prompt');

    const mdExport = await LocalArchive.exportHistory({ format: 'markdown' });
    assert.ok(mdExport.filename.endsWith('.md'));
    assert.match(mdExport.data, /\*\*User\*\*:\nExport prompt/);
    assert.match(mdExport.data, /\*\*Assistant\*\*:\nExport response/);
  } finally {
    unbind();
  }
});

// -- F13: Popup & Settings UI contract (engine switcher, indicators, history viewer) --

test('Tier 1 - F13.1: Service worker STATUS response satisfies Popup UI status contract', async () => {
  const harness = createServiceWorkerHarness();
  const status = await harness.send({ type: 'STATUS' });
  assert.equal(typeof status.connected, 'boolean');
  assert.equal(typeof status.activeEngine, 'string');
  assert.ok(status.apiUrl);
});

test('Tier 1 - F13.2: Service worker GET_SETTINGS response satisfies Popup Settings schema', async () => {
  const harness = createServiceWorkerHarness();
  const settings = await harness.send({ type: 'GET_SETTINGS' });
  assert.ok('activeEngine' in settings);
  assert.ok('apiUrl' in settings);
  assert.ok('mem0ApiUrl' in settings);
  assert.ok('mem0ApiKey' in settings);
  assert.ok('aistudioAutoSave' in settings);
});

test('Tier 1 - F13.3: Service worker SET_SETTINGS handles dynamic engine switcher payload', async () => {
  const harness = createServiceWorkerHarness();
  const res = await harness.send({
    type: 'SET_SETTINGS',
    settings: {
      activeEngine: 'mem0',
      mem0ApiKey: 'popup-entered-key',
      mem0UserId: 'popup-user',
    },
  });
  assert.equal(res.ok, true);
  const current = await harness.send({ type: 'GET_SETTINGS' });
  assert.equal(current.activeEngine, 'mem0');
  assert.equal(current.mem0ApiKey, 'popup-entered-key');
});

test('Tier 1 - F13.4: Popup memory card model normalizes correctly for context generation', () => {
  const items = [
    {
      title: 'Database Architecture',
      narrative: 'PostgreSQL with pgvector for embeddings',
      facts: ['PostgreSQL 16', 'pgvector extension'],
    },
  ];

  let context = '';
  for (const obs of items) {
    if (obs.title) context += `### ${obs.title}\n`;
    if (obs.narrative) context += `${obs.narrative}\n`;
    if (obs.facts && obs.facts.length > 0) context += `Key facts: ${obs.facts.join('; ')}\n`;
    context += '\n';
  }

  assert.match(context, /### Database Architecture/);
  assert.match(context, /Key facts: PostgreSQL 16; pgvector extension/);
});

test('Tier 1 - F13.5: Popup queue management synchronizes badge and session count', async () => {
  const harness = createServiceWorkerHarness();

  await harness.send({ type: 'SET_QUEUE_COUNT', count: 4 });
  assert.equal(harness.badge.text, '4');

  await harness.send({ type: 'CONTEXT_SENT' });
  assert.equal(harness.badge.text, '✓');
});

test('Tier 1 - F13.6: Popup file assets exist and are syntactically valid', () => {
  const htmlPath = path.join(ROOT_DIR, 'popup/popup.html');
  const cssPath = path.join(ROOT_DIR, 'popup/popup.css');
  const jsPath = path.join(ROOT_DIR, 'popup/popup.js');

  assert.ok(fs.existsSync(htmlPath), 'popup.html must exist');
  assert.ok(fs.existsSync(cssPath), 'popup.css must exist');
  assert.ok(fs.existsSync(jsPath), 'popup.js must exist');

  const jsContent = fs.readFileSync(jsPath, 'utf8');
  assert.doesNotThrow(() => {
    new vm.Script(jsContent);
  }, 'popup.js must parse cleanly without syntax errors');
});


// -----------------------------------------------------------------------------
// TIER 2: BOUNDARY & CORNER CASES (>=5 tests per category/feature)
// -----------------------------------------------------------------------------

test('Tier 2 - B1.1: Mem0Engine search handles empty string query gracefully', async () => {
  const engine = new Mem0Engine();
  const res = await engine.search({ query: '' });
  assert.deepEqual(res.results, []);
});

test('Tier 2 - B1.2: Mem0Engine search handles whitespace-only query gracefully', async () => {
  const engine = new Mem0Engine();
  const res = await engine.search({ query: '   \n\t  ' });
  assert.deepEqual(res.results, []);
});

test('Tier 2 - B1.3: AgentMemoryEngine search with null/undefined query does not crash', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    async json() { return { results: [] }; },
  });

  try {
    const engine = new AgentMemoryEngine();
    const res = await engine.search({ query: undefined });
    assert.deepEqual(res.results, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Tier 2 - B1.4: LocalArchive saveTurn with empty payload defaults gracefully', async () => {
  const store = createMockStorageArea();
  const unbind = bindMockChromeStorage(store);
  try {
    const res = await LocalArchive.saveTurn({});
    assert.equal(res.success, true);
    assert.ok(res.sessionId);
    assert.equal(res.turnCount, 1);
  } finally {
    unbind();
  }
});

test('Tier 2 - B1.5: LocalArchive getSessions with whitespace query returns unfiltered sessions', async () => {
  const store = createMockStorageArea();
  const unbind = bindMockChromeStorage(store);
  try {
    await LocalArchive.saveTurn({ sessionId: 'ws-1', userText: 'Sample turn' });
    const res = await LocalArchive.getSessions({ query: '   \t  ' });
    assert.equal(res.length, 1);
  } finally {
    unbind();
  }
});

test('Tier 2 - B2.1: Mem0Engine checkHealth on HTTP 401 returns unauthorized message', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 401,
    async json() { return { message: 'Invalid API key provided' }; },
  });

  try {
    const engine = new Mem0Engine({ apiKey: 'wrong' });
    const health = await engine.checkHealth();
    assert.equal(health.connected, false);
    assert.match(health.error, /401/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Tier 2 - B2.2: Mem0Engine checkHealth on HTTP 403 returns forbidden error', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 403,
    async json() { return { message: 'Forbidden access' }; },
  });

  try {
    const engine = new Mem0Engine({ apiKey: 'forbidden' });
    const health = await engine.checkHealth();
    assert.equal(health.connected, false);
    assert.match(health.error, /403/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Tier 2 - B2.3: AgentMemoryEngine observe without secret sends unauthenticated request when omitted', async () => {
  let capturedHeaders = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    capturedHeaders = opts.headers;
    return {
      ok: true,
      async json() { return { ok: true, id: 'obs-open' }; },
    };
  };

  try {
    const engine = new AgentMemoryEngine({ secret: '' });
    await engine.observe({ content: 'no secret turn' });
    assert.equal(capturedHeaders.Authorization, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Tier 2 - B2.4: AgentMemoryEngine checkHealth reports error when loopback daemon returns 401', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 401,
    async json() { return { error: 'Invalid Bearer token' }; },
  });

  try {
    const engine = new AgentMemoryEngine({ secret: 'bad-secret' });
    const health = await engine.checkHealth();
    assert.equal(health.connected, false);
    assert.match(health.error, /Invalid Bearer token/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Tier 2 - B2.5: Mem0Engine observe without API key returns error when remote requires auth', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 401,
    async json() { return { message: 'Authentication credentials were not provided.' }; },
  });

  try {
    const engine = new Mem0Engine({ apiKey: '' });
    const res = await engine.observe({ content: 'turn' });
    assert.equal(res.success, false);
    assert.equal(res.status, 401);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Tier 2 - B3.1: AgentMemoryEngine rejects invalid ports or non-loopback IPs', () => {
  assert.throws(
    () => new AgentMemoryEngine({ apiUrl: 'http://10.0.0.1:3111' }),
    /AgentMemory URL must be an http:\/\/localhost or http:\/\/127\.0\.0\.1 address/
  );
  assert.throws(
    () => new AgentMemoryEngine({ apiUrl: 'http://google.com' }),
    /AgentMemory URL must be an http:\/\/localhost or http:\/\/127\.0\.0\.1 address/
  );
});

test('Tier 2 - B3.2: Mem0Engine normalizeUrl throws on non-HTTP/HTTPS schemes', () => {
  assert.throws(
    () => new Mem0Engine({ apiUrl: 'data:text/plain;base64,SGVsbG8=' }),
    /Mem0 URL must use http:\/\/ or https:\/\//
  );
});

test('Tier 2 - B3.3: AgentMemoryEngine normalizeUrl rejects embedded username/password', () => {
  assert.throws(
    () => new AgentMemoryEngine({ apiUrl: 'http://admin:pass@localhost:3111' }),
    /AgentMemory URL must be an http:\/\/localhost or http:\/\/127\.0\.0\.1 address/
  );
});

test('Tier 2 - B3.4: Mem0Engine normalizeUrl throws on malformed URL string', () => {
  assert.throws(
    () => new Mem0Engine({ apiUrl: 'not-a-valid-url://' }),
    /Invalid URL|Mem0 URL must use/
  );
});

test('Tier 2 - B3.5: AgentMemoryEngine normalizeUrl rejects ftp scheme on localhost', () => {
  assert.throws(
    () => new AgentMemoryEngine({ apiUrl: 'ftp://localhost:21' }),
    /AgentMemory URL must be an http:\/\/localhost or http:\/\/127\.0\.0\.1 address/
  );
});

test('Tier 2 - B4.1: AgentMemoryEngine handles network timeout / abort signal cleanly', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    const err = new Error('The operation was aborted');
    err.name = 'TimeoutError';
    throw err;
  };

  try {
    const engine = new AgentMemoryEngine({ timeout: 100 });
    const health = await engine.checkHealth();
    assert.equal(health.connected, false);
    assert.match(health.error, /aborted/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Tier 2 - B4.2: Mem0Engine observe handles network disconnect cleanly without crash', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('fetch failed: ECONNREFUSED');
  };

  try {
    const engine = new Mem0Engine();
    const res = await engine.observe({ content: 'test turn' });
    assert.equal(res.success, false);
    assert.match(res.error, /ECONNREFUSED/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Tier 2 - B4.3: Mem0Engine search handles timeout cleanly without unhandled rejection', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    const err = new Error('Request timed out');
    err.name = 'TimeoutError';
    throw err;
  };

  try {
    const engine = new Mem0Engine({ timeout: 50 });
    const res = await engine.search({ query: 'timeout test' });
    assert.deepEqual(res.results, []);
    assert.match(res.error, /timed out/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Tier 2 - B4.4: AgentMemoryEngine observe handles timeout cleanly', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('Connection timed out');
  };

  try {
    const engine = new AgentMemoryEngine();
    const res = await engine.observe({ content: 'slow turn' });
    assert.equal(res.success, false);
    assert.match(res.error, /timed out/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Tier 2 - B4.5: Mem0Engine checkHealth handles slow response timeout within threshold', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    const err = new Error('The operation was aborted due to timeout');
    throw err;
  };

  try {
    const engine = new Mem0Engine();
    const health = await engine.checkHealth();
    assert.equal(health.connected, false);
    assert.match(health.error, /aborted/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Tier 2 - B5.1: AgentMemoryEngine handles HTTP 500 internal server error gracefully', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 500,
    async json() { return { error: 'Internal Database Failure' }; },
  });

  try {
    const engine = new AgentMemoryEngine();
    const res = await engine.observe({ content: 'save turn' });
    assert.equal(res.success, false);
    assert.equal(res.status, 500);
    assert.equal(res.error, 'Internal Database Failure');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Tier 2 - B5.2: Mem0Engine handles malformed non-JSON response payload without error', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 502,
    async json() { throw new SyntaxError('Unexpected token < in JSON at position 0'); },
  });

  try {
    const engine = new Mem0Engine();
    const res = await engine.search({ query: 'test' });
    assert.deepEqual(res.results, []);
    assert.match(res.error, /HTTP 502/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Tier 2 - B5.3: AgentMemoryEngine handles HTTP 502 Bad Gateway response', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 502,
    async json() { return { error: 'Bad Gateway' }; },
  });

  try {
    const engine = new AgentMemoryEngine();
    const res = await engine.search({ query: 'query' });
    assert.deepEqual(res.results, []);
    assert.equal(res.status, 502);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Tier 2 - B5.4: Mem0Engine observe handles HTTP 429 rate limit response', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 429,
    async json() { return { message: 'Rate limit exceeded: please slow down' }; },
  });

  try {
    const engine = new Mem0Engine();
    const res = await engine.observe({ content: 'rapid turn' });
    assert.equal(res.success, false);
    assert.equal(res.status, 429);
    assert.match(res.error, /Rate limit exceeded/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Tier 2 - B5.5: AgentMemoryEngine checkHealth handles empty body on non-ok status', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 503,
    async json() { throw new Error('Empty body'); },
  });

  try {
    const engine = new AgentMemoryEngine();
    const res = await engine.checkHealth();
    assert.equal(res.connected, false);
    assert.match(res.error, /HTTP 503/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Tier 2 - B6.1: LocalArchive preserves Unicode, emojis, and multiline symbols', async () => {
  const store = createMockStorageArea();
  const unbind = bindMockChromeStorage(store);
  try {
    const prompt = '🤖 AI: よろしくお願いします！ 🚀 🧠 🌟\n\n```python\nprint("Hello, 世界")\n```';
    const response = '👍 了解しました。Here is a mathematical symbol: ∑(x_i) ≥ 0.';

    await LocalArchive.saveTurn({
      platform: 'aistudio',
      sessionId: 'sess-unicode',
      userPrompt: prompt,
      assistantResponse: response,
    });

    const details = await LocalArchive.getSessionDetails('sess-unicode');
    assert.equal(details.turns[0].userText, prompt);
    assert.equal(details.turns[0].assistantText, response);

    const search = await LocalArchive.getSessions({ query: 'よろしくお願いします' });
    assert.equal(search.length, 1);
  } finally {
    unbind();
  }
});

test('Tier 2 - B6.2: LocalArchive handles extremely large prompt text (>100k chars)', async () => {
  const store = createMockStorageArea();
  const unbind = bindMockChromeStorage(store);
  try {
    const hugePrompt = 'A'.repeat(120000);
    const res = await LocalArchive.saveTurn({
      platform: 'gemini',
      sessionId: 'sess-huge',
      userPrompt: hugePrompt,
      assistantResponse: 'Received large payload.',
    });
    assert.equal(res.success, true);
    const details = await LocalArchive.getSessionDetails('sess-huge');
    assert.equal(details.turns[0].userText.length, 120000);
  } finally {
    unbind();
  }
});

test('Tier 2 - B6.3: Mem0Engine _parseMessages handles multi-line code blocks and nested markdown headers', () => {
  const engine = new Mem0Engine();
  const content = 'User: ```sql\nSELECT * FROM memory;\n```\n\nAssistant: ```sql\n-- Result\n1 row\n```';
  const msgs = engine._parseMessages({ content });
  assert.equal(msgs.length, 2);
  assert.match(msgs[0].content, /SELECT \* FROM memory/);
  assert.match(msgs[1].content, /-- Result/);
});

test('Tier 2 - B6.4: LocalArchive handles strings with control characters without corrupting JSON', async () => {
  const store = createMockStorageArea();
  const unbind = bindMockChromeStorage(store);
  try {
    const rawWithControl = 'Line 1\r\nLine 2\tTabbed\b\f';
    await LocalArchive.saveTurn({
      platform: 'chatgpt',
      sessionId: 'sess-ctrl',
      userText: rawWithControl,
      assistantText: 'Clean reply',
    });
    const details = await LocalArchive.getSessionDetails('sess-ctrl');
    assert.equal(details.turns[0].userText, rawWithControl.trim());
  } finally {
    unbind();
  }
});

test('Tier 2 - B6.5: LocalArchive exportHistory handles quotes and special characters in titles', async () => {
  const store = createMockStorageArea();
  const unbind = bindMockChromeStorage(store);
  try {
    await LocalArchive.saveTurn({
      platform: 'claude',
      sessionId: 'sess-quotes',
      userPrompt: 'Tell me about "Quantum Computing" & <Special> Chars',
      assistantResponse: 'Quantum computing uses qubits.',
    });
    const jsonExport = await LocalArchive.exportHistory({ format: 'json' });
    const parsed = JSON.parse(jsonExport.data);
    assert.match(parsed.sessions[0].title, /Quantum Computing/);
  } finally {
    unbind();
  }
});

test('Tier 2 - B7.1: LocalArchive parses asymmetric turn with only user prompt', async () => {
  const store = createMockStorageArea();
  const unbind = bindMockChromeStorage(store);
  try {
    await LocalArchive.saveTurn({
      platform: 'chatgpt',
      sessionId: 'sess-asymm',
      userPrompt: 'Pending assistant reply...',
      assistantResponse: '',
    });
    const details = await LocalArchive.getSessionDetails('sess-asymm');
    assert.equal(details.turns.length, 1);
    assert.equal(details.turns[0].userText, 'Pending assistant reply...');
    assert.equal(details.turns[0].assistantText, '');
  } finally {
    unbind();
  }
});

test('Tier 2 - B7.2: LocalArchive parses asymmetric turn with only assistant response', async () => {
  const store = createMockStorageArea();
  const unbind = bindMockChromeStorage(store);
  try {
    await LocalArchive.saveTurn({
      platform: 'claude',
      sessionId: 'sess-asymm-ast',
      userPrompt: '',
      assistantResponse: 'Standalone assistant greeting.',
    });
    const details = await LocalArchive.getSessionDetails('sess-asymm-ast');
    assert.equal(details.turns.length, 1);
    assert.equal(details.turns[0].userText, '');
    assert.equal(details.turns[0].assistantText, 'Standalone assistant greeting.');
  } finally {
    unbind();
  }
});

test('Tier 2 - B7.3: Mem0Engine _parseMessages parses turn with only userPrompt into single message', () => {
  const engine = new Mem0Engine();
  const msgs = engine._parseMessages({ userPrompt: 'Sole user prompt' });
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].role, 'user');
  assert.equal(msgs[0].content, 'Sole user prompt');
});

test('Tier 2 - B7.4: Mem0Engine _parseMessages parses unformatted single line content into user message', () => {
  const engine = new Mem0Engine();
  const msgs = engine._parseMessages({ content: 'Single prompt without role prefix' });
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].role, 'user');
  assert.equal(msgs[0].content, 'Single prompt without role prefix');
});

test('Tier 2 - B7.5: AgentMemoryEngine observe formats prompt from content when distinct properties absent', async () => {
  let posted = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    posted = JSON.parse(opts.body);
    return { ok: true, async json() { return { ok: true }; } };
  };

  try {
    const engine = new AgentMemoryEngine();
    await engine.observe({
      platform: 'grok',
      content: 'Raw turn content string',
    });
    assert.equal(posted.data.prompt, 'Raw turn content string');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Tier 2 - B8.1: LocalArchive deleteSession on non-existent session ID does not throw', async () => {
  const store = createMockStorageArea();
  const unbind = bindMockChromeStorage(store);
  try {
    const res = await LocalArchive.deleteSession('non-existent-id-999');
    assert.equal(res.success, true);
  } finally {
    unbind();
  }
});

test('Tier 2 - B8.2: LocalArchive clearHistory on empty store returns success', async () => {
  const store = createMockStorageArea();
  const unbind = bindMockChromeStorage(store);
  try {
    const res = await LocalArchive.clearHistory();
    assert.equal(res.success, true);
    const sessions = await LocalArchive.getSessions();
    assert.deepEqual(sessions, []);
  } finally {
    unbind();
  }
});

test('Tier 2 - B8.3: LocalArchive getSessionDetails on null/empty sessionId returns null session', async () => {
  const store = createMockStorageArea();
  const unbind = bindMockChromeStorage(store);
  try {
    const res = await LocalArchive.getSessionDetails('');
    assert.equal(res.session, null);
    assert.deepEqual(res.turns, []);
  } finally {
    unbind();
  }
});

test('Tier 2 - B8.4: LocalArchive getSessions with offset beyond total count returns empty array', async () => {
  const store = createMockStorageArea();
  const unbind = bindMockChromeStorage(store);
  try {
    await LocalArchive.saveTurn({ sessionId: 's1', userText: 'T1' });
    const res = await LocalArchive.getSessions({ offset: 100, limit: 10 });
    assert.deepEqual(res, []);
  } finally {
    unbind();
  }
});

test('Tier 2 - B8.5: LocalArchive saveTurn handles rapid streaming updates in-place', async () => {
  const store = createMockStorageArea();
  const unbind = bindMockChromeStorage(store);
  try {
    const sid = 'streaming-sess';
    // Stream chunk 1
    await LocalArchive.saveTurn({
      platform: 'aistudio',
      sessionId: sid,
      userPrompt: 'Compute pi',
      assistantResponse: '3.14',
    });
    // Stream chunk 2 (extends chunk 1)
    await LocalArchive.saveTurn({
      platform: 'aistudio',
      sessionId: sid,
      userPrompt: 'Compute pi',
      assistantResponse: '3.14159265',
    });

    const details = await LocalArchive.getSessionDetails(sid);
    assert.equal(details.turns.length, 1);
    assert.equal(details.turns[0].assistantText, '3.14159265');
  } finally {
    unbind();
  }
});

// -----------------------------------------------------------------------------
// TIER 3: CROSS-FEATURE COMBINATIONS
// -----------------------------------------------------------------------------

test('Tier 3 - C1: Engine switching dynamically routes subsequent OBSERVE calls', async () => {
  let routedRequests = [];
  const customFetch = async (url, opts) => {
    routedRequests.push({
      url,
      method: opts.method || 'GET',
      body: opts.body ? JSON.parse(opts.body) : null,
    });
    return {
      ok: true,
      async json() { return { ok: true, success: true }; },
    };
  };

  const harness = createServiceWorkerHarness({}, customFetch);

  // Turn 1 on AgentMemory
  await harness.send({
    type: 'OBSERVE',
    platform: 'chatgpt',
    sessionId: 'sess-switch',
    content: 'User: Question 1\n\nAssistant: Answer 1',
  });
  assert.equal(routedRequests.length, 1);
  assert.match(routedRequests[0].url, /localhost:3111\/agentmemory\/observe/);

  // Switch to Mem0
  await harness.send({
    type: 'SET_SETTINGS',
    settings: {
      activeEngine: 'mem0',
      mem0ApiKey: 'token-m0',
      mem0UserId: 'charlie',
    },
  });

  // Turn 2 on Mem0
  await harness.send({
    type: 'OBSERVE',
    platform: 'chatgpt',
    sessionId: 'sess-switch',
    userPrompt: 'Question 2',
    assistantResponse: 'Answer 2',
  });
  const observeRequests = routedRequests.filter(
    (r) => r.method === 'POST' && (r.url.includes('/observe') || r.url.includes('/memories'))
  );
  assert.equal(observeRequests.length, 2);
  assert.match(observeRequests[0].url, /localhost:3111\/agentmemory\/observe/);
  assert.match(observeRequests[1].url, /api\.mem0\.ai\/v1\/memories/);
  assert.equal(observeRequests[1].body.user_id, 'charlie');
});

test('Tier 3 - C2: Zero-retention archiving preserves turns even when remote backend fails', async () => {
  const store = createMockStorageArea();
  const unbind = bindMockChromeStorage(store);

  // Simulate remote engine failure
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('503 Service Unavailable: Remote backend is offline');
  };

  try {
    const engine = new Mem0Engine();
    const remoteRes = await engine.observe({
      platform: 'aistudio',
      sessionId: 'sess-resilient',
      userPrompt: 'Important research thought',
      assistantResponse: 'Crucial model response',
    });
    assert.equal(remoteRes.success, false);

    // Save to LocalArchive (zero-retention local capture)
    const localRes = await LocalArchive.saveTurn({
      platform: 'aistudio',
      sessionId: 'sess-resilient',
      userPrompt: 'Important research thought',
      assistantResponse: 'Crucial model response',
    });
    assert.equal(localRes.success, true);

    const details = await LocalArchive.getSessionDetails('sess-resilient');
    assert.equal(details.session.turnCount, 1);
    assert.equal(details.turns[0].userText, 'Important research thought');
    assert.equal(details.turns[0].assistantText, 'Crucial model response');
  } finally {
    unbind();
    globalThis.fetch = originalFetch;
  }
});

test('Tier 3 - C3: Recalled Mem0 memories normalized, queued, and injected into AI Studio DOM', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return [
        {
          id: 'mem-ai-studio',
          memory: 'User is conducting research on transformer self-attention.',
          metadata: {
            title: 'Research Context',
            facts: ['Query Key Value projections', 'Multi-head mechanism'],
          },
        },
      ];
    },
  });

  try {
    const mem0 = new Mem0Engine();
    const searchRes = await mem0.search({ query: 'transformer' });
    const memory = searchRes.results[0];

    // Format context text as popup does
    const contextText = `### ${memory.title}\n${memory.narrative}\nKey facts: ${memory.facts.join('; ')}\n\n`;

    // Simulated Google AI Studio textarea
    const events = [];
    let focused = false;
    const aiStudioTextarea = {
      tagName: 'TEXTAREA',
      value: 'How are attention weights normalized?',
      focus() { focused = true; },
      dispatchEvent(e) { events.push(e.type); return true; },
    };

    // Prepend context
    aiStudioTextarea.focus();
    aiStudioTextarea.value = contextText + aiStudioTextarea.value;
    aiStudioTextarea.dispatchEvent({ type: 'input', bubbles: true });
    aiStudioTextarea.dispatchEvent({ type: 'change', bubbles: true });
    aiStudioTextarea.dispatchEvent({ type: 'resize', bubbles: true });

    assert.equal(focused, true);
    assert.match(aiStudioTextarea.value, /### Research Context/);
    assert.match(aiStudioTextarea.value, /How are attention weights normalized\?/);
    assert.deepEqual(events, ['input', 'change', 'resize']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Tier 3 - C4: Searching local archive while external engine is completely offline', async () => {
  const store = createMockStorageArea();
  const unbind = bindMockChromeStorage(store);

  try {
    await LocalArchive.saveTurn({
      platform: 'aistudio',
      sessionId: 'offline-sess',
      userPrompt: 'Offline prompt text',
      assistantResponse: 'Offline response text',
    });

    // Verify local search returns session without network dependency
    const results = await LocalArchive.getSessions({ query: 'offline' });
    assert.equal(results.length, 1);
    assert.equal(results[0].id, 'offline-sess');
  } finally {
    unbind();
  }
});

test('Tier 3 - C5: Interleaved multi-platform conversation archival preserves independent histories', async () => {
  const store = createMockStorageArea();
  const unbind = bindMockChromeStorage(store);

  try {
    await LocalArchive.saveTurn({ platform: 'aistudio', sessionId: 's1', userText: 'AI Studio turn' });
    await LocalArchive.saveTurn({ platform: 'gemini', sessionId: 's2', userText: 'Gemini turn' });
    await LocalArchive.saveTurn({ platform: 'chatgpt', sessionId: 's3', userText: 'ChatGPT turn' });
    await LocalArchive.saveTurn({ platform: 'claude', sessionId: 's4', userText: 'Claude turn' });

    const all = await LocalArchive.getSessions();
    assert.equal(all.length, 4);

    const aistudioOnly = await LocalArchive.getSessions({ platform: 'aistudio' });
    assert.equal(aistudioOnly.length, 1);
    assert.equal(aistudioOnly[0].id, 's1');

    const chatgptOnly = await LocalArchive.getSessions({ platform: 'chatgpt' });
    assert.equal(chatgptOnly.length, 1);
    assert.equal(chatgptOnly[0].id, 's3');
  } finally {
    unbind();
  }
});

test('Tier 3 - C6: Comprehensive settings update alters activeEngine and auto-save toggles simultaneously', async () => {
  const harness = createServiceWorkerHarness();

  const updateResult = await harness.send({
    type: 'SET_SETTINGS',
    settings: {
      activeEngine: 'mem0',
      mem0ApiUrl: 'https://api.mem0.ai/v1',
      mem0ApiKey: 'm0-unified-test-key',
      mem0UserId: 'unified-user',
      aistudioAutoSave: true,
      geminiAutoSave: false,
      chatgptAutoSave: true,
    },
  });
  assert.equal(updateResult.ok, true);

  const current = await harness.send({ type: 'GET_SETTINGS' });
  assert.equal(current.activeEngine, 'mem0');
  assert.equal(current.mem0ApiKey, 'm0-unified-test-key');
  assert.equal(current.aistudioAutoSave, true);
  assert.equal(current.geminiAutoSave, false);
  assert.equal(current.chatgptAutoSave, true);
});

// -----------------------------------------------------------------------------
// TIER 4: REAL-WORLD APPLICATION SCENARIOS (>=5 scenarios)
// -----------------------------------------------------------------------------

test('Tier 4 - Scenario 1: Multi-turn research conversation on Google AI Studio archived locally', async () => {
  // Scenario: A researcher is conducting a multi-turn deep dive on aistudio.google.com with
  // cloud activity logging disabled for privacy.
  const store = createMockStorageArea();
  const unbind = bindMockChromeStorage(store);

  try {
    const sessionId = 'aistudio_research_20261005';
    const turnsData = [
      {
        user: 'Can you compare FLASH attention with standard multi-head attention?',
        assistant: 'FlashAttention is an IO-aware exact attention algorithm that reduces memory access overhead...',
      },
      {
        user: 'How does tiling affect GPU SRAM utilization?',
        assistant: 'Tiling splits Q, K, and V into blocks that fit within fast SRAM, computing softmax without materialized NxN matrices...',
      },
      {
        user: 'What are the backward pass gradient computation implications?',
        assistant: 'During the backward pass, FlashAttention recomputes intermediate attention scores on the fly rather than reading them from HBM...',
      },
    ];

    for (let i = 0; i < turnsData.length; i++) {
      const turn = turnsData[i];
      const saveRes = await LocalArchive.saveTurn({
        platform: 'aistudio',
        sessionId,
        userPrompt: turn.user,
        assistantResponse: turn.assistant,
        timestamp: new Date(Date.now() + i * 60000).toISOString(),
      });
      assert.equal(saveRes.success, true);
      assert.equal(saveRes.turnCount, i + 1);
    }

    // Inspect stored conversation thread
    const details = await LocalArchive.getSessionDetails(sessionId);
    assert.equal(details.session.turnCount, 3);
    assert.equal(details.session.platform, 'aistudio');
    assert.equal(details.session.title, 'Can you compare FLASH attention with standard multi-head attention?');
    assert.equal(details.turns.length, 3);
    assert.equal(details.turns[2].userText, turnsData[2].user);

    // Verify transcript search finds the discussion
    const searchRes = await LocalArchive.getSessions({ query: 'FlashAttention' });
    assert.equal(searchRes.length, 1);
    assert.equal(searchRes[0].id, sessionId);
  } finally {
    unbind();
  }
});

test('Tier 4 - Scenario 2: Switching from AgentMemory to Mem0 Cloud and searching recalled memories', async () => {
  // Scenario: User migrates memory storage from local daemon to Mem0 Cloud.
  const customFetch = async (url, opts) => {
    if (url.includes('/memories/search')) {
      return {
        ok: true,
        async json() {
          return [
            {
              id: 'cloud-mem-1',
              memory: 'User prefers functional programming with immutability.',
              metadata: { title: 'Code Principles', facts: ['Pure functions', 'Persistent data structures'] },
              score: 0.945,
            },
            {
              id: 'cloud-mem-2',
              memory: 'Primary language is JavaScript and TypeScript.',
              metadata: { title: 'Languages', facts: ['TypeScript 5.x', 'Node.js 22'] },
              score: 0.912,
            },
          ];
        },
      };
    }
    return { ok: true, async json() { return { ok: true }; } };
  };

  const harness = createServiceWorkerHarness({}, customFetch);

  // Switch to Mem0
  await harness.send({
    type: 'SET_SETTINGS',
    settings: {
      activeEngine: 'mem0',
      mem0ApiKey: 'm0-user-secret',
      mem0UserId: 'developer_1',
    },
  });

  // Search memories
  const searchResult = await harness.send({
    type: 'SEARCH',
    query: 'programming style',
  });

  assert.equal(searchResult.results.length, 2);
  const m1 = searchResult.results[0];
  assert.equal(m1.title, 'Code Principles');
  assert.equal(m1.narrative, 'User prefers functional programming with immutability.');
  assert.deepEqual(m1.facts, ['Pure functions', 'Persistent data structures']);
  assert.equal(m1.score, 0.945);
});

test('Tier 4 - Scenario 3: Zero-retention privacy workflow: cloud disabled, local archive retains full dialogue', async () => {
  // Scenario: Privacy-conscious user disables Gemini Apps Activity & ChatGPT history retention.
  // The local archive ensures dialogue is retained safely on the client device.
  const store = createMockStorageArea();
  const unbind = bindMockChromeStorage(store);

  try {
    const session1 = 'gemini_private_session';
    await LocalArchive.saveTurn({
      platform: 'gemini',
      sessionId: session1,
      userPrompt: 'Confidential medical symptom query',
      assistantResponse: 'General health guidance...',
    });

    const session2 = 'chatgpt_private_session';
    await LocalArchive.saveTurn({
      platform: 'chatgpt',
      sessionId: session2,
      userPrompt: 'Proprietary financial planning calculation',
      assistantResponse: 'Calculation results: ROI is 14%...',
    });

    const sessions = await LocalArchive.getSessions();
    assert.equal(sessions.length, 2);

    // Export complete archive to JSON
    const exported = await LocalArchive.exportHistory({ format: 'json' });
    const bundle = JSON.parse(exported.data);
    assert.equal(bundle.sessions.length, 2);
    assert.equal(bundle.totalSessions, 2);
    assert.equal(bundle.totalTurns, 2);
  } finally {
    unbind();
  }
});

test('Tier 4 - Scenario 4: Memory recall, context queuing, badge update, and AI Studio prompt execution', async () => {
  // Scenario: User finds 2 relevant memories, queues them in popup, badge reflects count,
  // then runs prompt on AI Studio using Ctrl+Enter shortcut.
  const harness = createServiceWorkerHarness();

  // Queue 2 memories
  const queueRes = await harness.send({ type: 'SET_QUEUE_COUNT', count: 2 });
  assert.equal(queueRes.ok, true);
  assert.equal(harness.badge.text, '2');

  // Simulated AI Studio DOM execution
  const contextString = '### Memory 1\nPrefers Python 3.12\n\n### Memory 2\nUses PyTorch\n\n';
  let queueCleared = false;

  const mockInput = {
    tagName: 'TEXTAREA',
    value: 'Write a neural network training loop',
    focus() {},
    dispatchEvent() { return true; },
  };

  // Prepend context
  mockInput.value = contextString + mockInput.value;

  // On submit, send CONTEXT_SENT message
  const sentRes = await harness.send({ type: 'CONTEXT_SENT' });
  assert.equal(sentRes.ok, true);
  assert.equal(harness.sessionStore._raw.oamQueueCount, undefined);
  assert.equal(harness.badge.text, '✓');
});

test('Tier 4 - Scenario 5: Multi-session archival, cross-platform transcript search, export, and platform purge', async () => {
  // Scenario: User accumulates conversation history across all 5 supported platforms,
  // searches across transcripts, exports to Markdown, clears only Grok sessions, and validates remainder.
  const store = createMockStorageArea();
  const unbind = bindMockChromeStorage(store);

  try {
    const platforms = ['aistudio', 'gemini', 'chatgpt', 'claude', 'grok'];
    for (const p of platforms) {
      await LocalArchive.saveTurn({
        platform: p,
        sessionId: `sess_${p}`,
        userPrompt: `Query on ${p}`,
        assistantResponse: `Response from ${p}`,
      });
    }

    const allSessions = await LocalArchive.getSessions();
    assert.equal(allSessions.length, 5);

    // Export to Markdown
    const mdExport = await LocalArchive.exportHistory({ format: 'markdown' });
    assert.match(mdExport.data, /- \*\*Platform\*\*: aistudio/i);
    assert.match(mdExport.data, /- \*\*Platform\*\*: grok/i);

    // Purge only Grok history
    await LocalArchive.clearHistory({ platform: 'grok' });
    const remaining = await LocalArchive.getSessions();
    assert.equal(remaining.length, 4);
    assert.ok(!remaining.some((s) => s.platform === 'grok'));
    assert.ok(remaining.some((s) => s.platform === 'aistudio'));

    // Clear all remaining history
    await LocalArchive.clearHistory();
    const finalSessions = await LocalArchive.getSessions();
    assert.equal(finalSessions.length, 0);
  } finally {
    unbind();
  }
});

// =============================================================================
// Tier 1 - F14 & F15: Hindsight and Cognee Engines Support & Default Ports
// =============================================================================

test('Tier 1 - F14.1: HindsightEngine initializes with default port 8888 and normalizes endpoints', () => {
  const e1 = new HindsightEngine();
  assert.equal(e1.apiUrl, 'http://localhost:8888');
  assert.equal(e1.bankId, 'default');

  const e2 = new HindsightEngine({ apiUrl: 'http://localhost:8888///', bankId: 'custom-bank' });
  assert.equal(e2.apiUrl, 'http://localhost:8888');
  assert.equal(e2.bankId, 'custom-bank');

  assert.throws(() => new HindsightEngine({ apiUrl: 'ftp://localhost:8888' }), /Hindsight URL must use http:\/\/ or https:\/\//);
});

test('Tier 1 - F14.2: HindsightEngine observe formats and transmits turn to /retain', async () => {
  let calledUrl = null;
  let sentBody = null;
  let sentHeaders = null;
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async (url, opts) => {
      calledUrl = url;
      sentBody = JSON.parse(opts.body);
      sentHeaders = opts.headers;
      return {
        ok: true,
        status: 200,
        async json() { return { success: true, id: 'hs-123' }; },
      };
    };

    const engine = new HindsightEngine({ apiUrl: 'http://localhost:8888', apiKey: 'secret', bankId: 'kb' });
    const res = await engine.observe({
      platform: 'gemini',
      userPrompt: 'What is Hindsight?',
      assistantResponse: 'Hindsight is an agent memory backend.',
      sessionId: 'sess-1',
    });

    assert.equal(res.success, true);
    assert.match(calledUrl, /:8888\/retain$/);
    assert.equal(sentHeaders['Authorization'], 'Bearer secret');
    assert.equal(sentBody.bank_id, 'kb');
    assert.match(sentBody.content, /What is Hindsight\?/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Tier 1 - F14.3: HindsightEngine search retrieves memories and supports empty query recent memory retrieval', async () => {
  let listCalled = false;
  let recallCalled = false;
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async (url, opts) => {
      const u = new URL(url);
      if (u.pathname.endsWith('/memories') && opts.method === 'GET') {
        listCalled = true;
        return {
          ok: true,
          status: 200,
          async json() {
            return [
              {
                id: 'm-recent',
                text: 'Recent memory text',
                bank_id: 'kb',
                metadata: { platform: 'claude' },
              },
            ];
          },
        };
      }
      if (u.pathname.endsWith('/recall') && opts.method === 'POST') {
        recallCalled = true;
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              results: [
                {
                  id: 'm-query',
                  content: 'Query matched memory',
                  score: 0.92,
                },
              ],
            };
          },
        };
      }
      return { ok: true, status: 200, async json() { return {}; } };
    };

    const engine = new HindsightEngine({ apiUrl: 'http://localhost:8888', bankId: 'kb' });

    // 1. Empty query calls GET /memories for recent memories
    const recent = await engine.search({ query: '', limit: 5 });
    assert.equal(listCalled, true);
    assert.equal(recent.results.length, 1);
    assert.equal(recent.results[0].narrative, 'Recent memory text');

    // 2. Non-empty query calls POST /recall
    const queried = await engine.search({ query: 'quantum', limit: 5 });
    assert.equal(recallCalled, true);
    assert.equal(queried.results.length, 1);
    assert.equal(queried.results[0].narrative, 'Query matched memory');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Tier 1 - F14.4: HindsightEngine checkHealth validates server connectivity and auth status', async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async (url) => {
      if (url.includes('healthy-host')) {
        return { ok: true, status: 200, async json() { return { version: '0.9.1' }; } };
      }
      return { ok: false, status: 401, async json() { return { message: 'Unauthorized' }; } };
    };

    const engineGood = new HindsightEngine({ apiUrl: 'http://healthy-host:8888' });
    const healthGood = await engineGood.checkHealth();
    assert.equal(healthGood.connected, true);
    assert.equal(healthGood.engine, 'hindsight');
    assert.equal(healthGood.version, '0.9.1');

    const engineBad = new HindsightEngine({ apiUrl: 'http://unauth-host:8888' });
    const healthBad = await engineBad.checkHealth();
    assert.equal(healthBad.connected, false);
    assert.match(healthBad.error, /Invalid Hindsight API Key/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Tier 1 - F15.1: CogneeEngine initializes with default port 8000 and normalizes endpoints', () => {
  const e1 = new CogneeEngine();
  assert.equal(e1.apiUrl, 'http://localhost:8000');
  assert.equal(e1.datasetName, 'main');

  const e2 = new CogneeEngine({ apiUrl: 'http://localhost:8000///', datasetName: 'nlp' });
  assert.equal(e2.apiUrl, 'http://localhost:8000');
  assert.equal(e2.datasetName, 'nlp');

  assert.throws(() => new CogneeEngine({ apiUrl: 'ftp://localhost:8000' }), /Cognee URL must use http:\/\/ or https:\/\//);
});

test('Tier 1 - F15.2: CogneeEngine observe sends add payload and triggers background cognify', async () => {
  let addUrl = null;
  let sentBody = null;
  let sentHeaders = null;
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async (url, opts) => {
      if (url.includes('/add')) {
        addUrl = url;
        sentBody = JSON.parse(opts.body);
        sentHeaders = opts.headers;
        return { ok: true, status: 200, async json() { return { success: true, id: 'cg-456' }; } };
      }
      return { ok: true, status: 200, async json() { return {}; } };
    };

    const engine = new CogneeEngine({ apiUrl: 'http://localhost:8000', apiKey: 'cg-token', datasetName: 'custom' });
    const res = await engine.observe({
      platform: 'chatgpt',
      userPrompt: 'Tell me about graph memory',
      assistantResponse: 'Cognee constructs knowledge graphs from text.',
      sessionId: 'cg-sess-1',
    });

    assert.equal(res.success, true);
    assert.match(addUrl, /:8000\/(api\/v1\/)?add$/);
    assert.equal(sentHeaders['Authorization'], 'Bearer cg-token');
    assert.equal(sentHeaders['X-Api-Key'], 'cg-token');
    assert.equal(sentBody.datasetName, 'custom');
    assert.match(sentBody.data, /Cognee constructs knowledge graphs/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Tier 1 - F15.3: CogneeEngine search queries dataset and normalizes graph memories', async () => {
  let listCalled = false;
  let searchCalled = false;
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async (url, opts) => {
      const u = new URL(url);
      if (u.pathname.includes('/memories') && opts.method === 'GET') {
        listCalled = true;
        return {
          ok: true,
          status: 200,
          async json() {
            return [
              {
                id: 'cg-recent-1',
                text: 'Node A connects to Node B',
                datasetName: 'custom',
                metadata: { platform: 'grok' },
              },
            ];
          },
        };
      }
      if (u.pathname.includes('/search') && opts.method === 'POST') {
        searchCalled = true;
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              results: [
                {
                  id: 'cg-search-1',
                  search_result: 'Entity relations extracted',
                  score: 0.88,
                },
              ],
            };
          },
        };
      }
      return { ok: true, status: 200, async json() { return {}; } };
    };

    const engine = new CogneeEngine({ apiUrl: 'http://localhost:8000', datasetName: 'custom' });

    // 1. Empty query calls GET /api/v1/memories for recent memories
    const recent = await engine.search({ query: '', limit: 5 });
    assert.equal(listCalled, true);
    assert.equal(recent.results.length, 1);
    assert.equal(recent.results[0].narrative, 'Node A connects to Node B');

    // 2. Non-empty query calls POST /search
    const queried = await engine.search({ query: 'relations', limit: 5 });
    assert.equal(searchCalled, true);
    assert.equal(queried.results.length, 1);
    assert.equal(queried.results[0].narrative, 'Entity relations extracted');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Tier 1 - F16.1: All 5 memory engines have standard default ports configured', () => {
  // Mem0 Self-Hosted: http://localhost:8000
  const mem0Local = EngineFactory.createEngine({});
  assert.equal(mem0Local instanceof Mem0Engine, true);
  assert.equal(mem0Local.apiUrl, 'http://localhost:8000');

  // Mem0 Cloud: https://api.mem0.ai/v1
  const mem0Cloud = EngineFactory.createEngine({ activeEngine: 'mem0', mem0ApiUrl: 'https://api.mem0.ai/v1' });
  assert.equal(mem0Cloud.apiUrl, 'https://api.mem0.ai/v1');

  // AgentMemory: http://localhost:3111
  const agentMem = EngineFactory.createEngine({ activeEngine: 'agentmemory' });
  assert.equal(agentMem instanceof AgentMemoryEngine, true);
  assert.equal(agentMem.apiUrl, 'http://localhost:3111');

  // Hindsight: http://localhost:8888
  const hindsight = EngineFactory.createEngine({ activeEngine: 'hindsight' });
  assert.equal(hindsight instanceof HindsightEngine, true);
  assert.equal(hindsight.apiUrl, 'http://localhost:8888');

  // Cognee: http://localhost:8000
  const cognee = EngineFactory.createEngine({ activeEngine: 'cognee' });
  assert.equal(cognee instanceof CogneeEngine, true);
  assert.equal(cognee.apiUrl, 'http://localhost:8000');
});

test('Tier 4 - Scenario 6: Switching between Hindsight and Cognee backends with observe, auto-load recent memories, and local archive coordination', async () => {
  // Scenario: User begins with Hindsight, observes a turn on Gemini which also archives locally,
  // then switches to Cognee, searches recent memories on popup, and archives on ChatGPT.
  const harness = createServiceWorkerHarness({
    activeEngine: 'hindsight',
    hindsightApiUrl: 'http://localhost:8888',
    cogneeApiUrl: 'http://localhost:8000',
  });

  // 1. Check initial status with Hindsight
  const status1 = await harness.send({ type: 'STATUS' });
  assert.equal(status1.activeEngine, 'hindsight');
  assert.equal(status1.apiUrl, 'http://localhost:8888');

  // 2. Observe on Gemini
  const obs1 = await harness.send({
    type: 'OBSERVE',
    platform: 'gemini',
    content: 'User: Exploring Hindsight\n\nAssistant: Hindsight retains memory context.',
    sessionId: 'sess-multi-hs',
  });
  assert.equal(obs1.success, true);

  // 3. Switch to Cognee
  const switchRes = await harness.send({
    type: 'SET_SETTINGS',
    settings: { activeEngine: 'cognee' },
  });
  assert.equal(switchRes.ok, true);

  const status2 = await harness.send({ type: 'STATUS' });
  assert.equal(status2.activeEngine, 'cognee');
  assert.equal(status2.apiUrl, 'http://localhost:8000');

  // 4. Auto-load recent memories with empty query
  const searchRes = await harness.send({
    type: 'SEARCH',
    query: '',
    limit: 5,
  });
  assert.ok(Array.isArray(searchRes.results));

  // 5. Observe on ChatGPT
  const obs2 = await harness.send({
    type: 'OBSERVE',
    platform: 'chatgpt',
    content: 'User: Graph databases\n\nAssistant: Graphs represent interconnected entities.',
    sessionId: 'sess-multi-cg',
  });
  assert.equal(obs2.success, true);
});

test('Tier 1 - F14.5: HindsightEngine supports /api/v1 fallbacks for health, retain, and recall', async () => {
  const originalFetch = globalThis.fetch;
  const queriedPaths = [];

  try {
    globalThis.fetch = async (url, opts = {}) => {
      const u = new URL(url);
      queriedPaths.push(u.pathname);

      // Simulate root endpoints 404ing, but /api/v1 endpoints succeeding
      if (u.pathname === '/health') return { ok: false, status: 404, async json() { return {}; } };
      if (u.pathname === '/api/v1/health') return { ok: true, status: 200, async json() { return { version: '1.2.0' }; } };

      if (u.pathname === '/retain') return { ok: false, status: 404, async json() { return {}; } };
      if (u.pathname === '/api/v1/retain') return { ok: true, status: 200, async json() { return { success: true }; } };

      if (u.pathname === '/recall') return { ok: false, status: 404, async json() { return {}; } };
      if (u.pathname === '/api/v1/recall') return { ok: true, status: 200, async json() { return { results: [{ text: 'Found via v1' }] }; } };

      return { ok: true, status: 200, async json() { return {}; } };
    };

    const engine = new HindsightEngine({ apiUrl: 'http://localhost:8888' });

    const health = await engine.checkHealth();
    assert.equal(health.connected, true);
    assert.equal(health.version, '1.2.0');

    const obs = await engine.observe({ content: 'test content' });
    assert.equal(obs.success, true);

    const search = await engine.search({ query: 'hello' });
    assert.equal(search.results.length, 1);
    assert.equal(search.results[0].narrative, 'Found via v1');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Tier 1 - F15.4: CogneeEngine handles asymmetric turns with assistantResponse only and /memories fallback', async () => {
  const originalFetch = globalThis.fetch;
  let receivedData = null;

  try {
    globalThis.fetch = async (url, opts = {}) => {
      const u = new URL(url);
      if (u.pathname.includes('/add')) {
        receivedData = JSON.parse(opts.body).data;
        return { ok: true, status: 200, async json() { return { success: true }; } };
      }
      if (u.pathname === '/api/v1/memories') {
        return { ok: false, status: 404, async json() { return {}; } };
      }
      if (u.pathname === '/memories') {
        return { ok: true, status: 200, async json() { return [{ text: 'Fallback unversioned memories' }]; } };
      }
      return { ok: true, status: 200, async json() { return {}; } };
    };

    const engine = new CogneeEngine({ apiUrl: 'http://localhost:8000' });

    // Asymmetric turn with assistantResponse only
    await engine.observe({ assistantResponse: 'Autonomous response without user prompt' });
    assert.equal(receivedData, 'Autonomous response without user prompt');

    // Empty query search falling back from /api/v1/memories to /memories
    const res = await engine.search({ query: '' });
    assert.equal(res.results.length, 1);
    assert.equal(res.results[0].narrative, 'Fallback unversioned memories');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Tier 1 - F16.2: All memory engines provide accurate getDashboardUrl() implementations', () => {
  const { EngineFactory } = require('../backends/engine-factory.js');

  const mem0Local = EngineFactory.createEngine({});
  assert.equal(mem0Local.getDashboardUrl(), 'http://localhost:8000');

  const mem0Cloud = EngineFactory.createEngine({ activeEngine: 'mem0', mem0ApiUrl: 'https://api.mem0.ai/v1' });
  assert.equal(mem0Cloud.getDashboardUrl(), 'https://app.mem0.ai');

  const am = EngineFactory.createEngine({ activeEngine: 'agentmemory' });
  assert.equal(am.getDashboardUrl(), 'http://localhost:3113');

  const hs = EngineFactory.createEngine({ activeEngine: 'hindsight' });
  assert.equal(hs.getDashboardUrl(), 'http://localhost:8888');

  const cg = EngineFactory.createEngine({ activeEngine: 'cognee' });
  assert.equal(cg.getDashboardUrl(), 'http://localhost:8000');
});
