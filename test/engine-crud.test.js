// =============================================================================
// WebAI Memory — Memory Engines Direct CRUD & Service Worker Routing Test Suite
// Sub-milestone M2.2: Unit and integration testing for Mem0, AgentMemory,
// Hindsight, Cognee CRUD and Service Worker ADD_MEMORY, UPDATE_MEMORY,
// DELETE_MEMORY, and SESSION_ALIAS routing.
// =============================================================================

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT_DIR = path.resolve(__dirname, '..');
const { BaseMemoryEngine } = require('../backends/base-engine.js');
const { Mem0Engine } = require('../backends/mem0-engine.js');
const { AgentMemoryEngine } = require('../backends/agentmemory-engine.js');
const { HindsightEngine } = require('../backends/hindsight-engine.js');
const { CogneeEngine } = require('../backends/cognee-engine.js');
const { EngineFactory } = require('../backends/engine-factory.js');
const { LocalArchive } = require('../backends/local-archive.js');

// -----------------------------------------------------------------------------
// Test Helpers & Mock Harnesses
// -----------------------------------------------------------------------------

function createStorageArea(initialData = {}) {
  const store = { ...initialData };
  return {
    async get(keys) {
      if (keys === null || keys === undefined) {
        return JSON.parse(JSON.stringify(store));
      }
      const res = {};
      const keyList = Array.isArray(keys) ? keys : [keys];
      for (const k of keyList) {
        if (k in store) res[k] = JSON.parse(JSON.stringify(store[k]));
      }
      return res;
    },
    async set(items) {
      for (const [k, v] of Object.entries(items)) {
        store[k] = JSON.parse(JSON.stringify(v));
      }
    },
    async remove(keys) {
      const keyList = Array.isArray(keys) ? keys : [keys];
      for (const k of keyList) {
        delete store[k];
      }
    },
    _raw: store,
  };
}

function createServiceWorkerHarness(customFetch) {
  const local = createStorageArea();
  const session = createStorageArea();
  const requests = [];
  let messageListener = null;

  const chromeMock = {
    action: {
      setBadgeText() {},
      setBadgeBackgroundColor() {},
      setIcon() {},
    },
    alarms: {
      create() {},
      onAlarm: { addListener() {} },
    },
    runtime: {
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: {
        addListener(fn) {
          messageListener = fn;
        },
      },
    },
    storage: {
      local,
      session,
    },
  };

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
    Promise,
    fetch: async (url, opts = {}) => {
      requests.push({ url, options: opts });
      if (customFetch) {
        return customFetch(url, opts);
      }
      return {
        ok: true,
        status: 200,
        async json() {
          return { success: true };
        },
      };
    },
    importScripts: (...scripts) => {
      for (const relPath of scripts) {
        const fullPath = path.join(ROOT_DIR, relPath);
        const code = fs.readFileSync(fullPath, 'utf8');
        vm.runInContext(code, context);
      }
    },
  };

  const context = vm.createContext(sandbox);
  const swCode = fs.readFileSync(path.join(ROOT_DIR, 'service-worker.js'), 'utf8');
  vm.runInContext(swCode, context);

  return {
    chrome: chromeMock,
    requests,
    sendMessage(message) {
      return new Promise((resolve) => {
        if (!messageListener) {
          resolve({ error: 'No message listener registered' });
          return;
        }
        messageListener(message, {}, (res) => resolve(res));
      });
    },
  };
}

// -----------------------------------------------------------------------------
// 1. BaseMemoryEngine Contract Tests
// -----------------------------------------------------------------------------

test('BaseMemoryEngine: CRUD and aliasSession method contracts', async () => {
  const base = new BaseMemoryEngine();

  await assert.rejects(
    async () => base.addMemory({ narrative: 'Test memory' }),
    /BaseMemoryEngine\.addMemory\(\) must be implemented by subclass/
  );

  await assert.rejects(
    async () => base.updateMemory('id-1', { narrative: 'Updated' }),
    /BaseMemoryEngine\.updateMemory\(\) must be implemented by subclass/
  );

  await assert.rejects(
    async () => base.deleteMemory('id-1'),
    /BaseMemoryEngine\.deleteMemory\(\) must be implemented by subclass/
  );

  const aliasResult = await base.aliasSession({ oldSessionId: 'old', newSessionId: 'new' });
  assert.deepEqual(aliasResult, { ok: true });
});

