# Project: WebAI Memory Extension Refactor & Upgrade

## Architecture
WebAI Memory is a zero-dependency Manifest V3 Chromium browser extension providing long-term memory and local conversation archiving across web AI chat platforms.

### High-Level Components
1. **Background Service Worker (`service-worker.js`)**:
   - Central message router (`OBSERVE`, `SEARCH`, `STATUS`, `SESSION_START`, `SESSION_END`, `GET_SETTINGS`, `SET_SETTINGS`, `ARCHIVE_*`, `SET_QUEUE_COUNT`, `CONTEXT_SENT`).
   - Delegates memory backend operations via `EngineFactory` to pluggable `BaseMemoryEngine` implementations (`AgentMemoryEngine`, `Mem0Engine`).
   - Delegates client-side zero-retention chat logging to `LocalArchive`.
   - Manages extension badge, alarms (`statusCheck`), and settings persistence in `chrome.storage.local`.
2. **Pluggable Memory Backends (`backends/`)**:
   - `backends/base-engine.js`: Abstract base contract & normalized memory schema (`NormalizedMemory`).
   - `backends/agentmemory-engine.js`: Backward-compatible loopback daemon client (`http://localhost:3111/agentmemory/*`, Bearer auth).
   - `backends/mem0-engine.js`: Mem0 Cloud (`https://api.mem0.ai/v1`) & self-hosted REST API client (`/memories`, `/memories/search`, Bearer/Token auth, message parsing, payload normalization).
   - `backends/hindsight-engine.js`: Hindsight agent memory service client (`http://localhost:8888`, retain/recall, bank ID).
   - `backends/cognee-engine.js`: Cognee knowledge graph memory client (`http://localhost:8000`, add/cognify/search, datasets).
   - `backends/engine-factory.js`: Instantiates active engine based on settings.
   - `backends/local-archive.js`: Independent zero-retention chat archive in `chrome.storage.local`.
3. **Platform Adapters & Content Scripts (`content/`)**:
   - `content/shared.js`: Core runtime (DOM observer, debounced mutation detector, message pair extraction, input injection, queued context banner).
   - `content/gemini.js`: Gemini adapter.
   - `content/chatgpt.js`: ChatGPT adapter.
   - `content/claude.js`: Claude adapter.
   - `content/grok.js`: Grok adapter.
   - `content/aistudio.js`: Google AI Studio adapter (`https://aistudio.google.com/*`) supporting chat, freeform, and structured prompts.
4. **Popup & Settings UI (`popup/`)**:
   - `popup/popup.html`, `popup/popup.css`, `popup/popup.js`: 3-tab interface (`Memories`, `Local History`, `Settings`).
   - Engine switcher, dynamic credentials, live connectivity badge.
   - Local conversation history browser, transcript search, session expansion, JSON export, clear history.
5. **Testing Track (`test/`)**:
   - Zero-dependency Node.js test runner using `node:test` and `node:assert/strict`.
   - `test/service-worker.test.js`: Service worker message routing, AgentMemory regression suite, Mem0 engine suite, local archive suite, and settings suite.
   - `test/e2e-suite.test.js`: Comprehensive 4-tier requirement verification suite.

