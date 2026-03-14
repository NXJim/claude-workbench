/**
 * Notes section for the sidebar — list notes, create, delete, scope toggle.
 */

import { useEffect, useState } from 'react';
import { useNoteStore } from '@/stores/noteStore';

export function NotesSidebarSection() {
  const notes = useNoteStore((s) => s.notes);
  const loading = useNoteStore((s) => s.loading);
  const fetchNotes = useNoteStore((s) => s.fetchNotes);
  const createNote = useNoteStore((s) => s.createNote);
  const openNote = useNoteStore((s) => s.openNote);
  const deleteNote = useNoteStore((s) => s.deleteNote);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    const note = await createNote(newTitle.trim());
    setNewTitle('');
    setCreating(false);
    openNote(note.id);
  };

  // Sort: pinned first, then by updated_at desc
  const sorted = [...notes].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.updated_at.localeCompare(a.updated_at);
  });

  return (
    <div>
      {/* Header with scope toggle and create button */}
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-surface-500">
            Notes
          </span>
          <span className="text-xs text-surface-400">({notes.length})</span>
        </div>
        <div className="flex items-center gap-1">
          {/* Create */}
          <button
            onClick={() => setCreating(true)}
            className="p-1 rounded hover:bg-surface-200 dark:hover:bg-surface-700 text-surface-500"
            title="New note"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>
      </div>

      {/* Create form */}
      {creating && (
        <div className="px-3 pb-2">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate();
              if (e.key === 'Escape') { setCreating(false); setNewTitle(''); }
            }}
            placeholder="Note title..."
            className="w-full text-xs bg-white dark:bg-surface-900 border border-surface-300 dark:border-surface-600 rounded px-2 py-1 focus:outline-none focus:border-blue-500"
            autoFocus
          />
        </div>
      )}

      {/* Notes list */}
      <div className="max-h-32 overflow-y-auto">
        {loading && notes.length === 0 ? (
          <p className="px-3 py-2 text-xs text-surface-400">Loading...</p>
        ) : sorted.length === 0 ? (
          <p className="px-3 py-2 text-xs text-surface-400">No notes yet</p>
        ) : (
          sorted.map((note) => (
            <div
              key={note.id}
              className="group flex items-center gap-2 px-3 py-1 hover:bg-surface-100 dark:hover:bg-surface-800 cursor-pointer"
              onClick={() => openNote(note.id)}
            >
              {note.pinned && (
                <span className="text-[10px] text-yellow-500" title="Pinned">*</span>
              )}
              <span className="text-xs truncate flex-1">{note.title}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete "${note.title}"?`)) deleteNote(note.id);
                }}
                className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-surface-400 hover:text-red-500"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
