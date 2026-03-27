/**
 * Terminal tile header bar — shows session name, status indicator, and action buttons.
 */

import { useState, useRef } from 'react';
import { useSessionStore } from '@/stores/sessionStore';
import { useLayoutStore } from '@/stores/layoutStore';
import { useConfirmDialog } from '@/components/ui/ConfirmDialog';
import { QuickPasteMenu } from '@/components/terminal/QuickPasteMenu';
import { VoiceInputPanel } from '@/components/terminal/VoiceInputPanel';
import { windowKey } from '@/types/windows';
import type { SessionData } from '@/api/client';

// Feature-detect Speech API once at module level
const speechSupported = typeof window !== 'undefined' &&
  !!(window.SpeechRecognition || window.webkitSpeechRecognition);

interface TerminalHeaderProps {
  session: SessionData;
  connected: boolean;
  isFloating?: boolean;
  onPopOut?: () => void;
  onDockBack?: () => void;
  onMinimize?: () => void;
  onClose?: () => void;
  onToggleNotes?: () => void;
  onOpenScratchPad?: () => void;
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
  onOpenScratchPad,
  onQuickPaste,
}: TerminalHeaderProps) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(session.display_name || '');
  const [showQuickPaste, setShowQuickPaste] = useState(false);
  const [showVoiceInput, setShowVoiceInput] = useState(false);
  const quickPasteBtnRef = useRef<HTMLButtonElement>(null);
  const voiceBtnRef = useRef<HTMLButtonElement>(null);
  // Individual selectors — action functions are stable refs, so these never trigger re-renders.
  // Using useSessionStore() with no selector subscribed to the entire store, causing
  // TerminalHeader to re-render every 10s poll and destroying iframe selection state.
  const updateSession = useSessionStore((s) => s.updateSession);
  const deleteSession = useSessionStore((s) => s.deleteSession);
  const removeFromTiling = useLayoutStore((s) => s.removeFromTiling);
  const removeFloating = useLayoutStore((s) => s.removeFloating);
  const confirmDialog = useConfirmDialog();

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
    const ok = await confirmDialog({
      title: 'Terminate session?',
      itemName: session.display_name || session.id,
      confirmLabel: 'Terminate',
      confirmVariant: 'danger',
    });
    if (!ok) return;
    try {
      const wId = windowKey({ type: 'terminal', sessionId: session.id });
      await deleteSession(session.id);
      removeFromTiling(wId);
      removeFloating(wId);
    } catch (e) {
      console.error('Failed to delete session:', e);
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

        {/* Voice input */}
        {speechSupported && (
          <button
            ref={voiceBtnRef}
            onClick={() => setShowVoiceInput(!showVoiceInput)}
            className={`p-2 sm:p-1 rounded text-surface-500 ${showVoiceInput
              ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
              : 'hover:bg-surface-200 dark:hover:bg-surface-700'
            }`}
            title="Voice input"
          >
            <svg className="w-4 h-4 sm:w-3.5 sm:h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          </button>
        )}
        {showVoiceInput && onQuickPaste && (
          <VoiceInputPanel
            anchorRef={voiceBtnRef}
            onSend={onQuickPaste}
            onClose={() => setShowVoiceInput(false)}
          />
        )}

        {/* Scratch pad — opens .cwb-scratch.md viewer */}
        {session.project_path && onOpenScratchPad && (
          <button
            onClick={onOpenScratchPad}
            className="p-2 sm:p-1 rounded hover:bg-surface-200 dark:hover:bg-surface-700 text-surface-500"
            title="Open scratch pad"
          >
            <svg className="w-4 h-4 sm:w-3.5 sm:h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" />
            </svg>
          </button>
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