// -----------------------------------------------------------------------------
// 2. Mem0Engine Direct CRUD Tests
// -----------------------------------------------------------------------------

test('Mem0Engine: addMemory in Cloud mode sends POST /memories with full metadata and headers', async () => {
  const requests = [];
  const origFetch = global.fetch;

  global.fetch = async (url, opts) => {
    requests.push({ url, opts });
    return {
      ok: true,
      status: 200,
      async json() {
        return [{ id: 'mem0_cloud_123', event: 'ADD' }];
      },
    };
  };

  try {
    const engine = new Mem0Engine({
      apiUrl: 'https://api.mem0.ai/v1',
      apiKey: 'test-mem0-token',
      userId: 'user_alice',
      orgId: 'org_omega',
      projectId: 'proj_alpha',
    });

    const res = await engine.addMemory({
      title: 'Alice Preferences',
      narrative: 'Alice prefers dark theme and TypeScript',
      category: 'preferences',
      metadata: { customField: 'extra' },
    });

    assert.equal(res.success, true);
    assert.equal(res.id, 'mem0_cloud_123');

    assert.equal(requests.length, 1);
    const req = requests[0];
    assert.equal(req.url, 'https://api.mem0.ai/v1/memories');
    assert.equal(req.opts.method, 'POST');
    assert.equal(req.opts.headers['Authorization'], 'Token test-mem0-token');
    assert.equal(req.opts.headers['X-Org-Id'], 'org_omega');
    assert.equal(req.opts.headers['X-Project-Id'], 'proj_alpha');

    const body = JSON.parse(req.opts.body);
    assert.equal(body.user_id, 'user_alice');
    assert.equal(body.org_id, 'org_omega');
    assert.equal(body.project_id, 'proj_alpha');
    assert.deepEqual(body.messages, [{ role: 'user', content: 'Alice prefers dark theme and TypeScript' }]);
    assert.equal(body.metadata.title, 'Alice Preferences');
    assert.equal(body.metadata.category, 'preferences');
    assert.equal(body.metadata.source, 'manual_popup');
    assert.equal(body.metadata.customField, 'extra');
    assert.ok(body.metadata.timestamp);
  } finally {
    global.fetch = origFetch;
  }
});

test('Mem0Engine: addMemory in Local Console mode targets POST /api/add', async () => {
  const requests = [];
  const origFetch = global.fetch;

  global.fetch = async (url, opts) => {
    requests.push({ url, opts });
    return {
      ok: true,
      status: 200,
      async json() {
        return { id: 'mem0_local_456', message: 'Added' };
      },
    };
  };

  try {
    const engine = new Mem0Engine({
      apiUrl: 'http://localhost:8000',
      apiKey: '',
    });

    const res = await engine.addMemory({
      title: 'Local Note',
      narrative: 'Local standalone memory entry',
      category: 'notes',
    });

    assert.equal(res.success, true);
    assert.equal(res.id, 'mem0_local_456');

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'http://localhost:8000/api/add');
    assert.equal(requests[0].opts.method, 'POST');

    const body = JSON.parse(requests[0].opts.body);
    assert.equal(body.content, 'Local standalone memory entry');
    assert.equal(body.category, 'notes');
    assert.equal(body.project, 'Local Note');
  } finally {
    global.fetch = origFetch;
  }
});

test('Mem0Engine: updateMemory in Cloud mode sends PUT /memories/:id', async () => {
  const requests = [];
  const origFetch = global.fetch;

  global.fetch = async (url, opts) => {
    requests.push({ url, opts });
    return {
      ok: true,
      status: 200,
      async json() {
        return { message: 'Memory updated successfully' };
      },
    };
  };

  try {
    const engine = new Mem0Engine({
      apiUrl: 'https://api.mem0.ai/v1',
      apiKey: 'mem0-secret',
    });

    const res = await engine.updateMemory('mem_789', {
      title: 'Updated Title',
      narrative: 'Updated narrative text',
      category: 'work',
    });

    assert.equal(res.success, true);
    assert.equal(res.id, 'mem_789');

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://api.mem0.ai/v1/memories/mem_789');
    assert.equal(requests[0].opts.method, 'PUT');

    const body = JSON.parse(requests[0].opts.body);
    assert.equal(body.text, 'Updated narrative text');
    assert.equal(body.metadata.title, 'Updated Title');
    assert.equal(body.metadata.category, 'work');
  } finally {
    global.fetch = origFetch;
  }
});

