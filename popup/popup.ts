// =============================================================================
// WebAI Memory — Popup Controller
// 3-Tab UI: Memories, Local History, Settings.
// Engine switcher (Local Mem0 / Mem0 Cloud / AgentMemory / Hindsight / Cognee).
// Local conversation archive browser with speech bubbles, transcript search, and export.
// =============================================================================

/* global chrome, LocalArchive */

'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  selectedMemories: new Map<string, NormalizedMemory>(),
  attachQueued: false,
  queuedCount: 0,
  currentHistoryPlatform: 'all',
  currentHistoryQuery: '',
  activeSessionId: null as string | null,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function msg(message: BackgroundMessage | Record<string, any>): Promise<any> {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
      resolve({ error: 'chrome.runtime is not available' });
      return;
    }
    chrome.runtime.sendMessage(message, (response: any) => {
      if (chrome.runtime.lastError) {
        resolve({ error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response || {});
    });
  });
}

function esc(str?: string | null): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function stableId(obs: any): string {
  const source = [
    obs.id,
    obs.sessionId,
    obs.timestamp,
    obs.title,
    obs.subtitle,
    obs.narrative,
  ].filter(Boolean).join('|');
  let hash = 0;
  for (let i = 0; i < source.length; i++) {
    hash = ((hash << 5) - hash) + source.charCodeAt(i);
    hash |= 0;
  }
  return `memory-${Math.abs(hash)}`;
}

