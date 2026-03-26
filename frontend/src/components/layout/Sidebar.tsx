/**
 * Sidebar with pin/unpin metaphor and hover-to-expand when unpinned.
 *
 * Three visual states:
 *   A) Pinned — full sidebar in document flow with resize handle
 *   B) Unpinned + collapsed — 48px strip, session dots, pin icon rotated 45°
 *   C) Unpinned + hovering — strip stays in flow, full sidebar as absolute overlay
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useSessionStore, SESSION_COLORS } from '@/stores/sessionStore';
import { useLayoutStore } from '@/stores/layoutStore';
import { ORPHANED_WORKSPACE_ID } from './WorkspaceTabBar';
import { useConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useIsMobile } from '@/hooks/useIsMobile';
import { ProjectTree } from './ProjectTree';
import { NotesSidebarSection } from '@/components/notes/NotesSidebarSection';
import { ResizeDivider } from '@/components/ui/ResizeDivider';
import { SessionContextMenu } from '@/components/ui/SessionContextMenu';
import { windowKey } from '@/types/windows';

/** Thumbtack pin icon — upright when pinned, rotated 45° when unpinned. */
function PinIcon({ pinned, className = '' }: { pinned: boolean; className?: string }) {
  return (
    <svg
      className={`w-4 h-4 transition-transform duration-200 ${pinned ? '' : 'rotate-45'} ${className}`}
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <path d="M16 4a1 1 0 00-1-1H9a1 1 0 00-1 1v2l-2 3v2h5v6l1 1 1-1v-6h5v-2l-2-3V4z" />
    </svg>
  );
}

/** Vertical drag handle on the sidebar's right edge for horizontal resizing. */
function SidebarWidthHandle({ onDrag }: { onDrag: (deltaX: number) => void }) {
  const onDragRef = useRef(onDrag);
  onDragRef.current = onDrag;

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    let lastX = e.clientX;

    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientX - lastX;
      lastX = ev.clientX;
      onDragRef.current(delta);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  return (
    <div
      className="flex-shrink-0 cursor-col-resize group relative"
      style={{ width: 4 }}
      onMouseDown={handleMouseDown}
    >
      {/* Wider invisible hit area */}
      <div className="absolute -left-1 -right-1 top-0 bottom-0" />
      {/* Visible line on hover */}
      <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px opacity-0 group-hover:opacity-100 bg-blue-500/40 transition-opacity" />
    </div>
  );
}

