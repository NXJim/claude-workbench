/**
 * CLAUDE.md editor store — list, read, and write CLAUDE.md files.
 */

import { create } from 'zustand';
import { api } from '@/api/client';
import { useLayoutStore } from './layoutStore';
import { windowKey } from '@/types/windows';

export interface ClaudeMdFile {
  path: string;
  label: string;
  category: string;
  project_name: string | null;
}

interface ClaudeMdState {
  files: ClaudeMdFile[];
  openContents: Record<string, string>;
  loading: boolean;

  fetchFiles: () => Promise<void>;
  openFile: (path: string) => Promise<void>;
  saveFile: (path: string, content: string) => void;
}

// Debounce timers for auto-save
const saveTimers: Record<string, ReturnType<typeof setTimeout>> = {};

export const useClaudeMdStore = create<ClaudeMdState>((set, get) => ({
  files: [],
  openContents: {},
  loading: false,

  fetchFiles: async () => {
    set({ loading: true });
    try {
      const files = await api.listClaudeMdFiles();
      set({ files, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  openFile: async (path) => {
    const { openContents } = get();
    // Load content if not cached
    if (!(path in openContents)) {
      const result = await api.readClaudeMd(path);
      set((s) => ({
        openContents: { ...s.openContents, [path]: result.content },
      }));
    }
    // Open in floating window
    useLayoutStore.getState().openWindow({ type: 'claude-md', filePath: path });
  },

  saveFile: (path, content) => {
    // Update local state immediately
    set((s) => ({
      openContents: { ...s.openContents, [path]: content },
    }));
    // Debounced API save
    if (saveTimers[path]) clearTimeout(saveTimers[path]);
    saveTimers[path] = setTimeout(async () => {
      try {
        await api.writeClaudeMd(path, content);
      } catch {
        // Auto-save failure is non-critical
      }
    }, 500);
  },
}));
