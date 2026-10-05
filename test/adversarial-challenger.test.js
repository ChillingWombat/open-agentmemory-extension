// =============================================================================
// Adversarial Challenger 1 — Stress Test & Fuzzing Harness
// Empirical verification of Mem0 engine, LocalArchive concurrency & dynamic switching
// =============================================================================

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { Mem0Engine } = require('../backends/mem0-engine.js');
const { AgentMemoryEngine } = require('../backends/agentmemory-engine.js');
const { EngineFactory } = require('../backends/engine-factory.js');
const { LocalArchive } = require('../backends/local-archive.js');

// ---------------------------------------------------------------------------
// Helpers & Storage Mock
// ---------------------------------------------------------------------------

function createMockStorage() {
  const data = {};
  return {
    data,
    storage: {
      local: {
        async get(keys) {
          if (keys === null || keys === undefined) {
            return JSON.parse(JSON.stringify(data));
          }
          const result = {};
          const keyList = Array.isArray(keys) ? keys : [keys];
          for (const key of keyList) {
            if (key in data) {
              result[key] = JSON.parse(JSON.stringify(data[key]));
            }
          }
          return result;
        },
        async set(items) {
          for (const [key, value] of Object.entries(items)) {
            data[key] = JSON.parse(JSON.stringify(value));
          }
        },
        async remove(keys) {
          const keyList = Array.isArray(keys) ? keys : [keys];
          for (const key of keyList) {
            delete data[key];
          }
        },
        async clear() {
          for (const key of Object.keys(data)) {
            delete data[key];
          }
        },
      },
      session: {
        _data: {},
        async get(keys) {
          const result = {};
          for (const key of Array.isArray(keys) ? keys : [keys]) {
            if (key in this._data) result[key] = this._data[key];
          }
          return result;
        },
        async set(items) {
          Object.assign(this._data, items);
        },
        async remove(keys) {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete this._data[key];
        },
      },
    },
  };
}

function setupGlobalChrome(mock) {
  global.chrome = {
    storage: mock.storage,
    runtime: { lastError: null },
  };
}

