/**
 * Right-click context menu for terminal.
 * Simplified — ttyd handles copy/paste/selection natively.
 * Only "Clear Terminal" remains (sends Ctrl+L via tmux send-keys).
 */

import { useEffect, useRef } from 'react';

interface ContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  onClear: () => void;
}

export function TerminalContextMenu({ x, y, onClose, onClear }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
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

  return (
    <div
      ref={menuRef}
      className="fixed z-50 bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-lg shadow-lg py-1 min-w-40"
      style={{ left: x, top: y }}
    >
      <button
        onClick={() => { onClear(); onClose(); }}
        className="w-full text-left px-3 py-1.5 text-sm hover:bg-surface-100 dark:hover:bg-surface-700"
      >
        Clear Terminal
      </button>
    </div>
  );
}
