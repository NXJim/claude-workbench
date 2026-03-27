/**
 * Visual overlay showing dock zone highlights during floating window drag.
 *
 * Renders:
 * - A top-edge bar when dragging near the top (maximize/dock)
 * - A tile highlight when hovering over a specific tiled pane
 */

import { useState, useEffect, useCallback } from 'react';
import { useLayoutStore } from '@/stores/layoutStore';

export function DockZoneOverlay() {
  const dockTarget = useLayoutStore((s) => s.dockTarget);
  const [tileRect, setTileRect] = useState<DOMRect | null>(null);

  // When dock target is a tile, find the element and read its bounds
  const updateTileRect = useCallback(() => {
    if (dockTarget?.type === 'tile') {
      const el = document.querySelector(`[data-tile-window-id="${dockTarget.tileWindowId}"]`);
      if (el) {
        setTileRect(el.getBoundingClientRect());
        return;
      }
    }
    setTileRect(null);
  }, [dockTarget]);

  useEffect(() => {
    updateTileRect();
  }, [updateTileRect]);

  if (!dockTarget) return null;

  // Top-edge maximize zone
  if (dockTarget.type === 'maximize') {
    return (
      <div
        className="fixed left-0 right-0 h-2.5 bg-blue-500/30 border-b-2 border-blue-400 transition-opacity duration-150 pointer-events-none"
        style={{
          top: document.querySelector('[data-workspace-main]')?.getBoundingClientRect().top ?? 0,
          zIndex: 250,
        }}
      />
    );
  }

  // Tile highlight zone
  if (dockTarget.type === 'tile' && tileRect) {
    return (
      <div
        className="fixed bg-blue-500/15 border-2 border-dashed border-blue-400 rounded transition-opacity duration-150 pointer-events-none"
        style={{
          left: tileRect.left,
          top: tileRect.top,
          width: tileRect.width,
          height: tileRect.height,
          zIndex: 250,
        }}
      >
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-sm font-medium text-blue-600 dark:text-blue-300 bg-blue-100/80 dark:bg-blue-900/60 px-3 py-1 rounded-full">
            Drop to swap
          </span>
        </div>
      </div>
    );
  }

  return null;
}
