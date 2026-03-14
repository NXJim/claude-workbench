/**
 * Session state management.
 * Tracks all terminal sessions, their connection state, and activity.
 */

import { create } from 'zustand';
import { api, type SessionData } from '@/api/client';

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
  loading: boolean;
  error: string | null;

  // Actions
  fetchSessions: () => Promise<void>;
  createSession: (projectPath?: string, displayName?: string, color?: string) => Promise<SessionData>;
  updateSession: (id: string, data: { display_name?: string; color?: string }) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  updateNotes: (id: string, notes: string) => Promise<void>;
  setSessionStatus: (id: string, status: string) => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  loading: false,
  error: null,

  fetchSessions: async () => {
    set({ loading: true, error: null });
    try {
      const sessions = await api.listSessions();
      set({ sessions, loading: false });
    } catch (e) {
      set({ error: (e as Error).message, loading: false });
    }
  },

  createSession: async (projectPath, displayName, color) => {
    const session = await api.createSession({
      project_path: projectPath,
      display_name: displayName,
      color: color || SESSION_COLORS[get().sessions.length % SESSION_COLORS.length],
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
}));
