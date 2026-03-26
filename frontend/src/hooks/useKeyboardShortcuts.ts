/**
 * Global keyboard shortcuts handler.
 */

import { useEffect } from 'react';
import { useCommandPaletteStore } from '@/stores/commandPaletteStore';
import { useLayoutStore } from '@/stores/layoutStore';

export function useKeyboardShortcuts() {
  const togglePalette = useCommandPaletteStore((s) => s.toggle);
  const toggleSidebarPin = useLayoutStore((s) => s.toggleSidebarPin);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ctrl+K — Command palette
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        togglePalette();
        return;
      }

      // Ctrl+B — Pin/unpin sidebar
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        toggleSidebarPin();
        return;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePalette, toggleSidebarPin]);
}