---

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Pluggable Engine Abstraction (`BaseMemoryEngine`) | Define common interface: checkHealth, observe, search, startSession, endSession | M1 | ORIGINAL_REQUEST §R1 |
| 2 | AgentMemory Engine Backward Compatibility | Maintain exact loopback endpoints (`/agentmemory/*`), Bearer auth, and schema | M1 | ORIGINAL_REQUEST §R1 |
| 3 | Mem0 Cloud REST API Integration | Connect to `https://api.mem0.ai/v1`, Bearer/Token auth, `/memories` add & search | M1 | ORIGINAL_REQUEST §R1 |
| 4 | Mem0 Self-Hosted Support | Support customizable HTTP/HTTPS endpoints for OSS Mem0 instances | M1 | ORIGINAL_REQUEST §R1 |
| 5 | Memory Payload Normalization | Normalize Mem0 responses to `{ id, title, narrative, facts, score }` for UI & prompt injection | M1 | ORIGINAL_REQUEST §R1 |
| 6 | Engine Factory & Dynamic Switching | Switch active engine dynamically based on stored settings | M1 | ORIGINAL_REQUEST §R1 |
| 7 | Host Permissions for Mem0 | Add `https://api.mem0.ai/*` and self-hosted host patterns to `manifest.json` | M1 | ORIGINAL_REQUEST §R1 |
| 8 | Google AI Studio Manifest Configuration | Add `https://aistudio.google.com/*` to `content_scripts` and `host_permissions` | M2 | ORIGINAL_REQUEST §R2 |
| 9 | Google AI Studio DOM Adapter (`content/aistudio.js`) | Selectors for `ms-chat-turn`, `[data-turn-role="User|Model"]`, inputs, and Run buttons | M2 | ORIGINAL_REQUEST §R2 |
| 10 | Framework-Safe Context Injection | Multi-event synthetic dispatch (`input`, `change`, `InputEvent`) for Angular/Wiz inputs | M2 | ORIGINAL_REQUEST §R2 |
| 11 | Execution Trigger & Shortcut Support | Support `Ctrl+Enter` and `Cmd+Enter` key triggers alongside button click | M2 | ORIGINAL_REQUEST §R2 |
| 12 | Google AI Studio Auto-Save Toggle | Add `aistudioAutoSave` setting, suppressing capture when toggled off | M2 | ORIGINAL_REQUEST §R2 |
| 13 | Local Conversation Archive Storage Schema | Segmented `chrome.storage.local` store: `oam_archive_sessions` index + `oam_archive_turns_${id}` | M3 | ORIGINAL_REQUEST §R3 |
| 14 | Automatic Turn Capture & Zero-Retention Flow | Automatically save captured turns client-side during `OBSERVE` even if engine offline | M3 | ORIGINAL_REQUEST §R3 |
| 15 | Local Session Retrieval & Querying | Query sessions by platform and search query (`GET_LOCAL_SESSIONS`, `GET_LOCAL_SESSION_DETAILS`) | M3 | ORIGINAL_REQUEST §R3 |
| 16 | History Export & Purge Actions | Export history as JSON (`EXPORT_LOCAL_HISTORY`) and delete/clear sessions (`DELETE_LOCAL_SESSION`, `CLEAR_LOCAL_HISTORY`) | M3 | ORIGINAL_REQUEST §R3 |
| 17 | Unlimited Storage Permission | Declare `"unlimitedStorage"` in `manifest.json` to prevent local storage quota failures | M3 | ORIGINAL_REQUEST §R3 |
| 18 | Popup Engine Switcher & Credential UI | UI for switching between AgentMemory and Mem0, with dynamic fields for API keys/URLs | M4 | ORIGINAL_REQUEST §R4 |
| 19 | Live Engine Connectivity Indicators | Visual indicators reflecting active engine health (`AgentMemory` vs `Mem0`) | M4 | ORIGINAL_REQUEST §R4 |
| 20 | Popup Local History Browser | Dedicated History tab: session list, preview, platform filters, expand dialogue thread | M4 | ORIGINAL_REQUEST §R4 |
| 21 | Popup Transcript Search & Export | Search local transcripts from popup, export JSON, and clear history | M4 | ORIGINAL_REQUEST §R4 |
| 22 | Google AI Studio Toggle in Popup Settings | Settings toggle for Google AI Studio alongside Gemini, ChatGPT, Claude, Grok | M4 | ORIGINAL_REQUEST §R4 |
| 23 | E2E Test Suite (Tiers 1-4) | Comprehensive opaque-box test suite verifying all requirements against public interfaces | E2E | ORIGINAL_REQUEST Acceptance Criteria |
| 24 | Final Milestone Verification & Adversarial Hardening | Pass 100% of E2E tests, node --check across all files, zero regressions, and adversarial review | M5 | ORIGINAL_REQUEST Acceptance Criteria |

