/**
 * Session groups store — batch launch/close named session sets.
 */

import { create } from 'zustand';
import { api } from '@/api/client';
import { useSessionStore } from './sessionStore';

export interface SessionGroup {
  id: string;
  name: string;
  project_path: string | null;
  session_configs: Array<{ display_name?: string; project_path?: string; color?: string }>;
  created_at: string;
}

interface SessionGroupState {
  groups: SessionGroup[];
  loading: boolean;

  fetchGroups: () => Promise<void>;
  createGroup: (name: string, configs: SessionGroup['session_configs'], projectPath?: string) => Promise<void>;
  updateGroup: (id: string, data: Partial<Pick<SessionGroup, 'name' | 'project_path' | 'session_configs'>>) => Promise<void>;
  deleteGroup: (id: string) => Promise<void>;
  launchGroup: (id: string) => Promise<void>;
  closeGroup: (id: string) => Promise<void>;
  saveCurrentAsGroup: (name: string) => Promise<void>;
}

export const useSessionGroupStore = create<SessionGroupState>((set, get) => ({
  groups: [],
  loading: false,

  fetchGroups: async () => {
    set({ loading: true });
    try {
      const groups = await api.listSessionGroups();
      set({ groups, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  createGroup: async (name, configs, projectPath) => {
    await api.createSessionGroup({ name, session_configs: configs, project_path: projectPath });
    await get().fetchGroups();
  },

  updateGroup: async (id, data) => {
    await api.updateSessionGroup(id, data);
    await get().fetchGroups();
  },

  deleteGroup: async (id) => {
    await api.deleteSessionGroup(id);
    await get().fetchGroups();
  },

  launchGroup: async (id) => {
    await api.launchSessionGroup(id);
    // Refresh sessions to pick up newly created ones
    await useSessionStore.getState().fetchSessions();
  },

  closeGroup: async (id) => {
    await api.closeSessionGroup(id);
    await useSessionStore.getState().fetchSessions();
  },

  saveCurrentAsGroup: async (name) => {
    const sessions = useSessionStore.getState().sessions.filter(s => s.is_alive);
    const configs = sessions.map(s => ({
      display_name: s.display_name || undefined,
      project_path: s.project_path || undefined,
      color: s.color,
    }));
    await api.createSessionGroup({ name, session_configs: configs });
    await get().fetchGroups();
  },
}));
