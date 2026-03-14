/**
 * Draggable resize divider between sidebar sections.
 * 4px visible, 12px hit area, cursor-row-resize.
 */

import { useCallback, useRef } from 'react';

interface ResizeDividerProps {
  /** Called with vertical pixel delta while dragging. */
  onDrag: (deltaY: number) => void;
}

export function ResizeDivider({ onDrag }: ResizeDividerProps) {
  const startYRef = useRef(0);
  // Keep a ref to the latest onDrag so mouse listeners don't use a stale closure
  const onDragRef = useRef(onDrag);
  onDragRef.current = onDrag;

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    startYRef.current = e.clientY;

    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientY - startYRef.current;
      startYRef.current = ev.clientY;
      onDragRef.current(delta);
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  return (
    <div
      className="relative flex-shrink-0 cursor-row-resize group"
      style={{ height: 4 }}
      onMouseDown={handleMouseDown}
    >
      {/* Wider invisible hit area */}
      <div className="absolute -top-1 -bottom-1 left-0 right-0" />
      {/* Visible line */}
      <div className="absolute inset-x-2 top-1/2 -translate-y-1/2 h-px bg-surface-200 dark:bg-surface-700 group-hover:bg-blue-500/30 transition-colors" />
    </div>
  );
}
