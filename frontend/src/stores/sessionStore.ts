/**
 * Session state management.
 * Tracks all terminal sessions, their connection state, and activity.
 */

import { create } from 'zustand';
import { api, type SessionData } from '@/api/client';
import { useLayoutStore } from './layoutStore';

// Session color presets
export const SESSION_COLORS = [
  '#7aa2f7', // blue (default)
  '#9ece6a', // green
  '#f7768e', // red
  '#e0af68', // yellow
  '#bb9af7', // purple
  '#7dcfff', // cyan
  '#ff9e64', // orange
  '#c0caf5', // white
];

interface SessionState {
  sessions: SessionData[];
  orphanedSessions: SessionData[];
  /** Map of workspace_id → alive session count (for all workspaces). */
  workspaceSessionCounts: Record<number, number>;
  /** Map of session_id → pane title (set by OSC escape sequences, delivered via SSE). */
  paneTitles: Record<string, string>;
  loading: boolean;
  error: string | null;

  // Actions
  fetchSessions: (workspaceId?: number | null) => Promise<void>;
  fetchOrphanedSessions: () => Promise<void>;
  fetchWorkspaceSessionCounts: () => Promise<void>;
  createSession: (projectPath?: string, displayName?: string, color?: string, opts?: { skipClaudePrompt?: boolean }) => Promise<SessionData>;
  updateSession: (id: string, data: { display_name?: string; color?: string }) => Promise<void>;
  moveToWorkspace: (id: string, targetWorkspaceId: number) => Promise<void>;
  adoptOrphan: (id: string, targetWorkspaceId: number) => Promise<void>;
  respawnSession: (id: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  updateNotes: (id: string, notes: string) => Promise<void>;
  setSessionStatus: (id: string, status: string) => void;
  setPaneTitle: (id: string, title: string) => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  orphanedSessions: [],
  workspaceSessionCounts: {},
  paneTitles: {},
  loading: false,
  error: null,

  fetchSessions: async (workspaceId?: number | null) => {
    set({ loading: true, error: null });
    try {
      const sessions = await api.listSessions(workspaceId ?? undefined);
      set({ sessions, loading: false });
    } catch (e) {
      set({ error: (e as Error).message, loading: false });
    }
  },

  fetchOrphanedSessions: async () => {
    try {
      const orphanedSessions = await api.listOrphanedSessions();
      set({ orphanedSessions });
    } catch (e) {
      console.error('Failed to fetch orphaned sessions:', e);
    }
  },

  fetchWorkspaceSessionCounts: async () => {
    try {
      const allSessions = await api.listSessions();
      const counts: Record<number, number> = {};
      for (const s of allSessions) {
        if (s.workspace_id != null && s.is_alive) {
          counts[s.workspace_id] = (counts[s.workspace_id] || 0) + 1;
        }
      }
      set({ workspaceSessionCounts: counts });
    } catch {
      // Non-critical — color indicator just won't update
    }
  },

  createSession: async (projectPath, displayName, color, opts) => {
    // Auto-assign workspace_id from the active workspace
    const wsId = useLayoutStore.getState().activeWorkspaceId;
    const session = await api.createSession({
      project_path: projectPath,
      display_name: displayName,
      color: color || SESSION_COLORS[get().sessions.length % SESSION_COLORS.length],
      workspace_id: wsId ?? undefined,
      skip_claude_prompt: opts?.skipClaudePrompt,
    });
    set((s) => ({ sessions: [session, ...s.sessions] }));
    return session;
  },

  updateSession: async (id, data) => {
    const updated = await api.updateSession(id, data);
    set((s) => ({
      sessions: s.sessions.map((sess) => (sess.id === id ? updated : sess)),
    }));
  },

  moveToWorkspace: async (id, targetWorkspaceId) => {
    // Update the session's workspace_id on the backend
    await api.updateSession(id, { workspace_id: targetWorkspaceId });
    // Remove from local sessions list (it no longer belongs to current workspace)
    set((s) => ({ sessions: s.sessions.filter((sess) => sess.id !== id) }));
  },

  adoptOrphan: async (id, targetWorkspaceId) => {
    // Move an orphaned session to a workspace
    await api.updateSession(id, { workspace_id: targetWorkspaceId });
    // Remove from orphaned list
    set((s) => ({
      orphanedSessions: s.orphanedSessions.filter((sess) => sess.id !== id),
    }));
  },

  respawnSession: async (id) => {
    const updated = await api.respawnSession(id);
    // Update in whichever list it belongs to
    set((s) => ({
      sessions: s.sessions.map((sess) => (sess.id === id ? updated : sess)),
      orphanedSessions: s.orphanedSessions.map((sess) => (sess.id === id ? updated : sess)),
    }));
  },

  deleteSession: async (id) => {
    await api.deleteSession(id);
    set((s) => ({ sessions: s.sessions.filter((sess) => sess.id !== id) }));
  },

  updateNotes: async (id, notes) => {
    await api.updateNotes(id, notes);
    set((s) => ({
      sessions: s.sessions.map((sess) => (sess.id === id ? { ...sess, notes } : sess)),
    }));
  },

  setSessionStatus: (id, status) => {
    set((s) => ({
      sessions: s.sessions.map((sess) => (sess.id === id ? { ...sess, status } : sess)),
    }));
  },

  setPaneTitle: (id, title) => {
    set((s) => ({ paneTitles: { ...s.paneTitles, [id]: title } }));
  },
}));
