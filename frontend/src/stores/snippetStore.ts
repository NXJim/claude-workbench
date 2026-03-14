/**
 * Code snippets knowledge base store.
 */

import { create } from 'zustand';
import { api } from '@/api/client';
import { useLayoutStore } from './layoutStore';

export interface Snippet {
  id: string;
  title: string;
  description: string;
  language: string;
  code: string;
  tags: string;
  source_project: string | null;
  created_at: string;
  updated_at: string;
}

interface SnippetFilters {
  search: string;
  tag: string;
  language: string;
}

interface SnippetState {
  snippets: Snippet[];
  allTags: string[];
  filters: SnippetFilters;
  loading: boolean;

  fetchSnippets: () => Promise<void>;
  fetchTags: () => Promise<void>;
  setFilter: (key: keyof SnippetFilters, value: string) => void;
  createSnippet: (data: Omit<Snippet, 'id' | 'created_at' | 'updated_at'>) => Promise<Snippet>;
  updateSnippet: (id: string, data: Partial<Snippet>) => Promise<void>;
  deleteSnippet: (id: string) => Promise<void>;
  openSnippet: (id: string) => void;
  openBrowser: () => void;
}

export const useSnippetStore = create<SnippetState>((set, get) => ({
  snippets: [],
  allTags: [],
  filters: { search: '', tag: '', language: '' },
  loading: false,

  fetchSnippets: async () => {
    set({ loading: true });
    try {
      const { filters } = get();
      const snippets = await api.listSnippets(
        filters.search || undefined,
        filters.tag || undefined,
        filters.language || undefined,
      );
      set({ snippets, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  fetchTags: async () => {
    try {
      const tags = await api.listSnippetTags();
      set({ allTags: tags });
    } catch {
      // Non-critical
    }
  },

  setFilter: (key, value) => {
    set((s) => ({
      filters: { ...s.filters, [key]: value },
    }));
    get().fetchSnippets();
  },

  createSnippet: async (data) => {
    const snippet = await api.createSnippet(data);
    await get().fetchSnippets();
    await get().fetchTags();
    return snippet;
  },

  updateSnippet: async (id, data) => {
    await api.updateSnippet(id, data);
    await get().fetchSnippets();
    await get().fetchTags();
  },

  deleteSnippet: async (id) => {
    await api.deleteSnippet(id);
    const wId = `snip:${id}`;
    useLayoutStore.getState().removeFloating(wId);
    await get().fetchSnippets();
  },

  openSnippet: (id) => {
    useLayoutStore.getState().openWindow({ type: 'snippet', snippetId: id });
  },

  openBrowser: () => {
    // Open the snippet browser as a floating window (uses 'snippet' type with special ID)
    useLayoutStore.getState().openWindow({ type: 'snippet', snippetId: '__browser__' });
  },
}));
