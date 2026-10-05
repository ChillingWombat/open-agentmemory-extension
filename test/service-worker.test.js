const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'service-worker.js'),
  'utf8'
);

function createHarness(options = {}) {
  const local = {};
  const session = {};
  const requests = [];
  const badge = {};
  let messageListener;

  function storageArea(values) {
    return {
      async get(keys) {
        const result = {};
        for (const key of Array.isArray(keys) ? keys : [keys]) {
          if (key in values) result[key] = values[key];
        }
        return result;
      },
      async set(next) {
        Object.assign(values, next);
      },
      async remove(keys) {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key];
      },
    };
  }

  const chrome = {
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
      local: storageArea(local),
      session: storageArea(session),
    },
  };

  async function defaultFetch(url, fetchOpts = {}) {
    requests.push({ url, options: fetchOpts });
    if (options.customFetch) {
      return options.customFetch(url, fetchOpts);
    }
    const parsed = new URL(url);
    const endpoint = parsed.pathname;

    // Mem0 mock responses
    if (url.includes('api.mem0.ai') || endpoint.includes('/memories')) {
      const authHeader = fetchOpts.headers?.Authorization || '';
      if (authHeader.includes('invalid') || authHeader.includes('bad-key')) {
        return {
          ok: false,
          status: 401,
          async json() { return { message: 'Invalid API Key' }; },
        };
      }
      if (endpoint.endsWith('/memories/search')) {
        return {
          ok: true,
          status: 200,
          async json() {
            return [
              {
                id: 'm-1',
                memory: 'User prefers dark mode and Python',
                score: 0.95,
                categories: ['preference'],
                metadata: {
                  title: 'Theme preference',
                  facts: ['Prefers dark mode', 'Uses Python'],
                  sessionId: 'session-xyz',
                  project: 'claude-web',
                },
                created_at: '2026-10-05T00:00:00Z',
              },
            ];
          },
        };
      }
      if (fetchOpts.method === 'GET') {
        return {
          ok: true,
          status: 200,
          async json() { return [{ id: 'probe-1', memory: 'probe memory' }]; },
        };
      }
      return {
        ok: true,
        status: 200,
        async json() { return { message: 'Memory created successfully', results: [{ id: 'm-2', event: 'ADD' }] }; },
      };
    }

    // AgentMemory mock responses
    if (endpoint.endsWith('/health')) {
      return {
        ok: true,
        status: 200,
        async json() { return { status: 'healthy', version: 'test' }; },
      };
    }

    if (endpoint.endsWith('/search')) {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            results: [
              {
                observation: {
                  id: 'obs-1',
                  title: 'Saved Memory',
                  subtitle: 'chatgpt-web',
                  narrative: 'AgentMemory observation content',
                  facts: ['Fact A', 'Fact B'],
                  sessionId: 'session-1',
                  score: 0.88,
                },
              },
            ],
          };
        },
      };
    }

    return {
      ok: true,
      status: 200,
      async json() { return { ok: true, success: true }; },
    };
  }

  const context = {
    AbortSignal,
    URL,
    chrome,
    console,
    fetch: defaultFetch,
    setTimeout,
    clearTimeout,
    importScripts: (...scripts) => {
      for (const script of scripts) {
        const fullPath = path.resolve(__dirname, '..', script);
        const code = fs.readFileSync(fullPath, 'utf8');
        vm.runInContext(code, context);
      }
    },
  };
  context.globalThis = context;

  vm.createContext(context);
  vm.runInContext(source, context);

  async function send(message) {
    return new Promise((resolve) => {
      messageListener(message, {}, resolve);
    });
  }

  return { badge, local, requests, send, session, context };
}

// ---------------------------------------------------------------------------
// Baseline Tests (AgentMemory & Daemon Routing)
// ---------------------------------------------------------------------------

test('rejects non-loopback daemon URLs', async () => {
  const harness = createHarness();
  const result = await harness.send({
    type: 'SET_SETTINGS',
    settings: { apiUrl: 'https://example.com' },
  });

  assert.match(result.error, /localhost/);
  assert.equal(harness.local.apiUrl, undefined);
});