function formatRelativeTime(isoString?: string | number | null): string {
  if (!isoString) return '';
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    if (diffMs < 0 || isNaN(diffMs)) return 'just now';

    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return `${diffSec}s ago`;

    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;

    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour}h ago`;

    const diffDays = Math.floor(diffHour / 24);
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

function formatPlatformName(platform?: string | null): string {
  const map: Record<string, string> = {
    aistudio: 'AI Studio',
    gemini: 'Gemini',
    chatgpt: 'ChatGPT',
    claude: 'Claude',
    grok: 'Grok',
  };
  return map[platform?.toLowerCase() || ''] || platform || 'Unknown';
}

function triggerDownload(dataString: string, filename = 'webai-memory-export.json'): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([dataString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Controller Initialization ─────────────────────────────────────────────────

async function initPopup(): Promise<void> {
  if (typeof document === 'undefined') return;

  // Element references
  const statusBadge = document.getElementById('status-badge');
  const statusText = document.getElementById('status-text');
  const apiUrlDisplay = document.getElementById('api-url-display');
  const dashboardLink = document.getElementById('dashboard-link') as HTMLAnchorElement | null;
  const offlineBanner = document.getElementById('offline-banner');
  const offlineTitle = document.getElementById('offline-title');
  const offlineHint = document.getElementById('offline-hint');
  const daemonCodeBlock = document.getElementById('daemon-code-block');
  const copyCmdBtn = document.getElementById('copy-cmd-btn');

  // Queue banner & Attach bar
  const queueBanner = document.getElementById('queue-banner');
  const queueLabel = document.getElementById('queue-label');
  const queueClearBtn = document.getElementById('queue-clear-btn');
  const attachBar = document.getElementById('attach-bar');
  const attachCount = document.getElementById('attach-count');
  const attachBtn = document.getElementById('attach-btn');

  // Memories tab
  const searchInput = document.getElementById('search-input') as HTMLInputElement | null;
  const searchBtn = document.getElementById('search-btn');
  const searchResults = document.getElementById('search-results');

  // Local History tab
  const historySearchInput = document.getElementById('history-search-input') as HTMLInputElement | null;
  const historySearchBtn = document.getElementById('history-search-btn');
  const platformFilters = document.getElementById('platform-filters');
  const historyCountLabel = document.getElementById('history-count-label');
  const historyExportBtn = document.getElementById('history-export-btn');
  const historyClearBtn = document.getElementById('history-clear-btn');
  const historySessionsList = document.getElementById('history-sessions-list');
  const sessionDetailView = document.getElementById('session-detail-view');
  const detailBackBtn = document.getElementById('detail-back-btn');
  const detailPlatformBadge = document.getElementById('detail-platform-badge');
  const detailSessionTitle = document.getElementById('detail-session-title');
  const detailDeleteBtn = document.getElementById('detail-delete-btn');
  const detailTurnsContainer = document.getElementById('detail-turns-container');

  // Settings tab
  const engineRadios = document.querySelectorAll<HTMLInputElement>('input[name="engine"]');
  const engineAgentMemory = document.getElementById('engine-agentmemory') as HTMLInputElement | null;
  const engineMem0Cloud = document.getElementById('engine-mem0-cloud') as HTMLInputElement | null;
  const engineMem0SelfHosted = document.getElementById('engine-mem0-selfhosted') as HTMLInputElement | null;
  const engineHindsight = document.getElementById('engine-hindsight') as HTMLInputElement | null;
  const engineCognee = document.getElementById('engine-cognee') as HTMLInputElement | null;

  const agentMemoryFields = document.getElementById('agentmemory-fields');
  const mem0Fields = document.getElementById('mem0-fields');
  const hindsightFields = document.getElementById('hindsight-fields');
  const cogneeFields = document.getElementById('cognee-fields');

  const apiUrlInput = document.getElementById('api-url') as HTMLInputElement | null;
  const apiSecretInput = document.getElementById('api-secret') as HTMLInputElement | null;
  const mem0ApiUrlInput = document.getElementById('mem0-api-url') as HTMLInputElement | null;
  const mem0ApiKeyInput = document.getElementById('mem0-api-key') as HTMLInputElement | null;
  const mem0UserIdInput = document.getElementById('mem0-user-id') as HTMLInputElement | null;
  const mem0OrgIdInput = document.getElementById('mem0-org-id') as HTMLInputElement | null;
  const mem0ProjectIdInput = document.getElementById('mem0-project-id') as HTMLInputElement | null;
  const hindsightApiUrlInput = document.getElementById('hindsight-api-url') as HTMLInputElement | null;
  const hindsightApiKeyInput = document.getElementById('hindsight-api-key') as HTMLInputElement | null;
  const hindsightBankIdInput = document.getElementById('hindsight-bank-id') as HTMLInputElement | null;
  const cogneeApiUrlInput = document.getElementById('cognee-api-url') as HTMLInputElement | null;
  const cogneeApiKeyInput = document.getElementById('cognee-api-key') as HTMLInputElement | null;
  const cogneeDatasetNameInput = document.getElementById('cognee-dataset-name') as HTMLInputElement | null;

  const aistudioSave = document.getElementById('aistudio-save') as HTMLInputElement | null;
  const geminiSave = document.getElementById('gemini-save') as HTMLInputElement | null;
  const chatgptSave = document.getElementById('chatgpt-save') as HTMLInputElement | null;
  const claudeSave = document.getElementById('claude-save') as HTMLInputElement | null;
  const grokSave = document.getElementById('grok-save') as HTMLInputElement | null;

  const localArchiveEnabled = document.getElementById('local-archive-enabled') as HTMLInputElement | null;
  const archiveStats = document.getElementById('archive-stats');
  const settingsExportHistoryBtn = document.getElementById('settings-export-history-btn');
  const settingsClearHistoryBtn = document.getElementById('settings-clear-history-btn');

  const showNotifications = document.getElementById('show-notifications') as HTMLInputElement | null;
  const settingsFeedback = document.getElementById('settings-feedback');
  const settingsError = document.getElementById('settings-error');
  const saveSettingsBtn = document.getElementById('save-settings') as HTMLButtonElement | null;

  // ---------------------------------------------------------------------------
  // 1. Tab Switching
  // ---------------------------------------------------------------------------
  const tabs = document.querySelectorAll<HTMLElement>('.tab');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      tabs.forEach((t) => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));

      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      const targetPanel = document.getElementById(`tab-${target}`);
      if (targetPanel) targetPanel.classList.add('active');

      if (target === 'history') {
        loadHistorySessions();
      } else if (target === 'settings') {
        loadArchiveStats();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Connectivity & Status Indicator
  // ---------------------------------------------------------------------------
  if (copyCmdBtn) {
    copyCmdBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText('agentmemory');
        copyCmdBtn.textContent = '✓';
      } catch {
        copyCmdBtn.textContent = '!';
      }
      setTimeout(() => { copyCmdBtn.textContent = '📋'; }, 2000);
    });
  }

  async function checkStatus(): Promise<any> {
    if (!statusBadge || !statusText) return;
    statusBadge.className = 'status-badge checking';
    statusText.textContent = 'Checking…';

    const res = await msg({ type: 'STATUS' });
    const activeEngine = res?.activeEngine || 'mem0';
    let engineLabel = 'Mem0';
    if (activeEngine === 'agentmemory') engineLabel = 'AgentMemory';
    else if (activeEngine === 'hindsight') engineLabel = 'Hindsight';
    else if (activeEngine === 'cognee') engineLabel = 'Cognee';

    if (res && res.connected) {
      statusBadge.className = 'status-badge connected';
      statusText.textContent = `${engineLabel}: Connected`;
      if (offlineBanner) offlineBanner.classList.add('hidden');
    } else {
      statusBadge.className = 'status-badge disconnected';
      statusText.textContent = `${engineLabel}: Offline`;
      if (offlineBanner) {
        offlineBanner.classList.remove('hidden');
        if (offlineTitle) offlineTitle.textContent = `${engineLabel} is offline`;
        if (offlineHint) {
          if (activeEngine === 'mem0') {
            const isLocal = !res?.apiUrl || res.apiUrl.includes('127.0.0.1') || res.apiUrl.includes('localhost');
            if (isLocal) {
              offlineHint.textContent = `Unable to connect to Local Mem0 (${res?.apiUrl || 'localhost:8000'}). Check that your local Mem0 server is running.`;
            } else {
              offlineHint.textContent = 'Unable to reach Mem0 endpoint. Check your API key, endpoint URL, or network in Settings.';
            }
          } else if (activeEngine === 'hindsight') {
            offlineHint.textContent = `Unable to connect to Hindsight service (${res?.apiUrl || 'localhost:8888'}). Check that Hindsight is running.`;
          } else if (activeEngine === 'cognee') {
            offlineHint.textContent = `Unable to connect to Cognee service (${res?.apiUrl || 'localhost:8000'}). Check that Cognee is running.`;
          } else {
            offlineHint.textContent = 'Unable to connect to local AgentMemory daemon. Start the daemon in your terminal:';
          }
        }
        if (daemonCodeBlock) {
          if (activeEngine === 'agentmemory') {
            daemonCodeBlock.classList.remove('hidden');
          } else {
            daemonCodeBlock.classList.add('hidden');
          }
        }
      }
    }

    if (apiUrlDisplay) {
      const displayUrl = (res?.apiUrl || '').replace(/^https?:\/\//, '');
      let fallbackPort = 'localhost:8000';
      if (activeEngine === 'agentmemory') fallbackPort = 'localhost:3111';
      else if (activeEngine === 'hindsight') fallbackPort = 'localhost:8888';
      else if (activeEngine === 'cognee') fallbackPort = 'localhost:8000';
      apiUrlDisplay.textContent = `${engineLabel} · ${displayUrl || fallbackPort}`;
    }

    if (dashboardLink) {
      if (res?.dashboardUrl) {
        dashboardLink.href = res.dashboardUrl;
        if (activeEngine === 'mem0') {
          const isLocal = !res?.apiUrl || res.apiUrl.includes('127.0.0.1') || res.apiUrl.includes('localhost');
          dashboardLink.title = isLocal ? 'Open Mem0 Management Console' : 'Open Mem0 Dashboard';
        } else if (activeEngine === 'hindsight') {
          dashboardLink.title = 'Open Hindsight Service';
        } else if (activeEngine === 'cognee') {
          dashboardLink.title = 'Open Cognee Service';
        } else {
          dashboardLink.title = 'Open AgentMemory Dashboard';
        }
      } else if (activeEngine === 'mem0') {
        const isLocal = !res?.apiUrl || res.apiUrl.includes('127.0.0.1') || res.apiUrl.includes('localhost');
        if (isLocal) {
          dashboardLink.href = res?.apiUrl || 'http://localhost:8000';
          dashboardLink.title = 'Open Mem0 Management Console';
        } else {
          dashboardLink.href = 'https://app.mem0.ai';
          dashboardLink.title = 'Open Mem0 Dashboard';
        }
      } else if (activeEngine === 'hindsight') {
        dashboardLink.href = res?.apiUrl || 'http://localhost:8888';
        dashboardLink.title = 'Open Hindsight Service';
      } else if (activeEngine === 'cognee') {
        dashboardLink.href = res?.apiUrl || 'http://localhost:8000';
        dashboardLink.title = 'Open Cognee Service';
      } else {
        dashboardLink.href = 'http://localhost:3113';
        dashboardLink.title = 'Open AgentMemory Dashboard';
      }
    }

    return res;
  }

  // ---------------------------------------------------------------------------
  // 3. Settings Management & Dynamic Engine Fields
  // ---------------------------------------------------------------------------
  function updateEngineFieldsVisibility(): void {
    const isAgentMemory = !!engineAgentMemory?.checked;
    const isMem0Cloud = !!engineMem0Cloud?.checked;
    const isMem0SelfHosted = !!engineMem0SelfHosted?.checked;
    const isHindsight = !!engineHindsight?.checked;
    const isCognee = !!engineCognee?.checked;

    if (agentMemoryFields) {
      if (isAgentMemory) agentMemoryFields.classList.remove('hidden');
      else agentMemoryFields.classList.add('hidden');
    }
    if (mem0Fields) {
      if (isMem0Cloud || isMem0SelfHosted) mem0Fields.classList.remove('hidden');
      else mem0Fields.classList.add('hidden');
    }
    if (hindsightFields) {
      if (isHindsight) hindsightFields.classList.remove('hidden');
      else hindsightFields.classList.add('hidden');
    }
    if (cogneeFields) {
      if (isCognee) cogneeFields.classList.remove('hidden');
      else cogneeFields.classList.add('hidden');
    }

    if (isMem0Cloud) {
      if (mem0ApiUrlInput && (!mem0ApiUrlInput.value || mem0ApiUrlInput.value.includes('localhost') || mem0ApiUrlInput.value.includes('127.0.0.1'))) {
        mem0ApiUrlInput.value = 'https://api.mem0.ai/v1';
      }
    } else if (isMem0SelfHosted) {
      if (mem0ApiUrlInput && (!mem0ApiUrlInput.value || mem0ApiUrlInput.value.includes('api.mem0.ai'))) {
        mem0ApiUrlInput.value = 'http://localhost:8000';
      }
    }
  }

  engineRadios.forEach((radio) => {
    radio.addEventListener('change', updateEngineFieldsVisibility);
  });

  async function loadSettings(): Promise<void> {
    const s = await msg({ type: 'GET_SETTINGS' });
    if (!s || s.error) return;

    // Active Engine selection
    const activeEngine = s.activeEngine || 'mem0';
    if (engineAgentMemory) engineAgentMemory.checked = (activeEngine === 'agentmemory');
    if (engineHindsight) engineHindsight.checked = (activeEngine === 'hindsight');
    if (engineCognee) engineCognee.checked = (activeEngine === 'cognee');

    if (activeEngine === 'mem0') {
      const isCloud = s.mem0ApiUrl && s.mem0ApiUrl.includes('api.mem0.ai');
      if (engineMem0Cloud) engineMem0Cloud.checked = !!isCloud;
      if (engineMem0SelfHosted) engineMem0SelfHosted.checked = !isCloud;
    } else {
      if (engineMem0Cloud) engineMem0Cloud.checked = false;
      if (engineMem0SelfHosted) engineMem0SelfHosted.checked = false;
    }
    updateEngineFieldsVisibility();

    // Field bindings
    if (apiUrlInput) apiUrlInput.value = s.apiUrl || 'http://localhost:3111';
    if (apiSecretInput) apiSecretInput.value = s.secret || '';
    if (mem0ApiUrlInput) mem0ApiUrlInput.value = s.mem0ApiUrl || 'http://localhost:8000';
    if (mem0ApiKeyInput) mem0ApiKeyInput.value = s.mem0ApiKey || '';
    if (mem0UserIdInput) mem0UserIdInput.value = s.mem0UserId || 'default_user';
    if (mem0OrgIdInput) mem0OrgIdInput.value = s.mem0OrgId || '';
    if (mem0ProjectIdInput) mem0ProjectIdInput.value = s.mem0ProjectId || '';
    if (hindsightApiUrlInput) hindsightApiUrlInput.value = s.hindsightApiUrl || 'http://localhost:8888';
    if (hindsightApiKeyInput) hindsightApiKeyInput.value = s.hindsightApiKey || '';
    if (hindsightBankIdInput) hindsightBankIdInput.value = s.hindsightBankId || 'default';
    if (cogneeApiUrlInput) cogneeApiUrlInput.value = s.cogneeApiUrl || 'http://localhost:8000';
    if (cogneeApiKeyInput) cogneeApiKeyInput.value = s.cogneeApiKey || '';
    if (cogneeDatasetNameInput) cogneeDatasetNameInput.value = s.cogneeDatasetName || 'main';

    // Auto-save toggles
    if (aistudioSave) aistudioSave.checked = s.aistudioAutoSave !== false;
    if (geminiSave) geminiSave.checked = s.geminiAutoSave !== false;
    if (chatgptSave) chatgptSave.checked = s.chatgptAutoSave !== false;
    if (claudeSave) claudeSave.checked = s.claudeAutoSave !== false;
    if (grokSave) grokSave.checked = s.grokAutoSave !== false;

    // Misc
    if (localArchiveEnabled) localArchiveEnabled.checked = s.localArchiveEnabled !== false;
    if (showNotifications) showNotifications.checked = s.showNotifications === true;
  }

  // Auto-save instant toggle listeners
  if (aistudioSave) aistudioSave.addEventListener('change', () => msg({ type: 'SET_SETTINGS', settings: { aistudioAutoSave: aistudioSave.checked } }));
  if (geminiSave) geminiSave.addEventListener('change', () => msg({ type: 'SET_SETTINGS', settings: { geminiAutoSave: geminiSave.checked } }));
  if (chatgptSave) chatgptSave.addEventListener('change', () => msg({ type: 'SET_SETTINGS', settings: { chatgptAutoSave: chatgptSave.checked } }));
  if (claudeSave) claudeSave.addEventListener('change', () => msg({ type: 'SET_SETTINGS', settings: { claudeAutoSave: claudeSave.checked } }));
  if (grokSave) grokSave.addEventListener('change', () => msg({ type: 'SET_SETTINGS', settings: { grokAutoSave: grokSave.checked } }));
  if (showNotifications) showNotifications.addEventListener('change', () => msg({ type: 'SET_SETTINGS', settings: { showNotifications: showNotifications.checked } }));
  if (localArchiveEnabled) localArchiveEnabled.addEventListener('change', () => msg({ type: 'SET_SETTINGS', settings: { localArchiveEnabled: localArchiveEnabled.checked } }));

  // Save & Test Connection
  if (saveSettingsBtn) {
    saveSettingsBtn.addEventListener('click', async () => {
      if (settingsError) {
        settingsError.classList.add('hidden');
        settingsError.textContent = '';
      }
      if (settingsFeedback) {
        settingsFeedback.classList.add('hidden');
        settingsFeedback.textContent = '';
      }

      let activeEngine = 'mem0';
      if (engineAgentMemory?.checked) activeEngine = 'agentmemory';
      else if (engineHindsight?.checked) activeEngine = 'hindsight';
      else if (engineCognee?.checked) activeEngine = 'cognee';
      else if (engineMem0Cloud?.checked || engineMem0SelfHosted?.checked) activeEngine = 'mem0';

      const payload = {
        activeEngine,
        apiUrl: apiUrlInput ? apiUrlInput.value.trim().replace(/\/+$/, '') : 'http://localhost:3111',
        secret: apiSecretInput ? apiSecretInput.value.trim() : '',
        mem0ApiUrl: mem0ApiUrlInput ? mem0ApiUrlInput.value.trim().replace(/\/+$/, '') : 'http://localhost:8000',
        mem0ApiKey: mem0ApiKeyInput ? mem0ApiKeyInput.value.trim() : '',
        mem0UserId: mem0UserIdInput ? mem0UserIdInput.value.trim() : 'default_user',
        mem0OrgId: mem0OrgIdInput ? mem0OrgIdInput.value.trim() : '',
        mem0ProjectId: mem0ProjectIdInput ? mem0ProjectIdInput.value.trim() : '',
        hindsightApiUrl: hindsightApiUrlInput ? hindsightApiUrlInput.value.trim().replace(/\/+$/, '') : 'http://localhost:8888',
        hindsightApiKey: hindsightApiKeyInput ? hindsightApiKeyInput.value.trim() : '',
        hindsightBankId: hindsightBankIdInput ? hindsightBankIdInput.value.trim() : 'default',
        cogneeApiUrl: cogneeApiUrlInput ? cogneeApiUrlInput.value.trim().replace(/\/+$/, '') : 'http://localhost:8000',
        cogneeApiKey: cogneeApiKeyInput ? cogneeApiKeyInput.value.trim() : '',
        cogneeDatasetName: cogneeDatasetNameInput ? cogneeDatasetNameInput.value.trim() : 'main',
        aistudioAutoSave: aistudioSave ? aistudioSave.checked : true,
        geminiAutoSave: geminiSave ? geminiSave.checked : true,
        chatgptAutoSave: chatgptSave ? chatgptSave.checked : true,
        claudeAutoSave: claudeSave ? claudeSave.checked : true,
        grokAutoSave: grokSave ? grokSave.checked : true,
        localArchiveEnabled: localArchiveEnabled ? localArchiveEnabled.checked : true,
        showNotifications: showNotifications ? showNotifications.checked : false,
      };

      const result = await msg({ type: 'SET_SETTINGS', settings: payload });
      if (result.error) {
        if (settingsError) {
          settingsError.textContent = result.error;
          settingsError.classList.remove('hidden');
        }
        return;
      }

      saveSettingsBtn.textContent = 'Testing…';
      const status = await checkStatus();

      if (status && status.connected) {
        saveSettingsBtn.textContent = 'Saved ✓';
        saveSettingsBtn.classList.add('saved');
        if (settingsFeedback) {
          let engineTitle = 'Mem0';
          if (status.activeEngine === 'agentmemory') engineTitle = 'AgentMemory';
          else if (status.activeEngine === 'hindsight') engineTitle = 'Hindsight';
          else if (status.activeEngine === 'cognee') engineTitle = 'Cognee';
          settingsFeedback.textContent = `Connected to ${engineTitle} successfully.`;
          settingsFeedback.classList.remove('hidden');
        }
      } else {
        saveSettingsBtn.textContent = 'Saved (Offline)';
        if (settingsError) {
          settingsError.textContent = `Saved, but connection failed: ${status?.error || 'Endpoint unreachable'}`;
          settingsError.classList.remove('hidden');
        }
      }

      setTimeout(() => {
        saveSettingsBtn.textContent = 'Save & Test Connection';
        saveSettingsBtn.classList.remove('saved');
      }, 2500);
    });
  }

  // ---------------------------------------------------------------------------
  // 4. Local Conversation Archive Browser
  // ---------------------------------------------------------------------------

  async function fetchLocalSessions(filter: { platform?: string; query?: string } = {}): Promise<SessionMetadata[]> {
    const platform = filter.platform ?? state.currentHistoryPlatform;
    const query = filter.query ?? state.currentHistoryQuery;

    // Try service worker message protocol first
    const res = await msg({
      type: 'GET_LOCAL_SESSIONS',
      platform: platform === 'all' ? undefined : platform,
      query: query || undefined,
    });
    if (res && Array.isArray(res.sessions)) {
      return res.sessions;
    }

    // Direct LocalArchive fallback
    if (typeof LocalArchive !== 'undefined' && typeof LocalArchive.getSessions === 'function') {
      try {
        return await LocalArchive.getSessions({
          platform: platform === 'all' ? undefined : platform,
          query: query || undefined,
        });
      } catch (err) {
        console.warn('LocalArchive fallback getSessions failed:', err);
      }
    }
    return [];
  }

  async function fetchSessionDetails(sessionId: string): Promise<{ session: SessionMetadata | null; turns: ConversationTurn[] }> {
    const res = await msg({ type: 'GET_LOCAL_SESSION_DETAILS', sessionId });
    if (res && (res.turns || res.session)) {
      return res;
    }
    if (typeof LocalArchive !== 'undefined' && typeof LocalArchive.getSessionDetails === 'function') {
      try {
        return await LocalArchive.getSessionDetails(sessionId);
      } catch (err) {
        console.warn('LocalArchive fallback getSessionDetails failed:', err);
      }
    }
    return { session: null, turns: [] };
  }

  async function deleteSessionAction(sessionId: string): Promise<any> {
    const res = await msg({ type: 'DELETE_LOCAL_SESSION', sessionId });
    if (res && res.success !== undefined) return res;

    if (typeof LocalArchive !== 'undefined' && typeof LocalArchive.deleteSession === 'function') {
      return await LocalArchive.deleteSession(sessionId);
    }
    return { success: false };
  }

  async function clearHistoryAction(platform?: string): Promise<any> {
    const res = await msg({
      type: 'CLEAR_LOCAL_HISTORY',
      platform: platform === 'all' ? undefined : platform,
    });
    if (res && res.success !== undefined) return res;

    if (typeof LocalArchive !== 'undefined' && typeof LocalArchive.clearHistory === 'function') {
      return await LocalArchive.clearHistory({
        platform: platform === 'all' ? undefined : platform,
      });
    }
    return { success: false };
  }

  async function exportHistoryAction(): Promise<void> {
    const res = await msg({ type: 'EXPORT_LOCAL_HISTORY', format: 'json' });
    if (res && res.data) {
      triggerDownload(res.data, res.filename || `webai-memory-history-${Date.now()}.json`);
      return;
    }

    if (typeof LocalArchive !== 'undefined' && typeof LocalArchive.exportHistory === 'function') {
      const exp = await LocalArchive.exportHistory({ format: 'json' });
      const dataStr = exp.data || String(exp);
      const filename = exp.filename || `webai-memory-history-${Date.now()}.json`;
      triggerDownload(dataStr, filename);
    }
  }

  async function loadArchiveStats(): Promise<void> {
    if (!archiveStats) return;
    try {
      const sessions = await fetchLocalSessions({ platform: 'all', query: '' });
      let totalTurns = 0;
      for (const s of sessions) {
        totalTurns += s.turnCount || 0;
      }
      archiveStats.textContent = `Preserved: ${sessions.length} session${sessions.length === 1 ? '' : 's'} (${totalTurns} turn${totalTurns === 1 ? '' : 's'})`;
    } catch {
      archiveStats.textContent = 'Preserved: 0 sessions';
    }
  }

  function buildSessionCard(s: SessionMetadata): HTMLElement {
    const card = document.createElement('div');
    card.className = 'session-card';
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('data-session-id', s.id);

    const platform = s.platform || 'unknown';
    const platformLabel = formatPlatformName(platform);
    const timeStr = formatRelativeTime(s.updatedAt || s.createdAt);
    const turnsCount = s.turnCount || 0;
    const title = s.title || 'Untitled Conversation';
    const snippet = s.snippet || '';

    card.innerHTML = `
      <div class="session-header">
        <div class="session-badges">
          <span class="platform-badge platform-${esc(platform)}">${esc(platformLabel)}</span>
          <span class="session-time">${esc(timeStr)}</span>
        </div>
        <button class="btn-delete-session" title="Delete conversation" aria-label="Delete conversation">🗑️</button>
      </div>
      <div class="session-title">${esc(title)}</div>
      ${snippet ? `<div class="session-snippet">${esc(snippet)}</div>` : ''}
      <div class="session-footer">
        <span class="session-turns-pill">${turnsCount} turn${turnsCount === 1 ? '' : 's'}</span>
      </div>
    `;

    // Delete session
    const delBtn = card.querySelector('.btn-delete-session');
    if (delBtn) {
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm('Delete this conversation session from local history?')) {
          await deleteSessionAction(s.id);
          await loadHistorySessions();
          await loadArchiveStats();
        }
      });
    }

    // Expand session detail
    card.addEventListener('click', () => openSessionDetail(s.id));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openSessionDetail(s.id);
      }
    });

    return card;
  }

  async function loadHistorySessions(): Promise<void> {
    if (!historySessionsList) return;
    historySessionsList.innerHTML = '<div class="loading-text">Loading sessions…</div>';

    const sessions = await fetchLocalSessions();

    if (historyCountLabel) {
      historyCountLabel.textContent = `${sessions.length} session${sessions.length === 1 ? '' : 's'}`;
    }

    if (!sessions || sessions.length === 0) {
      const isFiltered = state.currentHistoryPlatform !== 'all' || state.currentHistoryQuery;
      historySessionsList.innerHTML = `
        <div class="no-results">
          ${isFiltered ? 'No conversations match the selected filter.' : 'No conversations archived yet.<br><span style="font-size:10px; color:#a1a1aa">Chat on Gemini, AI Studio, ChatGPT, Claude, or Grok to record conversations locally.</span>'}
        </div>
      `;
      return;
    }

    historySessionsList.innerHTML = '';
    sessions.forEach((s) => historySessionsList.appendChild(buildSessionCard(s)));
  }

  async function openSessionDetail(sessionId: string): Promise<void> {
    state.activeSessionId = sessionId;
    if (!sessionDetailView) return;

    // Toggle views
    if (historySessionsList) historySessionsList.classList.add('hidden');
    if (platformFilters) platformFilters.classList.add('hidden');
    const historyActionsBar = document.querySelector('.history-actions-bar');
    if (historyActionsBar) historyActionsBar.classList.add('hidden');
    const historySearchBox = historySearchInput?.closest('.search-box');
    if (historySearchBox) historySearchBox.classList.add('hidden');

    sessionDetailView.classList.remove('hidden');
    if (detailTurnsContainer) detailTurnsContainer.innerHTML = '<div class="loading-text">Loading dialogue turns…</div>';

    const details = await fetchSessionDetails(sessionId);
    const session = details.session || {} as SessionMetadata;
    const turns = details.turns || [];

    if (detailPlatformBadge) {
      const p = session.platform || 'unknown';
      detailPlatformBadge.className = `platform-badge platform-${p}`;
      detailPlatformBadge.textContent = formatPlatformName(p);
    }
    if (detailSessionTitle) {
      detailSessionTitle.textContent = session.title || 'Conversation Thread';
    }

    if (!detailTurnsContainer) return;
    detailTurnsContainer.innerHTML = '';

    if (turns.length === 0) {
      detailTurnsContainer.innerHTML = '<div class="no-results">No dialogue turns recorded in this session.</div>';
      return;
    }

    turns.forEach((turn) => {
      const timeStr = formatRelativeTime(turn.timestamp);

      // User speech bubble
      if (turn.userText || turn.userPrompt) {
        const userBubble = document.createElement('div');
        userBubble.className = 'turn-bubble user';
        userBubble.innerHTML = `
          <div class="bubble-header">
            <span>User</span>
            <span class="bubble-time">${esc(timeStr)}</span>
          </div>
          <div class="bubble-text">${esc(turn.userText || turn.userPrompt)}</div>
        `;
        detailTurnsContainer.appendChild(userBubble);
      }

      // Assistant speech bubble
      if (turn.assistantText || turn.assistantResponse) {
        const assistantBubble = document.createElement('div');
        assistantBubble.className = 'turn-bubble assistant';
        assistantBubble.innerHTML = `
          <div class="bubble-header">
            <span>Assistant</span>
            <span class="bubble-time">${esc(timeStr)}</span>
          </div>
          <div class="bubble-text">${esc(turn.assistantText || turn.assistantResponse)}</div>
        `;
        detailTurnsContainer.appendChild(assistantBubble);
      }
    });

    // Auto-scroll to bottom of conversation
    detailTurnsContainer.scrollTop = detailTurnsContainer.scrollHeight;
  }

  function closeSessionDetail(): void {
    state.activeSessionId = null;
    if (sessionDetailView) sessionDetailView.classList.add('hidden');
    if (historySessionsList) historySessionsList.classList.remove('hidden');
    if (platformFilters) platformFilters.classList.remove('hidden');
    const historyActionsBar = document.querySelector('.history-actions-bar');
    if (historyActionsBar) historyActionsBar.classList.remove('hidden');
    const historySearchBox = historySearchInput?.closest('.search-box');
    if (historySearchBox) historySearchBox.classList.remove('hidden');
  }

  if (detailBackBtn) detailBackBtn.addEventListener('click', closeSessionDetail);

  if (detailDeleteBtn) {
    detailDeleteBtn.addEventListener('click', async () => {
      if (!state.activeSessionId) return;
      if (confirm('Delete this conversation thread from local history?')) {
        await deleteSessionAction(state.activeSessionId);
        closeSessionDetail();
        await loadHistorySessions();
        await loadArchiveStats();
      }
    });
  }

  // Platform Filter Pills
  if (platformFilters) {
    platformFilters.querySelectorAll('.pill').forEach((pill) => {
      pill.addEventListener('click', () => {
        platformFilters.querySelectorAll('.pill').forEach((p) => p.classList.remove('active'));
        pill.classList.add('active');
        state.currentHistoryPlatform = (pill as HTMLElement).dataset.platform || 'all';
        loadHistorySessions();
      });
    });
  }

  // History search handlers
  if (historySearchBtn) {
    historySearchBtn.addEventListener('click', () => {
      state.currentHistoryQuery = historySearchInput ? historySearchInput.value.trim() : '';
      loadHistorySessions();
    });
  }
  if (historySearchInput) {
    historySearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        state.currentHistoryQuery = historySearchInput.value.trim();
        loadHistorySessions();
      }
    });
  }

  // Export & Clear history buttons
  if (historyExportBtn) historyExportBtn.addEventListener('click', exportHistoryAction);
  if (settingsExportHistoryBtn) settingsExportHistoryBtn.addEventListener('click', exportHistoryAction);

  async function handleClearHistory(): Promise<void> {
    const isFiltered = state.currentHistoryPlatform !== 'all';
    const msgPrompt = isFiltered
      ? `Permanently delete all local conversation history for ${formatPlatformName(state.currentHistoryPlatform)}?`
      : 'Permanently delete all conversation history across all platforms?';

    if (confirm(msgPrompt)) {
      await clearHistoryAction(state.currentHistoryPlatform);
      closeSessionDetail();
      await loadHistorySessions();
      await loadArchiveStats();
    }
  }

  if (historyClearBtn) historyClearBtn.addEventListener('click', handleClearHistory);
  if (settingsClearHistoryBtn) settingsClearHistoryBtn.addEventListener('click', handleClearHistory);

  // ---------------------------------------------------------------------------
  // 5. Memories & Context Queueing
  // ---------------------------------------------------------------------------

  function updateAttachBar(): void {
    if (!attachBar || !attachCount || !attachBtn) return;
    const count = state.selectedMemories.size;
    if (count === 0) {
      attachBar.classList.add('hidden');
      state.attachQueued = false;
      attachBtn.textContent = '📎 Queue for next prompt';
      attachBtn.classList.remove('queued');
    } else {
      attachBar.classList.remove('hidden');
      attachCount.textContent = `${count} selected`;
      if (!state.attachQueued) {
        attachBtn.textContent = '📎 Queue for next prompt';
        attachBtn.classList.remove('queued');
      }
    }
  }

  function toggleCard(card: HTMLElement, id: string, obsData: any): void {
    if (state.selectedMemories.has(id)) {
      state.selectedMemories.delete(id);
      card.classList.remove('selected');
      card.setAttribute('aria-checked', 'false');
    } else {
      state.selectedMemories.set(id, obsData);
      card.classList.add('selected');
      card.setAttribute('aria-checked', 'true');
    }
    if (state.attachQueued) {
      state.attachQueued = false;
      if (attachBtn) {
        attachBtn.textContent = '📎 Queue for next prompt';
        attachBtn.classList.remove('queued');
      }
    }
    updateAttachBar();
  }

  function updateQueueBanner(text: string): void {
    if (!queueBanner || !queueLabel) return;
    if (!text) {
      queueBanner.classList.add('hidden');
      return;
    }
    const count = state.queuedCount || state.selectedMemories.size;
    queueLabel.textContent = `${count} memor${count === 1 ? 'y' : 'ies'} queued for next prompt`;
    queueBanner.classList.remove('hidden');
  }

  if (attachBtn) {
    attachBtn.addEventListener('click', async () => {
      if (state.attachQueued || state.selectedMemories.size === 0) return;

      let contextText = '';
      for (const [, obs] of state.selectedMemories) {
        const title = obs.title || obs.subtitle || '';
        const narrative = obs.narrative || '';
        const facts = (obs.facts || []).join('; ');
        if (title) contextText += `### ${title}\n`;
        if (narrative) contextText += `${narrative}\n`;
        if (facts) contextText += `Key facts: ${facts}\n`;
        contextText += '\n';
      }

      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
        await chrome.storage.session.set({ oamQueuedContext: contextText.trim() });
      }

      await msg({ type: 'SET_QUEUE_COUNT', count: state.selectedMemories.size });
      state.queuedCount = state.selectedMemories.size;

      state.attachQueued = true;
      attachBtn.textContent = `✓ ${state.selectedMemories.size} memor${state.selectedMemories.size === 1 ? 'y' : 'ies'} queued — send your prompt`;
      attachBtn.classList.add('queued');
      updateQueueBanner(contextText.trim());
    });
  }

  if (queueClearBtn) {
    queueClearBtn.addEventListener('click', async () => {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
        await chrome.storage.session.remove('oamQueuedContext');
      }
      await msg({ type: 'SET_QUEUE_COUNT', count: 0 });
      state.selectedMemories.clear();
      state.queuedCount = 0;
      document.querySelectorAll('.result-card.selected').forEach((c) => c.classList.remove('selected'));
      state.attachQueued = false;
      if (queueBanner) queueBanner.classList.add('hidden');
      updateAttachBar();
    });
  }

  async function initQueueBanner(): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.session) return;
    const data: any = await chrome.storage.session.get(['oamQueuedContext', 'oamQueueCount']);
    if (data.oamQueuedContext) {
      state.queuedCount = Number.isInteger(data.oamQueueCount) ? (data.oamQueueCount as number) : 1;
      state.attachQueued = true;
      updateQueueBanner(String(data.oamQueuedContext));
    }
  }

  function buildMemoryCard(item: any): HTMLElement {
    const obs = item.observation || item;
    const id = stableId(obs);
    const title = obs.title || obs.subtitle || 'Memory';
    const snippet = obs.narrative || (obs.facts || []).slice(0, 2).join('. ') || '';
    const meta = obs.sessionId || '';

    const card = document.createElement('div');
    card.className = 'result-card';
    card.tabIndex = 0;
    card.setAttribute('role', 'checkbox');
    card.setAttribute('aria-checked', 'false');
    card.innerHTML = `
      <div class="card-check">✓</div>
      <div class="card-body">
        <div class="result-title">${esc(title)}</div>
        <div class="result-snippet">${esc(snippet)}</div>
        ${meta ? `<div class="result-meta">${esc(meta)}</div>` : ''}
      </div>
    `;

    if (state.selectedMemories.has(id)) {
      card.classList.add('selected');
      card.setAttribute('aria-checked', 'true');
    }

    card.addEventListener('click', () => toggleCard(card, id, obs));
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggleCard(card, id, obs);
      }
    });
    return card;
  }

  async function doSearch(forcedQuery: string | null = null): Promise<void> {
    if (!searchInput || !searchResults) return;
    const query = forcedQuery !== null ? forcedQuery : searchInput.value.trim();

    if (query) {
      searchResults.innerHTML = '<div class="loading-text">Searching recalled memories…</div>';
    } else {
      searchResults.innerHTML = '<div class="loading-text">Loading recent memories…</div>';
    }

    const r = await msg({ type: 'SEARCH', platform: 'popup', query, limit: 8 });

    if (!r || r.error) {
      searchResults.innerHTML = `<div class="no-results">Error: ${esc(r?.error || 'No response from memory backend')}</div>`;
      return;
    }

    const items = r.results || [];
    if (items.length === 0) {
      if (query) {
        searchResults.innerHTML = '<div class="no-results">No matching memories found.</div>';
      } else {
        searchResults.innerHTML = '<div class="hint-text">No recent memories found across your AI sessions.</div>';
      }
      return;
    }

    searchResults.innerHTML = '';
    while (searchResults.firstChild) {
      searchResults.removeChild(searchResults.firstChild);
    }
    if (Array.isArray(searchResults.children)) {
      (searchResults.children as any).length = 0;
    }
    items.forEach((item: any) => searchResults.appendChild(buildMemoryCard(item)));
  }

  if (searchBtn) searchBtn.addEventListener('click', () => doSearch());
  if (searchInput) {
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doSearch();
      if (e.key === 'Escape') {
        searchInput.value = '';
        doSearch('');
      }
    });
    searchInput.addEventListener('input', () => {
      if (!searchInput.value.trim()) {
        doSearch('');
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Boot sequence
  // ---------------------------------------------------------------------------
  await Promise.all([
    checkStatus(),
    loadSettings(),
    initQueueBanner(),
    loadArchiveStats(),
    doSearch(''),
  ]);
  updateAttachBar();
}

// Auto-run when DOM ready in browser
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPopup);
  } else {
    initPopup();
  }
}

// Export for zero-dependency unit tests
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    state,
    msg,
    esc,
    stableId,
    formatRelativeTime,
    formatPlatformName,
    initPopup,
  };
}
