/**
 * Project tree state with dynamic categories from settings.
 */

import { create } from 'zustand';
import { api, type ProjectData, type ProjectCategory } from '@/api/client';
import { useLayoutStore } from './layoutStore';
import { windowKey } from '@/types/windows';

interface ProjectState {
  projects: ProjectData[];
  categories: ProjectCategory[];
  loading: boolean;
  error: string | null;
  expandedTypes: Record<string, boolean>;

  fetchProjects: () => Promise<void>;
  moveProject: (projectPath: string, targetCategory: string) => Promise<void>;
  toggleType: (type: string) => void;
  // Project file (notes) operations
  createProjectNote: (projectPath: string, title: string) => Promise<string>;
  renameProjectFile: (filePath: string, newName: string) => Promise<string>;
  deleteProjectFile: (filePath: string) => Promise<void>;
  moveProjectFileToGlobal: (filePath: string, title: string) => Promise<void>;
  moveProjectFileBetweenProjects: (filePath: string, targetProjectPath: string, title: string) => Promise<void>;
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

  moveProject: async (projectPath, targetCategory) => {
    await api.moveProject(projectPath, targetCategory);
    // Refresh the full project list after move
    await get().fetchProjects();
  },

  toggleType: (type) => {
    const current = get().expandedTypes;
    set({ expandedTypes: { ...current, [type]: !current[type] } });
  },

  createProjectNote: async (projectPath, title) => {
    const result = await api.createProjectFile({ project_path: projectPath, title });
    await get().fetchProjects();
    return result.path;
  },

  renameProjectFile: async (filePath, newName) => {
    const result = await api.renameProjectFile(filePath, newName);

    // If the file was open in the editor, close old and open new
    const layoutStore = useLayoutStore.getState();
    const oldWId = windowKey({ type: 'claude-md', filePath });
    const oldFw = layoutStore.floatingWindows.find((fw) => fw.id === oldWId);
    if (oldFw) {
      const pos = { x: oldFw.x, y: oldFw.y, width: oldFw.width, height: oldFw.height };
      layoutStore.removeFloating(oldWId);
      const { useClaudeMdStore } = await import('./claudeMdStore');
      await useClaudeMdStore.getState().openFile(result.new_path);
      const newWId = windowKey({ type: 'claude-md', filePath: result.new_path });
      layoutStore.updateFloatingWindow(newWId, pos);
    }

    await get().fetchProjects();
    return result.new_path;
  },

  deleteProjectFile: async (filePath) => {
    await api.deleteProjectFile(filePath);
    // Close editor window if open
    const wId = windowKey({ type: 'claude-md', filePath });
    useLayoutStore.getState().removeFloating(wId);
    await get().fetchProjects();
  },

  moveProjectFileToGlobal: async (filePath, title) => {
    // Close editor window if open, save position
    const layoutStore = useLayoutStore.getState();
    const wId = windowKey({ type: 'claude-md', filePath });
    const oldFw = layoutStore.floatingWindows.find((fw) => fw.id === wId);
    const pos = oldFw ? { x: oldFw.x, y: oldFw.y, width: oldFw.width, height: oldFw.height } : null;
    if (oldFw) layoutStore.removeFloating(wId);

    const result = await api.moveNote({
      source_type: 'project',
      source_path: filePath,
      target_type: 'global',
      title,
    });

    await get().fetchProjects();

    // Open as global note if was open, refresh note list
    const { useNoteStore } = await import('./noteStore');
    await useNoteStore.getState().fetchNotes();
    if (pos && result.target_id) {
      await useNoteStore.getState().openNote(result.target_id);
      const newWId = windowKey({ type: 'note', noteId: result.target_id });
      layoutStore.updateFloatingWindow(newWId, pos);
    }
  },

  moveProjectFileBetweenProjects: async (filePath, targetProjectPath, title) => {
    // Close editor window if open, save position
    const layoutStore = useLayoutStore.getState();
    const wId = windowKey({ type: 'claude-md', filePath });
    const oldFw = layoutStore.floatingWindows.find((fw) => fw.id === wId);
    const pos = oldFw ? { x: oldFw.x, y: oldFw.y, width: oldFw.width, height: oldFw.height } : null;
    if (oldFw) layoutStore.removeFloating(wId);

    const result = await api.moveNote({
      source_type: 'project',
      source_path: filePath,
      target_type: 'project',
      target_project_path: targetProjectPath,
      title,
    });

    await get().fetchProjects();

    // Reopen at new path if was open
    if (pos && result.target_path) {
      const { useClaudeMdStore } = await import('./claudeMdStore');
      await useClaudeMdStore.getState().openFile(result.target_path);
      const newWId = windowKey({ type: 'claude-md', filePath: result.target_path });
      layoutStore.updateFloatingWindow(newWId, pos);
    }
  },
}));
