/**
 * Mobile replacement for TilingWorkspace.
 * Shows session cards in a scrollable list; tapping opens full-screen terminal.
 */

import { useState, useRef } from 'react';
import { useSessionStore, SESSION_COLORS } from '@/stores/sessionStore';
import { TtydTerminal, type TtydTerminalHandle } from '@/components/terminal/TtydTerminal';
import { QuickPasteMenu } from '@/components/terminal/QuickPasteMenu';
import type { SessionData } from '@/api/client';

/** Full-screen terminal view with back button header. */
function MobileTerminalView({
  session,
  onBack,
}: {
  session: SessionData;
  onBack: () => void;
}) {
  const terminalRef = useRef<TtydTerminalHandle>(null);
  const [showQuickPaste, setShowQuickPaste] = useState(false);
  const quickPasteBtnRef = useRef<HTMLButtonElement>(null);

  const connected = session.status === 'connected';
  const statusColor = connected
    ? 'bg-green-400'
    : session.status === 'busy'
      ? 'bg-yellow-400 animate-pulse'
      : 'bg-red-400';

  return (
    <div className="flex flex-col h-full bg-surface-950">
      {/* Header bar */}
      <div
        className="flex items-center gap-2 px-3 py-2 bg-surface-100 dark:bg-surface-800 border-b border-surface-200 dark:border-surface-700 flex-shrink-0"
        style={{ borderLeft: `3px solid ${session.color}` }}
      >
        {/* Back button */}
        <button
          onClick={onBack}
          className="p-2 -ml-1 rounded-lg hover:bg-surface-200 dark:hover:bg-surface-700 text-surface-500"
          aria-label="Back to sessions"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        {/* Status dot */}
        <div className={`w-2.5 h-2.5 rounded-full ${statusColor} flex-shrink-0`} />

        {/* Session name */}
        <span className="text-sm font-medium truncate flex-1 text-surface-900 dark:text-surface-100">
          {session.display_name || `Session ${session.id.slice(0, 8)}`}
        </span>

        {/* Quick paste */}
        <button
          ref={quickPasteBtnRef}
          onClick={() => setShowQuickPaste(!showQuickPaste)}
          className={`p-2 rounded-lg text-surface-500 ${showQuickPaste
            ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
            : 'hover:bg-surface-200 dark:hover:bg-surface-700'
          }`}
          title="Quick paste"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
      </div>

      {/* Terminal fills remaining space */}
      <div className="flex-1 min-h-0">
        <TtydTerminal ref={terminalRef} sessionId={session.id} />
      </div>
    </div>
  );
}

export function MobileSessionCards() {
  const sessions = useSessionStore((s) => s.sessions);
  const createSession = useSessionStore((s) => s.createSession);
  const aliveSessions = sessions.filter((s) => s.is_alive);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  // If viewing a terminal, show it full-screen
  const activeSession = activeSessionId
    ? aliveSessions.find((s) => s.id === activeSessionId)
    : null;

  if (activeSession) {
    return (
      <MobileTerminalView
        session={activeSession}
        onBack={() => setActiveSessionId(null)}
      />
    );
  }

  const handleNewSession = async () => {
    const color = SESSION_COLORS[sessions.length % SESSION_COLORS.length];
    const session = await createSession(undefined, undefined, color);
    // Open the new session immediately
    setActiveSessionId(session.id);
  };

  // Session card list
  return (
    <div className="flex flex-col h-full bg-surface-50 dark:bg-surface-950">
      {aliveSessions.length === 0 ? (
        /* Empty state */
        <div className="flex-1 flex items-center justify-center px-6">
          <div className="text-center space-y-4">
            <svg className="w-16 h-16 mx-auto text-surface-300 dark:text-surface-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <div>
              <p className="text-lg font-medium text-surface-700 dark:text-surface-300">No sessions open</p>
              <p className="text-sm text-surface-500 dark:text-surface-400 mt-1">
                Open the sidebar to pick a project, or create a new session
              </p>
            </div>
            <button
              onClick={handleNewSession}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              New Session
            </button>
          </div>
        </div>
      ) : (
        /* Session cards */
        <div className="flex-1 overflow-y-auto">
          <div className="px-4 pt-3 pb-2">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-surface-500">
                Sessions ({aliveSessions.length})
              </h2>
              <button
                onClick={handleNewSession}
                className="p-1.5 rounded-lg hover:bg-surface-200 dark:hover:bg-surface-800 text-surface-500"
                title="New session"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
              </button>
            </div>
          </div>

          <div className="px-4 pb-4 space-y-2">
            {aliveSessions.map((s) => {
              const connected = s.status === 'connected';
              const statusColor = connected
                ? 'bg-green-400'
                : s.status === 'busy'
                  ? 'bg-yellow-400 animate-pulse'
                  : 'bg-red-400';

              return (
                <button
                  key={s.id}
                  onClick={() => setActiveSessionId(s.id)}
                  className="w-full text-left rounded-xl bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700 p-4 active:bg-surface-100 dark:active:bg-surface-800 transition-colors"
                  style={{ borderLeftWidth: 3, borderLeftColor: s.color }}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-2.5 h-2.5 rounded-full ${statusColor} flex-shrink-0`} />
                    <span className="text-sm font-medium text-surface-900 dark:text-surface-100 truncate flex-1">
                      {s.display_name || `Session ${s.id.slice(0, 8)}`}
                    </span>
                    <span className={`text-xs ${connected ? 'text-green-600 dark:text-green-400' : 'text-surface-400'}`}>
                      {connected ? 'connected' : s.status}
                    </span>
                    {/* Chevron hint */}
                    <svg className="w-4 h-4 text-surface-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                  {s.project_path && (
                    <p className="text-xs text-surface-500 dark:text-surface-400 mt-1.5 ml-5.5 truncate">
                      {s.project_path.split('/').slice(-2).join('/')}
                    </p>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