test('Mem0Engine: deleteMemory in Cloud mode sends DELETE /memories/:id', async () => {
  const requests = [];
  const origFetch = global.fetch;

  global.fetch = async (url, opts) => {
    requests.push({ url, opts });
    return {
      ok: true,
      status: 200,
      async json() {
        return { message: 'Memory deleted successfully' };
      },
    };
  };

  try {
    const engine = new Mem0Engine({
      apiUrl: 'https://api.mem0.ai/v1',
      apiKey: 'mem0-secret',
    });

    const res = await engine.deleteMemory('mem_del_999');
    assert.equal(res.success, true);

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://api.mem0.ai/v1/memories/mem_del_999');
    assert.equal(requests[0].opts.method, 'DELETE');
  } finally {
    global.fetch = origFetch;
  }
});

// -----------------------------------------------------------------------------
// 3. AgentMemoryEngine Direct CRUD Tests
// -----------------------------------------------------------------------------

test('AgentMemoryEngine: addMemory calls /agentmemory/memory/add with fallback to observe', async () => {
  const requests = [];
  const origFetch = global.fetch;

  let failFirst = false;
  global.fetch = async (url, opts) => {
    requests.push({ url, opts });
    if (url.endsWith('/memory/add') && failFirst) {
      return {
        ok: false,
        status: 404,
        async json() {
          return { error: 'Not found' };
        },
      };
    }
    return {
      ok: true,
      status: 200,
      async json() {
        return { id: 'agent_turn_42', success: true };
      },
    };
  };

  try {
    const engine = new AgentMemoryEngine({
      apiUrl: 'http://localhost:3111',
      secret: 'daemon-auth-token',
    });

    // Case 1: Primary endpoint succeeds
    const res1 = await engine.addMemory({
      title: 'Agent Fact',
      narrative: 'Agent memory content',
      category: 'facts',
    });
    assert.equal(res1.success, true);
    assert.equal(res1.id, 'agent_turn_42');
    assert.ok(requests[0].url.endsWith('/agentmemory/memory/add'));
    assert.equal(requests[0].opts.headers['Authorization'], 'Bearer daemon-auth-token');

    // Case 2: Fallback when memory/add is not implemented
    failFirst = true;
    requests.length = 0;
    const res2 = await engine.addMemory({
      title: 'Fallback Fact',
      narrative: 'Fallback narrative',
      category: 'general',
    });
    assert.equal(res2.success, true);
    assert.ok(requests.some((r) => r.url.endsWith('/agentmemory/observe')));
  } finally {
    global.fetch = origFetch;
  }
});

test('AgentMemoryEngine: updateMemory and deleteMemory call loopback daemon endpoints', async () => {
  const requests = [];
  const origFetch = global.fetch;

  global.fetch = async (url, opts) => {
    requests.push({ url, opts });
    return {
      ok: true,
      status: 200,
      async json() {
        return { success: true };
      },
    };
  };

  try {
    const engine = new AgentMemoryEngine({
      apiUrl: 'http://localhost:3111',
      secret: 'secret-key',
    });

    const updateRes = await engine.updateMemory('agent_mem_1', {
      title: 'New Title',
      narrative: 'New Narrative',
    });
    assert.equal(updateRes.success, true);
    assert.equal(updateRes.id, 'agent_mem_1');
    assert.ok(requests[0].url.endsWith('/agentmemory/memory/update'));
    assert.equal(JSON.parse(requests[0].opts.body).id, 'agent_mem_1');

    const delRes = await engine.deleteMemory('agent_mem_1');
    assert.equal(delRes.success, true);
    assert.ok(requests[1].url.endsWith('/agentmemory/memory/delete'));
    assert.equal(JSON.parse(requests[1].opts.body).id, 'agent_mem_1');
  } finally {
    global.fetch = origFetch;
  }
});