test('normalizes loopback settings and stores the bearer secret', async () => {
  const harness = createHarness();
  const result = await harness.send({
    type: 'SET_SETTINGS',
    settings: {
      apiUrl: 'http://127.0.0.1:4111/path/',
      secret: '  local-secret  ',
    },
  });

  assert.equal(result.ok, true);
  assert.equal(harness.local.apiUrl, 'http://127.0.0.1:4111');
  assert.equal(harness.local.secret, 'local-secret');
});

test('defaults to Local Mem0 on http://localhost:8000 when unconfigured', async () => {
  const harness = createHarness();
  const result = await harness.send({ type: 'STATUS' });
  assert.equal(result.activeEngine, 'mem0');
  assert.match(result.apiUrl, /localhost:8000|127\.0\.0\.1:8000/);
});

test('uses authenticated health checks', async () => {
  const harness = createHarness();
  harness.local.activeEngine = 'agentmemory';
  harness.local.secret = 'secret';

  const result = await harness.send({ type: 'STATUS' });
  const request = harness.requests.at(-1);

  assert.equal(result.connected, true);
  assert.equal(request.options.method, 'GET');
  assert.equal(request.options.headers.Authorization, 'Bearer secret');
  assert.match(request.url, /\/agentmemory\/health$/);
});

test('captures observations with portable browser metadata', async () => {
  const harness = createHarness();
  harness.local.activeEngine = 'agentmemory';
  await harness.send({
    type: 'OBSERVE',
    platform: 'chatgpt',
    sessionId: 'session-1',
    content: 'User: hello\n\nAssistant: hi',
  });

  const request = harness.requests.at(-1);
  const body = JSON.parse(request.options.body);

  assert.equal(body.project, 'chatgpt-web');
  assert.equal(body.cwd, 'browser:chatgpt');
  assert.equal(body.data.prompt, 'User: hello\n\nAssistant: hi');
});

test('persists queue count for badge updates', async () => {
  const harness = createHarness();
  const result = await harness.send({ type: 'SET_QUEUE_COUNT', count: 3 });

  assert.equal(result.ok, true);
  assert.equal(harness.session.oamQueueCount, 3);
  assert.equal(harness.badge.text, '3');
});

// ---------------------------------------------------------------------------
// Milestone 1 Tests (Mem0 & Multi-Backend Architecture)
// ---------------------------------------------------------------------------

test('Mem0: rejects non-http/https endpoints and normalizes Cloud /v1 prefix', async () => {
  const harness = createHarness();

  // Non-HTTP/HTTPS protocol rejected
  const badResult = await harness.send({
    type: 'SET_SETTINGS',
    settings: { mem0ApiUrl: 'ftp://api.mem0.ai' },
  });
  assert.match(badResult.error, /http/);

  // Cloud URL without /v1 normalized in engine and stored properly
  const goodResult = await harness.send({
    type: 'SET_SETTINGS',
    settings: {
      activeEngine: 'mem0',
      mem0ApiUrl: 'https://api.mem0.ai/',
      mem0ApiKey: '  m0-secret-key  ',
      mem0UserId: '  user-42  ',
      mem0OrgId: 'org-1',
      mem0ProjectId: 'proj-1',
    },
  });

  assert.equal(goodResult.ok, true);
  assert.equal(harness.local.activeEngine, 'mem0');
  assert.equal(harness.local.mem0ApiKey, 'm0-secret-key');
  assert.equal(harness.local.mem0UserId, 'user-42');
  assert.equal(harness.local.mem0OrgId, 'org-1');
  assert.equal(harness.local.mem0ProjectId, 'proj-1');

  // Verify Mem0Engine class normalizes api.mem0.ai to https://api.mem0.ai/v1
  const engine = harness.context.EngineFactory.createEngine(harness.local);
  assert.equal(engine.apiUrl, 'https://api.mem0.ai/v1');
});

