# Specification: WebAI Memory Extension

## Problem Statement

When users interact with web AI interfaces—such as Google Gemini, Google AI Studio, ChatGPT, Claude, and Grok—they face privacy and memory dilemmas:
1. **Privacy vs. History Trade-Off**: AI providers commonly use user chat histories for model training and potential human evaluation unless users opt out. However, opting out of activity tracking (such as turning off Google Apps Activity on Gemini) disables cloud-saved conversation history entirely, preventing users from ever reviewing or retrieving past sessions.
2. **Platform Siloing & Fragmented Context**: Context is isolated within each proprietary chat service. A user designing an architecture on Claude cannot recall notes or architectural facts from an earlier conversation on Gemini or Google AI Studio.
3. **Lack of Pluggable Memory Engine Support**: Previously, memory extensions were locked to a single daemon running on arbitrary, hardcoded ports without support for modern memory frameworks (such as Mem0, Hindsight, or Cognee).
4. **Initial Empty State & Port Inconsistencies**: Extensions often fail to show existing context upon opening because vector search with an empty query returns zero results, and conflicting port assignments confuse users regarding where local services run.
5. **UI Clutter & Visual Distortion**: Inconsistent layout containers cause input fields to bleed against popup borders, making settings difficult to navigate.

---

## Solution

**WebAI Memory** is a privacy-first, zero-dependency browser extension that:
1. **Locally Preserves Conversations for Zero-Retention Privacy**: Automatically captures conversation turns in browser client storage (`chrome.storage.local`), allowing users to disable cloud tracking on AI providers while retaining an searchable, exportable local history.
2. **Pluggable Memory Engines**: Provides modular support for five memory backends:
   - **Local Mem0 (Self-Hosted)** (default port `8000`)
   - **Mem0 Cloud** (`https://api.mem0.ai/v1`)
   - **AgentMemory** (default port `3111`)
   - **Hindsight** (default port `8888`)
   - **Cognee** (default port `8000`)
3. **Automatic Memory Auto-Load & Instant Recall**: Automatically retrieves and renders recent memories upon popup launch and whenever search queries are cleared, with real-time semantic search on active queries.
4. **Universal AI Web Support**: Injects and observes context across Google Gemini, Google AI Studio, ChatGPT, Claude, and xAI Grok.
5. **Google Material Design 3 Interface**: Features clean card grouping with consistent spacing, clear connection diagnostics, and user-configurable endpoints for every engine.

---

## User Stories

1. As a privacy-conscious user, I want my conversations on Google Gemini and Google AI Studio to be saved locally on my device, so that I can disable cloud activity tracking without losing past work.
2. As a user, I want the extension popup to display my most recent memories as soon as I open it, so that I do not stare at an empty search box.
3. As a developer, I want to connect my browser chats to a self-hosted Mem0 instance running on port 8000, so that I maintain full control of my embeddings and vector database.
4. As a developer, I want to connect to Mem0 Cloud using an API key, so that I can synchronize memories across distributed agent workflows.
5. As an AgentMemory user, I want backward-compatible support for my existing loopback daemon on port 3111, so that my legacy memory workflows continue running uninterrupted.
6. As a researcher, I want to connect to a Hindsight memory service on port 8888, so that conversational turns are retained and recalled using bank-level memory management.
7. As a data engineer, I want to route conversational memories to Cognee on port 8000, so that my chats are cognified into structured knowledge graphs.
8. As a user, I want to customize the endpoint URL and port for any memory engine in the Settings tab, so that I can connect to non-standard ports or remote tunnels.
9. As a user, I want to select memories in the popup and click "Queue for next prompt", so that the relevant facts are automatically prepended to my input on Google AI Studio or Gemini.
10. As a user, I want each engine's settings in the popup to be grouped within cleanly styled cards, so that input borders do not bleed against the edge of the window.
11. As a user, I want to view my past conversation sessions in a dedicated Local History tab, so that I can review full dialogues with speaker bubbles.
12. As a user, I want to filter my local conversation history by AI platform, so that I can easily find sessions originating from a specific tool.
13. As a user, I want to search full-text transcripts across all locally saved sessions, so that I can locate past answers by keyword.
14. As a user, I want to export my entire conversation history to a structured JSON bundle, so that I can backup or migrate my data.
15. As a user, I want to clear local history per platform or purge all history with confirmation, so that I maintain complete data hygiene.
16. As a user, I want to toggle auto-saving on or off for individual AI platforms independently, so that I choose exactly where recording occurs.
17. As a user, I want clear visual indicators when my selected memory engine is connected or offline, so that I immediately know if my local server needs starting.
18. As a user, I want one-click navigation to the active engine's web dashboard or local console directly from the header, so that I can inspect raw vectors or graph structures.
19. As a user, I want the search box to reload recent memories when I press Escape or backspace the query, so that I can browse without closing and reopening the popup.
20. As an enterprise user, I want an optional master toggle to disable local archiving completely, so that no conversation data is written to disk when strict ephemeral policies apply.

