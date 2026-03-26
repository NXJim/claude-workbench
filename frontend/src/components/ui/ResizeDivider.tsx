/**
 * Draggable resize divider between sidebar sections.
 * 4px visible, 20px hit area (touch-friendly), cursor-row-resize.
 * Supports both mouse and touch events.
 */

import { useCallback, useRef } from 'react';

interface ResizeDividerProps {
  /** Called with vertical pixel delta while dragging. */
  onDrag: (deltaY: number) => void;
}

export function ResizeDivider({ onDrag }: ResizeDividerProps) {
  const startYRef = useRef(0);
  // Keep a ref to the latest onDrag so listeners don't use a stale closure
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

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    startYRef.current = touch.clientY;

    const onMove = (ev: TouchEvent) => {
      // Prevent page scroll while dragging the divider
      ev.preventDefault();
      const delta = ev.touches[0].clientY - startYRef.current;
      startYRef.current = ev.touches[0].clientY;
      onDragRef.current(delta);
    };

    const onEnd = () => {
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
    };

    // passive: false required so preventDefault() works on touchmove
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
    document.addEventListener('touchcancel', onEnd);
  }, []);

  return (
    <div
      className="relative flex-shrink-0 cursor-row-resize group"
      style={{ height: 4 }}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
    >
      {/* Wider invisible hit area — 20px for touch targets */}
      <div className="absolute -top-2 -bottom-2 left-0 right-0" />
      {/* Visible line */}
      <div className="absolute inset-x-2 top-1/2 -translate-y-1/2 h-px bg-surface-200 dark:bg-surface-700 group-hover:bg-blue-500/30 transition-colors" />
    </div>
  );
}
