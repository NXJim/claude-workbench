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
    };
  }, [handleOutsideClick, onClose]);

  // Group projects by category for the submenu
  const projectsByCategory: Record<string, typeof projects> = {};
  for (const cat of categories) {
    const catProjects = projects.filter((p) => p.type === cat.name);
    if (catProjects.length > 0) projectsByCategory[cat.name] = catProjects;
  }

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
          className="relative"
          onMouseEnter={() => setMoveSubmenuOpen(true)}
          onMouseLeave={() => setMoveSubmenuOpen(false)}
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
            <div className="absolute left-full top-0 ml-0.5 min-w-[200px] max-h-[300px] overflow-y-auto bg-surface-50 dark:bg-surface-800 border border-surface-300 dark:border-surface-700 rounded-lg shadow-xl py-1">
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
