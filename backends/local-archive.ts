// =============================================================================
// WebAI Memory — Client-Side Local Conversation Archive
// Zero-retention storage operating on chrome.storage.local
// =============================================================================

'use strict';

class LocalArchive {
  static get SESSIONS_KEY(): string {
    return 'oam_archive_sessions';
  }

  static get TURNS_PREFIX(): string {
    return 'oam_archive_turns_';
  }

  static get META_KEY(): string {
    return 'oam_archive_meta';
  }

  /**
   * Internal wrapper for chrome.storage.local.get supporting both Promises and callbacks.
   */
  static async _getStorage(keys: string | string[] | null | undefined): Promise<Record<string, any>> {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
      throw new Error('chrome.storage.local is not available');
    }
    const result: any = chrome.storage.local.get(keys as any);
    if (result && typeof result.then === 'function') {
      return await result;
    }
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(keys as any, (items: any) => {
        if (chrome.runtime?.lastError) {
          reject(new Error(chrome.runtime.lastError.message || String(chrome.runtime.lastError)));
        } else {
          resolve(items || {});
        }
      });
    });
  }

  /**
   * Internal wrapper for chrome.storage.local.set supporting both Promises and callbacks.
   */
  static async _setStorage(items: Record<string, any>): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
      throw new Error('chrome.storage.local is not available');
    }
    const result: any = chrome.storage.local.set(items);
    if (result && typeof result.then === 'function') {
      return await result;
    }
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(items, () => {
        if (chrome.runtime?.lastError) {
          reject(new Error(chrome.runtime.lastError.message || String(chrome.runtime.lastError)));
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Internal wrapper for chrome.storage.local.remove supporting both Promises and callbacks.
   */
  static async _removeStorage(keys: string | string[]): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
      throw new Error('chrome.storage.local is not available');
    }
    const result: any = chrome.storage.local.remove(keys as any);
    if (result && typeof result.then === 'function') {
      return await result;
    }
    return new Promise((resolve, reject) => {
      chrome.storage.local.remove(keys as any, () => {
        if (chrome.runtime?.lastError) {
          reject(new Error(chrome.runtime.lastError.message || String(chrome.runtime.lastError)));
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Extracts user prompt and assistant response from turn payload.
   * Handles direct properties (userPrompt/assistantResponse, userText/assistantText)
   * or parses dialogue formatted content ("User: ...\n\nAssistant: ...").
   */
  static _extractDialogue(turn: Record<string, any>): { userText: string; assistantText: string } {
    let userText = turn.userText || turn.userPrompt || '';
    let assistantText = turn.assistantText || turn.assistantResponse || '';

    if ((!userText || !assistantText) && typeof turn.content === 'string') {
      const content = turn.content.trim();
      const userIdx = content.search(/^User:\s*/i);
      const assistantIdx = content.search(/\n\s*Assistant:\s*/i);

      if (userIdx !== -1 && assistantIdx !== -1) {
        if (!userText) {
          userText = content.slice(userIdx, assistantIdx).replace(/^User:\s*/i, '').trim();
        }
        if (!assistantText) {
          assistantText = content.slice(assistantIdx).replace(/^\n\s*Assistant:\s*/i, '').trim();
        }
      } else if (userIdx !== -1) {
        if (!userText) {
          userText = content.replace(/^User:\s*/i, '').trim();
        }
      } else if (!userText && !assistantText) {
        userText = content;
      }
    }

    return {
      userText: String(userText || '').trim(),
      assistantText: String(assistantText || '').trim(),
    };
  }

  /**
   * Generates a concise title from the user's initial prompt.
   */
  static _generateTitle(userText: string, fallbackTitle?: string): string {
    if (fallbackTitle && typeof fallbackTitle === 'string' && fallbackTitle.trim()) {
      return fallbackTitle.trim();
    }
    if (!userText) return 'New Conversation';
    const firstLine = userText.split('\n')[0].trim();
    if (firstLine.length <= 80) return firstLine;
    return firstLine.slice(0, 77) + '...';
  }

  /**
   * Generates a snippet preview from the assistant response or user text.
   */
  static _generateSnippet(assistantText?: string, userText?: string): string {
    const text = assistantText || userText || '';
    const cleaned = text.replace(/\s+/g, ' ').trim();
    if (cleaned.length <= 200) return cleaned;
    return cleaned.slice(0, 197) + '...';
  }

  /**
   * Saves or appends a dialogue turn to a session.
   * Updates session indexing, turn logs, and archive metadata.
   */
  static async saveTurn(turn: Partial<ConversationTurn> & Record<string, any> = {}): Promise<any> {
    const { userText, assistantText } = this._extractDialogue(turn);
    const platform = String(turn.platform || 'unknown').toLowerCase();
    const sessionId = String(
      turn.sessionId ||
      turn.id ||
      `session_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    );
    const timestamp = turn.timestamp || new Date().toISOString();

    const turnsKey = `${this.TURNS_PREFIX}${sessionId}`;
    const storageData = await this._getStorage([this.SESSIONS_KEY, turnsKey]);

    const sessions: SessionMetadata[] = Array.isArray(storageData[this.SESSIONS_KEY])
      ? storageData[this.SESSIONS_KEY]
      : [];
    const turns: ConversationTurn[] = Array.isArray(storageData[turnsKey])
      ? storageData[turnsKey]
      : [];

    let isDeduplicated = false;
    let assignedTurnId: string | undefined = undefined;

    // Check if updating an existing turn by turnId
    const existingIndex = turn.turnId ? turns.findIndex((t) => t.turnId === turn.turnId) : -1;

    if (existingIndex !== -1) {
      turns[existingIndex] = {
        ...turns[existingIndex],
        userText: userText || turns[existingIndex].userText,
        assistantText: assistantText || turns[existingIndex].assistantText,
        timestamp,
        platform: platform || turns[existingIndex].platform,
      };
      assignedTurnId = turn.turnId;
    } else {
      const lastTurn = turns.length > 0 ? turns[turns.length - 1] : null;

      // Check if this turn is an exact duplicate of the most recent turn
      if (lastTurn && lastTurn.userText === userText) {
        if (lastTurn.assistantText === assistantText) {
          // Exact duplicate: return early without duplicate append
          return {
            success: true,
            deduplicated: true,
            sessionId,
            turnId: lastTurn.turnId,
            turnCount: turns.length,
          };
        } else if (!lastTurn.assistantText || assistantText.startsWith(lastTurn.assistantText)) {
          // Streaming or incremental completion of the active turn
          lastTurn.assistantText = assistantText;
          lastTurn.timestamp = timestamp;
          assignedTurnId = lastTurn.turnId;
          isDeduplicated = true;
        } else {
          // New response/variant to the same prompt
          assignedTurnId = `turn_${turns.length + 1}`;
          turns.push({
            turnId: assignedTurnId,
            timestamp,
            userText,
            assistantText,
            platform,
          });
        }
      } else {
        assignedTurnId = turn.turnId || `turn_${turns.length + 1}`;
        turns.push({
          turnId: assignedTurnId,
          timestamp,
          userText,
          assistantText,
          platform,
        });
      }
    }

    // Update session summary index
    const sessionIndex = sessions.findIndex((s) => s.id === sessionId);
    const snippet = this._generateSnippet(assistantText, userText);

    if (sessionIndex !== -1) {
      const existingSession = sessions[sessionIndex];
      existingSession.updatedAt = String(timestamp);
      existingSession.turnCount = turns.length;
      existingSession.snippet = snippet;
      if (turn.title) existingSession.title = turn.title;
      if (platform && platform !== 'unknown') existingSession.platform = platform;

      // Move recently updated session to top
      if (sessionIndex > 0) {
        sessions.splice(sessionIndex, 1);
        sessions.unshift(existingSession);
      }
    } else {
      const newSession: SessionMetadata = {
        id: sessionId,
        platform,
        title: this._generateTitle(userText, turn.title),
        createdAt: String(timestamp),
        updatedAt: String(timestamp),
        turnCount: turns.length,
        snippet,
      };
      sessions.unshift(newSession);
    }

    // Update global archive metadata
    const totalSessions = sessions.length;
    const totalTurns = sessions.reduce((sum, s) => sum + (s.turnCount || 0), 0);
    const meta: ArchiveMeta = {
      totalSessions,
      totalTurns,
      lastArchivedAt: String(timestamp),
    };

    await this._setStorage({
      [this.SESSIONS_KEY]: sessions,
      [turnsKey]: turns,
      [this.META_KEY]: meta,
    });

    return {
      success: true,
      deduplicated: isDeduplicated,
      sessionId,
      turnId: assignedTurnId,
      turnCount: turns.length,
    };
  }

  /**
   * Retrieves sessions matching platform filter and/or search query.
   */
  static async getSessions({ platform, query, limit = 50, offset = 0 }: { platform?: string; query?: string; limit?: number; offset?: number } = {}): Promise<SessionMetadata[]> {
    const data = await this._getStorage(this.SESSIONS_KEY);
    let sessions: SessionMetadata[] = Array.isArray(data[this.SESSIONS_KEY]) ? data[this.SESSIONS_KEY] : [];

    // Filter by platform
    if (platform && typeof platform === 'string' && platform.trim() && platform.toLowerCase() !== 'all') {
      const targetPlatform = platform.trim().toLowerCase();
      sessions = sessions.filter(
        (s) => s.platform && s.platform.toLowerCase() === targetPlatform
      );
    }

    // Filter by search query (matching title, snippet, id, or transcript turns)
    if (query && typeof query === 'string' && query.trim()) {
      const q = query.trim().toLowerCase();
      const matched: SessionMetadata[] = [];

      for (const s of sessions) {
        const titleMatch = s.title && s.title.toLowerCase().includes(q);
        const snippetMatch = s.snippet && s.snippet.toLowerCase().includes(q);
        const idMatch = s.id && s.id.toLowerCase().includes(q);

        if (titleMatch || snippetMatch || idMatch) {
          matched.push(s);
        } else {
          // Check turns if title/snippet did not match
          const turnsKey = `${this.TURNS_PREFIX}${s.id}`;
          const tData = await this._getStorage(turnsKey);
          const turns: ConversationTurn[] = Array.isArray(tData[turnsKey]) ? tData[turnsKey] : [];
          const hasTurnMatch = turns.some(
            (t) =>
              (t.userText && t.userText.toLowerCase().includes(q)) ||
              (t.assistantText && t.assistantText.toLowerCase().includes(q))
          );
          if (hasTurnMatch) {
            matched.push(s);
          }
        }
      }
      sessions = matched;
    }

    const start = Math.max(0, parseInt(String(offset), 10) || 0);
    const end = start + (Math.max(1, parseInt(String(limit), 10) || 50));
    return sessions.slice(start, end);
  }

  /**
   * Retrieves full details and dialogue turns for a session.
   */
  static async getSessionDetails(sessionId: string): Promise<{ session: SessionMetadata | null; turns: ConversationTurn[] }> {
    if (!sessionId) {
      return { session: null, turns: [] };
    }

    const turnsKey = `${this.TURNS_PREFIX}${sessionId}`;
    const data = await this._getStorage([this.SESSIONS_KEY, turnsKey]);

    const sessions: SessionMetadata[] = Array.isArray(data[this.SESSIONS_KEY]) ? data[this.SESSIONS_KEY] : [];
    const session = sessions.find((s) => s.id === sessionId) || null;
    const turns: ConversationTurn[] = Array.isArray(data[turnsKey]) ? data[turnsKey] : [];

    return { session, turns };
  }

  /**
   * Deletes a session from index and removes turn storage.
   */
  static async deleteSession(sessionId: string): Promise<{ success: boolean; deletedSessionId?: string; error?: string }> {
    if (!sessionId) {
      return { success: false, error: 'sessionId is required' };
    }

    const turnsKey = `${this.TURNS_PREFIX}${sessionId}`;
    const data = await this._getStorage([this.SESSIONS_KEY, this.META_KEY]);

    const sessions: SessionMetadata[] = Array.isArray(data[this.SESSIONS_KEY]) ? data[this.SESSIONS_KEY] : [];
    const meta: Partial<ArchiveMeta> = data[this.META_KEY] || {};

    const remainingSessions = sessions.filter((s) => s.id !== sessionId);

    await this._removeStorage(turnsKey);

    const totalSessions = remainingSessions.length;
    const totalTurns = remainingSessions.reduce((sum, s) => sum + (s.turnCount || 0), 0);

    await this._setStorage({
      [this.SESSIONS_KEY]: remainingSessions,
      [this.META_KEY]: {
        totalSessions,
        totalTurns,
        lastArchivedAt: meta.lastArchivedAt || null,
      },
    });

    return { success: true, deletedSessionId: sessionId };
  }

  /**
   * Clears all archived sessions or sessions for a specific platform.
   */
  static async clearHistory({ platform }: { platform?: string } = {}): Promise<{ success: boolean; clearedCount: number }> {
    const data = await this._getStorage([this.SESSIONS_KEY, this.META_KEY]);
    const sessions: SessionMetadata[] = Array.isArray(data[this.SESSIONS_KEY]) ? data[this.SESSIONS_KEY] : [];

    if (platform && typeof platform === 'string' && platform.trim() && platform.toLowerCase() !== 'all') {
      const targetPlatform = platform.trim().toLowerCase();
      const toRemove = sessions.filter(
        (s) => s.platform && s.platform.toLowerCase() === targetPlatform
      );
      const toKeep = sessions.filter(
        (s) => !s.platform || s.platform.toLowerCase() !== targetPlatform
      );

      const turnKeysToRemove = toRemove.map((s) => `${this.TURNS_PREFIX}${s.id}`);
      if (turnKeysToRemove.length > 0) {
        await this._removeStorage(turnKeysToRemove);
      }

      const totalSessions = toKeep.length;
      const totalTurns = toKeep.reduce((sum, s) => sum + (s.turnCount || 0), 0);

      await this._setStorage({
        [this.SESSIONS_KEY]: toKeep,
        [this.META_KEY]: {
          totalSessions,
          totalTurns,
          lastArchivedAt: new Date().toISOString(),
        },
      });

      return { success: true, clearedCount: toRemove.length };
    }

    // Purge all archived history
    const allTurnKeys = sessions.map((s) => `${this.TURNS_PREFIX}${s.id}`);
    if (allTurnKeys.length > 0) {
      await this._removeStorage(allTurnKeys);
    }

    await this._setStorage({
      [this.SESSIONS_KEY]: [],
      [this.META_KEY]: {
        totalSessions: 0,
        totalTurns: 0,
        lastArchivedAt: null,
      },
    });

    return { success: true, clearedCount: sessions.length };
  }

  /**
   * Exports conversation history as a formatted JSON or Markdown bundle.
   */
  static async exportHistory({ format = 'json', platform }: { format?: string; platform?: string; sessionId?: string } = {}): Promise<{ data: string; filename: string; toString(): string; valueOf(): string }> {
    let sessions = await this.getSessions({ platform, limit: 10000, offset: 0 });

    const turnKeys = sessions.map((s) => `${this.TURNS_PREFIX}${s.id}`);
    const turnsData = turnKeys.length > 0 ? await this._getStorage(turnKeys) : {};

    const bundledSessions = sessions.map((s) => {
      const turns = Array.isArray(turnsData[`${this.TURNS_PREFIX}${s.id}`])
        ? turnsData[`${this.TURNS_PREFIX}${s.id}`]
        : [];
      return {
        ...s,
        turns,
      };
    });

    const isMarkdown = format && (format.toLowerCase() === 'markdown' || format.toLowerCase() === 'md');
    const dateStr = new Date().toISOString().slice(0, 10);
    const platformTag = platform && platform.toLowerCase() !== 'all' ? platform.toLowerCase() : 'all';

    let data: string;
    let filename: string;

    if (isMarkdown) {
      filename = `webai-memory-archive-${platformTag}-${dateStr}.md`;
      let md = `# WebAI Memory Conversation Archive Export\n\n`;
      md += `- **Export Date**: ${new Date().toISOString()}\n`;
      md += `- **Platform**: ${platformTag}\n`;
      md += `- **Total Sessions**: ${bundledSessions.length}\n`;
      md += `- **Total Turns**: ${bundledSessions.reduce((sum, s) => sum + s.turns.length, 0)}\n\n`;
      md += `---\n\n`;

      for (const session of bundledSessions) {
        md += `## Session: ${session.title || 'Untitled'}\n`;
        md += `- **Session ID**: ${session.id}\n`;
        md += `- **Platform**: ${session.platform}\n`;
        md += `- **Created**: ${session.createdAt}\n`;
        md += `- **Updated**: ${session.updatedAt}\n`;
        md += `- **Turns**: ${session.turns.length}\n\n`;

        if (session.turns.length === 0) {
          md += `*(No turns recorded)*\n\n`;
        } else {
          for (let i = 0; i < session.turns.length; i++) {
            const t = session.turns[i];
            md += `### Turn ${i + 1} (${t.timestamp || 'N/A'})\n\n`;
            md += `**User**:\n${t.userText || '*(Empty)*'}\n\n`;
            md += `**Assistant**:\n${t.assistantText || '*(Empty)*'}\n\n`;
          }
        }
        md += `---\n\n`;
      }
      data = md.trim();
    } else {
      filename = `webai-memory-archive-${platformTag}-${dateStr}.json`;
      const exportPayload = {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        platform: platformTag,
        totalSessions: bundledSessions.length,
        totalTurns: bundledSessions.reduce((sum, s) => sum + s.turns.length, 0),
        sessions: bundledSessions,
      };
      data = JSON.stringify(exportPayload, null, 2);
    }

    const result = {
      data,
      filename,
      toString() {
        return this.data;
      },
      valueOf() {
        return this.data;
      },
    };

    return result;
  }

  /**
   * Searches dialogue turns across sessions.
   */
  static async searchTurns({ query, platform, limit = 50 }: { query: string; platform?: string; limit?: number }): Promise<any[]> {
    if (!query || typeof query !== 'string' || !query.trim()) {
      return [];
    }

    const q = query.trim().toLowerCase();
    const sessions = await this.getSessions({ platform, limit: 10000 });
    const results: any[] = [];

    for (const session of sessions) {
      const turnsKey = `${this.TURNS_PREFIX}${session.id}`;
      const data = await this._getStorage(turnsKey);
      const turns: ConversationTurn[] = Array.isArray(data[turnsKey]) ? data[turnsKey] : [];

      for (const turn of turns) {
        const userMatch = turn.userText && turn.userText.toLowerCase().includes(q);
        const assistantMatch = turn.assistantText && turn.assistantText.toLowerCase().includes(q);

        if (userMatch || assistantMatch) {
          results.push({
            sessionId: session.id,
            platform: session.platform,
            sessionTitle: session.title,
            turn,
          });
          if (results.length >= limit) return results;
        }
      }
    }

    return results;
  }

  /**
   * Returns archive statistics (total sessions, total turns, last archived timestamp).
   */
  static async getMeta(): Promise<ArchiveMeta> {
    const data = await this._getStorage([this.META_KEY, this.SESSIONS_KEY]);
    const sessions: SessionMetadata[] = Array.isArray(data[this.SESSIONS_KEY]) ? data[this.SESSIONS_KEY] : [];
    const meta = data[this.META_KEY] || {};

    return {
      totalSessions: sessions.length,
      totalTurns: sessions.reduce((sum, s) => sum + (s.turnCount || 0), 0),
      lastArchivedAt: meta.lastArchivedAt || null,
    };
  }
}

// Module export for Node.js / CommonJS and global binding for browser environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = LocalArchive;
  (module.exports as any).LocalArchive = LocalArchive;
}
if (typeof globalThis !== 'undefined') {
  (globalThis as any).LocalArchive = LocalArchive;
}
