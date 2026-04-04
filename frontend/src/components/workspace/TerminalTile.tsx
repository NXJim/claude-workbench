/**
 * Terminal wrapper for react-mosaic tiles.
 * Combines header + terminal + optional notes panel.
 */

import { useState, useCallback, useRef, memo } from 'react';
import { useSessionStore } from '@/stores/sessionStore';
import { useConfirmDialog } from '@/components/ui/ConfirmDialog';
import type { SessionData } from '@/api/client';

/** Compare session fields that affect rendering — returns true if unchanged */
function sessionUnchanged(a: SessionData | undefined, b: SessionData | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.id === b.id && a.status === b.status && a.display_name === b.display_name
    && a.notes === b.notes && a.color === b.color && a.is_alive === b.is_alive;
}
import { useLayoutStore } from '@/stores/layoutStore';
import { TtydTerminal, type TtydTerminalHandle } from '@/components/terminal/TtydTerminal';
import { TerminalHeader } from '@/components/terminal/TerminalHeader';
import { TerminalContextMenu } from '@/components/terminal/TerminalContextMenu';
import { SessionNotes } from '@/components/terminal/SessionNotes';

interface TerminalTileProps {
  sessionId: string;
  /** Window key used in the layout tree (e.g., "term:abc123"). */
  windowId: string;
}

export const TerminalTile = memo(function TerminalTile({ sessionId, windowId }: TerminalTileProps) {
  // Stable selector: returns the cached ref when session data hasn't changed,
  // preventing re-renders from polling that replaces object references.
  const sessionRef = useRef<SessionData | undefined>(undefined);
  const session = useSessionStore((s) => {
    const found = s.sessions.find((sess) => sess.id === sessionId);
    if (sessionUnchanged(sessionRef.current, found)) return sessionRef.current;
    sessionRef.current = found;
    return found;
  });
  const removeFromTiling = useLayoutStore((s) => s.removeFromTiling);
  const popOut = useLayoutStore((s) => s.popOut);
  const deleteSession = useSessionStore((s) => s.deleteSession);
  const [showNotes, setShowNotes] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const terminalRef = useRef<TtydTerminalHandle>(null);
  const confirmDialog = useConfirmDialog();

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

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
        await deleteSession(sessionId);
        removeFromTiling(windowId);
      } catch (e) {
        console.error('Failed to delete session:', e);
      }
    }
  };

  if (!session) {
    return (
      <div className="flex items-center justify-center h-full bg-surface-50 dark:bg-surface-900 text-surface-400">
        Session not found
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-surface-50 dark:bg-surface-900 rounded-md overflow-hidden border border-surface-200 dark:border-surface-700">
      <TerminalHeader
        session={session}
        connected={session.status === 'connected'}
        onPopOut={() => { removeFromTiling(windowId); popOut(windowId, { type: 'terminal', sessionId }); }}
        onClose={handleClose}
        onToggleNotes={() => setShowNotes(!showNotes)}
        onOpenScratchPad={() => useLayoutStore.getState().openWindow({ type: 'scratch-pad', sessionId })}
        onQuickPaste={(cmd) => {
          terminalRef.current?.sendData(cmd, true);
        }}
      />
      <div className="flex flex-1 min-h-0">
        <div className="flex-1 min-w-0" onContextMenu={handleContextMenu}>
          <TtydTerminal ref={terminalRef} sessionId={sessionId} />
        </div>
        {showNotes && (
          <SessionNotes
            sessionId={sessionId}
            notes={session.notes || ''}
            onClose={() => setShowNotes(false)}
            onSend={(text) => terminalRef.current?.sendData(text)}
          />
        )}
      </div>

      {contextMenu && (
        <TerminalContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onClear={() => {
            terminalRef.current?.sendData('\x0c');
          }}
        />
      )}
    </div>
  );
});
