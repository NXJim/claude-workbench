/**
 * Terminal tile header bar — shows session name, status indicator, and action buttons.
 */

import { useState, useRef } from 'react';
import { useSessionStore } from '@/stores/sessionStore';
import { useLayoutStore } from '@/stores/layoutStore';
import { QuickPasteMenu } from '@/components/terminal/QuickPasteMenu';
import { windowKey } from '@/types/windows';
import type { SessionData } from '@/api/client';

interface TerminalHeaderProps {
  session: SessionData;
  connected: boolean;
  isFloating?: boolean;
  onPopOut?: () => void;
  onDockBack?: () => void;
  onMinimize?: () => void;
  onClose?: () => void;
  onToggleNotes?: () => void;
  onQuickPaste?: (command: string) => void;
}

export function TerminalHeader({
  session,
  connected,
  isFloating,
  onPopOut,
  onDockBack,
  onMinimize,
  onClose,
  onToggleNotes,
  onQuickPaste,
}: TerminalHeaderProps) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(session.display_name || '');
  const [showQuickPaste, setShowQuickPaste] = useState(false);
  const quickPasteBtnRef = useRef<HTMLButtonElement>(null);
  // Individual selectors — action functions are stable refs, so these never trigger re-renders.
  // Using useSessionStore() with no selector subscribed to the entire store, causing
  // TerminalHeader to re-render every 10s poll and destroying iframe selection state.
  const updateSession = useSessionStore((s) => s.updateSession);
  const deleteSession = useSessionStore((s) => s.deleteSession);
  const removeFromTiling = useLayoutStore((s) => s.removeFromTiling);
  const removeFloating = useLayoutStore((s) => s.removeFloating);

  const startEditing = () => {
    setEditName(session.display_name || '');
    setEditing(true);
  };

  const handleSaveName = async () => {
    if (editName.trim() && editName !== session.display_name) {
      await updateSession(session.id, { display_name: editName.trim() });
    }
    setEditing(false);
  };

  const handleDelete = async () => {
    if (confirm(`Terminate session "${session.display_name}"?`)) {
      try {
        const wId = windowKey({ type: 'terminal', sessionId: session.id });
        await deleteSession(session.id);
        removeFromTiling(wId);
        removeFloating(wId);
      } catch (e) {
        console.error('Failed to delete session:', e);
      }
    }
  };

  // Status indicator color
  const statusColor = connected
    ? 'bg-green-400'
    : session.status === 'busy'
      ? 'bg-yellow-400 animate-pulse'
      : 'bg-red-400';

  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 bg-surface-100 dark:bg-surface-800 border-b border-surface-200 dark:border-surface-700 select-none"
      style={{ borderLeft: `3px solid ${session.color}` }}
    >
      {/* Status dot */}
      <div className={`w-2 h-2 rounded-full ${statusColor} flex-shrink-0`} />

      {/* Session name */}
      {editing ? (
        <input
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onBlur={handleSaveName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSaveName();
            if (e.key === 'Escape') setEditing(false);
          }}
          className="text-sm font-medium bg-white dark:bg-surface-900 border border-surface-300 dark:border-surface-600 rounded px-1 py-0.5 flex-1 min-w-0"
          autoFocus
        />
      ) : (
        <span
          className="text-sm font-medium truncate cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 flex-1 min-w-0"
          onDoubleClick={startEditing}
          onContextMenu={(e) => {
            e.preventDefault();
            startEditing();
          }}
          title="Double-click or right-click to rename"
        >
          {session.display_name || session.id}
        </span>
      )}

      {/* Project path (truncated) */}
      {session.project_path && (
        <span className="text-xs text-surface-500 dark:text-surface-400 truncate max-w-32 hidden sm:inline">
          {session.project_path.split('/').slice(-2).join('/')}
        </span>
      )}

      {/* Action buttons — min 44px touch targets on mobile */}
      <div className="flex items-center gap-0.5 sm:gap-1 flex-shrink-0">
        {/* Quick paste */}
        <button
          ref={quickPasteBtnRef}
          onClick={() => setShowQuickPaste(!showQuickPaste)}
          className={`p-2 sm:p-1 rounded text-surface-500 ${showQuickPaste
            ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
            : 'hover:bg-surface-200 dark:hover:bg-surface-700'
          }`}
          title="Quick paste commands"
        >
          <svg className="w-4 h-4 sm:w-3.5 sm:h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </button>
        {showQuickPaste && onQuickPaste && (
          <QuickPasteMenu
            anchorRef={quickPasteBtnRef}
            onPaste={onQuickPaste}
            onClose={() => setShowQuickPaste(false)}
          />
        )}

        {/* Notes toggle */}
        <button
          onClick={onToggleNotes}
          className="p-2 sm:p-1 rounded hover:bg-surface-200 dark:hover:bg-surface-700 text-surface-500"
          title="Toggle notes (Ctrl+Shift+N)"
        >
          <svg className="w-4 h-4 sm:w-3.5 sm:h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        </button>

        {/* Minimize (floating only) — hides window back to sidebar */}
        {isFloating && onMinimize && (
          <button
            onClick={onMinimize}
            className="p-2 sm:p-1 rounded hover:bg-surface-200 dark:hover:bg-surface-700 text-surface-500"
            title="Minimize to sidebar"
          >
            <svg className="w-4 h-4 sm:w-3.5 sm:h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18 12H6" />
            </svg>
          </button>
        )}

        {/* Pop-out / dock-back — hidden on very small screens (no room for floating) */}
        {isFloating ? (
          <button
            onClick={onDockBack}
            className="hidden sm:block p-2 sm:p-1 rounded hover:bg-surface-200 dark:hover:bg-surface-700 text-surface-500"
            title="Dock back to tiling"
          >
            <svg className="w-4 h-4 sm:w-3.5 sm:h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
            </svg>
          </button>
        ) : (
          <button
            onClick={onPopOut}
            className="hidden sm:block p-2 sm:p-1 rounded hover:bg-surface-200 dark:hover:bg-surface-700 text-surface-500"
            title="Pop out as floating window"
          >
            <svg className="w-4 h-4 sm:w-3.5 sm:h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </button>
        )}

        {/* Close/delete */}
        <button
          onClick={onClose || handleDelete}
          className="p-2 sm:p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-surface-500 hover:text-red-600"
          title="Close session"
        >
          <svg className="w-4 h-4 sm:w-3.5 sm:h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
