/**
 * Config store — fetches dynamic paths from the backend once on startup.
 * Replaces all hardcoded user paths (e.g., ~/.claude/CLAUDE.md).
 */

import { create } from 'zustand';

interface ConfigState {
  homeDir: string;
  projectsRoot: string;
  globalClaudeMdPath: string;
  loaded: boolean;
  fetch: () => Promise<void>;
}

export const useConfigStore = create<ConfigState>((set) => ({
  // Sensible defaults until the API responds
  homeDir: '',
  projectsRoot: '',
  globalClaudeMdPath: '',
  loaded: false,

  fetch: async () => {
    try {
      const res = await fetch('/api/config/public');
      if (!res.ok) return;
      const data = await res.json();
      set({
        homeDir: data.home_dir,
        projectsRoot: data.projects_root,
        globalClaudeMdPath: data.global_claude_md_path,
        loaded: true,
      });
    } catch {
      // Silently fail — defaults will be used
    }
  },
}));