---

## Implementation Decisions

### Architectural Seams
- **Memory Engine Seam**: Abstracted behind a common contract (`BaseMemoryEngine`) requiring:
  - `checkHealth()`: Connectivity and authentication probe.
  - `observe(turn)`: Formats and stores conversation turns.
  - `search({ query, limit })`: Performs semantic search for non-empty queries, and retrieves recent memory lists for empty queries.
  - `getDashboardUrl()`: Returns the console or web management URL.
- **Service Worker Message Bus**: Central messaging layer routing:
  - `STATUS`: Verifies health and provides active engine metadata.
  - `SEARCH`: Dispatches memory recall or recent listing.
  - `OBSERVE`: Archives to local store and dispatches turn to active backend.
  - `GET_SETTINGS` / `SET_SETTINGS`: Persists user preferences and custom endpoints.
  - `GET_LOCAL_SESSIONS`, `GET_LOCAL_SESSION_DETAILS`, `DELETE_LOCAL_SESSION`, `CLEAR_LOCAL_HISTORY`, `EXPORT_LOCAL_HISTORY`: Manages local conversation storage.
- **Local Archive Storage Schema**:
  - Segmented `chrome.storage.local` store:
    - `oam_archive_sessions`: Array of session metadata summaries.
    - `oam_archive_turns_<sessionId>`: Array of turns containing user prompts, model responses, timestamps, and platform identifiers.

### Default Port Standards
- **Local Mem0**: `http://localhost:8000` (FastAPI / OSS default).
- **Mem0 Cloud**: `https://api.mem0.ai/v1`.
- **AgentMemory**: `http://localhost:3111` (daemon default).
- **Hindsight**: `http://localhost:8888`.
- **Cognee**: `http://localhost:8000`.
- All ports are fully editable in Settings and persist to extension storage.

### UI / Layout Decisions
- **Popup Container**: Fixed dimensions at 390px width and 540px height with `overflow: hidden` on root containers and flex scroll panels on tab bodies.
- **Grouping Container**: Every configuration section is wrapped in `.settings-group` cards with Google Material 3 styling (`12px` border radius, `1px solid #dadce0`, `16px` outer margins).
- **Recent Memories on Boot**: `initPopup()` triggers recent memory loading during startup and whenever search text is cleared.

---

## Testing Decisions

### What Makes a Good Test
- **External Behavior Verification**: Tests execute against the top-level message router (`service-worker.js`), DOM controller actions (`popup.js`), and adapter interfaces (`backends/*.js`), avoiding coupling to internal private methods.
- **Resilience to Network and Timeout Failures**: All network dependencies use mock fetch harnesses to simulate offline states, 401 unauthorized responses, 404 version fallbacks, and slow network abort signals.
- **Zero External Dependencies**: All tests run natively with `node --test` and `node:assert/strict`.

### Modules Tested
- `service-worker.js`: Engine switching, message validation, setting persistence, and privacy toggle gating.
- `backends/agentmemory-engine.js`: Loopback origin enforcement, secret authentication, and observe/search pipelines.
- `backends/mem0-engine.js`: Cloud /v1 normalization, token formatting, `/api/memories` local console fallback, and empty query handling.
- `backends/hindsight-engine.js`: Port 8888 defaults, `/retain` observation, `/recall` search, and `/api/v1/` route fallbacks.
- `backends/cognee-engine.js`: Port 8000 defaults, `/add` and background cognify dispatch, dataset scoping, and `/memories` fallback.
- `backends/local-archive.js`: Session indexing, turn deduplication, streaming turn updates, search filtering, export generation, and platform clearing.
- `popup/popup.js` & `popup.html`: Tab switching, DOM initialization, auto-loading recent memories, HTMLCollection safety, dynamic credential visibility, and settings dispatch.

### Prior Art
- Existing multi-tier test suite in `test/*.test.js` passing 231/231 automated assertions with zero regressions.

---

## Out of Scope
- Automated background sync with third-party cloud synchronization providers (e.g., Google Drive / Dropbox sync).
- Mobile browser support (designed exclusively for Chromium Manifest V3 desktop extensions).
- Training custom embedding models inside the extension service worker.

---

## Further Notes
- Live local testing requires loading unpacked at `chrome://extensions`.
- If the remote GitHub issue tracker requires automated issue creation, run `/setup-matt-pocock-skills` to configure valid API credentials.
