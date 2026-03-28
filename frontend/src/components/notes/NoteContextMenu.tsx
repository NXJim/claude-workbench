/**
 * Context menu for global sidebar notes.
 * Rendered via createPortal to escape overflow-hidden containers.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useProjectStore } from '@/stores/projectStore';
import { useConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useNoteStore } from '@/stores/noteStore';

interface NoteContextMenuProps {
  noteId: string;
  noteTitle: string;
  isPinned: boolean;
  position: { x: number; y: number };
  onClose: () => void;
  /** Triggers inline rename flow in the parent. */
  onRename: () => void;
}

export function NoteContextMenu({
  noteId,
  noteTitle,
  isPinned,
  position,
  onClose,
  onRename,
}: NoteContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [moveSubmenuOpen, setMoveSubmenuOpen] = useState(false);
  const moveItemRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const projects = useProjectStore((s) => s.projects);
  const categories = useProjectStore((s) => s.categories);
  const confirmDialog = useConfirmDialog();
  const deleteNote = useNoteStore((s) => s.deleteNote);
  const updateNoteMetadata = useNoteStore((s) => s.updateNoteMetadata);
  const moveNoteToProject = useNoteStore((s) => s.moveNoteToProject);
  const fetchProjects = useProjectStore((s) => s.fetchProjects);

  // Clamp position so menu stays on-screen
  const [adjustedPos, setAdjustedPos] = useState(position);
  useEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const x = Math.min(position.x, window.innerWidth - rect.width - 8);
    const y = Math.min(position.y, window.innerHeight - rect.height - 8);
    setAdjustedPos({ x: Math.max(4, x), y: Math.max(4, y) });
  }, [position]);

  // Close on outside click or Escape
  const handleOutsideClick = useCallback(
    (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    },
    [onClose]
  );

  useEffect(() => {
    document.addEventListener('mousedown', handleOutsideClick);
    const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleEsc);
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, [handleOutsideClick, onClose]);

  // Delayed open/close so mouse can cross gap between trigger and submenu
  const openSubmenu = useCallback(() => {
    if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null; }
    setMoveSubmenuOpen(true);
  }, []);
  const scheduleCloseSubmenu = useCallback(() => {
    closeTimerRef.current = setTimeout(() => setMoveSubmenuOpen(false), 100);
  }, []);

  // Group projects by category for the submenu
  const projectsByCategory: Record<string, typeof projects> = {};
  for (const cat of categories) {
    const catProjects = projects.filter((p) => p.type === cat.name);
    if (catProjects.length > 0) projectsByCategory[cat.name] = catProjects;
  }

  // Compute submenu position via callback ref so it's set before first paint
  const [submenuPos, setSubmenuPos] = useState<{ left: number; top: number } | null>(null);
  const submenuCallbackRef = useCallback((node: HTMLDivElement | null) => {
    if (!node || !moveItemRef.current) return;
    const trigger = moveItemRef.current.getBoundingClientRect();
    const sub = node.getBoundingClientRect();
    const pad = 8;
    // Horizontal: prefer right of parent, flip left if no room
    let left = trigger.right + 2;
    if (left + sub.width > window.innerWidth - pad) {
      left = trigger.left - sub.width - 2;
    }
    // Vertical: align top with trigger, shift up if overflows bottom
    let top = trigger.top;
    if (top + sub.height > window.innerHeight - pad) {
      top = window.innerHeight - pad - sub.height;
    }
    top = Math.max(pad, top);
    setSubmenuPos({ left, top });
  }, []);

  // Reset position when submenu closes so next open recalculates
  useEffect(() => {
    if (!moveSubmenuOpen) setSubmenuPos(null);
  }, [moveSubmenuOpen]);

  const menuItemClass =
    'w-full text-left px-3 py-1.5 text-sm hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors text-surface-800 dark:text-surface-200';

  const handleDelete = async () => {
    onClose();
    const ok = await confirmDialog({
      title: 'Delete note?',
      itemName: noteTitle,
      confirmLabel: 'Delete',
      confirmVariant: 'danger',
    });
    if (ok) await deleteNote(noteId);
  };

  const handlePin = async () => {
    await updateNoteMetadata(noteId, { pinned: !isPinned });
    onClose();
  };

  const handleMove = async (projectPath: string) => {
    onClose();
    await moveNoteToProject(noteId, projectPath);
    // Refresh projects so the file shows up in the tree
    await fetchProjects();
  };

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[9999] min-w-[180px] bg-surface-50 dark:bg-surface-800 border border-surface-300 dark:border-surface-700 rounded-lg shadow-xl py-1"
      style={{ left: adjustedPos.x, top: adjustedPos.y }}
    >
      {/* Rename */}
      <button
        className={menuItemClass}
        onClick={() => { onRename(); onClose(); }}
      >
        Rename
      </button>

      {/* Pin/Unpin */}
      <button className={menuItemClass} onClick={handlePin}>
        {isPinned ? 'Unpin' : 'Pin'}
      </button>

      {/* Move to project submenu */}
      {Object.keys(projectsByCategory).length > 0 && (
        <div
          ref={moveItemRef}
          className="relative"
          onMouseEnter={openSubmenu}
          onMouseLeave={scheduleCloseSubmenu}
        >
          <button
            className={`${menuItemClass} flex items-center justify-between`}
            onClick={() => setMoveSubmenuOpen((v) => !v)}
          >
            <span>Move to project</span>
            <svg className="w-3.5 h-3.5 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>

          {moveSubmenuOpen && (
            <div
              ref={submenuCallbackRef}
              className="fixed z-[10000] min-w-[200px] max-h-[min(300px,calc(100vh-16px))] overflow-y-auto bg-surface-50 dark:bg-surface-800 border border-surface-300 dark:border-surface-700 rounded-lg shadow-xl py-1"
              style={submenuPos
                ? { left: submenuPos.left, top: submenuPos.top }
                : { visibility: 'hidden' as const }
              }
              onMouseEnter={openSubmenu}
              onMouseLeave={scheduleCloseSubmenu}
            >
              {Object.entries(projectsByCategory).map(([catName, catProjects]) => (
                <div key={catName}>
                  <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-surface-400 font-semibold">
                    {catName}
                  </div>
                  {catProjects.map((project) => (
                    <button
                      key={project.path}
                      className={menuItemClass}
                      onClick={() => handleMove(project.path)}
                    >
                      {project.display_name || project.name}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Separator + Delete */}
      <div className="border-t border-surface-300 dark:border-surface-700 my-1" />
      <button
        className={`${menuItemClass} text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/20`}
        onClick={handleDelete}
      >
        Delete
      </button>
    </div>,
    document.body
  );
}
