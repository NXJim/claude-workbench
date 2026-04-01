/**
 * Auto-focus the topmost terminal iframe when the browser window gains focus.
 *
 * When the user switches from another application to the browser, this hook
 * focuses the highest z-index floating terminal iframe (or the first tiled
 * terminal if no floating windows exist). This saves the extra click to
 * activate the terminal before typing.
 *
 * Only fires when no specific element was clicked — if the user clicks a
 * sidebar button or other UI element, their click target keeps focus.
 */

import { useEffect } from 'react';
import { useLayoutStore } from '@/stores/layoutStore';

export function useTerminalAutoFocus() {
  useEffect(() => {
    const handleWindowFocus = () => {
      // Short delay: let any click events settle first. If the user clicked
      // a specific UI element to activate the window, activeElement will be
      // that element and we should not steal focus.
      setTimeout(() => {
        const active = document.activeElement;
        // Only auto-focus if nothing specific has focus (body = no click target)
        if (active && active !== document.body && active.tagName !== 'HTML') return;

        // Find the topmost floating terminal iframe (highest z-index)
        const floatingWindows = useLayoutStore.getState().floatingWindows;
        const sortedByZ = [...floatingWindows]
          .filter((fw) => fw.descriptor.type === 'terminal')
          .sort((a, b) => b.zIndex - a.zIndex);

        if (sortedByZ.length > 0) {
          const topWindow = sortedByZ[0];
          const container = document.querySelector(`[data-floating-window-id="${topWindow.id}"]`);
          const iframe = container?.querySelector<HTMLIFrameElement>('[data-terminal-iframe]');
          if (iframe) {
            iframe.focus();
            return;
          }
        }

        // No floating terminals — focus the first tiled terminal iframe
        const tiledIframe = document.querySelector<HTMLIFrameElement>('[data-terminal-iframe]');
        if (tiledIframe) {
          tiledIframe.focus();
        }
      }, 50);
    };

    window.addEventListener('focus', handleWindowFocus);
    return () => window.removeEventListener('focus', handleWindowFocus);
  }, []);
}
