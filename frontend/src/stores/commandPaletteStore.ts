/**
 * Command palette state (Ctrl+K).
 */

import { create } from 'zustand';

export interface PaletteCommand {
  id: string;
  label: string;
  category: string;
  action: () => void;
  shortcut?: string;
}

interface CommandPaletteState {
  isOpen: boolean;
  query: string;

  open: () => void;
  close: () => void;
  toggle: () => void;
  setQuery: (q: string) => void;
}

export const useCommandPaletteStore = create<CommandPaletteState>((set) => ({
  isOpen: false,
  query: '',

  open: () => set({ isOpen: true, query: '' }),
  close: () => set({ isOpen: false, query: '' }),
  toggle: () => set((s) => ({ isOpen: !s.isOpen, query: '' })),
  setQuery: (q) => set({ query: q }),
}));
