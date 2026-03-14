/**
 * Hook to detect mobile viewport (< 768px).
 * Uses useSyncExternalStore for concurrent-safe subscription to matchMedia.
 */

import { useSyncExternalStore } from 'react';

const MOBILE_QUERY = '(max-width: 767px)';

// Singleton matchMedia instance — shared across all hook consumers
let mediaQuery: MediaQueryList | null = null;

function getMediaQuery(): MediaQueryList {
  if (!mediaQuery) {
    mediaQuery = window.matchMedia(MOBILE_QUERY);
  }
  return mediaQuery;
}

function subscribe(callback: () => void): () => void {
  const mq = getMediaQuery();
  mq.addEventListener('change', callback);
  return () => mq.removeEventListener('change', callback);
}

function getSnapshot(): boolean {
  return getMediaQuery().matches;
}

function getServerSnapshot(): boolean {
  return false;
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
