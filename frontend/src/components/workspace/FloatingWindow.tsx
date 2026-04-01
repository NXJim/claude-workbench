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
import { VoiceInputPanel } from '@/components/terminal/VoiceInputPanel';
import { useConfirmDialog } from '@/components/ui/ConfirmDialog';

// Feature-detect Speech API once at module level
const speechSupported = typeof window !== 'undefined' &&
  !!(window.SpeechRecognition || window.webkitSpeechRecognition);
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
  const removeFloating = useLayoutStore((s) => s.removeFloating);
  const toggleMaximizeFloating = useLayoutStore((s) => s.toggleMaximizeFloating);
  const saveLayout = useLayoutStore((s) => s.saveLayout);
  const deleteSession = useSessionStore((s) => s.deleteSession);
  const updateSession = useSessionStore((s) => s.updateSession);
  const moveToWorkspace = useSessionStore((s) => s.moveToWorkspace);
  const [showNotes, setShowNotes] = useState(false);
  const [showQuickPaste, setShowQuickPaste] = useState(false);
  const [showVoiceInput, setShowVoiceInput] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const quickPasteBtnRef = useRef<HTMLButtonElement>(null);
  const voiceBtnRef = useRef<HTMLButtonElement>(null);
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

          {/* Voice input */}
          {speechSupported && (
            <button
              ref={voiceBtnRef}
              onClick={() => setShowVoiceInput(!showVoiceInput)}
              className={`p-1 rounded text-surface-500 ${showVoiceInput
                ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
                : 'hover:bg-surface-200 dark:hover:bg-surface-700'
              }`}
              title="Voice input"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            </button>
          )}
          {showVoiceInput && (
            <VoiceInputPanel
              anchorRef={voiceBtnRef}
              onSend={(text) => terminalRef.current?.sendData(text)}
              onClose={() => setShowVoiceInput(false)}
            />
          )}

          {/* Scratch pad */}
          {session.project_path && (
            <button
              onClick={() => useLayoutStore.getState().openWindow({ type: 'scratch-pad', sessionId: sessionId! })}
              className="p-1 rounded hover:bg-surface-200 dark:hover:bg-surface-700 text-surface-500"
              title="Open scratch pad"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" />
              </svg>
            </button>
          )}

          {/* Notes toggle — pencil icon (no surrounding square) */}
          <button
            onClick={() => setShowNotes(!showNotes)}
            className="p-1 rounded hover:bg-surface-200 dark:hover:bg-surface-700 text-surface-500"
            title="Toggle notes (Ctrl+Shift+N)"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Z" />
            </svg>
          </button>

          {/* Maximize */}
          <button
            onClick={() => toggleMaximizeFloating(fw.id)}
            className="hidden sm:block p-1 rounded hover:bg-surface-200 dark:hover:bg-surface-700 text-surface-500"
            title="Maximize"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
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
            onSend={(text) => terminalRef.current?.sendData(text)}
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
