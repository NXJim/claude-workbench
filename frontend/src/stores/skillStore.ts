/**
 * Skills store — discover and edit Claude Code skill files.
 */

import { create } from 'zustand';
import { api, type SkillData } from '@/api/client';
import { useLayoutStore } from './layoutStore';

type SaveStatus = 'idle' | 'saving' | 'saved';

interface SkillState {
  skills: SkillData[];
  openSkillContents: Record<string, string>; // keyed by file path
  openSkillReadonly: Record<string, boolean>; // keyed by file path
  saveStatus: Record<string, SaveStatus>;
  loading: boolean;

  fetchSkills: () => Promise<void>;
  openSkill: (skill: SkillData) => Promise<void>;
  saveSkillContent: (path: string, content: string) => void;
  openBrowser: () => void;
}

// Debounce timers for auto-save
const saveTimers: Record<string, ReturnType<typeof setTimeout>> = {};
// Timers to reset "saved" back to "idle"
const savedTimers: Record<string, ReturnType<typeof setTimeout>> = {};

export const useSkillStore = create<SkillState>((set, get) => ({
  skills: [],
  openSkillContents: {},
  openSkillReadonly: {},
  saveStatus: {},
  loading: false,

  fetchSkills: async () => {
    set({ loading: true });
    try {
      const skills = await api.listSkills();
      set({ skills, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  openSkill: async (skill) => {
    const { openSkillContents } = get();
    // Load content if not already open
    if (!(skill.path in openSkillContents)) {
      const detail = await api.getSkill(skill.path);
      set((s) => ({
        openSkillContents: { ...s.openSkillContents, [skill.path]: detail.content },
        openSkillReadonly: { ...s.openSkillReadonly, [skill.path]: detail.readonly },
      }));
    }
    // Open in floating window
    useLayoutStore.getState().openWindow({ type: 'skill-editor', skillPath: skill.path });
  },

  saveSkillContent: (path, content) => {
    // Update local state immediately
    set((s) => ({
      openSkillContents: { ...s.openSkillContents, [path]: content },
    }));
    // Debounced API save
    if (saveTimers[path]) clearTimeout(saveTimers[path]);
    if (savedTimers[path]) clearTimeout(savedTimers[path]);
    saveTimers[path] = setTimeout(async () => {
      set((s) => ({ saveStatus: { ...s.saveStatus, [path]: 'saving' } }));
      try {
        await api.updateSkill(path, content);
        set((s) => ({ saveStatus: { ...s.saveStatus, [path]: 'saved' } }));
        // Reset to idle after 2 seconds
        savedTimers[path] = setTimeout(() => {
          set((s) => ({ saveStatus: { ...s.saveStatus, [path]: 'idle' } }));
        }, 2000);
      } catch {
        set((s) => ({ saveStatus: { ...s.saveStatus, [path]: 'idle' } }));
      }
    }, 500);
  },

  openBrowser: () => {
    useLayoutStore.getState().openWindow({ type: 'skill-browser' });
  },
}));