// -----------------------------------------------------------------------------
// 4. HindsightEngine Direct CRUD Tests
// -----------------------------------------------------------------------------

test('HindsightEngine: addMemory, updateMemory, deleteMemory with fallback endpoints', async () => {
  const requests = [];
  const origFetch = global.fetch;

  global.fetch = async (url, opts) => {
    requests.push({ url, opts });
    if (url.endsWith('/retain')) {
      return {
        ok: true,
        status: 200,
        async json() {
          return { id: 'hs_101', memory_id: 'hs_101' };
        },
      };
    }
    if (url.includes('/memories/hs_101') && opts.method === 'PUT') {
      return {
        ok: true,
        status: 200,
        async json() {
          return { success: true, id: 'hs_101' };
        },
      };
    }
    if (url.includes('/memories/hs_101') && opts.method === 'DELETE') {
      return {
        ok: true,
        status: 200,
        async json() {
          return { success: true };
        },
      };
    }
    return { ok: false, status: 404, async json() { return {}; } };
  };

  try {
    const engine = new HindsightEngine({
      apiUrl: 'http://localhost:8888',
      apiKey: 'hindsight-key',
      bankId: 'bank_research',
    });

    // Add
    const addRes = await engine.addMemory({
      title: 'Hindsight Observation',
      narrative: 'Hindsight captured insight',
      category: 'insights',
    });
    assert.equal(addRes.success, true);
    assert.equal(addRes.id, 'hs_101');
    assert.ok(requests[0].url.endsWith('/retain'));
    const addBody = JSON.parse(requests[0].opts.body);
    assert.equal(addBody.bank_id, 'bank_research');
    assert.equal(addBody.title, 'Hindsight Observation');
    assert.equal(addBody.content, 'Hindsight captured insight');

    // Update
    const updateRes = await engine.updateMemory('hs_101', {
      title: 'Refined Insight',
      narrative: 'Refined content',
      category: 'insights',
    });
    assert.equal(updateRes.success, true);
    assert.equal(updateRes.id, 'hs_101');
    assert.ok(requests[1].url.endsWith('/memories/hs_101'));
    assert.equal(requests[1].opts.method, 'PUT');
    const updateBody = JSON.parse(requests[1].opts.body);
    assert.equal(updateBody.bank_id, 'bank_research');
    assert.equal(updateBody.title, 'Refined Insight');

    // Delete
    const deleteRes = await engine.deleteMemory('hs_101');
    assert.equal(deleteRes.success, true);
    assert.ok(requests[2].url.includes('/memories/hs_101?bank_id=bank_research'));
    assert.equal(requests[2].opts.method, 'DELETE');
  } finally {
    global.fetch = origFetch;
  }
});

// -----------------------------------------------------------------------------
// 5. CogneeEngine Direct CRUD Tests
// -----------------------------------------------------------------------------