test('Mem0: health probe uses Token auth and reports connectivity', async () => {
  const harness = createHarness();
  harness.local.activeEngine = 'mem0';
  harness.local.mem0ApiUrl = 'https://api.mem0.ai/v1';
  harness.local.mem0ApiKey = 'm0-valid-key';
  harness.local.mem0UserId = 'alice';

  const result = await harness.send({ type: 'STATUS' });
  const request = harness.requests.at(-1);

  assert.equal(result.connected, true);
  assert.equal(result.activeEngine, 'mem0');
  assert.equal(request.options.method, 'GET');
  assert.equal(request.options.headers.Authorization, 'Token m0-valid-key');
  assert.match(request.url, /https:\/\/api\.mem0\.ai\/v1\/memories\?limit=1&user_id=alice/);
});

test('Mem0: health probe reports authentication failure on 401/403', async () => {
  const harness = createHarness();
  harness.local.activeEngine = 'mem0';
  harness.local.mem0ApiUrl = 'https://api.mem0.ai/v1';
  harness.local.mem0ApiKey = 'invalid-bad-key';
  harness.local.mem0UserId = 'alice';

  const result = await harness.send({ type: 'STATUS' });
  assert.equal(result.connected, false);
  assert.equal(result.activeEngine, 'mem0');
  assert.match(result.error, /Invalid Mem0 API Key/);
});

test('Mem0: parses dialogue turn into user and assistant messages for observation', async () => {
  const harness = createHarness();
  harness.local.activeEngine = 'mem0';
  harness.local.mem0ApiUrl = 'https://api.mem0.ai/v1';
  harness.local.mem0ApiKey = 'm0-test-key';
  harness.local.mem0UserId = 'charlie';

  await harness.send({
    type: 'OBSERVE',
    platform: 'claude',
    sessionId: 'session-mem0-1',
    content: 'User: How does Mem0 work?\n\nAssistant: Mem0 provides memory as a service.',
  });

  const request = harness.requests.at(-1);
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers.Authorization, 'Token m0-test-key');
  assert.match(request.url, /\/v1\/memories$/);

  const body = JSON.parse(request.options.body);
  assert.equal(body.user_id, 'charlie');
  assert.equal(body.metadata.platform, 'claude');
  assert.equal(body.metadata.sessionId, 'session-mem0-1');
  assert.equal(body.metadata.project, 'claude-web');
  assert.equal(body.metadata.cwd, 'browser:claude');
  assert.deepEqual(body.messages, [
    { role: 'user', content: 'How does Mem0 work?' },
    { role: 'assistant', content: 'Mem0 provides memory as a service.' },
  ]);
});

test('Mem0: parses distinct userPrompt and assistantResponse fields if provided', async () => {
  const harness = createHarness();
  harness.local.activeEngine = 'mem0';
  harness.local.mem0ApiUrl = 'https://api.mem0.ai/v1';
  harness.local.mem0ApiKey = 'm0-test-key';

  await harness.send({
    type: 'OBSERVE',
    platform: 'aistudio',
    sessionId: 'session-mem0-2',
    userPrompt: 'Explain quantum computing',
    assistantResponse: 'Quantum computers use qubits.',
  });

  const request = harness.requests.at(-1);
  const body = JSON.parse(request.options.body);
  assert.deepEqual(body.messages, [
    { role: 'user', content: 'Explain quantum computing' },
    { role: 'assistant', content: 'Quantum computers use qubits.' },
  ]);
});

test('Mem0: search queries POST /memories/search and normalizes results for popup', async () => {
  const harness = createHarness();
  harness.local.activeEngine = 'mem0';
  harness.local.mem0ApiUrl = 'https://api.mem0.ai/v1';
  harness.local.mem0ApiKey = 'm0-test-key';
  harness.local.mem0UserId = 'dave';

  const result = await harness.send({
    type: 'SEARCH',
    query: 'theme preference',
    limit: 5,
  });

  const request = harness.requests.at(-1);
  assert.equal(request.options.method, 'POST');
  assert.match(request.url, /\/v1\/memories\/search$/);

  const reqBody = JSON.parse(request.options.body);
  assert.equal(reqBody.query, 'theme preference');
  assert.equal(reqBody.user_id, 'dave');
  assert.equal(reqBody.limit, 5);

  assert.equal(Array.isArray(result.results), true);
  assert.equal(result.results.length, 1);
  const mem = result.results[0];
  assert.equal(mem.id, 'm-1');
  assert.equal(mem.title, 'Theme preference');
  assert.equal(mem.narrative, 'User prefers dark mode and Python');
  assert.deepEqual(mem.facts, ['Prefers dark mode', 'Uses Python']);
  assert.equal(mem.score, 0.95);
  assert.equal(mem.sessionId, 'session-xyz');
  assert.equal(mem.timestamp, '2026-10-05T00:00:00Z');
});

