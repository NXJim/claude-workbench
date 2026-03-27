/**
 * Reusable floating window shell — drag, resize, overlay logic.
 *
 * Extracted from FloatingWindow.tsx so every window type (terminal,
 * notes, snippets, CLAUDE.md, dashboard) shares the same chrome.
 */

import { useRef, useCallback, useState, type ReactNode } from 'react';
import { useLayoutStore, type FloatingWindow } from '@/stores/layoutStore';
import { useIsMobile } from '@/hooks/useIsMobile';

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
  /** Right-click handler for the title bar (e.g., context menu). */
  onTitleBarContextMenu?: (e: React.MouseEvent) => void;
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
  onTitleBarContextMenu,
  onClose,
  children,
}: FloatingWindowShellProps) {
  const updateFloatingWindow = useLayoutStore((s) => s.updateFloatingWindow);
  const bringToFront = useLayoutStore((s) => s.bringToFront);
  const removeFloating = useLayoutStore((s) => s.removeFloating);
  const setDockTarget = useLayoutStore((s) => s.setDockTarget);
  const clearDrag = useLayoutStore((s) => s.clearDrag);
  const dockBack = useLayoutStore((s) => s.dockBack);
  const dockToTile = useLayoutStore((s) => s.dockToTile);
  const toggleMaximizeFloating = useLayoutStore((s) => s.toggleMaximizeFloating);
  const isMobile = useIsMobile();

  // When true, an overlay blocks child iframes from stealing mouse events
  const [interacting, setInteracting] = useState(false);
  // Inline title editing state
  const [editingTitle, setEditingTitle] = useState(false);
  const [editName, setEditName] = useState('');
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; origW: number; origH: number } | null>(null);
  // Track last mousedown time for double-click detection (can't use onDoubleClick
  // because setInteracting(true) disables pointer-events, blocking the 2nd click)
  const lastClickRef = useRef<{ time: number; x: number; y: number }>({ time: 0, x: 0, y: 0 });

  // Drag handler
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, input')) return;

    // Double-click detection: if two mousedowns within 400ms and 5px
    const now = Date.now();
    const last = lastClickRef.current;
    const dx = Math.abs(e.clientX - last.x);
    const dy = Math.abs(e.clientY - last.y);
    if (now - last.time < 400 && dx < 5 && dy < 5) {
      // Reset to prevent triple-click triggering again
      lastClickRef.current = { time: 0, x: 0, y: 0 };
      e.preventDefault();
      toggleMaximizeFloating(fw.id);
      return;
    }
    lastClickRef.current = { time: now, x: e.clientX, y: e.clientY };

    // Don't allow dragging maximized windows
    if (fw.isMaximized) return;
    e.preventDefault();
    bringToFront(fw.id);
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: fw.x, origY: fw.y };
    let dragActivated = false;

    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      // Activate pointer-events overlay only once dragging actually starts
      // (deferred so double-click's 2nd mousedown isn't blocked)
      if (!dragActivated) {
        dragActivated = true;
        setInteracting(true);
        document.body.classList.add('window-dragging');
      }
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      updateFloatingWindow(fw.id, {
        x: Math.max(0, dragRef.current.origX + dx),
        y: Math.max(0, dragRef.current.origY + dy),
      });

      // Hit-test for dock zones
      const mainRect = document.querySelector('[data-workspace-main]')?.getBoundingClientRect();
      if (mainRect && ev.clientY - mainRect.top < 10) {
        // Top-edge → maximize (dock as full workspace)
        setDockTarget({ type: 'maximize' });
      } else {
        // Check if hovering over a tile
        const el = document.elementFromPoint(ev.clientX, ev.clientY);
        const tileEl = el?.closest('[data-tile-window-id]');
        if (tileEl) {
          const tileWindowId = tileEl.getAttribute('data-tile-window-id');
          if (tileWindowId && tileWindowId !== fw.id) {
            // If the tile covers nearly the entire workspace (maximized),
            // require Shift to be held to allow swap — prevents accidental
            // swaps when just repositioning a floating window.
            const tileRect = tileEl.getBoundingClientRect();
            const isMaximized = mainRect &&
              tileRect.width >= mainRect.width * 0.95 &&
              tileRect.height >= mainRect.height * 0.95;
            if (isMaximized && !ev.shiftKey) {
              setDockTarget(null);
            } else {
              setDockTarget({ type: 'tile', tileWindowId });
            }
          } else {
            setDockTarget(null);
          }
        } else {
          setDockTarget(null);
        }
      }
    };
    const onUp = () => {
      // Read dock target and execute dock action before cleanup
      const target = useLayoutStore.getState().dockTarget;
      if (target) {
        if (target.type === 'maximize') {
          dockBack(fw.id);
        } else if (target.type === 'tile') {
          dockToTile(fw.id, target.tileWindowId);
        }
      }
      dragRef.current = null;
      if (dragActivated) {
        setInteracting(false);
        document.body.classList.remove('window-dragging');
      }
      clearDrag();
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [fw, bringToFront, updateFloatingWindow, setDockTarget, clearDrag, dockBack, dockToTile, toggleMaximizeFloating]);

  // Resize handler (bottom-right corner)
  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    bringToFront(fw.id);
    setInteracting(true);
    resizeRef.current = { startX: e.clientX, startY: e.clientY, origW: fw.width, origH: fw.height };
    document.body.classList.add('window-dragging');

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
      document.body.classList.remove('window-dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [fw, bringToFront, updateFloatingWindow]);

  // Mobile: full-screen sheet (no drag, no resize)
  if (isMobile) {
    return (
      <div
        className="fixed inset-x-0 bottom-0 top-12 z-50 flex flex-col bg-white dark:bg-surface-900"
      >
        {/* Header — no drag, just title and close */}
        <div
          className="flex items-center gap-2 px-3 py-2 bg-surface-100 dark:bg-surface-800 border-b border-surface-200 dark:border-surface-700 select-none flex-shrink-0"
          style={{ borderLeft: `3px solid ${accentColor}` }}
        >
          {icon && <span className="flex-shrink-0">{icon}</span>}
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
              className="text-sm font-medium bg-white dark:bg-surface-900 border border-surface-300 dark:border-surface-600 rounded px-1 py-0.5 flex-1 min-w-0"
              autoFocus
            />
          ) : (
            <span
              className={`text-sm font-medium truncate flex-1${onRenameTitle ? ' cursor-pointer' : ''}`}
              onDoubleClick={onRenameTitle ? () => { setEditName(title); setEditingTitle(true); } : undefined}
            >
              {title}
            </span>
          )}

          {headerActions}

          {/* Minimize — hides window without killing the session */}
          <button
            onClick={() => removeFloating(fw.id)}
            className="p-2 rounded-lg hover:bg-surface-200 dark:hover:bg-surface-700 text-surface-500"
            title="Minimize (back to sidebar)"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {/* Close — terminates the session */}
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 text-surface-500 hover:text-red-600"
            title="Close session"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content — fills remaining space */}
        <div className="flex-1 min-h-0 safe-area-bottom">
          {children}
        </div>
      </div>
    );
  }

  // Desktop: normal floating window with drag and resize
  return (
    <div
      data-floating-window-id={fw.id}
      className="floating-window fixed rounded-lg overflow-hidden border border-surface-300 dark:border-surface-600 shadow-xl bg-white dark:bg-surface-900 flex flex-col"
      style={{
        left: fw.x,
        top: fw.y,
        width: fw.width,
        height: fw.height,
        zIndex: fw.zIndex,
        pointerEvents: interacting ? 'none' : undefined,
      }}
    >
      {/* Draggable header — double-click to maximize/restore */}
      <div
        onMouseDown={handleMouseDown}
        onContextMenu={onTitleBarContextMenu}
        className={`flex items-center gap-2 px-3 py-1.5 bg-surface-100 dark:bg-surface-800 border-b border-surface-200 dark:border-surface-700 select-none ${fw.isMaximized ? 'cursor-default' : 'cursor-move'}`}
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

      {/* Content area — mousedown brings to front for non-iframe children */}
      <div className="flex-1 min-h-0 relative" onMouseDown={() => bringToFront(fw.id)}>
        {children}
        {/* Transparent overlay during drag/resize — blocks iframes from stealing mouse events */}
        {interacting && <div className="absolute inset-0" />}
      </div>

      {/* Resize handle — hidden when maximized */}
      {!fw.isMaximized && (
        <div
          className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
          onMouseDown={handleResizeMouseDown}
        >
          <svg className="w-4 h-4 text-surface-400" viewBox="0 0 16 16" fill="currentColor">
            <path d="M14 14H10V12H12V10H14V14ZM14 8H12V6H14V8ZM8 14H6V12H8V14Z" />
          </svg>
        </div>
      )}
    </div>
  );
}