/** The full expanded sidebar content — shared between pinned and hover-expanded states. */
function SidebarContent({ isOverlay = false }: { isOverlay?: boolean }) {
  const sessions = useSessionStore((s) => s.sessions);
  const createSession = useSessionStore((s) => s.createSession);
  const deleteSession = useSessionStore((s) => s.deleteSession);
  const updateSession = useSessionStore((s) => s.updateSession);
  const moveToWorkspace = useSessionStore((s) => s.moveToWorkspace);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [contextMenu, setContextMenu] = useState<{ sessionId: string; x: number; y: number } | null>(null);
  const sidebarPinned = useLayoutStore((s) => s.sidebarPinned);
  const sidebarWidth = useLayoutStore((s) => s.sidebarWidth);
  const toggleSidebarPin = useLayoutStore((s) => s.toggleSidebarPin);
  const popOut = useLayoutStore((s) => s.popOut);
  const removeFromTiling = useLayoutStore((s) => s.removeFromTiling);
  const removeFloating = useLayoutStore((s) => s.removeFloating);
  const setSidebarWidth = useLayoutStore((s) => s.setSidebarWidth);
  const sidebarSectionRatios = useLayoutStore((s) => s.sidebarSectionRatios);
  const setSidebarSectionRatios = useLayoutStore((s) => s.setSidebarSectionRatios);
  const saveLayout = useLayoutStore((s) => s.saveLayout);
  const activeWorkspaceId = useLayoutStore((s) => s.activeWorkspaceId);
  const presets = useLayoutStore((s) => s.presets);
  const switchWorkspace = useLayoutStore((s) => s.switchWorkspace);
  const [wsDropdownOpen, setWsDropdownOpen] = useState(false);
  const wsDropdownRef = useRef<HTMLDivElement>(null);
  const wsTriggerRef = useRef<HTMLButtonElement>(null);
  const [wsDropdownPos, setWsDropdownPos] = useState<{ top: number; left: number } | null>(null);

  const orphanedSessions = useSessionStore((s) => s.orphanedSessions);
  const adoptOrphan = useSessionStore((s) => s.adoptOrphan);
  const respawnSession = useSessionStore((s) => s.respawnSession);
  const fetchOrphanedSessions = useSessionStore((s) => s.fetchOrphanedSessions);

  const confirmDialog = useConfirmDialog();
  const isMobile = useIsMobile();
  const isOrphanedView = activeWorkspaceId === ORPHANED_WORKSPACE_ID;
  const aliveSessions = sessions.filter((s) => s.is_alive);

  // Workspace list for mobile selector
  const workspaces = useMemo(() => presets.filter((p) => p.is_workspace), [presets]);
  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId);

  // Close workspace dropdown on outside click
  useEffect(() => {
    if (!wsDropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      // Ignore clicks on the trigger button (toggle handles that)
      if (wsTriggerRef.current?.contains(target)) return;
      if (wsDropdownRef.current && !wsDropdownRef.current.contains(target)) {
        setWsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [wsDropdownOpen]);

  // Measure container height for ratio-based section sizing
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerHeight, setContainerHeight] = useState(0);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height);
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Resize divider handlers
  const handleDividerDrag = useCallback((index: number, deltaY: number) => {
    if (containerHeight <= 0) return;
    const ratios = [...sidebarSectionRatios] as [number, number, number];
    const deltaRatio = deltaY / containerHeight;

    ratios[index] = Math.max(0.1, ratios[index] + deltaRatio);
    ratios[index + 1] = Math.max(0.1, ratios[index + 1] - deltaRatio);

    const total = ratios[0] + ratios[1] + ratios[2];
    ratios[0] /= total;
    ratios[1] /= total;
    ratios[2] /= total;

    setSidebarSectionRatios(ratios);
  }, [containerHeight, sidebarSectionRatios, setSidebarSectionRatios]);

  const handleWidthDrag = useCallback((deltaX: number) => {
    const newWidth = Math.max(180, Math.min(600, sidebarWidth + deltaX));
    setSidebarWidth(newWidth);
  }, [sidebarWidth, setSidebarWidth]);

  const termKey = (sessionId: string) => windowKey({ type: 'terminal', sessionId });

  const handleNewSession = async () => {
    const color = SESSION_COLORS[sessions.length % SESSION_COLORS.length];
    const session = await createSession(undefined, undefined, color);
    popOut(termKey(session.id), { type: 'terminal', sessionId: session.id });
  };

  return (
    <div className="flex flex-row flex-shrink-0 h-full" style={{ width: sidebarWidth }}>
      <div className="flex-1 min-w-0 bg-white dark:bg-surface-900 flex flex-col overflow-hidden h-full">
        {/* Resizable sections container */}
        <div ref={containerRef} className="flex-1 flex flex-col min-h-0">
          {/* Section 1: Project tree */}
          <div
            className="overflow-y-auto"
            style={{ height: containerHeight > 0 ? containerHeight * sidebarSectionRatios[0] : 'auto' }}
          >
            <div className="flex items-center justify-between px-3 py-2 sticky top-0 bg-white dark:bg-surface-900 z-10">
              <span className="text-xs font-semibold uppercase tracking-wider text-surface-500">
                Projects
              </span>
              {/* Pin/unpin button — hidden on mobile (hamburger menu handles close) */}
              <button
                onClick={toggleSidebarPin}
                className="hidden md:block p-1 rounded hover:bg-surface-200 dark:hover:bg-surface-700 text-surface-500"
                title={sidebarPinned ? 'Unpin sidebar (Ctrl+B)' : 'Pin sidebar (Ctrl+B)'}
              >
                <PinIcon pinned={sidebarPinned} />
              </button>
            </div>
            <ProjectTree />
          </div>

          <ResizeDivider onDrag={(dy) => handleDividerDrag(0, dy)} />

          {/* Section 2: Active sessions */}
          <div
            className="overflow-y-auto border-t border-surface-200 dark:border-surface-700"
            style={{ height: containerHeight > 0 ? containerHeight * sidebarSectionRatios[1] : 'auto' }}
          >
            <div className="flex items-center justify-between px-3 py-2 sticky top-0 bg-white dark:bg-surface-900 z-10">
              <span className={`text-xs font-semibold uppercase tracking-wider ${isOrphanedView ? 'text-amber-600 dark:text-amber-400' : 'text-surface-500'}`}>
                {isOrphanedView ? `Orphaned (${orphanedSessions.length})` : `Sessions (${aliveSessions.length})`}
              </span>
              {/* Mobile workspace selector — only shown when 2+ workspaces exist */}
              {isMobile && workspaces.length >= 2 && (
                <>
                  <button
                    ref={wsTriggerRef}
                    onClick={() => {
                      if (!wsDropdownOpen && wsTriggerRef.current) {
                        const rect = wsTriggerRef.current.getBoundingClientRect();
                        // Position below the trigger, clamped to viewport
                        const top = Math.min(rect.bottom + 4, window.innerHeight - 200);
                        const left = Math.min(rect.left, window.innerWidth - 180);
                        setWsDropdownPos({ top, left });
                      }
                      setWsDropdownOpen((v) => !v);
                    }}
                    className="flex items-center gap-1 ml-auto mr-1 px-2 py-0.5 rounded-full text-xs font-medium bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors"
                  >
                    <span className="truncate max-w-[120px]">{activeWorkspace?.name || 'Workspace'}</span>
                    <svg className={`w-3 h-3 transition-transform ${wsDropdownOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {wsDropdownOpen && wsDropdownPos && createPortal(
                    <div
                      ref={wsDropdownRef}
                      className="fixed min-w-[160px] bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-lg shadow-lg z-[9999] py-1"
                      style={{ top: wsDropdownPos.top, left: wsDropdownPos.left }}
                    >
                      {workspaces.map((ws) => (
                        <button
                          key={ws.id}
                          onClick={() => {
                            switchWorkspace(ws.id);
                            setWsDropdownOpen(false);
                          }}
                          className={`w-full text-left px-3 py-2 text-sm hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors ${
                            ws.id === activeWorkspaceId
                              ? 'text-blue-600 dark:text-blue-400 font-medium'
                              : 'text-surface-700 dark:text-surface-300'
                          }`}
                        >
                          {ws.name}
                        </button>
                      ))}
                    </div>,
                    document.body
                  )}
                </>
              )}
              {!isOrphanedView && <button
                onClick={handleNewSession}
                className="p-1 rounded hover:bg-surface-200 dark:hover:bg-surface-700 text-surface-500"
                title="New session (Ctrl+N)"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
              </button>}
            </div>
            <div className="pb-2">
              {isOrphanedView ? (
                /* Orphaned sessions view */
                orphanedSessions.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-surface-400">No orphaned sessions</p>
                ) : (
                  <>
                    <p className="px-3 py-1 text-[10px] text-amber-600 dark:text-amber-400">
                      Recovered tmux sessions. Move them to a workspace to keep them.
                    </p>
                    {orphanedSessions.map((s) => (
                      <OrphanedSessionItem
                        key={s.id}
                        session={s}
                        workspaces={workspaces}
                        onAdopt={async (targetId) => {
                          await adoptOrphan(s.id, targetId);
                          await fetchOrphanedSessions();
                        }}
                        onRespawn={async () => {
                          await respawnSession(s.id);
                        }}
                        onDelete={async () => {
                          const confirmed = await confirmDialog({
                            title: 'Terminate orphaned session?',
                            itemName: s.display_name || `Session ${s.id.slice(0, 8)}`,
                            message: 'This will kill the tmux session permanently.',
                            confirmLabel: 'Terminate',
                            confirmVariant: 'danger',
                          });
                          if (confirmed) {
                            await deleteSession(s.id);
                            await fetchOrphanedSessions();
                          }
                        }}
                        onOpen={() => {
                          popOut(termKey(s.id), { type: 'terminal', sessionId: s.id });
                          if (isMobile && sidebarPinned) toggleSidebarPin();
                        }}
                      />
                    ))}
                  </>
                )
              ) : (
                /* Normal session view */
                aliveSessions.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-surface-400">No active sessions</p>
                ) : (
                  aliveSessions.map((s) => (
                    <div
                      key={s.id}
                      className="group flex items-center gap-2 px-3 py-1.5 hover:bg-surface-100 dark:hover:bg-surface-800 cursor-pointer"
                      onClick={() => {
                        popOut(termKey(s.id), { type: 'terminal', sessionId: s.id });
                        // Auto-close sidebar drawer on mobile after selecting a session
                        if (isMobile && sidebarPinned) toggleSidebarPin();
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setRenamingId(s.id);
                        setRenameValue(s.display_name || '');
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setContextMenu({ sessionId: s.id, x: e.clientX, y: e.clientY });
                      }}
                    >
                      <div
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: s.color }}
                      />
                      {renamingId === s.id ? (
                        <input
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onBlur={async () => {
                            if (renameValue.trim() && renameValue !== s.display_name) {
                              await updateSession(s.id, { display_name: renameValue.trim() });
                            }
                            setRenamingId(null);
                          }}
                          onKeyDown={async (e) => {
                            if (e.key === 'Enter') {
                              if (renameValue.trim() && renameValue !== s.display_name) {
                                await updateSession(s.id, { display_name: renameValue.trim() });
                              }
                              setRenamingId(null);
                            }
                            if (e.key === 'Escape') setRenamingId(null);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="text-sm bg-white dark:bg-surface-900 border border-surface-300 dark:border-surface-600 rounded px-1 py-0.5 flex-1 min-w-0"
                          autoFocus
                          placeholder="Session name..."
                        />
                      ) : (
                        <span className="text-sm truncate flex-1">{s.display_name || `Session ${s.id.slice(0, 8)}`}</span>
                      )}
                      <span className={`text-xs ${s.status === 'connected' ? 'text-green-500' : 'text-surface-400'}`}>
                        {s.status === 'connected' ? 'on' : s.status}
                      </span>
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          const confirmed = await confirmDialog({
                            title: 'Terminate session?',
                            itemName: s.display_name || `Session ${s.id.slice(0, 8)}`,
                            message: 'This will kill the tmux session and close its terminal process. This action cannot be undone.',
                            confirmLabel: 'Terminate',
                            confirmVariant: 'danger',
                          });
                          if (confirmed) {
                            try {
                              const wId = termKey(s.id);
                              await deleteSession(s.id);
                              removeFromTiling(wId);
                              removeFloating(wId);
                            } catch (err) {
                              console.error('Failed to delete session:', err);
                            }
                          }
                        }}
                        className="opacity-100 md:opacity-0 md:group-hover:opacity-100 p-1.5 md:p-0.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-surface-400 hover:text-red-500"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))
                )
              )}
            </div>
          </div>

          <ResizeDivider onDrag={(dy) => handleDividerDrag(1, dy)} />

          {/* Section 3: Notes */}
          <div
            className="overflow-y-auto border-t border-surface-200 dark:border-surface-700"
            style={{ height: containerHeight > 0 ? containerHeight * sidebarSectionRatios[2] : 'auto' }}
          >
            <NotesSidebarSection />
          </div>
        </div>
      </div>
      {/* Width resize handle — only in pinned mode, hidden on mobile */}
      {!isOverlay && (
        <div className="hidden md:block">
          <SidebarWidthHandle onDrag={handleWidthDrag} />
        </div>
      )}

      {/* Session context menu (portal — renders outside sidebar overflow) */}
      {contextMenu && (
        <SessionContextMenu
          sessionId={contextMenu.sessionId}
          position={{ x: contextMenu.x, y: contextMenu.y }}
          onClose={() => setContextMenu(null)}
          showRename
          showDelete
          currentColor={sessions.find((s) => s.id === contextMenu.sessionId)?.color}
          onColorChange={async (color) => {
            await updateSession(contextMenu.sessionId, { color });
          }}
          onRename={() => {
            setRenamingId(contextMenu.sessionId);
            const sess = sessions.find((s) => s.id === contextMenu.sessionId);
            setRenameValue(sess?.display_name || '');
          }}
          onDelete={async () => {
            const sess = sessions.find((s) => s.id === contextMenu.sessionId);
            const confirmed = await confirmDialog({
              title: 'Terminate session?',
              itemName: sess?.display_name || `Session ${contextMenu.sessionId.slice(0, 8)}`,
              message: 'This will kill the tmux session and close its terminal process. This action cannot be undone.',
              confirmLabel: 'Terminate',
              confirmVariant: 'danger',
            });
            if (confirmed) {
              try {
                const wId = termKey(contextMenu.sessionId);
                await deleteSession(contextMenu.sessionId);
                removeFromTiling(wId);
                removeFloating(wId);
              } catch (err) {
                console.error('Failed to delete session:', err);
              }
            }
          }}
          onMove={async (targetId) => {
            const wId = termKey(contextMenu.sessionId);
            removeFromTiling(wId);
            removeFloating(wId);
            await moveToWorkspace(contextMenu.sessionId, targetId);
            saveLayout();
          }}
        />
      )}
    </div>
  );
}

/** A single orphaned session row with move-to-workspace dropdown. */
function OrphanedSessionItem({
  session: s,
  workspaces,
  onAdopt,
  onRespawn,
  onDelete,
  onOpen,
}: {
  session: import('@/api/client').SessionData;
  workspaces: import('@/api/client').LayoutPresetData[];
  onAdopt: (targetWorkspaceId: number) => Promise<void>;
  onRespawn: () => Promise<void>;
  onDelete: () => Promise<void>;
  onOpen: () => void;
}) {
  const [showMoveMenu, setShowMoveMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const isPaneDead = s.status === 'pane_dead';

  // Close menu on outside click
  useEffect(() => {
    if (!showMoveMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMoveMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMoveMenu]);

  return (
    <div className="group flex items-center gap-2 px-3 py-1.5 hover:bg-surface-100 dark:hover:bg-surface-800">
      <div
        className="w-2 h-2 rounded-full flex-shrink-0"
        style={{ backgroundColor: isPaneDead ? '#94a3b8' : s.color }}
      />
      <button
        onClick={onOpen}
        className="text-sm truncate flex-1 text-left hover:underline"
        title="Open terminal"
      >
        {s.display_name || `Session ${s.id.slice(0, 8)}`}
      </button>
      {isPaneDead && (
        <button
          onClick={onRespawn}
          className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-900/50"
          title="Restart the shell process"
        >
          Restart
        </button>
      )}
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setShowMoveMenu((v) => !v)}
          className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900/50"
          title="Move to a workspace"
        >
          Move
        </button>
        {showMoveMenu && (
          <div className="absolute right-0 top-full mt-1 min-w-[140px] bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-lg shadow-lg z-50 py-1">
            {workspaces.map((ws) => (
              <button
                key={ws.id}
                onClick={async () => {
                  await onAdopt(ws.id);
                  setShowMoveMenu(false);
                }}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-surface-100 dark:hover:bg-surface-700 text-surface-700 dark:text-surface-300"
              >
                {ws.name}
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        onClick={onDelete}
        className="opacity-100 md:opacity-0 md:group-hover:opacity-100 p-0.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-surface-400 hover:text-red-500"
        title="Terminate session"
      >
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}


export function Sidebar() {
  const sidebarPinned = useLayoutStore((s) => s.sidebarPinned);
  const sidebarWidth = useLayoutStore((s) => s.sidebarWidth);
  const toggleSidebarPin = useLayoutStore((s) => s.toggleSidebarPin);
  const popOut = useLayoutStore((s) => s.popOut);
  const isMobile = useIsMobile();
  const sessions = useSessionStore((s) => s.sessions);
  const aliveSessions = sessions.filter((s) => s.is_alive);

  // Hover expand state for unpinned mode
  const [hoverExpanded, setHoverExpanded] = useState(false);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const termKey = (sessionId: string) => windowKey({ type: 'terminal', sessionId });

  const handleMouseEnter = useCallback(() => {
    if (isMobile) return;
    // 150ms debounce to prevent accidental triggers
    hoverTimerRef.current = setTimeout(() => {
      setHoverExpanded(true);
    }, 150);
  }, [isMobile]);

  const handleMouseLeave = useCallback(() => {
    // Clear pending hover timer
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    // Collapse immediately
    setHoverExpanded(false);
  }, []);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    };
  }, []);

  // --- State A: Pinned (desktop) or open drawer (mobile) ---
  if (sidebarPinned) {
    if (isMobile) {
      // Mobile: full sidebar as drawer (no pin icon, no resize handle)
      return <SidebarContent isOverlay />;
    }
    // Desktop pinned: full sidebar in flow with resize handle
    return <SidebarContent />;
  }

  // --- Mobile unpinned: hidden (hamburger menu re-opens via toggleSidebarPin) ---
  if (isMobile) return null;

  // --- State B/C: Unpinned (desktop) — strip + optional hover overlay ---
  return (
    <div
      className="relative flex flex-row h-full"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* State B: 48px collapsed strip — always in flow */}
      <div className="w-12 flex-shrink-0 h-full border-r border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 flex flex-col items-center py-3 gap-3">
        <button
          onClick={toggleSidebarPin}
          className="p-2 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 text-surface-500"
          title="Pin sidebar (Ctrl+B)"
        >
          <PinIcon pinned={false} />
        </button>
        {/* Session dots */}
        {aliveSessions.map((s) => (
          <button
            key={s.id}
            onClick={() => popOut(termKey(s.id), { type: 'terminal', sessionId: s.id })}
            className="w-3 h-3 rounded-full border-2 border-transparent hover:border-surface-400 transition-colors"
            style={{ backgroundColor: s.color }}
            title={s.display_name || s.id}
          />
        ))}
      </div>

      {/* State C: Hover-expanded overlay */}
      {hoverExpanded && (
        <div
          className="absolute left-12 top-0 h-full z-[300] shadow-xl"
          style={{ width: sidebarWidth }}
        >
          <SidebarContent isOverlay />
        </div>
      )}
    </div>
  );
}
