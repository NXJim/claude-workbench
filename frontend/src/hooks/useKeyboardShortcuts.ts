/**
 * Global keyboard shortcuts handler.
 */

import { useEffect } from 'react';
import { useCommandPaletteStore } from '@/stores/commandPaletteStore';
import { useLayoutStore } from '@/stores/layoutStore';

export function useKeyboardShortcuts() {
  const togglePalette = useCommandPaletteStore((s) => s.toggle);
  const toggleSidebar = useLayoutStore((s) => s.toggleSidebar);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ctrl+K — Command palette
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        togglePalette();
        return;
      }

      // Ctrl+B — Toggle sidebar
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        toggleSidebar();
        return;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePalette, toggleSidebar]);
}