---

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| E2E | E2E Testing Track | Requirement-driven test suite (`test/e2e-suite.test.js`, `TEST_INFRA.md`, `TEST_READY.md`) covering Tiers 1-4 | none | DONE |
| M1 | Pluggable Memory Backend Architecture | `backends/base-engine.js`, `backends/agentmemory-engine.js`, `backends/mem0-engine.js`, `backends/engine-factory.js`, `manifest.json` host_permissions, `service-worker.js` engine routing, unit tests in `test/service-worker.test.js` | none | DONE |
| M2 | Google AI Studio Platform Support | `content/aistudio.js`, `manifest.json` content_scripts & host_permissions, `content/shared.js` shortcuts & input injection, `service-worker.js` auto-save toggle | none | DONE |
| M3 | Local Conversation Archive & Zero-Retention Storage | `backends/local-archive.js`, `manifest.json` unlimitedStorage, `service-worker.js` OBSERVE local capture & archive message handlers, unit tests | none | DONE |
| M4 | Settings & Popup UI Enhancements | `popup/popup.html`, `popup/popup.css`, `popup/popup.js` 3-tab layout (Memories, Local History, Settings), engine switcher, history browser, status indicators | M1, M2, M3 | DONE |
| M5 | Final Milestone: Full E2E & Hardening | Phase 1: Pass 100% E2E test suite (Tiers 1-4); Phase 2: Adversarial coverage hardening (Tier 5) | E2E, M1, M2, M3, M4 | DONE |

---

## Interface Contracts

### 1. `BaseMemoryEngine` Interface Contract
```javascript
class BaseMemoryEngine {
  async checkHealth() // returns { connected: boolean, engine: string, version?: string, error?: string }
  async observe(turn)  // returns { success: boolean, id?: string, error?: string }
  async search(params) // returns { results: NormalizedMemory[], error?: string }
  async startSession(params) // returns { ok: boolean }
  async endSession(params)   // returns { ok: boolean }
}
```

### 2. `NormalizedMemory` Data Contract
```javascript
{
  id: string,          // Unique identifier
  title: string,       // Card headline
  subtitle: string,    // Secondary category / project
  narrative: string,   // Main body / text
  facts: string[],     // Key bullet points
  score?: number,      // Match relevance score
  sessionId?: string,  // Originating session
  timestamp?: string,  // ISO timestamp string
  metadata?: object    // Engine-specific raw metadata
}
```

### 3. `LocalArchive` Interface Contract (`backends/local-archive.js`)
```javascript
class LocalArchive {
  static async saveTurn(turn) // turn: { platform, sessionId, userText, assistantText, timestamp }
  static async getSessions({ platform, query, limit, offset } = {})
  static async getSessionDetails(sessionId)
  static async deleteSession(sessionId)
  static async clearHistory({ platform } = {})
  static async exportHistory({ format = 'json', platform } = {})
}
```

### 4. Background Service Worker Message Protocol
| Message Type | Request Payload | Response Payload |
|---|---|---|
| `OBSERVE` | `{ platform, content, sessionId, userPrompt, assistantResponse }` | `{ success: boolean, skipped?: boolean, error?: string }` |
| `SEARCH` | `{ query, limit }` | `{ results: NormalizedMemory[], error?: string }` |
| `STATUS` | `{}` | `{ connected: boolean, activeEngine: string, apiUrl: string, version?: string, error?: string }` |
| `GET_SETTINGS` | `{}` | `ExtensionSettings` object |
| `SET_SETTINGS` | `Partial<ExtensionSettings>` | `{ success: boolean, error?: string }` |
| `GET_LOCAL_SESSIONS` | `{ platform?: string, query?: string }` | `{ sessions: ArchivedSessionSummary[] }` |
| `GET_LOCAL_SESSION_DETAILS` | `{ sessionId: string }` | `{ session: ArchivedSessionSummary, turns: ArchivedTurn[] }` |
| `DELETE_LOCAL_SESSION` | `{ sessionId: string }` | `{ success: boolean }` |
| `CLEAR_LOCAL_HISTORY` | `{ platform?: string }` | `{ success: boolean }` |
| `EXPORT_LOCAL_HISTORY` | `{ format?: 'json' | 'markdown' }` | `{ data: string, filename: string }` |
| `SET_QUEUE_COUNT` | `{ count: number }` | `{ ok: boolean }` |
| `CONTEXT_SENT` | `{}` | `{ ok: boolean }` |

---

## Code Layout
```text
/mnt/Data/Projects/OpenAgentMemory/
├── manifest.json
├── package.json
├── service-worker.js
├── backends/
│   ├── base-engine.js
│   ├── agentmemory-engine.js
│   ├── mem0-engine.js
│   ├── engine-factory.js
│   └── local-archive.js
├── content/
│   ├── shared.js
│   ├── gemini.js
│   ├── chatgpt.js
│   ├── claude.js
│   ├── grok.js
│   └── aistudio.js
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
└── test/
    ├── service-worker.test.js
    └── e2e-suite.test.js
```
