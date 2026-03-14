/**
 * Workspace tabs — session containers.
 * Each tab owns its own sessions. The sidebar filters to the active tab's sessions.
 * There is always at least one tab (the default workspace). Desktop only.
 */

import { useState, useRef, useEffect } from 'react';
import { useLayoutStore } from '@/stores/layoutStore';
import { api } from '@/api/client';

export function WorkspaceTabBar() {
  const presets = useLayoutStore((s) => s.presets);
  const activeWorkspaceId = useLayoutStore((s) => s.activeWorkspaceId);
  const switchWorkspace = useLayoutStore((s) => s.switchWorkspace);
  const saveAsWorkspace = useLayoutStore((s) => s.saveAsWorkspace);
  const deleteWorkspace = useLayoutStore((s) => s.deleteWorkspace);
  const renameWorkspace = useLayoutStore((s) => s.renameWorkspace);
  const updateWorkspace = useLayoutStore((s) => s.updateWorkspace);

  const workspaces = presets.filter((p) => p.is_workspace);

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
    // Always switch — no "click to deactivate" since there's always an active tab
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
    // Query backend for alive session count in this workspace
    try {
      const count = await api.countWorkspaceSessions(presetId);
      if (count > 0) {
        setConfirmClose({ id: presetId, sessionCount: count });
      } else {
        await deleteWorkspace(presetId, false);
      }
    } catch {
      // On error, try to delete anyway
      await deleteWorkspace(presetId, false);
    }
  };

  const handleConfirmDelete = async () => {
    if (confirmClose) {
      await deleteWorkspace(confirmClose.id, true);
      setConfirmClose(null);
    }
  };

  // Always show at least the workspace tabs area
  return (
    <>
      <div className="hidden md:flex items-center gap-0.5">
        {workspaces.map((ws) => (
          <div key={ws.id} className="relative">
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
                className={`text-xs px-2.5 py-1 rounded-t-md transition-colors relative ${
                  ws.id === activeWorkspaceId
                    ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-b-2 border-blue-500'
                    : 'text-surface-500 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800 hover:text-surface-700 dark:hover:text-surface-300'
                }`}
                title={`Switch to workspace: ${ws.name}`}
              >
                {ws.name}
              </button>
            )}
          </div>
        ))}

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
            className="text-xs px-1.5 py-1 rounded-md text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
            title="Create new workspace tab"
          >
            +
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
