/**
 * Quick-paste phrases store with server-side persistence.
 * Provides a list of user-configurable phrases that can be pasted into terminals.
 */

import { create } from 'zustand';
import { api, type QuickPhrase } from '@/api/client';

const DEFAULT_PHRASES: QuickPhrase[] = [
  { id: '1', label: 'Claude (skip perms)', command: 'claude --dangerously-skip-permissions' },
  { id: '2', label: 'Claude', command: 'claude' },
  { id: '3', label: 'Claude resume', command: 'claude --resume' },
  { id: '4', label: 'Claude continue', command: 'claude --continue' },
];

let idCounter = Date.now();

interface QuickPasteState {
  phrases: QuickPhrase[];
  loaded: boolean;
  fetchPhrases: () => Promise<void>;
  addPhrase: (label: string, command: string) => void;
  removePhrase: (id: string) => void;
  updatePhrase: (id: string, updates: Partial<Pick<QuickPhrase, 'label' | 'command'>>) => void;
  reorderPhrases: (phrases: QuickPhrase[]) => void;
}

/** Persist current phrases to the server (fire-and-forget). */
function savePhrases(phrases: QuickPhrase[]) {
  api.setQuickPastePhrases(phrases).catch(() => {
    // Non-critical — will retry on next mutation
  });
}

export const useQuickPasteStore = create<QuickPasteState>((set, get) => ({
  phrases: DEFAULT_PHRASES,
  loaded: false,

  fetchPhrases: async () => {
    try {
      const phrases = await api.getQuickPastePhrases();
      set({ phrases, loaded: true });
    } catch {
      // API not available — use defaults (first run or backend down)
      set({ loaded: true });
    }
  },

  addPhrase: (label, command) => set((state) => {
    const phrases = [...state.phrases, { id: String(++idCounter), label, command }];
    savePhrases(phrases);
    return { phrases };
  }),

  removePhrase: (id) => set((state) => {
    const phrases = state.phrases.filter((p) => p.id !== id);
    savePhrases(phrases);
    return { phrases };
  }),

  updatePhrase: (id, updates) => set((state) => {
    const phrases = state.phrases.map((p) => p.id === id ? { ...p, ...updates } : p);
    savePhrases(phrases);
    return { phrases };
  }),

  reorderPhrases: (phrases) => set(() => {
    savePhrases(phrases);
    return { phrases };
  }),
}));
