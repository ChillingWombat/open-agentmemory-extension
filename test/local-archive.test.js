const assert = require('node:assert/strict');
const test = require('node:test');
const { LocalArchive } = require('../backends/local-archive.js');

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
    },
  };
}

function setupTestEnvironment() {
  const mock = createMockStorage();
  global.chrome = {
    storage: mock.storage,
    runtime: { lastError: null },
  };
  return mock;
}

test('LocalArchive: saveTurn saves single turn with direct userPrompt and assistantResponse', async () => {
  const mock = setupTestEnvironment();

  const result = await LocalArchive.saveTurn({
    sessionId: 'session-alpha',
    platform: 'gemini',
    userPrompt: 'What is the theory of relativity?',
    assistantResponse: 'Relativity describes how space and time are linked for objects moving at a consistent speed.',
    timestamp: '2026-10-05T03:00:00.000Z',
  });

  assert.equal(result.success, true);
  assert.equal(result.sessionId, 'session-alpha');
  assert.equal(result.turnId, 'turn_1');
  assert.equal(result.turnCount, 1);

  // Check stored sessions
  const sessions = mock.data[LocalArchive.SESSIONS_KEY];
  assert.ok(Array.isArray(sessions));
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].id, 'session-alpha');
  assert.equal(sessions[0].platform, 'gemini');
  assert.equal(sessions[0].title, 'What is the theory of relativity?');
  assert.equal(sessions[0].turnCount, 1);
  assert.match(sessions[0].snippet, /Relativity describes/);

  // Check stored turns
  const turns = mock.data[`${LocalArchive.TURNS_PREFIX}session-alpha`];
  assert.ok(Array.isArray(turns));
  assert.equal(turns.length, 1);
  assert.equal(turns[0].turnId, 'turn_1');
  assert.equal(turns[0].userText, 'What is the theory of relativity?');
  assert.match(turns[0].assistantText, /Relativity describes/);
  assert.equal(turns[0].platform, 'gemini');

  // Check metadata
  const meta = mock.data[LocalArchive.META_KEY];
  assert.equal(meta.totalSessions, 1);
  assert.equal(meta.totalTurns, 1);
  assert.equal(meta.lastArchivedAt, '2026-10-05T03:00:00.000Z');
});

test('LocalArchive: saveTurn parses dialogue from formatted content string', async () => {
  const mock = setupTestEnvironment();

  const result = await LocalArchive.saveTurn({
    sessionId: 'session-parsed',
    platform: 'chatgpt',
    content: 'User: How do black holes form?\n\nAssistant: Black holes form when massive stars collapse at the end of their life cycle.',
  });

  assert.equal(result.success, true);
  const turns = mock.data[`${LocalArchive.TURNS_PREFIX}session-parsed`];
  assert.equal(turns.length, 1);
  assert.equal(turns[0].userText, 'How do black holes form?');
  assert.equal(
    turns[0].assistantText,
    'Black holes form when massive stars collapse at the end of their life cycle.'
  );

  const sessions = mock.data[LocalArchive.SESSIONS_KEY];
  assert.equal(sessions[0].title, 'How do black holes form?');
});

test('LocalArchive: saveTurn sequences multiple turns in the same session', async () => {
  const mock = setupTestEnvironment();

  await LocalArchive.saveTurn({
    sessionId: 'session-multi',
    platform: 'aistudio',
    userPrompt: 'Step 1: Define hypothesis',
    assistantResponse: 'Hypothesis defined: H1.',
  });

  await LocalArchive.saveTurn({
    sessionId: 'session-multi',
    platform: 'aistudio',
    userPrompt: 'Step 2: Collect data',
    assistantResponse: 'Data points gathered from 100 samples.',
  });

  const finalResult = await LocalArchive.saveTurn({
    sessionId: 'session-multi',
    platform: 'aistudio',
    userPrompt: 'Step 3: Analyze results',
    assistantResponse: 'P-value is below 0.01; hypothesis supported.',
  });

  assert.equal(finalResult.turnCount, 3);
  assert.equal(finalResult.turnId, 'turn_3');

  const { session, turns } = await LocalArchive.getSessionDetails('session-multi');
  assert.equal(session.turnCount, 3);
  assert.equal(turns.length, 3);
  assert.equal(turns[0].turnId, 'turn_1');
  assert.equal(turns[1].turnId, 'turn_2');
  assert.equal(turns[2].turnId, 'turn_3');
  assert.equal(turns[2].userText, 'Step 3: Analyze results');

  const meta = await LocalArchive.getMeta();
  assert.equal(meta.totalSessions, 1);
  assert.equal(meta.totalTurns, 3);
});

