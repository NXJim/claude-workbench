/**
 * Cross-session clipboard store — shared clipboard across terminal sessions.
 */

import { create } from 'zustand';
import { api } from '@/api/client';

interface ClipboardState {
  content: string;
  loading: boolean;

  fetch: () => Promise<void>;
  copy: (text: string) => Promise<void>;
  paste: () => string;
}

export const useClipboardStore = create<ClipboardState>((set, get) => ({
  content: '',
  loading: false,

  fetch: async () => {
    try {
      const result = await api.getClipboard();
      set({ content: result.content });
    } catch {
      // Non-critical
    }
  },

  copy: async (text) => {
    set({ content: text });
    try {
      await api.setClipboard(text);
    } catch {
      // Non-critical
    }
  },

  paste: () => get().content,
}));
