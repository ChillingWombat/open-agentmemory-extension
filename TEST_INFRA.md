# Test Infrastructure Documentation (TEST_INFRA.md)

## 1. Overview & Philosophy
The WebAI Memory test infrastructure provides comprehensive, hermetic, opaque-box end-to-end verification for the Chromium Manifest V3 browser extension refactor. Built strictly with Node.js native testing modules (`node:test` and `node:assert/strict`), the test suite requires **zero external npm dependencies** and executes deterministically via `node test/e2e-suite.test.js`.

The test suite tests the extension through its public interfaces, message protocols, Chrome storage contracts, and external HTTP API specifications without relying on internal mock facades or implementation compromises.

---

## 2. 4-Tier Opaque-Box Methodology

The test suite is structured across 4 rigorous testing tiers totaling **122 automated test cases**:

```
+-------------------------------------------------------------------------+
|                  Tier 4: Real-World Scenarios (5 tests)                 |
|   Multi-turn research, Engine migration, Zero-retention privacy, etc.   |
+-------------------------------------------------------------------------+
|              Tier 3: Cross-Feature Combinations (6 tests)               |
|      Dynamic engine switching during observe, offline search, etc.      |
+-------------------------------------------------------------------------+
|            Tier 2: Boundary & Corner Cases (40 tests, 8x5)              |
|    Empty queries, Auth 401/403, Malformed URLs, Timeouts, Unicode, etc.  |
+-------------------------------------------------------------------------+
|           Tier 1: Feature Coverage (71 tests across F1-F13)             |
|   Pluggable engines, Mem0 REST, Normalization, AI Studio, Local Archive |
+-------------------------------------------------------------------------+
```

### Tier 1: Feature Coverage (71 tests, >=5 tests per feature)
- **F1: Pluggable Engine Abstraction & `BaseMemoryEngine` (6 tests)**:
  Abstract class instantiation, custom configurations, enforcement of abstract method overrides (`checkHealth`, `observe`, `search`), default session lifecycle resolutions (`startSession`, `endSession`), and inheritance validation.
- **F2: AgentMemory Backward Compatibility (7 tests)**:
  Strict loopback address validation (`http://localhost`, `http://127.0.0.1`), rejection of external domains and schemes, Bearer authorization header injection, `/agentmemory/health` probe, `/agentmemory/observe` turn formatting with portable metadata, `/agentmemory/search` card parsing, and session lifecycle endpoints.
- **F3: Mem0 Cloud REST API Integration (7 tests)**:
  Cloud base URL normalization (`https://api.mem0.ai/v1`), `Token <key>` / `Bearer <key>` authorization, `X-Org-Id` and `X-Project-Id` tracking headers, lightweight authenticated health probe (`/v1/memories?limit=1`), turn parsing into `messages: [{ role: 'user', content }, { role: 'assistant', content }]`, and `/memories/search` query dispatch.
- **F4: Mem0 Self-Hosted Support (5 tests)**:
  Custom `http://` and `https://` self-hosted URLs with arbitrary ports and subpaths, trailing slash sanitation, unauthenticated OSS instance support, and scheme enforcement.
- **F5: Memory Payload Normalization (5 tests)**:
  Normalization of raw Mem0 results to `{ id, title, subtitle, narrative, facts, score, sessionId, timestamp, metadata, raw }`, title derivation from metadata or truncated text, fact extraction, score precision rounding, and compatibility with popup card rendering and context generation.
- **F6: Dynamic Engine Switching via Settings (5 tests)**:
  `EngineFactory.createEngine` instantiation of `AgentMemoryEngine` vs `Mem0Engine`, fallback defaults, dynamic switching via service worker `SET_SETTINGS` message, and active engine status reporting.
- **F7: Google AI Studio Manifest Configuration (5 tests)**:
  Manifest V3 validity, `content_scripts` match for `https://aistudio.google.com/*` with `shared.js` and `aistudio.js`, `host_permissions` declaration for AI Studio and Mem0 Cloud, and permission declarations.
- **F8: Google AI Studio DOM Adapter Selectors & Hooks (5 tests)**:
  Adapter initialization with `platform: 'aistudio'`, custom element selectors (`ms-chat-prompt`, `ms-prompt-editor`), turn selectors (`[data-turn-role="User"]`, `[data-turn-role="Model"]`), input and run button selectors, and keyboard execution hook (`Ctrl+Enter` and `Cmd+Enter`).
- **F9: Framework-Safe Context Injection (5 tests)**:
  Angular/Material textarea descriptor setting via `HTMLTextAreaElement.prototype`, multi-event synthetic dispatch (`input`, `change`, `InputEvent` with `insertText`, `resize`), input focusing for CDK autosize recalculation, and preservation of existing text.
- **F10: Google AI Studio Auto-Save Toggle (5 tests)**:
  Default `aistudioAutoSave: true`, settings update to `false`, observation suppression (`skipped: true`) when toggled off, active capture when enabled, and independent isolation from other platform toggles.
- **F11: Local Conversation Archive Storage Schema (5 tests)**:
  Segmented storage in `chrome.storage.local`: session metadata array in `oam_archive_sessions`, dialogue turn transcripts in `oam_archive_turns_${sessionId}`, archive statistics in `oam_archive_meta`, sequential turn ID generation, ISO timestamps, dialogue parsing, and turn deduplication.