test('LocalArchive: saveTurn deduplicates exact duplicate consecutive turns', async () => {
  const mock = setupTestEnvironment();

  const r1 = await LocalArchive.saveTurn({
    sessionId: 'session-dedup',
    platform: 'claude',
    userPrompt: 'Tell me a riddle.',
    assistantResponse: 'What has keys but no locks? A piano.',
  });
  assert.equal(r1.turnCount, 1);

  // Exact duplicate turn
  const r2 = await LocalArchive.saveTurn({
    sessionId: 'session-dedup',
    platform: 'claude',
    userPrompt: 'Tell me a riddle.',
    assistantResponse: 'What has keys but no locks? A piano.',
  });

  assert.equal(r2.turnCount, 1);
  assert.equal(r2.deduplicated, true);

  const turns = mock.data[`${LocalArchive.TURNS_PREFIX}session-dedup`];
  assert.equal(turns.length, 1);
});

test('LocalArchive: saveTurn handles streaming completion in-place', async () => {
  const mock = setupTestEnvironment();

  // Turn with partial streaming response
  await LocalArchive.saveTurn({
    sessionId: 'session-stream',
    platform: 'gemini',
    userPrompt: 'Write a haiku about rain.',
    assistantResponse: 'Gentle raindrops fall',
  });

  let turns = mock.data[`${LocalArchive.TURNS_PREFIX}session-stream`];
  assert.equal(turns.length, 1);
  assert.equal(turns[0].assistantText, 'Gentle raindrops fall');

  // Turn with completed response
  await LocalArchive.saveTurn({
    sessionId: 'session-stream',
    platform: 'gemini',
    userPrompt: 'Write a haiku about rain.',
    assistantResponse: 'Gentle raindrops fall,\nWhispering upon the leaves,\nEarth drinks and revives.',
  });

  turns = mock.data[`${LocalArchive.TURNS_PREFIX}session-stream`];
  assert.equal(turns.length, 1, 'Streaming update should update the active turn without creating duplicate');
  assert.match(turns[0].assistantText, /Earth drinks and revives/);
});

test('LocalArchive: saveTurn updates existing turn by turnId', async () => {
  const mock = setupTestEnvironment();

  await LocalArchive.saveTurn({
    sessionId: 'session-id-update',
    platform: 'grok',
    turnId: 'fixed-turn-42',
    userPrompt: 'Initial question',
    assistantResponse: 'Initial draft',
  });

  await LocalArchive.saveTurn({
    sessionId: 'session-id-update',
    platform: 'grok',
    turnId: 'fixed-turn-42',
    userPrompt: 'Initial question',
    assistantResponse: 'Final polished answer',
  });

  const turns = mock.data[`${LocalArchive.TURNS_PREFIX}session-id-update`];
  assert.equal(turns.length, 1);
  assert.equal(turns[0].turnId, 'fixed-turn-42');
  assert.equal(turns[0].assistantText, 'Final polished answer');
});