test('CogneeEngine: addMemory triggers cognify, updateMemory, and deleteMemory operate correctly', async () => {
  const requests = [];
  const origFetch = global.fetch;

  global.fetch = async (url, opts) => {
    requests.push({ url, opts });
    if (url.endsWith('/api/v1/add') || url.endsWith('/add')) {
      return {
        ok: true,
        status: 200,
        async json() {
          return { id: 'cog_node_501' };
        },
      };
    }
    if (url.endsWith('/api/v1/cognify')) {
      return { ok: true, status: 200, async json() { return { status: 'cognifying' }; } };
    }
    if (url.includes('/api/v1/memories/cog_node_501') && opts.method === 'PUT') {
      return { ok: true, status: 200, async json() { return { id: 'cog_node_501' }; } };
    }
    if (url.includes('/api/v1/memories/cog_node_501') && opts.method === 'DELETE') {
      return { ok: true, status: 200, async json() { return { success: true }; } };
    }
    return { ok: true, status: 200, async json() { return {}; } };
  };

  try {
    const engine = new CogneeEngine({
      apiUrl: 'http://localhost:8000',
      apiKey: 'cognee-secret',
      datasetName: 'knowledge_graph',
    });

    // Add
    const addRes = await engine.addMemory({
      title: 'Knowledge Graph Node',
      narrative: 'Graph relation: A connected to B',
      category: 'relations',
    });
    assert.equal(addRes.success, true);
    assert.equal(addRes.id, 'cog_node_501');

    // Verifies /api/v1/add was called
    const addReq = requests.find((r) => r.url.endsWith('/api/v1/add'));
    assert.ok(addReq);
    const addBody = JSON.parse(addReq.opts.body);
    assert.equal(addBody.data, 'Graph relation: A connected to B');
    assert.equal(addBody.datasetName, 'knowledge_graph');

    // Verifies background cognify trigger
    const cognifyReq = requests.find((r) => r.url.endsWith('/api/v1/cognify'));
    assert.ok(cognifyReq);

    // Update
    const updateRes = await engine.updateMemory('cog_node_501', {
      title: 'Updated Node',
      narrative: 'Updated relation details',
    });
    assert.equal(updateRes.success, true);
    assert.equal(updateRes.id, 'cog_node_501');
    const updateReq = requests.find((r) => r.url.endsWith('/api/v1/memories/cog_node_501') && r.opts.method === 'PUT');
    assert.ok(updateReq);

    // Delete
    const deleteRes = await engine.deleteMemory('cog_node_501');
    assert.equal(deleteRes.success, true);
    const delReq = requests.find((r) => r.url.includes('/api/v1/memories/cog_node_501?datasetName=knowledge_graph'));
    assert.ok(delReq);
    assert.equal(delReq.opts.method, 'DELETE');
  } finally {
    global.fetch = origFetch;
  }
});

// -----------------------------------------------------------------------------
// 6. Service Worker Background Routing Tests
// -----------------------------------------------------------------------------

test('Service Worker: routes ADD_MEMORY to active engine and returns created memory ID', async () => {
  const harness = createServiceWorkerHarness(async (url, opts) => {
    if (url.includes('/memories') && opts.method === 'POST') {
      return {
        ok: true,
        status: 200,
        async json() {
          return [{ id: 'mem0_sw_123', event: 'ADD' }];
        },
      };
    }
    return { ok: true, status: 200, async json() { return {}; } };
  });

  // Ensure activeEngine is mem0
  await harness.chrome.storage.local.set({
    activeEngine: 'mem0',
    mem0ApiUrl: 'https://api.mem0.ai/v1',
    mem0ApiKey: 'valid-key',
  });

  const response = await harness.sendMessage({
    type: 'ADD_MEMORY',
    title: 'SW Test Memory',
    narrative: 'Testing service worker ADD_MEMORY routing',
    category: 'unit_test',
  });

  assert.equal(response.success, true);
  assert.equal(response.id, 'mem0_sw_123');
});

test('Service Worker: routes UPDATE_MEMORY to active engine', async () => {
  const harness = createServiceWorkerHarness(async (url, opts) => {
    if (url.includes('/memories/mem_sw_99') && opts.method === 'PUT') {
      return {
        ok: true,
        status: 200,
        async json() {
          return { message: 'Updated' };
        },
      };
    }
    return { ok: true, status: 200, async json() { return {}; } };
  });

  await harness.chrome.storage.local.set({
    activeEngine: 'mem0',
    mem0ApiUrl: 'https://api.mem0.ai/v1',
    mem0ApiKey: 'valid-key',
  });

  const response = await harness.sendMessage({
    type: 'UPDATE_MEMORY',
    id: 'mem_sw_99',
    title: 'Updated SW Title',
    narrative: 'Updated narrative through SW',
    category: 'updates',
  });

  assert.equal(response.success, true);
  assert.equal(response.id, 'mem_sw_99');
});

test('Service Worker: routes DELETE_MEMORY to active engine', async () => {
  const harness = createServiceWorkerHarness(async (url, opts) => {
    if (url.includes('/memories/mem_del_77') && opts.method === 'DELETE') {
      return {
        ok: true,
        status: 200,
        async json() {
          return { message: 'Deleted' };
        },
      };
    }
    return { ok: true, status: 200, async json() { return {}; } };
  });

  await harness.chrome.storage.local.set({
    activeEngine: 'mem0',
    mem0ApiUrl: 'https://api.mem0.ai/v1',
    mem0ApiKey: 'valid-key',
  });

  const response = await harness.sendMessage({
    type: 'DELETE_MEMORY',
    id: 'mem_del_77',
  });

  assert.equal(response.success, true);
});

