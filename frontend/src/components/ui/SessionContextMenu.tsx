/**
 * Shared context menu for terminal sessions.
 * Used by both floating window title bars and sidebar session items.
 * Rendered via createPortal to escape overflow-hidden containers.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useLayoutStore } from '@/stores/layoutStore';
import { SESSION_COLORS } from '@/stores/sessionStore';

interface SessionContextMenuProps {
  sessionId: string;
  position: { x: number; y: number };
  onClose: () => void;
  /** Called when user picks "Rename" — triggers inline rename flow in the parent. */
  onRename?: () => void;
  /** Called when user picks "Delete" — triggers delete flow in the parent. */
  onDelete?: () => void;
  /** Called when user picks a workspace to move to. */
  onMove?: (targetWorkspaceId: number) => void;
  /** Called when user picks a new color. */
  onColorChange?: (color: string) => void;
  /** Current session color — used to highlight the active swatch. */
  currentColor?: string;
  showRename?: boolean;
  showDelete?: boolean;
}

export function SessionContextMenu({
  position,
  onClose,
  onRename,
  onDelete,
  onMove,
  onColorChange,
  currentColor,
  showRename = false,
  showDelete = false,
}: SessionContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [submenuOpen, setSubmenuOpen] = useState(false);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const activeWorkspaceId = useLayoutStore((s) => s.activeWorkspaceId);
  const presets = useLayoutStore((s) => s.presets);

  // Other workspaces (exclude current)
  const otherWorkspaces = presets.filter(
    (p) => p.is_workspace && p.id !== activeWorkspaceId
  );
  const hasMultipleWorkspaces = otherWorkspaces.length > 0;

  // Clamp position so menu doesn't go off-screen
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
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    document.addEventListener('mousedown', handleOutsideClick);
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [handleOutsideClick, onClose]);

  const menuItemClass =
    'w-full text-left px-3 py-1.5 text-sm hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors text-surface-800 dark:text-surface-200';

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[9999] min-w-[180px] bg-surface-50 dark:bg-surface-800 border border-surface-300 dark:border-surface-700 rounded-lg shadow-xl py-1"
      style={{ left: adjustedPos.x, top: adjustedPos.y }}
    >
      {/* Rename option */}
      {showRename && onRename && (
        <button
          className={menuItemClass}
          onClick={() => {
            onRename();
            onClose();
          }}
        >
          Rename
        </button>
      )}

      {/* Move to workspace submenu */}
      {hasMultipleWorkspaces && onMove && (
        <div
          className="relative"
          onMouseEnter={() => setSubmenuOpen(true)}
          onMouseLeave={() => setSubmenuOpen(false)}
        >
          <button
            className={`${menuItemClass} flex items-center justify-between`}
            onClick={() => setSubmenuOpen((v) => !v)}
          >
            <span>Move to</span>
            <svg
              className="w-3.5 h-3.5 text-surface-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 5l7 7-7 7"
              />
            </svg>
          </button>

          {submenuOpen && (
            <div className="absolute left-full top-0 ml-0.5 min-w-[160px] bg-surface-50 dark:bg-surface-800 border border-surface-300 dark:border-surface-700 rounded-lg shadow-xl py-1">
              {otherWorkspaces.map((ws) => (
                <button
                  key={ws.id}
                  className={menuItemClass}
                  onClick={() => {
                    onMove(ws.id);
                    onClose();
                  }}
                >
                  {ws.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Color picker */}
      {onColorChange && (
        <div
          className="relative"
          onMouseEnter={() => setColorPickerOpen(true)}
          onMouseLeave={() => setColorPickerOpen(false)}
        >
          <button
            className={`${menuItemClass} flex items-center justify-between`}
            onClick={() => setColorPickerOpen((v) => !v)}
          >
            <span className="flex items-center gap-2">
              <span
                className="w-3 h-3 rounded-full flex-shrink-0 border border-surface-300 dark:border-surface-600"
                style={{ backgroundColor: currentColor || SESSION_COLORS[0] }}
              />
              Color
            </span>
            <svg
              className="w-3.5 h-3.5 text-surface-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>

          {colorPickerOpen && (
            <div className="absolute left-full top-0 ml-0.5 w-[152px] bg-surface-50 dark:bg-surface-800 border border-surface-300 dark:border-surface-700 rounded-lg shadow-xl p-3">
              <div className="grid grid-cols-4 gap-3">
                {SESSION_COLORS.map((color) => (
                  <button
                    key={color}
                    className={`w-7 h-7 rounded-full border-2 transition-all hover:scale-110 ${
                      currentColor === color
                        ? 'border-surface-900 dark:border-white scale-110'
                        : 'border-transparent'
                    }`}
                    style={{ backgroundColor: color }}
                    title={color}
                    onClick={() => {
                      onColorChange(color);
                      onClose();
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Terminate option */}
      {showDelete && onDelete && (
        <>
          {(showRename || hasMultipleWorkspaces || onColorChange) && (
            <div className="border-t border-surface-300 dark:border-surface-700 my-1" />
          )}
          <button
            className={`${menuItemClass} text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/20`}
            onClick={() => {
              onDelete();
              onClose();
            }}
          >
            Terminate
          </button>
        </>
      )}
    </div>,
    document.body
  );
}
