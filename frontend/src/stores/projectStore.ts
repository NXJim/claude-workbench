/**
 * Project tree state with dynamic categories from settings.
 */

import { create } from 'zustand';
import { api, type ProjectData, type ProjectCategory } from '@/api/client';

interface ProjectState {
  projects: ProjectData[];
  categories: ProjectCategory[];
  loading: boolean;
  error: string | null;
  expandedTypes: Record<string, boolean>;

  fetchProjects: () => Promise<void>;
  toggleType: (type: string) => void;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  categories: [],
  loading: false,
  error: null,
  expandedTypes: {},

  fetchProjects: async () => {
    set({ loading: true, error: null });
    try {
      // Fetch projects and settings (categories) in parallel
      const [projects, settings] = await Promise.all([
        api.listProjects(),
        api.getSettings(),
      ]);
      const categories = settings.project_categories;

      // Expand all category types by default (preserve existing expanded state)
      const currentExpanded = get().expandedTypes;
      const expandedTypes: Record<string, boolean> = {};
      for (const cat of categories) {
        // Keep existing expanded state if set, otherwise default to true
        expandedTypes[cat.name] = currentExpanded[cat.name] ?? true;
      }

      set({ projects, categories, expandedTypes, loading: false });
    } catch (e) {
      set({ error: (e as Error).message, loading: false });
    }
  },

  toggleType: (type) => {
    const current = get().expandedTypes;
    set({ expandedTypes: { ...current, [type]: !current[type] } });
  },
}));
