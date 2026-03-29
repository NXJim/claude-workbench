/**
 * SSE hook for real-time notifications from the backend.
 *
 * Replaces the old WebSocket notification prefix (\x01N) approach.
 * Subscribes to /api/notifications/stream and dispatches activity
 * state changes to the notification store.
 *
 * Delays connection briefly to avoid racing with page load, and
 * only reconnects manually to suppress noisy browser console errors.
 */

import { useEffect, useRef } from 'react';
import { useSessionStore } from '@/stores/sessionStore';
import { useLayoutStore } from '@/stores/layoutStore';
import { useNotificationStore } from '@/stores/notificationStore';
import { useNoteStore } from '@/stores/noteStore';

const INITIAL_DELAY = 2000;    // wait for backend to be reachable
const RECONNECT_DELAY = 5000;  // retry interval on failure

export function useNotifications() {
  const { addToast } = useNotificationStore();
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (cancelled) return;

      const es = new EventSource('/api/notifications/stream');
      esRef.current = es;

      es.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          if (msg.type === 'activity' && msg.state === 'idle') {
            const session = useSessionStore.getState().sessions.find(s => s.id === msg.session_id);
            addToast({
              message: `${session?.display_name || 'Session'} is idle — Claude may be done`,
              type: 'info',
              sessionId: msg.session_id,
              sessionColor: session?.color,
            });
          }

          if (msg.type === 'session_dead') {
            // tmux session died — close the window and refresh sessions
            useLayoutStore.getState().removeFloating(msg.session_id);
            useLayoutStore.getState().removeFromTiling(msg.session_id);
            const wsId = useLayoutStore.getState().activeWorkspaceId;
            useSessionStore.getState().fetchSessions(wsId ?? undefined);
          }

          // Note sync events — keep notes in sync across tabs/devices
          if (msg.type === 'note_updated') {
            useNoteStore.getState().refreshNoteContent(msg.note_id);
          }
          if (msg.type === 'note_created' || msg.type === 'note_metadata') {
            useNoteStore.getState().fetchNotes();
          }
          if (msg.type === 'note_deleted') {
            useNoteStore.getState().handleRemoteDelete(msg.note_id);
          }
        } catch {
          // Ignore parse errors
        }
      };

      es.onerror = () => {
        // Close immediately so the browser doesn't spam reconnect errors
        es.close();
        esRef.current = null;
        if (!cancelled) {
          reconnectTimer = setTimeout(connect, RECONNECT_DELAY);
        }
      };
    }

    // Delay initial connection to avoid racing with page load
    const startTimer = setTimeout(connect, INITIAL_DELAY);

    return () => {
      cancelled = true;
      clearTimeout(startTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      esRef.current?.close();
      esRef.current = null;
    };
  }, [addToast]);
}