test('Service Worker: routes SESSION_ALIAS and merges LocalArchive turns and index', async () => {
  const harness = createServiceWorkerHarness();

  // Seed storage with a draft conversation turn
  const draftId = 'draft_chatgpt_123456';
  const threadId = 'chatgpt_c_uuid_789';

  await harness.chrome.storage.local.set({
    oam_archive_sessions: [
      {
        id: draftId,
        platform: 'chatgpt',
        title: 'Draft Conversation Title',
        createdAt: '2026-10-05T10:00:00Z',
        updatedAt: '2026-10-05T10:00:00Z',
        turnCount: 1,
        snippet: 'Assistant response preview',
      },
    ],
    [`oam_archive_turns_${draftId}`]: [
      {
        turnId: 'turn_1',
        sessionId: draftId,
        platform: 'chatgpt',
        userText: 'Explain quantum computing in one sentence.',
        assistantText: 'Quantum computing leverages superposition and entanglement to perform complex computations.',
        timestamp: '2026-10-05T10:00:00Z',
      },
    ],
    oam_archive_meta: { totalSessions: 1, totalTurns: 1, lastArchivedAt: '2026-10-05T10:00:00Z' },
  });

  // Dispatch SESSION_ALIAS message
  const response = await harness.sendMessage({
    type: 'SESSION_ALIAS',
    oldSessionId: draftId,
    newSessionId: threadId,
    platform: 'chatgpt',
    threadId: 'c_uuid_789',
    url: 'https://chatgpt.com/c/uuid_789',
  });

  assert.equal(response.success, true);
  assert.equal(response.oldSessionId, draftId);
  assert.equal(response.newSessionId, threadId);
  assert.equal(response.turnCount, 1);

  // Verify storage state: draft key removed, thread key created with turns, session re-keyed
  const rawStorage = harness.chrome.storage.local._raw;
  assert.equal(rawStorage[`oam_archive_turns_${draftId}`], undefined);
  assert.ok(rawStorage[`oam_archive_turns_${threadId}`]);
  assert.equal(rawStorage[`oam_archive_turns_${threadId}`].length, 1);
  assert.equal(rawStorage[`oam_archive_turns_${threadId}`][0].sessionId, threadId);

  const sessions = rawStorage['oam_archive_sessions'];
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].id, threadId);
});

test('Service Worker: SESSION_ALIAS validates input and rejects missing/identical IDs', async () => {
  const harness = createServiceWorkerHarness();

  const missingResponse = await harness.sendMessage({
    type: 'SESSION_ALIAS',
    oldSessionId: '',
    newSessionId: 'session_b',
  });
  assert.equal(missingResponse.success, false);
  assert.ok(missingResponse.error);

  const identicalResponse = await harness.sendMessage({
    type: 'SESSION_ALIAS',
    oldSessionId: 'session_same',
    newSessionId: 'session_same',
  });
  assert.equal(identicalResponse.success, false);
  assert.ok(identicalResponse.error);
});

test('Service Worker: dynamic engine switching changes destination of CRUD routing', async () => {
  const requests = [];
  const harness = createServiceWorkerHarness(async (url, opts) => {
    requests.push({ url, opts });
    if (url.includes('/retain')) {
      return { ok: true, status: 200, async json() { return { id: 'hs_sw_turn_1' }; } };
    }
    return { ok: true, status: 200, async json() { return {}; } };
  });

  // Switch to Hindsight
  await harness.chrome.storage.local.set({
    activeEngine: 'hindsight',
    hindsightApiUrl: 'http://localhost:8888',
    hindsightApiKey: 'hindsight-token',
    hindsightBankId: 'hs_bank',
  });

  const response = await harness.sendMessage({
    type: 'ADD_MEMORY',
    title: 'Hindsight Routed Turn',
    narrative: 'Testing Hindsight background routing',
  });

  assert.equal(response.success, true);
  assert.equal(response.id, 'hs_sw_turn_1');
  assert.ok(requests.some((r) => r.url.includes('/retain')));
});
