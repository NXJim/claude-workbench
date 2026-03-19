/**
 * Floating terminal window — uses FloatingWindowShell for drag/resize,
 * wraps terminal-specific content (header, ttyd iframe, session notes).
 */

import { useRef, useState, memo } from 'react';
import { useSessionStore } from '@/stores/sessionStore';
import { useLayoutStore, type FloatingWindow as FW } from '@/stores/layoutStore';
import { TtydTerminal, type TtydTerminalHandle } from '@/components/terminal/TtydTerminal';
import { SessionNotes } from '@/components/terminal/SessionNotes';
import { QuickPasteMenu } from '@/components/terminal/QuickPasteMenu';
import { useConfirmDialog } from '@/components/ui/ConfirmDialog';
import { SessionContextMenu } from '@/components/ui/SessionContextMenu';
import { FloatingWindowShell } from './FloatingWindowShell';
import { sessionIdFromKey } from '@/types/windows';
import type { SessionData } from '@/api/client';

/** Compare session fields that affect rendering — returns true if unchanged */
function sessionUnchanged(a: SessionData | undefined, b: SessionData | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.id === b.id && a.status === b.status && a.display_name === b.display_name
    && a.notes === b.notes && a.color === b.color && a.is_alive === b.is_alive;
}

interface FloatingWindowProps {
  window: FW;
}

export const TerminalFloatingWindow = memo(function TerminalFloatingWindow({ window: fw }: FloatingWindowProps) {
  const sessionId = sessionIdFromKey(fw.id);
  // Stable selector: returns the cached ref when session data hasn't changed,
  // preventing re-renders from polling that replaces object references.
  const sessionRef = useRef<SessionData | undefined>(undefined);
  const session = useSessionStore((s) => {
    const found = s.sessions.find((sess) => sess.id === sessionId);
    if (sessionUnchanged(sessionRef.current, found)) return sessionRef.current;
    sessionRef.current = found;
    return found;
  });
  const dockBack = useLayoutStore((s) => s.dockBack);
  const removeFloating = useLayoutStore((s) => s.removeFloating);
  const saveLayout = useLayoutStore((s) => s.saveLayout);
  const deleteSession = useSessionStore((s) => s.deleteSession);
  const updateSession = useSessionStore((s) => s.updateSession);
  const moveToWorkspace = useSessionStore((s) => s.moveToWorkspace);
  const [showNotes, setShowNotes] = useState(false);
  const [showQuickPaste, setShowQuickPaste] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const quickPasteBtnRef = useRef<HTMLButtonElement>(null);
  const terminalRef = useRef<TtydTerminalHandle>(null);
  const confirmDialog = useConfirmDialog();

  const handleClose = async () => {
    if (!session) return;
    const confirmed = await confirmDialog({
      title: 'Terminate session?',
      itemName: session.display_name || `Session ${session.id.slice(0, 8)}`,
      message: 'This will kill the tmux session and close its terminal process. This action cannot be undone.',
      confirmLabel: 'Terminate',
      confirmVariant: 'danger',
    });
    if (confirmed) {
      try {
        await deleteSession(fw.id.includes(':') ? fw.id.split(':')[1] : fw.id);
        removeFloating(fw.id);
      } catch (e) {
        console.error('Failed to delete session:', e);
      }
    }
  };

  if (!session || !sessionId) return null;

  // Status indicator color
  const connected = session.status === 'connected';
  const statusColor = connected
    ? 'bg-green-400'
    : session.status === 'busy'
      ? 'bg-yellow-400 animate-pulse'
      : 'bg-red-400';

  return (
    <>
    <FloatingWindowShell
      window={fw}
      title={session.display_name || session.id}
      accentColor={session.color}
      onClose={handleClose}
      onRenameTitle={(name) => updateSession(session.id, { display_name: name })}
      onTitleBarContextMenu={(e) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY });
      }}
      icon={<div className={`w-2 h-2 rounded-full ${statusColor} flex-shrink-0`} />}
      headerActions={
        <>
          {/* Quick paste */}
          <button
            ref={quickPasteBtnRef}
            onClick={() => setShowQuickPaste(!showQuickPaste)}
            className={`p-1 rounded text-surface-500 ${showQuickPaste
              ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
              : 'hover:bg-surface-200 dark:hover:bg-surface-700'
            }`}
            title="Quick paste commands"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </button>
          {showQuickPaste && (
            <QuickPasteMenu
              anchorRef={quickPasteBtnRef}
              onPaste={(cmd) => terminalRef.current?.sendData(cmd + '\n')}
              onClose={() => setShowQuickPaste(false)}
            />
          )}

          {/* Notes toggle */}
          <button
            onClick={() => setShowNotes(!showNotes)}
            className="p-1 rounded hover:bg-surface-200 dark:hover:bg-surface-700 text-surface-500"
            title="Toggle notes (Ctrl+Shift+N)"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>

          {/* Dock back */}
          <button
            onClick={() => dockBack(fw.id)}
            className="hidden sm:block p-1 rounded hover:bg-surface-200 dark:hover:bg-surface-700 text-surface-500"
            title="Dock back to tiling"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
            </svg>
          </button>
        </>
      }
    >
      <div className="flex flex-1 min-h-0 h-full">
        <div className="flex-1 min-w-0">
          <TtydTerminal ref={terminalRef} sessionId={sessionId} />
        </div>
        {showNotes && (
          <SessionNotes
            sessionId={sessionId}
            notes={session.notes || ''}
            onClose={() => setShowNotes(false)}
          />
        )}
      </div>
    </FloatingWindowShell>

    {/* Context menu for move-to-workspace and rename */}
    {contextMenu && sessionId && (
      <SessionContextMenu
        sessionId={sessionId}
        position={contextMenu}
        onClose={() => setContextMenu(null)}
        showRename
        currentColor={session?.color}
        onColorChange={async (color) => {
          await updateSession(sessionId, { color });
        }}
        onRename={() => {
          // Trigger the shell's inline rename by simulating double-click behavior
          // (Shell handles rename via onRenameTitle — just close the menu here;
          //  the user can double-click the title to rename)
        }}
        onMove={async (targetId) => {
          removeFloating(fw.id);
          await moveToWorkspace(sessionId, targetId);
          saveLayout();
        }}
      />
    )}
    </>
  );
});
