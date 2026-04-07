/**
 * Quick-paste dropdown menu for terminal header.
 * Shows saved phrases; clicking one pastes it into the terminal and presses Enter.
 * Includes inline editing for adding/removing phrases.
 */

import { useState, useEffect, useRef } from 'react';
import { useQuickPasteStore } from '@/stores/quickPasteStore';
import type { QuickPhrase } from '@/api/client';

interface QuickPasteMenuProps {
  onPaste: (command: string) => void;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
}

export function QuickPasteMenu({ onPaste, onClose, anchorRef }: QuickPasteMenuProps) {
  const { phrases, loaded, fetchPhrases, addPhrase, removePhrase } = useQuickPasteStore();
  const [editing, setEditing] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newCommand, setNewCommand] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const labelInputRef = useRef<HTMLInputElement>(null);

  // Load phrases from server on first open
  useEffect(() => { if (!loaded) fetchPhrases(); }, [loaded, fetchPhrases]);

  // Position below the anchor button
  const [pos, setPos] = useState({ top: 0, left: 0 });
  useEffect(() => {
    if (anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      // Align right edge of menu with right edge of button
      setPos({ top: rect.bottom + 4, left: rect.right });
    }
  }, [anchorRef]);

  // Close on outside click or Escape
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      // Ignore clicks on the anchor button — the button's own onClick handles toggle
      if (anchorRef.current?.contains(target)) return;
      if (menuRef.current && !menuRef.current.contains(target)) {
        onClose();
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [onClose]);

  // Focus label input when entering edit mode
  useEffect(() => {
    if (editing) labelInputRef.current?.focus();
  }, [editing]);

  const handleAdd = () => {
    if (newLabel.trim() && newCommand.trim()) {
      addPhrase(newLabel.trim(), newCommand.trim());
      setNewLabel('');
      setNewCommand('');
    }
  };

  return (
    <div
      ref={menuRef}
      className="fixed z-50 bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-lg shadow-lg py-1 min-w-56 max-w-80"
      style={{ top: pos.top, left: pos.left, transform: 'translateX(-100%)' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-surface-200 dark:border-surface-700">
        <span className="text-xs font-medium text-surface-500 dark:text-surface-400 uppercase tracking-wider">
          Quick Paste
        </span>
        <button
          onClick={() => setEditing(!editing)}
          className={`text-xs px-1.5 py-0.5 rounded ${editing
            ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
            : 'hover:bg-surface-100 dark:hover:bg-surface-700 text-surface-500'
          }`}
        >
          {editing ? 'Done' : 'Edit'}
        </button>
      </div>

      {/* Phrase list */}
      {phrases.length === 0 && !editing && (
        <div className="px-3 py-3 text-sm text-surface-400 text-center">
          No phrases yet. Click Edit to add some.
        </div>
      )}

      {phrases.map((phrase) => (
        <PhraseRow
          key={phrase.id}
          phrase={phrase}
          editing={editing}
          onPaste={() => { onPaste(phrase.command); onClose(); }}
          onRemove={() => removePhrase(phrase.id)}
        />
      ))}

      {/* Add new phrase form */}
      {editing && (
        <div className="px-3 py-2 border-t border-surface-200 dark:border-surface-700 space-y-1.5">
          <input
            ref={labelInputRef}
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="Label"
            className="w-full text-xs bg-surface-50 dark:bg-surface-900 border border-surface-300 dark:border-surface-600 rounded px-2 py-1"
          />
          <input
            value={newCommand}
            onChange={(e) => setNewCommand(e.target.value)}
            placeholder="Command"
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
            className="w-full text-xs font-mono bg-surface-50 dark:bg-surface-900 border border-surface-300 dark:border-surface-600 rounded px-2 py-1"
          />
          <button
            onClick={handleAdd}
            disabled={!newLabel.trim() || !newCommand.trim()}
            className="w-full text-xs py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}

/** Single phrase row — shows label + command, with optional delete button in edit mode. */
function PhraseRow({
  phrase,
  editing,
  onPaste,
  onRemove,
}: {
  phrase: QuickPhrase;
  editing: boolean;
  onPaste: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center group">
      <button
        onClick={onPaste}
        className="flex-1 text-left px-3 py-1.5 hover:bg-surface-100 dark:hover:bg-surface-700 min-w-0"
      >
        <div className="text-sm truncate">{phrase.label}</div>
        <div className="text-xs font-mono text-surface-400 dark:text-surface-500 truncate">
          {phrase.command}
        </div>
      </button>
      {editing && (
        <button
          onClick={onRemove}
          className="flex-shrink-0 p-1.5 mr-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-surface-400 hover:text-red-600"
          title="Remove"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}
