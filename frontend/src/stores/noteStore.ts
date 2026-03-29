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

type SaveStatus = 'idle' | 'saving' | 'saved';

interface NoteState {
  notes: NoteMetadata[];
  openNoteContents: Record<string, string>;
  saveStatus: Record<string, SaveStatus>;
  loading: boolean;

  fetchNotes: () => Promise<void>;
  createNote: (title: string) => Promise<NoteMetadata>;
  openNote: (id: string) => Promise<void>;
  saveNoteContent: (id: string, content: string) => void;
  updateNoteMetadata: (id: string, data: { title?: string; pinned?: boolean }) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
  renameNote: (id: string, newTitle: string) => Promise<void>;
  moveNoteToProject: (noteId: string, projectPath: string) => Promise<void>;
  /** Flush pending auto-save for a note (call before move/delete). */
  flushSave: (id: string) => Promise<void>;
  /** Re-fetch a note's content from the server (for SSE sync). Skips if mid-save. */
  refreshNoteContent: (id: string) => Promise<void>;
  /** Handle a remote note deletion (for SSE sync). */
  handleRemoteDelete: (id: string) => void;
}

// Debounce timers for auto-save
const saveTimers: Record<string, ReturnType<typeof setTimeout>> = {};
// Timers to reset "saved" back to "idle"
const savedTimers: Record<string, ReturnType<typeof setTimeout>> = {};

export const useNoteStore = create<NoteState>((set, get) => ({
  notes: [],
  openNoteContents: {},
  saveStatus: {},
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
    if (savedTimers[id]) clearTimeout(savedTimers[id]);
    saveTimers[id] = setTimeout(async () => {
      set((s) => ({ saveStatus: { ...s.saveStatus, [id]: 'saving' } }));
      try {
        await api.updateNoteContent(id, content, 'global');
        set((s) => ({ saveStatus: { ...s.saveStatus, [id]: 'saved' } }));
        // Reset to idle after 2 seconds
        savedTimers[id] = setTimeout(() => {
          set((s) => ({ saveStatus: { ...s.saveStatus, [id]: 'idle' } }));
        }, 2000);
      } catch {
        set((s) => ({ saveStatus: { ...s.saveStatus, [id]: 'idle' } }));
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

  renameNote: async (id, newTitle) => {
    await api.updateNoteMetadata(id, { title: newTitle }, 'global');
    await get().fetchNotes();
  },

  flushSave: async (id) => {
    // If there's a pending debounced save, execute it immediately
    if (saveTimers[id]) {
      clearTimeout(saveTimers[id]);
      delete saveTimers[id];
      const content = get().openNoteContents[id];
      if (content !== undefined) {
        await api.updateNoteContent(id, content, 'global');
      }
    }
  },

  refreshNoteContent: async (id) => {
    const { openNoteContents, saveStatus } = get();
    // Only refresh if the note is currently open and not mid-save
    if (!(id in openNoteContents)) return;
    if (saveStatus[id] === 'saving') return;
    // Also skip if there's a pending debounced save (local edits not yet flushed)
    if (saveTimers[id]) return;
    try {
      const note = await api.getNote(id, 'global');
      // Re-check after async — user may have started editing during fetch
      if (saveTimers[id] || get().saveStatus[id] === 'saving') return;
      set((s) => ({
        openNoteContents: { ...s.openNoteContents, [id]: note.content },
      }));
    } catch {
      // Note may have been deleted — ignore
    }
  },

  handleRemoteDelete: (id) => {
    // Close floating window if open
    const wId = windowKey({ type: 'note', noteId: id });
    useLayoutStore.getState().removeFloating(wId);
    // Remove from open contents
    set((s) => {
      const { [id]: _, ...rest } = s.openNoteContents;
      return { openNoteContents: rest };
    });
    // Refresh the sidebar list
    get().fetchNotes();
  },

  moveNoteToProject: async (noteId, projectPath) => {
    // Flush any pending save first
    await get().flushSave(noteId);

    // Read old floating window position before closing
    const wId = windowKey({ type: 'note', noteId });
    const layoutStore = useLayoutStore.getState();
    const oldFw = layoutStore.floatingWindows.find((fw) => fw.id === wId);
    const pos = oldFw ? { x: oldFw.x, y: oldFw.y, width: oldFw.width, height: oldFw.height } : null;

    // Get the note title before move
    const note = get().notes.find((n) => n.id === noteId);
    const title = note?.title || 'Untitled';

    // Move via API
    const result = await api.moveNote({
      source_type: 'global',
      source_id: noteId,
      target_type: 'project',
      target_project_path: projectPath,
      title,
    });

    // Close old note window
    layoutStore.removeFloating(wId);
    set((s) => {
      const { [noteId]: _, ...rest } = s.openNoteContents;
      return { openNoteContents: rest };
    });

    // Refresh notes list
    await get().fetchNotes();

    // Open the new file in the claude-md editor if the note was open
    if (pos && result.target_path) {
      // Dynamic import to avoid circular dependency
      const { useClaudeMdStore } = await import('./claudeMdStore');
      await useClaudeMdStore.getState().openFile(result.target_path);
      // Restore position
      const newWId = windowKey({ type: 'claude-md', filePath: result.target_path });
      layoutStore.updateFloatingWindow(newWId, pos);
    }
  },
}));
