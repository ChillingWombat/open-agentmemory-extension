# WebAI Memory

A browser extension that saves your chats from AI web interfaces—Gemini, Google AI Studio, ChatGPT, Claude, and Grok—and connects them to pluggable memory engines like [Mem0](https://mem0.ai), [AgentMemory](https://github.com/rohitg00/agentmemory), [Hindsight](https://github.com/vector-database/hindsight), and [Cognee](https://github.com/topoteretes/cognee), or safely preserves them client-side in a zero-retention local archive.

### Why use this?

If you turn off history or activity tracking on services like Gemini (for example, to stop providers from retaining your data or training models on it), their web apps stop saving your past chats.

This extension keeps a copy saved locally on your own machine. You get the privacy benefits of turning off cloud history without losing track of your conversations.

If you also configure a memory engine (such as Local Mem0, Mem0 Cloud, AgentMemory, Hindsight, or Cognee), it sends the dialogue turns there too, so you can search past memories and inject them into future prompts.

---

## What it does

- **Keeps a local history**: Saves your chats in your browser (`chrome.storage.local`). You can read past sessions, search transcripts, and export them to Markdown or JSON anytime.
- **Works with memory engines**: Pluggable support for **Local Mem0** (default), **Mem0 Cloud**, **AgentMemory**, **Hindsight**, **Cognee**, or standalone **Local Archive Only**.
- **Supports popular AI chats**:
  - Google Gemini (`gemini.google.com`)
  - Google AI Studio (`aistudio.google.com`)
  - ChatGPT (`chatgpt.com`, `chat.openai.com`)
  - Claude (`claude.ai`)
  - Grok (`grok.com`)
- **Memory recall**: Search your memories from the popup and queue relevant notes to prepend to your next prompt.
- **Per-site toggles**: Turn auto-save on or off for each site independently.

---

## Quick Start

### 1. Load the extension in your browser

1. Clone or download this repo (`git clone https://github.com/ChillingWombat/webai-memory.git`).
2. Open `chrome://extensions` in Chrome, Brave, Edge, or any Chromium browser.
3. Turn on **Developer mode** (top right switch).
4. Click **Load unpacked** and select this project folder.

### 2. Choose your memory setup (optional)

Click the extension icon and open the **Settings** tab:

- **Local Mem0** *(Default)*:
  - Connects automatically to your local Mem0 server/console at `http://localhost:8000` with zero configuration needed.
- **Mem0 Cloud**:
  - Select **Mem0 Cloud**, leave the endpoint as `https://api.mem0.ai/v1`, and paste your API key.
- **AgentMemory**:
  - Connects to a local loopback daemon (`http://localhost:3111`). Enter your bearer secret if configured.
- **Hindsight**:
  - Connects to a local Hindsight agent memory service at `http://localhost:8888`.
- **Cognee**:
  - Connects to a local Cognee knowledge graph memory service at `http://localhost:8000`.
- **Local Archive Only**:
  - Even if no memory daemon is running, full conversation turns are safely archived client-side in your browser for zero-retention privacy.

Click **Save & Test Connection** to verify.

---

## How to use it

1. **Chat as usual**: Open Gemini, Google AI Studio, ChatGPT, Claude, or Grok. Once the assistant finishes its reply, the exchange is saved.
2. **Review past chats**: Click the extension icon and open **Local History**. Click any conversation to view the full dialogue, or search keywords across all past sessions.
3. **Bring past context into a prompt**:
   - In the popup, go to **Memories** and search a topic.
   - Select the notes you want and click **Queue for next prompt**.
   - Back in your chat tab, your selected context will be added to your input box before sending.

---

## Privacy

- Your conversation archive stays in your browser's local storage.
- If you use a local engine (Local Mem0, AgentMemory, Hindsight, or Cognee), network calls only go to your local machine (`localhost` / `127.0.0.1`).
- If you use Mem0 Cloud, memories are sent to `api.mem0.ai` using your own API key.
- The extension does not collect analytics or route your data through any third-party relay.

---

## Notes & Development

- **DOM Selectors**: These web interfaces update their layouts from time to time. If saving stops working on a site, check the selectors in `content/<site>.js`.
- **Run tests**:
  ```bash
  npm test
  ```
  Runs the built-in test suite (no extra npm packages needed).
- **Check syntax**:
  ```bash
  node --check service-worker.js
  node --check popup/popup.js
  ```
