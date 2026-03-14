/**
 * Note editor — textarea with 500ms debounce auto-save.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useNoteStore } from '@/stores/noteStore';

interface NoteEditorProps {
  noteId: string;
}

export function NoteEditor({ noteId }: NoteEditorProps) {
  const content = useNoteStore((s) => s.openNoteContents[noteId] ?? '');
  const saveNoteContent = useNoteStore((s) => s.saveNoteContent);
  const notes = useNoteStore((s) => s.notes);
  const [isPreview, setIsPreview] = useState(false);

  const note = notes.find((n) => n.id === noteId);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    saveNoteContent(noteId, e.target.value);
  }, [noteId, saveNoteContent]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800">
        <span className="text-xs text-surface-500 truncate">
          {note?.title || 'Untitled'}
        </span>
        <button
          onClick={() => setIsPreview(!isPreview)}
          className={`text-xs px-2 py-0.5 rounded ${
            isPreview
              ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
              : 'text-surface-500 hover:bg-surface-200 dark:hover:bg-surface-700'
          }`}
        >
          {isPreview ? 'Edit' : 'Preview'}
        </button>
      </div>

      {/* Content */}
      {isPreview ? (
        <div className="flex-1 overflow-y-auto p-4 prose prose-sm dark:prose-invert max-w-none">
          <pre className="whitespace-pre-wrap font-mono text-sm">{content}</pre>
        </div>
      ) : (
        <textarea
          value={content}
          onChange={handleChange}
          placeholder="Write your note..."
          className="flex-1 p-3 text-sm resize-none bg-transparent focus:outline-none font-mono leading-relaxed"
          spellCheck={false}
        />
      )}
    </div>
  );
}
