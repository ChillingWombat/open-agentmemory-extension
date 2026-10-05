// =============================================================================
// WebAI Memory — Core Type Definitions
// Multi-engine memory extension type system: backends, content scripts, popup,
// service worker, and background message protocols.
// =============================================================================

export interface NormalizedMemory {
  id: string;
  title: string;
  subtitle?: string;
  narrative: string;
  facts: string[];
  score?: number;
  sessionId?: string;
  timestamp?: string;
  metadata?: Record<string, any>;
  raw?: any;
}

export interface ConversationTurn {
  turnId?: string;
  timestamp?: string | number;
  userText?: string;
  assistantText?: string;
  platform?: string;
  sessionId?: string;
  content?: string;
  userPrompt?: string;
  assistantResponse?: string;
  title?: string;
}

export interface SessionMetadata {
  id: string;
  platform: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  turnCount: number;
  snippet: string;
  turns?: ConversationTurn[];
}

export interface ArchiveMeta {
  totalSessions: number;
  totalTurns: number;
  lastArchivedAt: string | null;
}

export interface EngineSettings {
  activeEngine: 'mem0' | 'agentmemory' | 'hindsight' | 'cognee' | string;
  mem0ApiUrl: string;
  mem0ApiKey: string;
  mem0UserId: string;
  mem0OrgId: string;
  mem0ProjectId: string;
  apiUrl: string;
  secret: string;
  hindsightApiUrl: string;
  hindsightApiKey: string;
  hindsightBankId: string;
  cogneeApiUrl: string;
  cogneeApiKey: string;
  cogneeDatasetName: string;
  geminiAutoSave: boolean;
  chatgptAutoSave: boolean;
  claudeAutoSave: boolean;
  grokAutoSave: boolean;
  aistudioAutoSave: boolean;
  localArchiveEnabled: boolean;
  showNotifications: boolean;
}

export interface HealthCheckResult {
  connected: boolean;
  engine?: string;
  version?: string;
  error?: string;
  status?: string;
  authenticated?: boolean;
}

// -----------------------------------------------------------------------------
// Background Messages (Discriminated Union)
// -----------------------------------------------------------------------------

export interface ObserveMessage {
  type: 'OBSERVE';
  platform?: string;
  sessionId?: string;
  content?: string;
  userPrompt?: string;
  assistantResponse?: string;
  timestamp?: string;
}

export interface SearchMessage {
  type: 'SEARCH';
  query: string;
  limit?: number;
  platform?: string;
}

export interface SessionStartMessage {
  type: 'SESSION_START';
  sessionId: string;
  platform?: string;
  project?: string;
}

export interface SessionEndMessage {
  type: 'SESSION_END';
  sessionId: string;
}

export interface StatusMessage {
  type: 'STATUS';
}

export interface GetSettingsMessage {
  type: 'GET_SETTINGS';
}

export interface SetSettingsMessage {
  type: 'SET_SETTINGS';
  settings: Partial<EngineSettings>;
}

export interface SetQueueCountMessage {
  type: 'SET_QUEUE_COUNT';
  count: number;
}

export interface ContextSentMessage {
  type: 'CONTEXT_SENT';
}

export interface GetLocalSessionsMessage {
  type: 'GET_LOCAL_SESSIONS';
  platform?: string;
  query?: string;
  limit?: number;
  offset?: number;
}

export interface GetLocalSessionDetailsMessage {
  type: 'GET_LOCAL_SESSION_DETAILS' | 'GET_SESSION_DETAILS';
  sessionId: string;
}

export interface DeleteLocalSessionMessage {
  type: 'DELETE_LOCAL_SESSION' | 'DELETE_SESSION';
  sessionId: string;
}

export interface ClearLocalHistoryMessage {
  type: 'CLEAR_LOCAL_HISTORY';
  platform?: string;
}

export interface ExportLocalHistoryMessage {
  type: 'EXPORT_LOCAL_HISTORY';
  format?: 'json' | 'markdown' | 'md' | string;
  platform?: string;
  sessionId?: string;
}

export type BackgroundMessage =
  | ObserveMessage
  | SearchMessage
  | SessionStartMessage
  | SessionEndMessage
  | StatusMessage
  | GetSettingsMessage
  | SetSettingsMessage
  | SetQueueCountMessage
  | ContextSentMessage
  | GetLocalSessionsMessage
  | GetLocalSessionDetailsMessage
  | DeleteLocalSessionMessage
  | ClearLocalHistoryMessage
  | ExportLocalHistoryMessage;

