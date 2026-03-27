/**
 * Workspace tabs — session containers.
 * Each tab owns its own sessions. The sidebar filters to the active tab's sessions.
 * There is always at least one tab (the default workspace). Desktop only.
 *
 * Features:
 * - Drag-and-drop reordering via native HTML drag events
 * - Per-tab color accent (vertical line to the left of the label)
 * - Inline rename (double-click), right-click context menu, close with confirmation
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useLayoutStore } from '@/stores/layoutStore';
import { useSessionStore } from '@/stores/sessionStore';
import { api } from '@/api/client';

/** Sentinel ID used to represent the virtual "Orphaned" workspace tab. */
export const ORPHANED_WORKSPACE_ID = -1;

/** Preset color palette for workspace tabs. */
const TAB_COLORS = [
  '#3b82f6', // blue
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f97316', // orange
];

export function WorkspaceTabBar() {
  const presets = useLayoutStore((s) => s.presets);
  const activeWorkspaceId = useLayoutStore((s) => s.activeWorkspaceId);
  const switchWorkspace = useLayoutStore((s) => s.switchWorkspace);
  const saveAsWorkspace = useLayoutStore((s) => s.saveAsWorkspace);
  const deleteWorkspace = useLayoutStore((s) => s.deleteWorkspace);
  const renameWorkspace = useLayoutStore((s) => s.renameWorkspace);
  const updateWorkspace = useLayoutStore((s) => s.updateWorkspace);
  const reorderWorkspaces = useLayoutStore((s) => s.reorderWorkspaces);
  const setWorkspaceColor = useLayoutStore((s) => s.setWorkspaceColor);

  const workspaces = presets.filter((p) => p.is_workspace);
  const orphanedSessions = useSessionStore((s) => s.orphanedSessions);
  const fetchOrphanedSessions = useSessionStore((s) => s.fetchOrphanedSessions);
  const orphanCount = orphanedSessions.length;
  const workspaceSessionCounts = useSessionStore((s) => s.workspaceSessionCounts);
  const fetchWorkspaceSessionCounts = useSessionStore((s) => s.fetchWorkspaceSessionCounts);

  // Fetch orphaned sessions and workspace session counts on mount and periodically
  useEffect(() => {
    fetchOrphanedSessions();
    fetchWorkspaceSessionCounts();
    const interval = setInterval(() => {
      fetchOrphanedSessions();
      fetchWorkspaceSessionCounts();
    }, 10000);
    return () => clearInterval(interval);
  }, [fetchOrphanedSessions, fetchWorkspaceSessionCounts]);

  // Inline rename state
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  // New workspace input state
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const newInputRef = useRef<HTMLInputElement>(null);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ id: number; x: number; y: number } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Confirm dialog state for closing tabs with sessions
  const [confirmClose, setConfirmClose] = useState<{ id: number; sessionCount: number } | null>(null);

  // Drag-and-drop state
  const [dragId, setDragId] = useState<number | null>(null);
  const [dropTargetId, setDropTargetId] = useState<number | null>(null);

  // Scroll overflow state
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  /** Recompute whether scroll arrows should be visible. */
  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // 1px tolerance to avoid sub-pixel rounding issues
    setCanScrollLeft(el.scrollLeft > 1);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  // Track scroll position changes
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', updateScrollState, { passive: true });
    return () => el.removeEventListener('scroll', updateScrollState);
  }, [updateScrollState]);

  // Track container/content size changes via ResizeObserver + initial check
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Immediate check after layout
    requestAnimationFrame(updateScrollState);
    const ro = new ResizeObserver(updateScrollState);
    ro.observe(el);
    // Also observe a child so we detect when tabs are added/removed
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [updateScrollState, workspaces.length, orphanCount]);

  const scrollBy = useCallback((dir: -1 | 1) => {
    scrollRef.current?.scrollBy({ left: dir * 120, behavior: 'smooth' });
  }, []);

  // Focus rename input when it appears
  useEffect(() => {
    if (renamingId !== null && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  // Focus new workspace input
  useEffect(() => {
    if (creating && newInputRef.current) {
      newInputRef.current.focus();
    }
  }, [creating]);

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const handler = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [contextMenu]);

  const handleRenameSubmit = async () => {
    if (renamingId !== null && renameValue.trim()) {
      await renameWorkspace(renamingId, renameValue.trim());
    }
    setRenamingId(null);
  };

  const handleCreateSubmit = async () => {
    if (newName.trim()) {
      await saveAsWorkspace(newName.trim());
    }
    setNewName('');
    setCreating(false);
  };

  const handleTabClick = (presetId: number) => {
    if (presetId !== activeWorkspaceId) {
      switchWorkspace(presetId);
    }
  };

  const handleDoubleClick = (preset: typeof workspaces[0]) => {
    setRenamingId(preset.id);
    setRenameValue(preset.name);
  };

  const handleContextMenu = (e: React.MouseEvent, id: number) => {
    e.preventDefault();
    setContextMenu({ id, x: e.clientX, y: e.clientY });
  };

  const handleCloseWorkspace = async (presetId: number) => {
    try {
      const count = await api.countWorkspaceSessions(presetId);
      if (count > 0) {
        setConfirmClose({ id: presetId, sessionCount: count });
      } else {
        await deleteWorkspace(presetId, false);
      }
    } catch {
      await deleteWorkspace(presetId, false);
    }
  };

  const handleConfirmDelete = async () => {
    if (confirmClose) {
      await deleteWorkspace(confirmClose.id, true);
      setConfirmClose(null);
    }
  };

  // --- Drag-and-drop handlers ---

  const handleDragStart = useCallback((e: React.DragEvent, wsId: number) => {
    setDragId(wsId);
    e.dataTransfer.effectAllowed = 'move';
    // Minimal drag image data — the visual feedback is the drop indicator
    e.dataTransfer.setData('text/plain', String(wsId));
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, wsId: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragId !== null && dragId !== wsId) {
      setDropTargetId(wsId);
    }
  }, [dragId]);

  const handleDragLeave = useCallback(() => {
    setDropTargetId(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetId: number) => {
    e.preventDefault();
    if (dragId === null || dragId === targetId) {
      setDragId(null);
      setDropTargetId(null);
      return;
    }

    // Compute new order: move dragId before targetId
    const currentOrder = workspaces.map((ws) => ws.id);
    const filtered = currentOrder.filter((id) => id !== dragId);
    const targetIdx = filtered.indexOf(targetId);
    filtered.splice(targetIdx, 0, dragId);

    reorderWorkspaces(filtered);
    setDragId(null);
    setDropTargetId(null);
  }, [dragId, workspaces, reorderWorkspaces]);

  const handleDragEnd = useCallback(() => {
    setDragId(null);
    setDropTargetId(null);
  }, []);

  return (
    <>
      <div className="hidden md:flex items-center gap-0 min-w-0 flex-1">
        {/* Scroll left chevron */}
        {canScrollLeft && (
          <button
            onClick={() => scrollBy(-1)}
            className="flex-shrink-0 px-0.5 py-1 text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 transition-colors"
            title="Scroll tabs left"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}

        {/* Scrollable tab strip — scrollbar hidden via CSS, arrows handle navigation */}
        <div
          ref={scrollRef}
          className="flex items-center gap-0.5 overflow-x-auto min-w-0 scrollbar-hide"
          style={{ scrollbarWidth: 'none' }}
        >
        {workspaces.map((ws) => (
          <div
            key={ws.id}
            className="relative flex-shrink-0"
            draggable={renamingId !== ws.id}
            onDragStart={(e) => handleDragStart(e, ws.id)}
            onDragOver={(e) => handleDragOver(e, ws.id)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, ws.id)}
            onDragEnd={handleDragEnd}
          >
            {/* Drop indicator — left edge highlight */}
            {dropTargetId === ws.id && dragId !== ws.id && (
              <div className="absolute left-0 top-1 bottom-1 w-0.5 bg-blue-500 rounded-full z-10" />
            )}

            {renamingId === ws.id ? (
              <input
                ref={renameInputRef}
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={handleRenameSubmit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRenameSubmit();
                  if (e.key === 'Escape') setRenamingId(null);
                }}
                className="text-xs px-2 py-1 w-24 rounded-md border border-blue-400 dark:border-blue-500 bg-white dark:bg-surface-800 text-surface-800 dark:text-surface-200 outline-none"
              />
            ) : (
              <button
                onClick={() => handleTabClick(ws.id)}
                onDoubleClick={() => handleDoubleClick(ws)}
                onContextMenu={(e) => handleContextMenu(e, ws.id)}
                className={`text-xs px-2.5 py-1 rounded-t-md transition-colors relative flex items-center gap-1.5 whitespace-nowrap ${
                  dragId === ws.id ? 'opacity-40' : ''
                } ${
                  ws.id === activeWorkspaceId
                    ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-b-2 border-blue-500'
                    : 'text-surface-500 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800 hover:text-surface-700 dark:hover:text-surface-300'
                }`}
                title={`Switch to workspace: ${ws.name}`}
              >
                {/* Color accent — vertical line (hidden when workspace has no active sessions) */}
                {ws.color && (workspaceSessionCounts[ws.id] ?? 0) > 0 && (
                  <span
                    className="w-0.5 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: ws.color }}
                  />
                )}
                {ws.name}
              </button>
            )}
          </div>
        ))}

        {/* Orphaned sessions tab — only shown when orphans exist */}
        {orphanCount > 0 && (
          <button
            onClick={() => switchWorkspace(ORPHANED_WORKSPACE_ID)}
            className={`text-xs px-2.5 py-1 rounded-t-md transition-colors relative flex items-center gap-1 flex-shrink-0 whitespace-nowrap ${
              activeWorkspaceId === ORPHANED_WORKSPACE_ID
                ? 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-b-2 border-amber-500'
                : 'text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 hover:text-amber-700 dark:hover:text-amber-300'
            }`}
            title="Recovered tmux sessions without a workspace"
          >
            Orphaned
            <span className={`text-[10px] px-1 py-0.5 rounded-full leading-none ${
              activeWorkspaceId === ORPHANED_WORKSPACE_ID
                ? 'bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200'
                : 'bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400'
            }`}>
              {orphanCount}
            </span>
          </button>
        )}

        {/* Create new workspace */}
        {creating ? (
          <input
            ref={newInputRef}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onBlur={handleCreateSubmit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateSubmit();
              if (e.key === 'Escape') { setCreating(false); setNewName(''); }
            }}
            placeholder="Name..."
            className="text-xs px-2 py-1 w-24 rounded-md border border-blue-400 dark:border-blue-500 bg-white dark:bg-surface-800 text-surface-800 dark:text-surface-200 outline-none placeholder:text-surface-400"
          />
        ) : (
          <button
            onClick={() => setCreating(true)}
            className="text-xs px-1.5 py-1 rounded-md text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors flex-shrink-0"
            title="Create new workspace tab"
          >
            +
          </button>
        )}
        </div>{/* end scrollable tab strip */}

        {/* Scroll right chevron */}
        {canScrollRight && (
          <button
            onClick={() => scrollBy(1)}
            className="flex-shrink-0 px-0.5 py-1 text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 transition-colors"
            title="Scroll tabs right"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )}

        {/* Context menu */}
        {contextMenu && (
          <div
            ref={contextMenuRef}
            className="fixed z-[9999] bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-lg shadow-lg py-1 min-w-36"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            {/* Save Layout */}
            <button
              onClick={() => {
                if (contextMenu.id) {
                  updateWorkspace(contextMenu.id);
                }
                setContextMenu(null);
              }}
              className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-xs hover:bg-surface-100 dark:hover:bg-surface-700 text-surface-700 dark:text-surface-300"
            >
              Save Layout
            </button>

            {/* Rename */}
            <button
              onClick={() => {
                const ws = workspaces.find((w) => w.id === contextMenu.id);
                if (ws) {
                  setRenamingId(ws.id);
                  setRenameValue(ws.name);
                }
                setContextMenu(null);
              }}
              className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-xs hover:bg-surface-100 dark:hover:bg-surface-700 text-surface-700 dark:text-surface-300"
            >
              Rename
            </button>

            {/* Color picker — inline swatches */}
            <div className="px-3 py-1.5">
              <div className="text-xs text-surface-500 dark:text-surface-400 mb-1">Color</div>
              <div className="flex items-center gap-1 flex-wrap">
                {/* "No color" option */}
                <button
                  onClick={() => {
                    setWorkspaceColor(contextMenu.id, null);
                    setContextMenu(null);
                  }}
                  className="w-4 h-4 rounded-full border border-surface-300 dark:border-surface-600 flex items-center justify-center hover:border-surface-500 dark:hover:border-surface-400 transition-colors"
                  title="No color"
                >
                  <span className="text-[8px] text-surface-400">&#x2715;</span>
                </button>
                {TAB_COLORS.map((color) => {
                  const ws = workspaces.find((w) => w.id === contextMenu.id);
                  const isActive = ws?.color === color;
                  return (
                    <button
                      key={color}
                      onClick={() => {
                        setWorkspaceColor(contextMenu.id, color);
                        setContextMenu(null);
                      }}
                      className={`w-4 h-4 rounded-full transition-transform ${
                        isActive ? 'ring-2 ring-offset-1 ring-surface-400 dark:ring-surface-500 dark:ring-offset-surface-800 scale-110' : 'hover:scale-110'
                      }`}
                      style={{ backgroundColor: color }}
                      title={color}
                    />
                  );
                })}
              </div>
            </div>

            <div className="my-1 border-t border-surface-200 dark:border-surface-700" />

            {/* Close — hidden when only 1 workspace */}
            {workspaces.length > 1 && (
              <button
                onClick={() => {
                  handleCloseWorkspace(contextMenu.id);
                  setContextMenu(null);
                }}
                className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-xs hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 dark:text-red-400"
              >
                Close
              </button>
            )}
          </div>
        )}
      </div>

      {/* Confirm close dialog */}
      {confirmClose && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-xl shadow-2xl p-5 max-w-sm mx-4">
            <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200 mb-2">
              Close Workspace?
            </h3>
            <p className="text-xs text-surface-600 dark:text-surface-400 mb-4">
              This workspace has {confirmClose.sessionCount} active session{confirmClose.sessionCount > 1 ? 's' : ''} that will be terminated.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmClose(null)}
                className="px-3 py-1.5 text-xs rounded-lg bg-surface-100 dark:bg-surface-700 text-surface-700 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-600 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                className="px-3 py-1.5 text-xs rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors"
              >
                Close & Terminate
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