test('LocalArchive: getSessions filters by platform and handles case insensitivity', async () => {
  const mock = setupTestEnvironment();

  await LocalArchive.saveTurn({
    sessionId: 's-gemini-1',
    platform: 'gemini',
    userPrompt: 'Gemini prompt 1',
    assistantResponse: 'Gemini reply',
  });
  await LocalArchive.saveTurn({
    sessionId: 's-gemini-2',
    platform: 'gemini',
    userPrompt: 'Gemini prompt 2',
    assistantResponse: 'Gemini reply',
  });
  await LocalArchive.saveTurn({
    sessionId: 's-chatgpt-1',
    platform: 'chatgpt',
    userPrompt: 'ChatGPT prompt',
    assistantResponse: 'ChatGPT reply',
  });
  await LocalArchive.saveTurn({
    sessionId: 's-aistudio-1',
    platform: 'aistudio',
    userPrompt: 'AI Studio prompt',
    assistantResponse: 'AI Studio reply',
  });

  const geminiSessions = await LocalArchive.getSessions({ platform: 'gemini' });
  assert.equal(geminiSessions.length, 2);
  assert.ok(geminiSessions.every((s) => s.platform === 'gemini'));

  const geminiUpper = await LocalArchive.getSessions({ platform: 'GEMINI' });
  assert.equal(geminiUpper.length, 2);

  const aistudioSessions = await LocalArchive.getSessions({ platform: 'aistudio' });
  assert.equal(aistudioSessions.length, 1);
  assert.equal(aistudioSessions[0].id, 's-aistudio-1');

  const allSessions = await LocalArchive.getSessions({ platform: 'all' });
  assert.equal(allSessions.length, 4);

  const defaultSessions = await LocalArchive.getSessions();
  assert.equal(defaultSessions.length, 4);
});

test('LocalArchive: getSessions searches across title, snippet, and transcript turns', async () => {
  setupTestEnvironment();

  await LocalArchive.saveTurn({
    sessionId: 's-physics',
    platform: 'gemini',
    userPrompt: 'What is quantum entanglement?',
    assistantResponse: 'Quantum entanglement is a phenomenon in quantum mechanics.',
  });
  await LocalArchive.saveTurn({
    sessionId: 's-biology',
    platform: 'claude',
    userPrompt: 'How does CRISPR Cas9 edit genes?',
    assistantResponse: 'CRISPR uses a guide RNA to locate specific DNA sequences.',
  });
  await LocalArchive.saveTurn({
    sessionId: 's-math',
    platform: 'chatgpt',
    userPrompt: 'Explain calculus',
    assistantResponse: 'Calculus studies continuous change. Leibniz and Newton developed it.',
  });

  // Query in title
  const qTitle = await LocalArchive.getSessions({ query: 'quantum' });
  assert.equal(qTitle.length, 1);
  assert.equal(qTitle[0].id, 's-physics');

  // Query in snippet
  const qSnippet = await LocalArchive.getSessions({ query: 'guide RNA' });
  assert.equal(qSnippet.length, 1);
  assert.equal(qSnippet[0].id, 's-biology');

  // Query in deep dialogue text
  const qDeep = await LocalArchive.getSessions({ query: 'Leibniz' });
  assert.equal(qDeep.length, 1);
  assert.equal(qDeep[0].id, 's-math');

  // Query with no matches
  const qNone = await LocalArchive.getSessions({ query: 'nonexistenttermxyz' });
  assert.equal(qNone.length, 0);
});

test('LocalArchive: getSessions supports pagination with limit and offset', async () => {
  setupTestEnvironment();

  for (let i = 1; i <= 10; i++) {
    await LocalArchive.saveTurn({
      sessionId: `session-page-${i}`,
      platform: 'gemini',
      userPrompt: `Prompt number ${i}`,
      assistantResponse: `Response number ${i}`,
    });
  }

  const page1 = await LocalArchive.getSessions({ limit: 4, offset: 0 });
  assert.equal(page1.length, 4);

  const page2 = await LocalArchive.getSessions({ limit: 4, offset: 4 });
  assert.equal(page2.length, 4);

  const page3 = await LocalArchive.getSessions({ limit: 4, offset: 8 });
  assert.equal(page3.length, 2);

  // Ensure items across pages do not overlap
  const ids1 = new Set(page1.map((s) => s.id));
  assert.ok(page2.every((s) => !ids1.has(s.id)));
});

test('LocalArchive: getSessionDetails returns session summary and turns or null for missing', async () => {
  setupTestEnvironment();

  await LocalArchive.saveTurn({
    sessionId: 'session-details-test',
    platform: 'claude',
    userPrompt: 'Provide an architecture summary',
    assistantResponse: 'The architecture consists of three layers.',
  });

  const found = await LocalArchive.getSessionDetails('session-details-test');
  assert.ok(found.session);
  assert.equal(found.session.id, 'session-details-test');
  assert.equal(found.session.platform, 'claude');
  assert.equal(found.turns.length, 1);
  assert.equal(found.turns[0].userText, 'Provide an architecture summary');

  const notFound = await LocalArchive.getSessionDetails('missing-session-id');
  assert.equal(notFound.session, null);
  assert.deepEqual(notFound.turns, []);

  const empty = await LocalArchive.getSessionDetails('');
  assert.equal(empty.session, null);
  assert.deepEqual(empty.turns, []);
});