// -----------------------------------------------------------------------------
// Background Responses
// -----------------------------------------------------------------------------

export interface ObserveResponse {
  success?: boolean;
  skipped?: boolean;
  id?: string;
  error?: string;
  showToast?: boolean;
  status?: number;
}

export interface SearchResponse {
  results: NormalizedMemory[];
  error?: string;
  status?: number;
}

export interface StatusResponse {
  connected: boolean;
  activeEngine: string;
  apiUrl: string;
  dashboardUrl: string;
  version?: string;
  error?: string;
}

export interface ExportHistoryResponse {
  data: string;
  filename: string;
  error?: string;
}

export interface PlatformConfig {
  platform: string;
  conversationSelectors: string[];
  userMessageSelectors: string[];
  assistantMessageSelectors: string[];
  inputSelectors: string[];
  sendButtonSelectors: string[];
}

// -----------------------------------------------------------------------------
// Global Ambient Declarations for Extension Scripts
// -----------------------------------------------------------------------------

declare global {
  function importScripts(...urls: string[]): void;

  interface NormalizedMemory {
    id: string;
    title: string;
    subtitle?: string;
    narrative: string;
    facts: string[];
    score?: number;
    sessionId?: string;
    timestamp?: string;
    metadata?: Record<string, any>;
    raw?: any;
  }

  interface ConversationTurn {
    turnId?: string;
    timestamp?: string | number;
    userText?: string;
    assistantText?: string;
    platform?: string;
    sessionId?: string;
    content?: string;
    userPrompt?: string;
    assistantResponse?: string;
    title?: string;
  }

  interface SessionMetadata {
    id: string;
    platform: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    turnCount: number;
    snippet: string;
    turns?: ConversationTurn[];
  }

  interface ArchiveMeta {
    totalSessions: number;
    totalTurns: number;
    lastArchivedAt: string | null;
  }

  interface EngineSettings {
    activeEngine: 'mem0' | 'agentmemory' | 'hindsight' | 'cognee' | string;
    mem0ApiUrl: string;
    mem0ApiKey: string;
    mem0UserId: string;
    mem0OrgId: string;
    mem0ProjectId: string;
    apiUrl: string;
    secret: string;
    hindsightApiUrl: string;
    hindsightApiKey: string;
    hindsightBankId: string;
    cogneeApiUrl: string;
    cogneeApiKey: string;
    cogneeDatasetName: string;
    geminiAutoSave: boolean;
    chatgptAutoSave: boolean;
    claudeAutoSave: boolean;
    grokAutoSave: boolean;
    aistudioAutoSave: boolean;
    localArchiveEnabled: boolean;
    showNotifications: boolean;
  }

  interface HealthCheckResult {
    connected: boolean;
    engine?: string;
    version?: string;
    error?: string;
    status?: string;
    authenticated?: boolean;
  }

  interface ObserveResponse {
    success?: boolean;
    skipped?: boolean;
    id?: string;
    error?: string;
    showToast?: boolean;
    status?: number;
  }

  interface SearchResponse {
    results: NormalizedMemory[];
    error?: string;
    status?: number;
  }

  interface StatusResponse {
    connected: boolean;
    activeEngine: string;
    apiUrl: string;
    dashboardUrl: string;
    version?: string;
    error?: string;
  }

  interface ExportHistoryResponse {
    data: string;
    filename: string;
    error?: string;
  }

  interface PlatformConfig {
    platform: string;
    conversationSelectors: string[];
    userMessageSelectors: string[];
    assistantMessageSelectors: string[];
    inputSelectors: string[];
    sendButtonSelectors: string[];
  }

  type BackgroundMessage =
    | ObserveMessage
    | SearchMessage
    | SessionStartMessage
    | SessionEndMessage
    | StatusMessage
    | GetSettingsMessage
    | SetSettingsMessage
    | SetQueueCountMessage
    | ContextSentMessage
    | GetLocalSessionsMessage
    | GetLocalSessionDetailsMessage
    | DeleteLocalSessionMessage
    | ClearLocalHistoryMessage
    | ExportLocalHistoryMessage;
}