test('AgentMemory: preserves exact loopback backward compatibility for search and observe', async () => {
  const harness = createHarness();
  harness.local.activeEngine = 'agentmemory';
  harness.local.secret = 'test-secret';

  const searchResult = await harness.send({
    type: 'SEARCH',
    query: 'code',
    limit: 3,
  });

  const request = harness.requests.at(-1);
  assert.match(request.url, /\/agentmemory\/search$/);
  assert.equal(request.options.headers.Authorization, 'Bearer test-secret');

  assert.equal(searchResult.results.length, 1);
  const item = searchResult.results[0];
  assert.equal(item.id, 'obs-1');
  assert.equal(item.title, 'Saved Memory');
  assert.equal(item.narrative, 'AgentMemory observation content');
  assert.deepEqual(item.facts, ['Fact A', 'Fact B']);

  // Session start & end
  await harness.send({ type: 'SESSION_START', sessionId: 'sess-am-1', platform: 'gemini' });
  assert.match(harness.requests.at(-1).url, /\/agentmemory\/session\/start$/);

  await harness.send({ type: 'SESSION_END', sessionId: 'sess-am-1' });
  assert.match(harness.requests.at(-1).url, /\/agentmemory\/session\/end$/);
});

test('EngineFactory: dynamically switches active engines based on stored settings', async () => {
  const harness = createHarness();
  const { EngineFactory, AgentMemoryEngine, Mem0Engine, HindsightEngine, CogneeEngine } = harness.context;

  // Default is Local Mem0 on localhost:8000
  const engine1 = EngineFactory.createEngine({});
  assert.equal(engine1 instanceof Mem0Engine, true);
  assert.equal(engine1.apiUrl, 'http://localhost:8000');

  // Mem0 engine with custom config
  const engine2 = EngineFactory.createEngine({
    activeEngine: 'mem0',
    mem0ApiUrl: 'http://localhost:8080',
    mem0ApiKey: 'key-123',
    mem0UserId: 'custom-user',
  });
  assert.equal(engine2 instanceof Mem0Engine, true);
  assert.equal(engine2.apiUrl, 'http://localhost:8080');
  assert.equal(engine2.apiKey, 'key-123');
  assert.equal(engine2.userId, 'custom-user');

  // Hindsight engine
  const engineHindsight = EngineFactory.createEngine({
    activeEngine: 'hindsight',
    hindsightApiUrl: 'http://localhost:8888',
    hindsightApiKey: 'hs-secret',
    hindsightBankId: 'research',
  });
  assert.equal(engineHindsight instanceof HindsightEngine, true);
  assert.equal(engineHindsight.apiUrl, 'http://localhost:8888');
  assert.equal(engineHindsight.apiKey, 'hs-secret');
  assert.equal(engineHindsight.bankId, 'research');

  // Cognee engine
  const engineCognee = EngineFactory.createEngine({
    activeEngine: 'cognee',
    cogneeApiUrl: 'http://localhost:8000',
    cogneeApiKey: 'cg-key',
    cogneeDatasetName: 'project-a',
  });
  assert.equal(engineCognee instanceof CogneeEngine, true);
  assert.equal(engineCognee.apiUrl, 'http://localhost:8000');
  assert.equal(engineCognee.apiKey, 'cg-key');
  assert.equal(engineCognee.datasetName, 'project-a');

  // Dynamic switch via SET_SETTINGS to Mem0
  await harness.send({
    type: 'SET_SETTINGS',
    settings: { activeEngine: 'mem0', mem0ApiUrl: 'https://api.mem0.ai/v1', mem0ApiKey: 'switched-key' },
  });
  assert.equal(harness.local.activeEngine, 'mem0');

  // Status now probes Mem0
  const statusRes = await harness.send({ type: 'STATUS' });
  assert.equal(statusRes.activeEngine, 'mem0');
  assert.match(harness.requests.at(-1).url, /mem0\.ai/);

  // Switch to Hindsight
  await harness.send({
    type: 'SET_SETTINGS',
    settings: { activeEngine: 'hindsight', hindsightApiUrl: 'http://localhost:8888' },
  });
  assert.equal(harness.local.activeEngine, 'hindsight');
  const statusHs = await harness.send({ type: 'STATUS' });
  assert.equal(statusHs.activeEngine, 'hindsight');
  assert.match(harness.requests.at(-1).url, /:8888\/health$/);

  // Switch to Cognee
  await harness.send({
    type: 'SET_SETTINGS',
    settings: { activeEngine: 'cognee', cogneeApiUrl: 'http://localhost:8000' },
  });
  assert.equal(harness.local.activeEngine, 'cognee');
  const statusCg = await harness.send({ type: 'STATUS' });
  assert.equal(statusCg.activeEngine, 'cognee');
  assert.match(harness.requests.at(-1).url, /:8000\/(api\/v1\/)?health$/);

  // Switch back to AgentMemory
  await harness.send({
    type: 'SET_SETTINGS',
    settings: { activeEngine: 'agentmemory' },
  });
  assert.equal(harness.local.activeEngine, 'agentmemory');
  const statusRes2 = await harness.send({ type: 'STATUS' });
  assert.equal(statusRes2.activeEngine, 'agentmemory');
  assert.match(harness.requests.at(-1).url, /\/agentmemory\/health$/);
});

