/**
 * Reusable floating window shell — drag, resize, overlay logic.
 *
 * Extracted from FloatingWindow.tsx so every window type (terminal,
 * notes, snippets, CLAUDE.md, dashboard) shares the same chrome.
 */

import { useRef, useCallback, useState, type ReactNode } from 'react';
import { useLayoutStore, type FloatingWindow } from '@/stores/layoutStore';

interface FloatingWindowShellProps {
  window: FloatingWindow;
  title: string;
  /** Optional icon rendered before the title. */
  icon?: ReactNode;
  /** Extra buttons rendered in the header bar. */
  headerActions?: ReactNode;
  /** Color accent for the left border (defaults to blue). */
  accentColor?: string;
  /** If provided, title becomes double-click-editable; called with new name on save. */
  onRenameTitle?: (newName: string) => void;
  onClose: () => void;
  children: ReactNode;
}

export function FloatingWindowShell({
  window: fw,
  title,
  icon,
  headerActions,
  accentColor = '#7aa2f7',
  onRenameTitle,
  onClose,
  children,
}: FloatingWindowShellProps) {
  const updateFloatingWindow = useLayoutStore((s) => s.updateFloatingWindow);
  const bringToFront = useLayoutStore((s) => s.bringToFront);
  const removeFloating = useLayoutStore((s) => s.removeFloating);

  // When true, an overlay blocks child iframes from stealing mouse events
  const [interacting, setInteracting] = useState(false);
  // Inline title editing state
  const [editingTitle, setEditingTitle] = useState(false);
  const [editName, setEditName] = useState('');
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; origW: number; origH: number } | null>(null);

  // Drag handler
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    bringToFront(fw.id);
    setInteracting(true);
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: fw.x, origY: fw.y };

    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      updateFloatingWindow(fw.id, {
        x: Math.max(0, dragRef.current.origX + dx),
        y: Math.max(0, dragRef.current.origY + dy),
      });
    };
    const onUp = () => {
      dragRef.current = null;
      setInteracting(false);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [fw, bringToFront, updateFloatingWindow]);

  // Resize handler (bottom-right corner)
  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    bringToFront(fw.id);
    setInteracting(true);
    resizeRef.current = { startX: e.clientX, startY: e.clientY, origW: fw.width, origH: fw.height };

    const onMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return;
      const dw = ev.clientX - resizeRef.current.startX;
      const dh = ev.clientY - resizeRef.current.startY;
      const minW = window.innerWidth < 640 ? 280 : 400;
      const minH = window.innerWidth < 640 ? 200 : 250;
      updateFloatingWindow(fw.id, {
        width: Math.max(minW, resizeRef.current.origW + dw),
        height: Math.max(minH, resizeRef.current.origH + dh),
      });
    };
    const onUp = () => {
      resizeRef.current = null;
      setInteracting(false);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [fw, bringToFront, updateFloatingWindow]);

  return (
    <div
      className="floating-window fixed rounded-lg overflow-hidden border border-surface-300 dark:border-surface-600 shadow-xl bg-surface-50 dark:bg-surface-900 flex flex-col"
      style={{
        left: fw.x,
        top: fw.y,
        width: fw.width,
        height: fw.height,
        zIndex: fw.zIndex,
      }}
    >
      {/* Draggable header */}
      <div
        onMouseDown={handleMouseDown}
        className="flex items-center gap-2 px-3 py-1.5 bg-surface-100 dark:bg-surface-800 border-b border-surface-200 dark:border-surface-700 select-none cursor-move"
        style={{ borderLeft: `3px solid ${accentColor}` }}
      >
        {icon && <span className="flex-shrink-0">{icon}</span>}
        {/* Editable title — double-click to rename (if onRenameTitle provided) */}
        {editingTitle && onRenameTitle ? (
          <input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={() => {
              if (editName.trim() && editName !== title) onRenameTitle(editName.trim());
              setEditingTitle(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (editName.trim() && editName !== title) onRenameTitle(editName.trim());
                setEditingTitle(false);
              }
              if (e.key === 'Escape') setEditingTitle(false);
            }}
            onMouseDown={(e) => e.stopPropagation()} // prevent drag
            className="text-sm font-medium bg-white dark:bg-surface-900 border border-surface-300 dark:border-surface-600 rounded px-1 py-0.5 flex-1 min-w-0"
            autoFocus
          />
        ) : (
          <span
            className={`text-sm font-medium truncate flex-1${onRenameTitle ? ' cursor-pointer hover:text-blue-600 dark:hover:text-blue-400' : ''}`}
            onDoubleClick={onRenameTitle ? () => { setEditName(title); setEditingTitle(true); } : undefined}
            title={onRenameTitle ? 'Double-click to rename' : undefined}
          >
            {title}
          </span>
        )}

        {headerActions}

        {/* Minimize */}
        <button
          onClick={() => removeFloating(fw.id)}
          className="p-1 rounded hover:bg-surface-200 dark:hover:bg-surface-700 text-surface-500"
          title="Minimize"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M18 12H6" />
          </svg>
        </button>

        {/* Close */}
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-surface-500 hover:text-red-600"
          title="Close"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Content area */}
      <div className="flex-1 min-h-0 relative">
        {children}
        {/* Transparent overlay during drag/resize — blocks iframes from stealing mouse events */}
        {interacting && <div className="absolute inset-0" />}
      </div>

      {/* Resize handle */}
      <div
        className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
        onMouseDown={handleResizeMouseDown}
      >
        <svg className="w-4 h-4 text-surface-400" viewBox="0 0 16 16" fill="currentColor">
          <path d="M14 14H10V12H12V10H14V14ZM14 8H12V6H14V8ZM8 14H6V12H8V14Z" />
        </svg>
      </div>
    </div>
  );
}
