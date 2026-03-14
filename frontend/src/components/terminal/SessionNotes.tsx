/**
 * Collapsible markdown notepad alongside each terminal.
 * Auto-saves on 1s debounce.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSessionStore } from '@/stores/sessionStore';

interface SessionNotesProps {
  sessionId: string;
  notes: string;
  onClose: () => void;
}

export function SessionNotes({ sessionId, notes: initialNotes, onClose }: SessionNotesProps) {
  const [value, setValue] = useState(initialNotes);
  const { updateNotes } = useSessionStore();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced auto-save
  const save = useCallback((text: string) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      updateNotes(sessionId, text);
    }, 1000);
  }, [sessionId, updateNotes]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    setValue(text);
    save(text);
  };

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  return (
    <div className="flex flex-col h-full w-[300px] border-l border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900">
      <div className="flex items-center justify-between px-3 py-2 border-b border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800">
        <span className="text-sm font-medium">Notes</span>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-surface-200 dark:hover:bg-surface-700"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <textarea
        value={value}
        onChange={handleChange}
        placeholder="Session notes..."
        className="flex-1 p-3 text-sm resize-none bg-transparent focus:outline-none font-mono leading-relaxed"
        spellCheck={false}
      />
    </div>
  );
}
