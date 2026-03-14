/**
 * Notes store — global markdown notes.
 */

import { create } from 'zustand';
import { api } from '@/api/client';
import { useLayoutStore } from './layoutStore';
import { windowKey } from '@/types/windows';

export interface NoteMetadata {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  pinned: boolean;
}

interface NoteState {
  notes: NoteMetadata[];
  openNoteContents: Record<string, string>;
  loading: boolean;

  fetchNotes: () => Promise<void>;
  createNote: (title: string) => Promise<NoteMetadata>;
  openNote: (id: string) => Promise<void>;
  saveNoteContent: (id: string, content: string) => void;
  updateNoteMetadata: (id: string, data: { title?: string; pinned?: boolean }) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
}

// Debounce timers for auto-save
const saveTimers: Record<string, ReturnType<typeof setTimeout>> = {};

export const useNoteStore = create<NoteState>((set, get) => ({
  notes: [],
  openNoteContents: {},
  loading: false,

  fetchNotes: async () => {
    set({ loading: true });
    try {
      const notes = await api.listNotes('global');
      set({ notes, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  createNote: async (title) => {
    const note = await api.createNote({ title, scope: 'global' });
    await get().fetchNotes();
    return note;
  },

  openNote: async (id) => {
    const { openNoteContents } = get();
    // Load content if not already open
    if (!(id in openNoteContents)) {
      const note = await api.getNote(id, 'global');
      set((s) => ({
        openNoteContents: { ...s.openNoteContents, [id]: note.content },
      }));
    }
    // Open in floating window
    useLayoutStore.getState().openWindow({ type: 'note', noteId: id });
  },

  saveNoteContent: (id, content) => {
    // Update local state immediately
    set((s) => ({
      openNoteContents: { ...s.openNoteContents, [id]: content },
    }));
    // Debounced API save
    if (saveTimers[id]) clearTimeout(saveTimers[id]);
    saveTimers[id] = setTimeout(async () => {
      try {
        await api.updateNoteContent(id, content, 'global');
      } catch {
        // Auto-save failure is non-critical
      }
    }, 500);
  },

  updateNoteMetadata: async (id, data) => {
    await api.updateNoteMetadata(id, data, 'global');
    await get().fetchNotes();
  },

  deleteNote: async (id) => {
    await api.deleteNote(id, 'global');
    // Close floating window if open
    const wId = windowKey({ type: 'note', noteId: id });
    useLayoutStore.getState().removeFloating(wId);
    // Remove from open contents
    set((s) => {
      const { [id]: _, ...rest } = s.openNoteContents;
      return { openNoteContents: rest };
    });
    await get().fetchNotes();
  },
}));