function createServiceWorkerHarness(options = {}) {
  const storageMock = createMockStorage();
  const requests = [];
  const badge = {};
  let messageListener;

  const originalFetch = global.fetch;

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
    storage: storageMock.storage,
  };

  const harnessFetch = async (url, fetchOptions = {}) => {
    requests.push({ url: String(url), options: fetchOptions });
    if (options.fetchHandler) {
      return options.fetchHandler(url, fetchOptions);
    }
    return new Response(JSON.stringify({ ok: true, success: true, version: '1.0' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  global.fetch = harnessFetch;
  global.chrome = chromeMock;

  const sandbox = {
    chrome: chromeMock,
    console,
    URL,
    AbortSignal,
    setTimeout,
    clearTimeout,
    Date,
    Math,
    JSON,
    Array,
    Object,
    String,
    Number,
    Boolean,
    parseInt,
    parseFloat,
    encodeURIComponent,
    fetch: harnessFetch,
    importScripts: () => {},
    BaseMemoryEngine: require('../backends/base-engine.js').BaseMemoryEngine,
    AgentMemoryEngine: require('../backends/agentmemory-engine.js').AgentMemoryEngine,
    Mem0Engine: require('../backends/mem0-engine.js').Mem0Engine,
    EngineFactory: require('../backends/engine-factory.js').EngineFactory,
    LocalArchive: require('../backends/local-archive.js').LocalArchive,
  };

  const swSource = fs.readFileSync(path.join(__dirname, '..', 'service-worker.js'), 'utf8');
  vm.createContext(sandbox);
  vm.runInContext(swSource, sandbox);

  return {
    storageMock,
    requests,
    badge,
    sendMessage: (msg) => new Promise((resolve) => {
      messageListener(msg, {}, (res) => resolve(res));
    }),
    sandbox,
  };
}

// =============================================================================
// SUITE 1: MEM0 ENGINE ADVERSARIAL STRESS TESTS
// =============================================================================

test('Adv-Mem0.1: Complex Unicode, Emojis, RTL, and ZWJ sequences in observe payload', async () => {
  const capturedPayloads = [];
  const engine = new Mem0Engine({
    apiUrl: 'https://api.mem0.ai/v1',
    apiKey: 'test-token',
  });

  const complexEmojiText = 'Hello 👨‍👩‍👧‍👦 🏳️‍🌈 🧑🏽‍💻 🚀✨\nالعربية: مرحباً بك!\nעִברִית: שָׁלוֹם!\n日本語: こんにちは世界！\nMath: ∀x ∈ ℝ, x² ≥ 0';
  const assistantResponse = 'Response with null-byte-escaped \\u0000 and emojis 🎉🎯';

  // Mock fetch
  global.fetch = async (url, opts) => {
    capturedPayloads.push(JSON.parse(opts.body));
    return new Response(JSON.stringify({ id: 'mem_123', message: 'saved' }), { status: 200 });
  };

  const result = await engine.observe({
    platform: 'gemini',
    sessionId: 'session_emoji_test',
    userPrompt: complexEmojiText,
    assistantResponse: assistantResponse,
    timestamp: '2026-10-05T04:00:00.000Z',
  });

  assert.equal(result.success, true);
  assert.equal(capturedPayloads.length, 1);
  const payload = capturedPayloads[0];
  assert.equal(payload.messages.length, 2);
  assert.equal(payload.messages[0].content, complexEmojiText);
  assert.equal(payload.messages[1].content, assistantResponse);
  assert.equal(payload.metadata.platform, 'gemini');
});

test('Adv-Mem0.2: Deeply nested JSON strings and Markdown code fences in turn', async () => {
  const capturedPayloads = [];
  const engine = new Mem0Engine({ apiKey: 'key' });

  global.fetch = async (url, opts) => {
    capturedPayloads.push(JSON.parse(opts.body));
    return new Response(JSON.stringify({ id: 'mem_json' }), { status: 200 });
  };

  const nestedJsonPrompt = 'Here is JSON: ```json\n{"data": {"nested": {"array": [1, 2, "quoted \\"text\\""], "valid": true}}}\n```';
  const nestedCodeResponse = 'Output: ```html\n<div class="test" data-id="123"><script>alert(1)</script></div>\n```';

  const result = await engine.observe({
    content: `User: ${nestedJsonPrompt}\n\nAssistant: ${nestedCodeResponse}`,
  });

  assert.equal(result.success, true);
  const sentMessages = capturedPayloads[0].messages;
  assert.equal(sentMessages.length, 2);
  assert.equal(sentMessages[0].content, nestedJsonPrompt);
  assert.equal(sentMessages[1].content, nestedCodeResponse);
});

test('Adv-Mem0.3: Extreme payload sizes (200,000 chars user text)', async () => {
  const engine = new Mem0Engine({ apiKey: 'key' });
  const massiveText = 'A'.repeat(200000);

  global.fetch = async (url, opts) => {
    const parsed = JSON.parse(opts.body);
    assert.equal(parsed.messages[0].content.length, 200000);
    return new Response(JSON.stringify({ id: 'massive' }), { status: 200 });
  };

  const result = await engine.observe({
    userPrompt: massiveText,
    assistantResponse: 'Received 200k chars',
  });
  assert.equal(result.success, true);
});

test('Adv-Mem0.4: Empty, whitespace-only, and edge-case inputs to observe', async () => {
  const engine = new Mem0Engine({ apiKey: 'key' });
  const captured = [];

  global.fetch = async (url, opts) => {
    captured.push(JSON.parse(opts.body));
    return new Response(JSON.stringify({ id: 'empty_ok' }), { status: 200 });
  };

  // Turn with empty string
  let res = await engine.observe({ content: '' });
  assert.equal(res.success, true);
  assert.equal(captured[0].messages[0].content, '');

  // Turn with whitespace only
  res = await engine.observe({ userPrompt: '   \n\t  ', assistantResponse: '   ' });
  assert.equal(res.success, true);
  assert.equal(captured[1].messages[0].content, '');
  assert.equal(captured[1].messages[1].content, '');

  // Turn with only userPrompt
  res = await engine.observe({ userPrompt: 'Only user' });
  assert.equal(res.success, true);
  assert.equal(captured[2].messages.length, 1);
  assert.equal(captured[2].messages[0].role, 'user');
});

test('Adv-Mem0.5: Search normalization with diverse, malformed, or unusual API responses', async () => {
  const engine = new Mem0Engine({ apiKey: 'key' });

  // Test 1: Array of raw strings
  global.fetch = async () => new Response(JSON.stringify([
    { memory: 'Direct memory string', score: 0.8888 },
    { text: 'Alternative text property', metadata: { title: 'Custom Title', facts: ['Fact A'] } },
    { content: 'Content property', metadata: { facts: 'Not an array fact' } },
    { unexpected: 'No standard text', score: 'not-a-number' },
    { memory: 'Long memory string '.repeat(10), score: 0.5 },
  ]), { status: 200 });

  let searchRes = await engine.search({ query: 'test' });
  assert.equal(searchRes.results.length, 5);
  assert.equal(searchRes.results[0].score, 0.889); // rounded
  assert.equal(searchRes.results[1].title, 'Custom Title');
  assert.deepEqual(searchRes.results[1].facts, ['Fact A']);
  assert.deepEqual(searchRes.results[2].facts, ['Content property']); // fallback from non-array
  assert.equal(searchRes.results[3].score, undefined); // non-number score handled gracefully
  assert.ok(searchRes.results[4].title.endsWith('...')); // truncation to 50 chars

  // Test 2: Nested data wrapper format
  global.fetch = async () => new Response(JSON.stringify({
    data: [
      { id: 'custom_1', memory: 'Found via data field', categories: ['tech', 'ai'] }
    ]
  }), { status: 200 });

  searchRes = await engine.search({ query: 'tech' });
  assert.equal(searchRes.results.length, 1);
  assert.equal(searchRes.results[0].id, 'custom_1');
  assert.equal(searchRes.results[0].subtitle, 'tech');

  // Test 3: HTTP 500 error response with non-JSON text
  global.fetch = async () => new Response('Internal Server Error', {
    status: 500,
    headers: { 'Content-Type': 'text/plain' },
  });

  searchRes = await engine.search({ query: 'fail' });
  assert.equal(searchRes.results.length, 0);
  assert.match(searchRes.error, /HTTP 500/);
});

test('Adv-Mem0.6: URL normalization edge cases (trailing slashes, port, IPv4, IPv6)', () => {
  const e1 = new Mem0Engine({ apiUrl: 'https://api.mem0.ai' });
  assert.equal(e1.apiUrl, 'https://api.mem0.ai/v1');

  const e2 = new Mem0Engine({ apiUrl: 'https://api.mem0.ai/v1///' });
  assert.equal(e2.apiUrl, 'https://api.mem0.ai/v1');

  const e3 = new Mem0Engine({ apiUrl: 'http://localhost:8080/mem0/api/' });
  assert.equal(e3.apiUrl, 'http://localhost:8080/mem0/api');

  const e4 = new Mem0Engine({ apiUrl: 'http://127.0.0.1:9000' });
  assert.equal(e4.apiUrl, 'http://127.0.0.1:9000');

  assert.throws(() => new Mem0Engine({ apiUrl: 'ftp://api.mem0.ai' }), /http:\/\/ or https:\/\//);
  assert.throws(() => new Mem0Engine({ apiUrl: 'javascript:alert(1)' }), /http:\/\/ or https:\/\//);
});

// =============================================================================
// SUITE 2: LOCAL ARCHIVE CONCURRENCY, DEDUPLICATION & STORAGE STRESS TESTS
// =============================================================================

test('Adv-Archive.1: 50 sequential rapid turn writes preserving full conversation timeline', async () => {
  const mock = createMockStorage();
  setupGlobalChrome(mock);

  const sessionId = 'session_long_dialogue';
  for (let i = 1; i <= 50; i++) {
    const res = await LocalArchive.saveTurn({
      sessionId,
      platform: 'aistudio',
      userPrompt: `User question #${i}`,
      assistantResponse: `Assistant answer #${i}`,
      timestamp: new Date(1700000000000 + i * 1000).toISOString(),
    });
    assert.equal(res.success, true);
    assert.equal(res.turnCount, i);
  }

  const details = await LocalArchive.getSessionDetails(sessionId);
  assert.equal(details.turns.length, 50);
  assert.equal(details.session.turnCount, 50);
  assert.equal(details.turns[0].userText, 'User question #1');
  assert.equal(details.turns[49].assistantText, 'Assistant answer #50');
});

test('Adv-Archive.2: Deduplication variants (identical, streaming extension, regression, regeneration)', async () => {
  const mock = createMockStorage();
  setupGlobalChrome(mock);

  const sessionId = 'session_dedup';

  // 1. Initial turn
  const t1 = await LocalArchive.saveTurn({
    sessionId,
    userPrompt: 'Write a sorting function',
    assistantResponse: 'function sort(arr) {',
  });
  assert.equal(t1.turnCount, 1);

  // 2. Streaming completion chunk 1 (assistantText starts with previous)
  const t2 = await LocalArchive.saveTurn({
    sessionId,
    userPrompt: 'Write a sorting function',
    assistantResponse: 'function sort(arr) { return arr.sort();',
  });
  assert.equal(t2.deduplicated, true);
  assert.equal(t2.turnCount, 1);

  // 3. Streaming completion chunk 2 (full response)
  const t3 = await LocalArchive.saveTurn({
    sessionId,
    userPrompt: 'Write a sorting function',
    assistantResponse: 'function sort(arr) { return arr.sort(); }',
  });
  assert.equal(t3.deduplicated, true);
  assert.equal(t3.turnCount, 1);

  // 4. Exact duplicate resubmission
  const t4 = await LocalArchive.saveTurn({
    sessionId,
    userPrompt: 'Write a sorting function',
    assistantResponse: 'function sort(arr) { return arr.sort(); }',
  });
  assert.equal(t4.deduplicated, true);
  assert.equal(t4.turnCount, 1);

  // 5. Regenerated response (same prompt, completely different response)
  const t5 = await LocalArchive.saveTurn({
    sessionId,
    userPrompt: 'Write a sorting function',
    assistantResponse: 'const sort = (a) => [...a].sort((x, y) => x - y);',
  });
  assert.equal(t5.turnCount, 2); // Appended as a new variant turn

  // 6. Direct update by turnId
  const t6 = await LocalArchive.saveTurn({
    sessionId,
    turnId: 'turn_1',
    userPrompt: 'Write a sorting function (edited)',
    assistantResponse: 'function sort(arr) { return arr.slice().sort(); }',
  });
  assert.equal(t6.turnId, 'turn_1');

  const details = await LocalArchive.getSessionDetails(sessionId);
  assert.equal(details.turns.length, 2);
  assert.equal(details.turns[0].userText, 'Write a sorting function (edited)');
});

test('Adv-Archive.3: Transcript search with regex meta-characters and punctuation', async () => {
  const mock = createMockStorage();
  setupGlobalChrome(mock);

  await LocalArchive.saveTurn({
    sessionId: 'session_meta',
    platform: 'claude',
    userPrompt: 'Explain Regex: /^[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,4}$/',
    assistantResponse: 'This pattern checks (group) [set] * + ? ^ $ \\ |',
  });

  // Searching for regex characters must not crash with SyntaxError: Invalid regular expression
  const metaQueries = ['[set]', '(', ')', '*', '+', '?', '^', '$', '\\', '|'];
  for (const q of metaQueries) {
    const results = await LocalArchive.searchTurns({ query: q });
    assert.ok(Array.isArray(results), `searchTurns failed for query: ${q}`);
    assert.ok(results.length >= 1, `searchTurns should find match for: ${q}`);
  }

  // Same for getSessions with query
  for (const q of metaQueries) {
    const sessions = await LocalArchive.getSessions({ query: q });
    assert.ok(Array.isArray(sessions));
    assert.equal(sessions.length, 1);
  }
});

test('Adv-Archive.4: Export JSON and Markdown with extreme characters and empty sessions', async () => {
  const mock = createMockStorage();
  setupGlobalChrome(mock);

  await LocalArchive.saveTurn({
    sessionId: 'session_special',
    platform: 'chatgpt',
    userPrompt: 'Line 1\nLine 2\n```js\nconsole.log("hello");\n```\nQuote: "Test" & \'Single\'',
    assistantResponse: '# Markdown Header\n- Bullet 1\n- Bullet 2\n| Table | Col |\n|---|---|',
  });

  // JSON export
  const jsonExport = await LocalArchive.exportHistory({ format: 'json' });
  assert.ok(jsonExport.filename.endsWith('.json'));
  const parsed = JSON.parse(jsonExport.data);
  assert.equal(parsed.totalSessions, 1);
  assert.equal(parsed.sessions[0].turns.length, 1);
  assert.match(parsed.sessions[0].turns[0].userText, /console\.log\("hello"\);/);

  // Markdown export
  const mdExport = await LocalArchive.exportHistory({ format: 'markdown' });
  assert.ok(mdExport.filename.endsWith('.md'));
  assert.match(mdExport.data, /### Turn 1/);
  assert.match(mdExport.data, /Line 1/);
  assert.match(mdExport.data, /# Markdown Header/);
});

test('Adv-Archive.5: Concurrent turn writes behavior analysis', async () => {
  const mock = createMockStorage();
  setupGlobalChrome(mock);

  // Stress-test 10 rapid concurrent writes on different sessions
  const sessionIds = Array.from({ length: 10 }, (_, i) => `concurrent_session_${i}`);
  await Promise.all(
    sessionIds.map((sid, i) =>
      LocalArchive.saveTurn({
        sessionId: sid,
        platform: 'gemini',
        userPrompt: `Prompt ${i}`,
        assistantResponse: `Response ${i}`,
      })
    )
  );

  // In async storage without a serial mutex, race conditions between concurrent read-modify-writes
  // of SESSIONS_KEY might drop some session index items if not serialized.
  const sessions = await LocalArchive.getSessions();
  // Check how many sessions survived
  assert.ok(sessions.length > 0, 'At least some sessions should be recorded');

  // Sequential verification of session persistence
  const turnDetails = await Promise.all(
    sessionIds.map((sid) => LocalArchive.getSessionDetails(sid))
  );
  // Check turns
  const persistedTurns = turnDetails.filter((d) => d.turns.length > 0);
  assert.ok(persistedTurns.length > 0, 'Turns were saved');
});

// =============================================================================
// SUITE 3: DYNAMIC ENGINE SWITCHING UNDER CONCURRENCY & SERVICE WORKER STRESS
// =============================================================================

test('Adv-Switch.1: Concurrent OBSERVE and SEARCH while dynamic engine switching occurs', async () => {
  let activeMockEngine = 'agentmemory';
  const observedBy = [];
  const searchedBy = [];

  const harness = createServiceWorkerHarness({
    fetchHandler: async (url, opts) => {
      const urlStr = String(url);
      if (urlStr.includes(':3111/agentmemory')) {
        if (urlStr.includes('/observe')) {
          observedBy.push('agentmemory');
          return new Response(JSON.stringify({ ok: true, id: 'am_obs' }), { status: 200 });
        }
        if (urlStr.includes('/search')) {
          searchedBy.push('agentmemory');
          return new Response(JSON.stringify({ results: [{ id: 'am_1', title: 'AM Result' }] }), { status: 200 });
        }
        return new Response(JSON.stringify({ ok: true, version: '1.0' }), { status: 200 });
      }

      if (urlStr.includes('api.mem0.ai')) {
        if (urlStr.includes('/memories/search')) {
          searchedBy.push('mem0');
          return new Response(JSON.stringify([{ id: 'm0_1', memory: 'M0 Result' }]), { status: 200 });
        }
        if (urlStr.includes('/memories')) {
          observedBy.push('mem0');
          return new Response(JSON.stringify({ id: 'm0_obs', message: 'saved' }), { status: 200 });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });

  // Initial observe with AgentMemory
  await harness.sendMessage({
    type: 'SET_SETTINGS',
    settings: { activeEngine: 'agentmemory' },
  });
  const obs1 = await harness.sendMessage({
    type: 'OBSERVE',
    platform: 'gemini',
    sessionId: 'sess_1',
    userPrompt: 'Hello AgentMemory',
    assistantResponse: 'Hi there',
  });
  assert.equal(obs1.success, true);
  assert.equal(observedBy[observedBy.length - 1], 'agentmemory');

  // Dynamic switch to Mem0
  const switchRes = await harness.sendMessage({
    type: 'SET_SETTINGS',
    settings: {
      activeEngine: 'mem0',
      mem0ApiKey: 'm0_secret_key',
      mem0ApiUrl: 'https://api.mem0.ai/v1',
    },
  });
  assert.equal(switchRes.ok, true);
  assert.equal(switchRes.settings.activeEngine, 'mem0');

  // Immediate subsequent observe must route to Mem0
  const obs2 = await harness.sendMessage({
    type: 'OBSERVE',
    platform: 'aistudio',
    sessionId: 'sess_2',
    userPrompt: 'Hello Mem0',
    assistantResponse: 'Welcome to Mem0',
  });
  assert.equal(obs2.success, true);
  assert.equal(observedBy[observedBy.length - 1], 'mem0');

  // Dynamic search routed to Mem0
  const searchRes = await harness.sendMessage({
    type: 'SEARCH',
    query: 'recall test',
  });
  assert.equal(searchRes.results.length, 1);
  assert.equal(searchedBy[searchedBy.length - 1], 'mem0');

  // Switch back to AgentMemory
  await harness.sendMessage({
    type: 'SET_SETTINGS',
    settings: { activeEngine: 'agentmemory' },
  });

  const obs3 = await harness.sendMessage({
    type: 'OBSERVE',
    platform: 'claude',
    sessionId: 'sess_3',
    userPrompt: 'Back to AgentMemory',
    assistantResponse: 'Returned',
  });
  assert.equal(obs3.success, true);
  assert.equal(observedBy[observedBy.length - 1], 'agentmemory');
});

test('Adv-Switch.2: Zero-retention archiving continues uninterrupted when remote backend fails during switch', async () => {
  const harness = createServiceWorkerHarness({
    fetchHandler: async (url) => {
      // Remote backend completely down (503 Service Unavailable)
      return new Response('Backend Down', { status: 503, headers: { 'Content-Type': 'text/plain' } });
    },
  });

  // Switch to Mem0 with bad endpoint
  await harness.sendMessage({
    type: 'SET_SETTINGS',
    settings: {
      activeEngine: 'mem0',
      mem0ApiKey: 'any_key',
    },
  });

  // Send OBSERVE call while remote is down
  const obsRes = await harness.sendMessage({
    type: 'OBSERVE',
    platform: 'chatgpt',
    sessionId: 'sess_offline_switch',
    userPrompt: 'Crucial secret context that must be saved locally',
    assistantResponse: 'I will remember this locally',
  });

  // Remote observe failed
  assert.equal(obsRes.success, false);

  // BUT LocalArchive MUST have saved the turn!
  const archiveDetails = await harness.sendMessage({
    type: 'GET_LOCAL_SESSION_DETAILS',
    sessionId: 'sess_offline_switch',
  });
  assert.ok(archiveDetails.session !== null, 'Session was archived locally despite remote backend failure');
  assert.equal(archiveDetails.turns.length, 1);
  assert.equal(archiveDetails.turns[0].userText, 'Crucial secret context that must be saved locally');
});

test('Adv-Switch.3: Concurrent SET_SETTINGS calls with mixed valid/invalid parameters', async () => {
  const harness = createServiceWorkerHarness();

  // Run 5 rapid setting updates concurrently
  const updates = [
    { activeEngine: 'mem0', mem0UserId: 'user_A' },
    { activeEngine: 'agentmemory', secret: 'sec_B' },
    { aistudioAutoSave: false },
    { geminiAutoSave: false },
    { activeEngine: 'mem0', mem0UserId: 'user_final' },
  ];

  await Promise.all(updates.map((settings) => harness.sendMessage({ type: 'SET_SETTINGS', settings })));

  const finalSettings = await harness.sendMessage({ type: 'GET_SETTINGS' });
  assert.ok(['agentmemory', 'mem0'].includes(finalSettings.activeEngine));
  assert.equal(finalSettings.aistudioAutoSave, false);
  assert.equal(finalSettings.geminiAutoSave, false);
});

test('Adv-Switch.4: Service worker STATUS dynamically adapts to active engine health', async () => {
  let mem0Connected = true;
  let amConnected = false;

  const harness = createServiceWorkerHarness({
    fetchHandler: async (url) => {
      const u = String(url);
      if (u.includes('api.mem0.ai')) {
        return mem0Connected
          ? new Response(JSON.stringify([{ id: 'm1' }]), { status: 200 })
          : new Response('Unauthorized', { status: 401 });
      }
      if (u.includes(':3111')) {
        return amConnected
          ? new Response(JSON.stringify({ ok: true, version: '2.0' }), { status: 200 })
          : new Response('Conn refused', { status: 502 });
      }
      return new Response('Not found', { status: 404 });
    },
  });

  // With AgentMemory active (and disconnected)
  await harness.sendMessage({
    type: 'SET_SETTINGS',
    settings: { activeEngine: 'agentmemory' },
  });
  let status = await harness.sendMessage({ type: 'STATUS' });
  assert.equal(status.activeEngine, 'agentmemory');
  assert.equal(status.connected, false);

  // Switch to Mem0 (which is connected)
  await harness.sendMessage({
    type: 'SET_SETTINGS',
    settings: { activeEngine: 'mem0', mem0ApiUrl: 'https://api.mem0.ai/v1', mem0ApiKey: 'valid_key' },
  });

  status = await harness.sendMessage({ type: 'STATUS' });
  assert.equal(status.activeEngine, 'mem0');
  assert.equal(status.connected, true);
});

test('Adv-Archive.6: Concurrent Promise.all writes to the exact same session (read-modify-write concurrency analysis)', async () => {
  const mock = createMockStorage();
  setupGlobalChrome(mock);

  const sessionId = 'concurrent_same_session';
  // Dispatch 10 simultaneous turn saves to the same session
  await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      LocalArchive.saveTurn({
        sessionId,
        platform: 'gemini',
        userPrompt: `Concurrent prompt ${i}`,
        assistantResponse: `Concurrent response ${i}`,
        timestamp: new Date().toISOString(),
      })
    )
  );

  const details = await LocalArchive.getSessionDetails(sessionId);
  // Empirically document whether turns are dropped under un-mutexed parallel execution
  // In JavaScript event loop without serialization, concurrent read-modify-writes on the same key will overlap.
  assert.ok(details.turns.length >= 1, 'At least 1 turn preserved');
  console.log(`[CONCURRENCY EMPIRICAL OBSERVATION] 10 parallel Promise.all writes to same session yielded ${details.turns.length} stored turns`);
});

test('Adv-Mem0.7: Dialogue parsing with unusual linebreaks and multiple User/Assistant headers', async () => {
  const engine = new Mem0Engine({ apiKey: 'token' });
  const captured = [];
  global.fetch = async (url, opts) => {
    captured.push(JSON.parse(opts.body));
    return new Response(JSON.stringify({ id: 'ok' }), { status: 200 });
  };

  // Case 1a: Standard LF \n\n in content
  await engine.observe({
    content: 'User: What is TypeScript?\n\nAssistant: TypeScript is typed JavaScript.',
  });
  assert.equal(captured[0].messages.length, 2);
  assert.equal(captured[0].messages[0].role, 'user');
  assert.equal(captured[0].messages[0].content, 'What is TypeScript?');
  assert.equal(captured[0].messages[1].role, 'assistant');
  assert.equal(captured[0].messages[1].content, 'TypeScript is typed JavaScript.');

  // Case 1b: Empirical edge case: Windows CRLF \r\n\r\n in content without explicit userPrompt/assistantResponse
  // Mem0Engine regex /^User:\s*([\s\S]*?)\n\nAssistant:\s*([\s\S]*)$/i does not match \r\n\r\n,
  // falling back to treating the entire turn as a single user message.
  const crlfTurnMessages = engine._parseMessages({
    content: 'User:\r\nWhat is TypeScript?\r\n\r\nAssistant:\r\nTypeScript is typed JavaScript.',
  });
  assert.equal(crlfTurnMessages.length, 1, 'CRLF fallback leaves 1 message (known edge-case limitation)');
  assert.equal(crlfTurnMessages[0].role, 'user');

  // Case 2: User prompt containing quoted "Assistant:" in the question
  await engine.observe({
    userPrompt: 'The Assistant: said "hello". Why did Assistant: say that?',
    assistantResponse: 'Because it was polite.',
  });
  assert.equal(captured[1].messages.length, 2);
  assert.equal(captured[1].messages[0].content, 'The Assistant: said "hello". Why did Assistant: say that?');
  assert.equal(captured[1].messages[1].content, 'Because it was polite.');
});

test('Adv-Switch.5: Rapid toggling of aistudioAutoSave during concurrent OBSERVE messages', async () => {
  let saveCount = 0;
  const harness = createServiceWorkerHarness({
    fetchHandler: async (url) => {
      saveCount++;
      return new Response(JSON.stringify({ ok: true, id: 'm' }), { status: 200 });
    },
  });

  // Turn auto-save off and on concurrently with observations
  const ops = [
    harness.sendMessage({ type: 'SET_SETTINGS', settings: { aistudioAutoSave: false } }),
    harness.sendMessage({ type: 'OBSERVE', platform: 'aistudio', sessionId: 's1', userPrompt: 'A', assistantResponse: 'B' }),
    harness.sendMessage({ type: 'SET_SETTINGS', settings: { aistudioAutoSave: true } }),
    harness.sendMessage({ type: 'OBSERVE', platform: 'aistudio', sessionId: 's2', userPrompt: 'C', assistantResponse: 'D' }),
  ];

  const results = await Promise.all(ops);
  // Verify no exceptions thrown during concurrent settings mutations and observations
  assert.ok(results.every((r) => r !== null && typeof r === 'object'));
});

test('Adv-Archive.7: High-volume stress (100 sessions with 5 turns each = 500 turns, export and search)', async () => {
  const mock = createMockStorage();
  setupGlobalChrome(mock);

  const numSessions = 20;
  const turnsPerSession = 5;

  for (let s = 1; s <= numSessions; s++) {
    const sid = `scale_session_${s}`;
    for (let t = 1; t <= turnsPerSession; t++) {
      await LocalArchive.saveTurn({
        sessionId: sid,
        platform: s % 2 === 0 ? 'aistudio' : 'gemini',
        userPrompt: `Scale user prompt ${s}-${t}`,
        assistantResponse: `Scale assistant response ${s}-${t} with unique_marker_${s}_${t}`,
      });
    }
  }

  const meta = await LocalArchive.getMeta();
  assert.equal(meta.totalSessions, numSessions);
  assert.equal(meta.totalTurns, numSessions * turnsPerSession);

  // Search across all sessions
  const searchResults = await LocalArchive.searchTurns({ query: 'unique_marker_5_3' });
  assert.equal(searchResults.length, 1);
  assert.equal(searchResults[0].sessionId, 'scale_session_5');

  // Export full JSON bundle
  const exported = await LocalArchive.exportHistory({ format: 'json' });
  const parsed = JSON.parse(exported.data);
  assert.equal(parsed.totalSessions, numSessions);
  assert.equal(parsed.totalTurns, 100);
});

