/**
 * Collapsible markdown notepad alongside each terminal.
 * Auto-saves on 500ms debounce with save indicator.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSessionStore } from '@/stores/sessionStore';

type SaveStatus = 'idle' | 'saving' | 'saved';

interface SessionNotesProps {
  sessionId: string;
  notes: string;
  onClose: () => void;
  onSend?: (text: string) => void;
}

export function SessionNotes({ sessionId, notes: initialNotes, onClose, onSend }: SessionNotesProps) {
  const [value, setValue] = useState(initialNotes);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const { updateNotes } = useSessionStore();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced auto-save with status indicator
  const save = useCallback((text: string) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaveStatus('saving');
      try {
        await updateNotes(sessionId, text);
        setSaveStatus('saved');
        savedTimer.current = setTimeout(() => setSaveStatus('idle'), 2000);
      } catch {
        setSaveStatus('idle');
      }
    }, 500);
  }, [sessionId, updateNotes]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    setValue(text);
    save(text);
  };

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (savedTimer.current) clearTimeout(savedTimer.current);
    };
  }, []);

  return (
    <div className="flex flex-col h-full w-[300px] border-l border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900">
      <div className="flex items-center justify-between px-3 py-2 border-b border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Notes</span>
          {saveStatus === 'saving' && (
            <span className="flex items-center gap-1 text-xs text-surface-400">
              <span className="w-1.5 h-1.5 rounded-full bg-surface-400 animate-pulse" />
              Saving
            </span>
          )}
          {saveStatus === 'saved' && (
            <span className="flex items-center gap-1 text-xs text-green-500 dark:text-green-400">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Saved
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-surface-200 dark:hover:bg-surface-700 text-surface-500"
          title="Collapse notes"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7" />
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
      {/* Send to terminal footer */}
      {onSend && (
        <div className="px-3 py-2 border-t border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800">
          <button
            onClick={() => value.trim() && onSend(value)}
            disabled={!value.trim()}
            className="w-full text-xs py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Send to Terminal
          </button>
        </div>
      )}
    </div>
  );
}