- **F12: Local History Query, Search, Export, and Delete (5 tests)**:
  Session index sorting by recency, platform-based filtering, full transcript keyword search, session detail inspection, session deletion, platform purge, and JSON & Markdown export generation.
- **F13: Popup & Settings UI Contract (6 tests)**:
  Service worker `STATUS` message contract compliance, `GET_SETTINGS` / `SET_SETTINGS` schema compatibility, popup memory card to context compilation, queue badge synchronization, and popup asset syntax integrity.

### Tier 2: Boundary & Corner Cases (40 tests, 5 tests per category)
- **B1: Empty & Whitespace Inputs (5 tests)**: Empty search queries, whitespace strings, null query parameters, empty turn payloads, and whitespace archive filters.
- **B2: Missing Credentials & Authentication Errors (5 tests)**: Missing API keys on Cloud, HTTP 401 unauthorized detection, HTTP 403 forbidden detection, unauthenticated daemon configurations, and remote auth rejection.
- **B3: Invalid & Malformed URLs (5 tests)**: Non-loopback IPs, external domains, invalid schemes (`data:`, `ftp:`), embedded basic auth credentials, and malformed URL strings.
- **B4: Network Timeouts & AbortSignal (5 tests)**: AbortSignal timeout handling, network disconnections (`ECONNREFUSED`), search timeouts, observe timeouts, and slow health check probes.
- **B5: Server HTTP Errors & Malformed Payloads (5 tests)**: HTTP 500 internal errors, HTTP 502 bad gateways, HTTP 429 rate limit responses, non-JSON HTML proxy errors, and empty responses.
- **B6: Unicode, Emojis, Long Strings, Escaping (5 tests)**: Multi-byte Japanese and emoji characters, massive prompts (>120,000 characters), multiline code blocks, control characters, and quote escaping in titles.
- **B7: Missing Assistant Responses & Asymmetric Dialogue (5 tests)**: User-only turns, assistant-only greetings, unformatted single-line turns, and formatted prompt synthesis.
- **B8: Storage Boundaries & Edge Conditions (5 tests)**: Deletion of non-existent sessions, clearing empty archives, null session ID queries, pagination offsets exceeding count, and rapid streaming turn updates.

### Tier 3: Cross-Feature Combinations (6 tests)
- **C1**: Dynamic engine switching while actively observing turns (routing from AgentMemory daemon to Mem0 Cloud with payload format transformation).
- **C2**: Zero-retention archiving resilience when external memory backend is unreachable.
- **C3**: Mem0 memory recall, normalization, queue staging, and synthetic context injection into simulated Google AI Studio DOM.
- **C4**: Searching local conversation transcripts while external engine is completely offline.
- **C5**: Interleaved multi-platform turn archiving across Google AI Studio, Gemini, ChatGPT, and Claude.
- **C6**: Comprehensive settings atomic update altering activeEngine, API credentials, and platform toggles in a single transaction.

### Tier 4: Real-World Scenarios (5 scenarios)
- **Scenario 1**: Multi-turn technical research conversation on Google AI Studio archived locally with zero-retention privacy (cloud activity logging disabled).
- **Scenario 2**: Seamless migration from AgentMemory to Mem0 Cloud with memory search, score rounding, and normalized display.
- **Scenario 3**: Complete backend outage resilience: zero data loss in local conversation archive and full JSON export recovery.
- **Scenario 4**: End-to-end memory recall, context queuing, badge update, and AI Studio prompt execution via `Ctrl+Enter`.
- **Scenario 5**: Multi-session lifecycle across all 5 platforms: accumulation, keyword transcript search, detail inspection, Markdown export, and selective platform purge.

---

## 3. Harness Architecture

The test harness simulates the browser extension environment within Node.js without requiring a headless browser:

1. **`createMockStorageArea(initialStore)`**:
   In-memory store providing asynchronous `get()`, `set()`, `remove()`, and `clear()` matching Chromium's `chrome.storage.local` and `chrome.storage.session` APIs.
2. **`createServiceWorkerHarness(initialSettings, customFetch)`**:
   Sandboxed `node:vm` environment running `service-worker.js`. Implements `importScripts(...)` to dynamically evaluate backend scripts (`base-engine.js`, `agentmemory-engine.js`, `mem0-engine.js`, `engine-factory.js`), captures `chrome.runtime.onMessage` listeners, and routes simulated extension messages.
3. **`bindMockChromeStorage(storageArea)`**:
   Temporarily binds mock storage to `globalThis.chrome.storage.local` to allow direct testing of `LocalArchive` static methods with automatic teardown in `finally` blocks.
4. **Mock Network Engine**:
   Interception layer recording URL, HTTP method, headers, JSON body, and AbortSignal for every request, with support for simulated latency, HTTP error codes, and malformed responses.
5. **Simulated DOM Environment**:
   Lightweight DOM mocking for `HTMLTextAreaElement`, `focus()`, and synthetic event dispatches (`Event`, `InputEvent`, `CustomEvent`) ensuring Angular/Wiz form compatibility.

---

## 4. How to Run the Tests

```bash
# Run the complete 4-tier E2E test suite
node test/e2e-suite.test.js

# Or run via Node's test runner with TAP/spec reporting
node --test test/e2e-suite.test.js

# Verify syntax across all test files
node --check test/e2e-suite.test.js test/local-archive.test.js test/aistudio-content.test.js
```