test('LocalArchive: deleteSession removes session from index and deletes turn storage', async () => {
  const mock = setupTestEnvironment();

  await LocalArchive.saveTurn({
    sessionId: 'session-to-delete',
    platform: 'gemini',
    userPrompt: 'Delete me soon',
    assistantResponse: 'Will do.',
  });
  await LocalArchive.saveTurn({
    sessionId: 'session-to-keep',
    platform: 'chatgpt',
    userPrompt: 'Keep me safe',
    assistantResponse: 'I am safe.',
  });

  const metaBefore = await LocalArchive.getMeta();
  assert.equal(metaBefore.totalSessions, 2);

  const delResult = await LocalArchive.deleteSession('session-to-delete');
  assert.equal(delResult.success, true);

  const sessionsAfter = await LocalArchive.getSessions();
  assert.equal(sessionsAfter.length, 1);
  assert.equal(sessionsAfter[0].id, 'session-to-keep');

  // Check turn key is deleted from storage
  assert.equal(mock.data[`${LocalArchive.TURNS_PREFIX}session-to-delete`], undefined);
  assert.ok(mock.data[`${LocalArchive.TURNS_PREFIX}session-to-keep`] !== undefined);

  const metaAfter = await LocalArchive.getMeta();
  assert.equal(metaAfter.totalSessions, 1);
  assert.equal(metaAfter.totalTurns, 1);
});

test('LocalArchive: clearHistory purges platform-specific sessions only', async () => {
  const mock = setupTestEnvironment();

  await LocalArchive.saveTurn({
    sessionId: 's-gem-1',
    platform: 'gemini',
    userPrompt: 'Gemini turn',
    assistantResponse: 'Gemini reply',
  });
  await LocalArchive.saveTurn({
    sessionId: 's-gpt-1',
    platform: 'chatgpt',
    userPrompt: 'ChatGPT turn',
    assistantResponse: 'ChatGPT reply',
  });

  const clearResult = await LocalArchive.clearHistory({ platform: 'gemini' });
  assert.equal(clearResult.success, true);
  assert.equal(clearResult.clearedCount, 1);

  const remaining = await LocalArchive.getSessions();
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].platform, 'chatgpt');

  assert.equal(mock.data[`${LocalArchive.TURNS_PREFIX}s-gem-1`], undefined);
  assert.ok(mock.data[`${LocalArchive.TURNS_PREFIX}s-gpt-1`] !== undefined);
});

test('LocalArchive: clearHistory purges all history when no platform specified', async () => {
  const mock = setupTestEnvironment();

  await LocalArchive.saveTurn({
    sessionId: 's-all-1',
    platform: 'gemini',
    userPrompt: 'U1',
    assistantResponse: 'A1',
  });
  await LocalArchive.saveTurn({
    sessionId: 's-all-2',
    platform: 'claude',
    userPrompt: 'U2',
    assistantResponse: 'A2',
  });

  const clearResult = await LocalArchive.clearHistory();
  assert.equal(clearResult.success, true);
  assert.equal(clearResult.clearedCount, 2);

  const sessions = await LocalArchive.getSessions();
  assert.equal(sessions.length, 0);

  const meta = await LocalArchive.getMeta();
  assert.equal(meta.totalSessions, 0);
  assert.equal(meta.totalTurns, 0);
  assert.equal(mock.data[`${LocalArchive.TURNS_PREFIX}s-all-1`], undefined);
  assert.equal(mock.data[`${LocalArchive.TURNS_PREFIX}s-all-2`], undefined);
});

