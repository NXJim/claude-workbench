/**
 * Quick-paste phrases store with localStorage persistence.
 * Provides a list of user-configurable phrases that can be pasted into terminals.
 */

import { create } from 'zustand';

export interface QuickPhrase {
  id: string;
  label: string;    // Short display name
  command: string;   // Full command to paste
}

const STORAGE_KEY = 'cwb-quick-phrases';

const DEFAULT_PHRASES: QuickPhrase[] = [
  { id: '1', label: 'Claude (skip perms)', command: 'claude --dangerously-skip-permissions' },
  { id: '2', label: 'Claude', command: 'claude' },
  { id: '3', label: 'Claude resume', command: 'claude --resume' },
  { id: '4', label: 'Claude continue', command: 'claude --continue' },
];

function loadPhrases(): QuickPhrase[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch { /* use defaults */ }
  return DEFAULT_PHRASES;
}

function savePhrases(phrases: QuickPhrase[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(phrases));
}

let idCounter = Date.now();

interface QuickPasteState {
  phrases: QuickPhrase[];
  addPhrase: (label: string, command: string) => void;
  removePhrase: (id: string) => void;
  updatePhrase: (id: string, updates: Partial<Pick<QuickPhrase, 'label' | 'command'>>) => void;
  reorderPhrases: (phrases: QuickPhrase[]) => void;
}

export const useQuickPasteStore = create<QuickPasteState>((set) => ({
  phrases: loadPhrases(),

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
