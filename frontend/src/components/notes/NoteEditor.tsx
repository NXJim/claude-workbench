/**
 * Note editor — CodeMirror with markdown highlighting and 500ms debounce auto-save.
 */

import { useCallback } from 'react';
import { useNoteStore } from '@/stores/noteStore';
import { CodeMirrorEditor } from '@/components/ui/CodeMirrorEditor';

interface NoteEditorProps {
  noteId: string;
}

export function NoteEditor({ noteId }: NoteEditorProps) {
  const content = useNoteStore((s) => s.openNoteContents[noteId] ?? '');
  const saveNoteContent = useNoteStore((s) => s.saveNoteContent);
  const notes = useNoteStore((s) => s.notes);
  const status = useNoteStore((s) => s.saveStatus[noteId] ?? 'idle');

  const note = notes.find((n) => n.id === noteId);

  const handleChange = useCallback((value: string) => {
    saveNoteContent(noteId, value);
  }, [noteId, saveNoteContent]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs text-surface-500 truncate">
            {note?.title || 'Untitled'}
          </span>
          {/* Save indicator */}
          {status === 'saving' && (
            <span className="flex items-center gap-1 text-xs text-surface-400 flex-shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-surface-400 animate-pulse" />
              Saving
            </span>
          )}
          {status === 'saved' && (
            <span className="flex items-center gap-1 text-xs text-green-500 dark:text-green-400 flex-shrink-0">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Saved
            </span>
          )}
        </div>
      </div>

      {/* CodeMirror editor */}
      <CodeMirrorEditor
        value={content}
        onChange={handleChange}
        language="md"
        placeholder="Write your note..."
      />
    </div>
  );
}