test('Hindsight: service worker observe and search routing', async () => {
  const harness = createHarness();
  await harness.send({
    type: 'SET_SETTINGS',
    settings: { activeEngine: 'hindsight', hindsightApiUrl: 'http://localhost:8888' },
  });

  const obs = await harness.send({
    type: 'OBSERVE',
    platform: 'gemini',
    content: 'User: Hello\n\nAssistant: Hi there',
    sessionId: 'sess-hs-1',
  });
  assert.equal(obs.success, true);

  const search = await harness.send({
    type: 'SEARCH',
    query: '',
    limit: 5,
  });
  assert.ok(Array.isArray(search.results));
});

test('Cognee: service worker observe and search routing', async () => {
  const harness = createHarness();
  await harness.send({
    type: 'SET_SETTINGS',
    settings: { activeEngine: 'cognee', cogneeApiUrl: 'http://localhost:8000' },
  });

  const obs = await harness.send({
    type: 'OBSERVE',
    platform: 'chatgpt',
    content: 'User: Question\n\nAssistant: Answer',
    sessionId: 'sess-cg-1',
  });
  assert.equal(obs.success, true);

  const search = await harness.send({
    type: 'SEARCH',
    query: 'Question',
    limit: 5,
  });
  assert.ok(Array.isArray(search.results));
});

test('Mem0: supports existing Bearer or Token prefix in apiKey', async () => {
  const harness = createHarness();
  const { Mem0Engine } = harness.context;

  const engineToken = new Mem0Engine({ apiKey: 'raw-key' });
  assert.equal(engineToken._headers()['Authorization'], 'Token raw-key');

  const engineBearer = new Mem0Engine({ apiKey: 'Bearer jwt-token' });
  assert.equal(engineBearer._headers()['Authorization'], 'Bearer jwt-token');

  const engineExplicitToken = new Mem0Engine({ apiKey: 'Token token-value' });
  assert.equal(engineExplicitToken._headers()['Authorization'], 'Token token-value');
});