test('LocalArchive: exportHistory exports JSON bundle with all sessions and turns', async () => {
  setupTestEnvironment();

  await LocalArchive.saveTurn({
    sessionId: 'export-s1',
    platform: 'gemini',
    userPrompt: 'Export prompt 1',
    assistantResponse: 'Export reply 1',
  });
  await LocalArchive.saveTurn({
    sessionId: 'export-s2',
    platform: 'aistudio',
    userPrompt: 'Export prompt 2',
    assistantResponse: 'Export reply 2',
  });

  const exportResult = await LocalArchive.exportHistory({ format: 'json' });
  assert.ok(exportResult.data);
  assert.match(exportResult.filename, /webai-memory-archive-all-.*\.json$/);

  // Verify object behaves both as { data, filename } and converts to string
  const jsonParsed = JSON.parse(exportResult.data);
  assert.equal(jsonParsed.version, '1.0');
  assert.equal(jsonParsed.totalSessions, 2);
  assert.equal(jsonParsed.totalTurns, 2);
  assert.equal(jsonParsed.sessions.length, 2);
  assert.equal(jsonParsed.sessions[0].turns.length, 1);
  assert.equal(jsonParsed.sessions[1].turns.length, 1);

  // Verify String conversion
  assert.equal(String(exportResult), exportResult.data);
  const parsedFromString = JSON.parse(exportResult);
  assert.equal(parsedFromString.totalSessions, 2);
});

test('LocalArchive: exportHistory exports clean Markdown transcript', async () => {
  setupTestEnvironment();

  await LocalArchive.saveTurn({
    sessionId: 'md-session-1',
    platform: 'aistudio',
    userPrompt: 'Analyze this code snippet',
    assistantResponse: 'The code snippet has linear complexity O(N).',
  });

  const exportResult = await LocalArchive.exportHistory({ format: 'markdown', platform: 'aistudio' });
  assert.match(exportResult.filename, /webai-memory-archive-aistudio-.*\.md$/);

  const md = exportResult.data;
  assert.match(md, /# WebAI Memory Conversation Archive Export/);
  assert.match(md, /## Session: Analyze this code snippet/);
  assert.match(md, /- \*\*Platform\*\*: aistudio/);
  assert.match(md, /\*\*User\*\*:\nAnalyze this code snippet/);
  assert.match(md, /\*\*Assistant\*\*:\nThe code snippet has linear complexity O\(N\)\./);
});

test('LocalArchive: searchTurns returns matching turns with session context', async () => {
  setupTestEnvironment();

  await LocalArchive.saveTurn({
    sessionId: 's-search-1',
    platform: 'gemini',
    userPrompt: 'What is WebAssembly?',
    assistantResponse: 'WebAssembly (Wasm) is a binary instruction format for a stack-based virtual machine.',
  });
  await LocalArchive.saveTurn({
    sessionId: 's-search-2',
    platform: 'chatgpt',
    userPrompt: 'Explain Docker containers',
    assistantResponse: 'Docker packages applications and dependencies together in portable containers.',
  });

  const results = await LocalArchive.searchTurns({ query: 'stack-based' });
  assert.equal(results.length, 1);
  assert.equal(results[0].sessionId, 's-search-1');
  assert.equal(results[0].platform, 'gemini');
  assert.match(results[0].turn.assistantText, /stack-based virtual machine/);

  const emptyResults = await LocalArchive.searchTurns({ query: '' });
  assert.deepEqual(emptyResults, []);
});

test('LocalArchive: handles special characters, unicode, code blocks, and multiline text', async () => {
  setupTestEnvironment();

  const codeSnippet = '```javascript\nfunction test() {\n  return "✨ 🚀 Unicode & <tags> \'quotes\'";\n}\n```';
  const prompt = 'Can you review this code?\n\nLine 2 has emoji: 🤖';

  await LocalArchive.saveTurn({
    sessionId: 'session-unicode',
    platform: 'aistudio',
    userPrompt: prompt,
    assistantResponse: codeSnippet,
  });

  const { session, turns } = await LocalArchive.getSessionDetails('session-unicode');
  assert.ok(session);
  assert.equal(turns[0].userText, prompt);
  assert.equal(turns[0].assistantText, codeSnippet);

  // Search by emoji
  const searchEmoji = await LocalArchive.getSessions({ query: '🤖' });
  assert.equal(searchEmoji.length, 1);

  // Search by code snippet content
  const searchCode = await LocalArchive.getSessions({ query: 'Unicode & <tags>' });
  assert.equal(searchCode.length, 1);
});