test('service-worker: localArchiveEnabled setting toggles LocalArchive.saveTurn in OBSERVE', async () => {
  const harness = createHarness();
  const { LocalArchive } = harness.context;

  // 1. Initial settings should default localArchiveEnabled to true
  const initialSettings = await harness.send({ type: 'GET_SETTINGS' });
  assert.equal(initialSettings.localArchiveEnabled, true);

  // 2. Disable local archiving
  const setRes = await harness.send({
    type: 'SET_SETTINGS',
    settings: { localArchiveEnabled: false },
  });
  assert.equal(setRes.ok, true);
  assert.equal(harness.local.localArchiveEnabled, false);

  // 3. OBSERVE turn while localArchiveEnabled is false
  let turnSaved = false;
  const originalSaveTurn = LocalArchive.saveTurn;
  LocalArchive.saveTurn = async () => {
    turnSaved = true;
    return { ok: true };
  };

  try {
    await harness.send({
      type: 'OBSERVE',
      platform: 'gemini',
      sessionId: 'sess-privacy-1',
      content: 'User: Private turn\n\nAssistant: Zero retention response',
    });
    assert.equal(turnSaved, false, 'LocalArchive.saveTurn must be skipped when localArchiveEnabled is false');

    // 4. Re-enable local archiving
    await harness.send({
      type: 'SET_SETTINGS',
      settings: { localArchiveEnabled: true },
    });
    assert.equal(harness.local.localArchiveEnabled, true);

    await harness.send({
      type: 'OBSERVE',
      platform: 'gemini',
      sessionId: 'sess-privacy-2',
      content: 'User: Normal turn\n\nAssistant: Normal response',
    });
    assert.equal(turnSaved, true, 'LocalArchive.saveTurn must run when localArchiveEnabled is true');
  } finally {
    LocalArchive.saveTurn = originalSaveTurn;
  }
});

test('service-worker: STATUS provides dashboardUrl for all active engines', async () => {
  const harness = createHarness();

  // Mem0 self-hosted (default)
  const statusMem0 = await harness.send({ type: 'STATUS' });
  assert.equal(statusMem0.dashboardUrl, 'http://localhost:8000');

  // AgentMemory
  await harness.send({ type: 'SET_SETTINGS', settings: { activeEngine: 'agentmemory' } });
  const statusAm = await harness.send({ type: 'STATUS' });
  assert.equal(statusAm.dashboardUrl, 'http://localhost:3113');

  // Hindsight
  await harness.send({ type: 'SET_SETTINGS', settings: { activeEngine: 'hindsight', hindsightApiUrl: 'http://localhost:8888' } });
  const statusHs = await harness.send({ type: 'STATUS' });
  assert.equal(statusHs.dashboardUrl, 'http://localhost:8888');

  // Cognee
  await harness.send({ type: 'SET_SETTINGS', settings: { activeEngine: 'cognee', cogneeApiUrl: 'http://localhost:8000' } });
  const statusCg = await harness.send({ type: 'STATUS' });
  assert.equal(statusCg.dashboardUrl, 'http://localhost:8000');
});

test('Engines: _normalizeItem safely handles string primitives and null inputs', () => {
  const harness = createHarness();
  const { Mem0Engine, HindsightEngine, CogneeEngine } = harness.context;

  const m0 = new Mem0Engine({});
  const hs = new HindsightEngine({});
  const cg = new CogneeEngine({});

  // String primitive normalization
  const normM0 = m0._normalizeItem('Simple string memory from vector store');
  assert.equal(normM0.narrative, 'Simple string memory from vector store');
  assert.equal(normM0.title, 'Simple string memory from vector store');
  assert.equal(normM0.facts.length, 1);
  assert.equal(normM0.facts[0], 'Simple string memory from vector store');

  const normHs = hs._normalizeItem('Hindsight string chunk');
  assert.equal(normHs.narrative, 'Hindsight string chunk');
  assert.equal(normHs.title, 'Hindsight string chunk');
  assert.equal(normHs.facts.length, 1);
  assert.equal(normHs.facts[0], 'Hindsight string chunk');

  const normCg = cg._normalizeItem('Knowledge graph edge fact string');
  assert.equal(normCg.narrative, 'Knowledge graph edge fact string');
  assert.equal(normCg.title, 'Knowledge graph edge fact string');
  assert.equal(normCg.facts.length, 1);
  assert.equal(normCg.facts[0], 'Knowledge graph edge fact string');

  // Null input safety
  assert.doesNotThrow(() => m0._normalizeItem(null));
  assert.doesNotThrow(() => hs._normalizeItem(null));
  assert.doesNotThrow(() => cg._normalizeItem(null));
});
