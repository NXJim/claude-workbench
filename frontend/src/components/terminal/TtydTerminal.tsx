/**
 * Terminal component using ttyd via iframe.
 *
 * Replaces WebTerminal.tsx (custom xterm.js integration). ttyd handles
 * xterm.js rendering, mouse selection, copy/paste, and resize correctly
 * out of the box. We just embed it in an iframe.
 *
 * IMPORTANT: This component is wrapped in React.memo to prevent parent
 * re-renders from touching the iframe DOM, which clears text selection
 * in the terminal.
 */

import { useState, useEffect, useImperativeHandle, forwardRef, useCallback, useRef, memo } from 'react';
import { api } from '@/api/client';
import { useSessionStore } from '@/stores/sessionStore';

export interface TtydTerminalHandle {
  /** Send data to the terminal via tmux send-keys */
  sendData: (data: string) => void;
}

interface TtydTerminalProps {
  sessionId: string;
}

export const TtydTerminal = memo(forwardRef<TtydTerminalHandle, TtydTerminalProps>(
  function TtydTerminal({ sessionId }, ref) {
    const [url, setUrl] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const iframeRef = useRef<HTMLIFrameElement>(null);
    // Use getState() instead of subscribing — avoids re-renders from session store updates
    const setSessionStatus = useSessionStore.getState().setSessionStatus;

    // Fetch ttyd URL on mount
    useEffect(() => {
      let cancelled = false;

      async function fetchUrl() {
        try {
          const data = await api.getTerminalUrl(sessionId);
          if (cancelled) return;

          // Wait briefly for ttyd to bind its port before loading the iframe
          await new Promise((r) => setTimeout(r, 500));
          if (cancelled) return;

          const ttydUrl = `/ttyd/${data.port}/`;
          setUrl(ttydUrl);
          useSessionStore.getState().setSessionStatus(sessionId, 'connected');
        } catch (e) {
          if (!cancelled) {
            setError(e instanceof Error ? e.message : 'Failed to start terminal');
            useSessionStore.getState().setSessionStatus(sessionId, 'disconnected');
          }
        }
      }

      fetchUrl();
      return () => { cancelled = true; };
    }, [sessionId]);

    // Hide ttyd's size overlay after iframe loads
    const handleIframeLoad = useCallback(() => {
      try {
        const doc = iframeRef.current?.contentDocument;
        if (doc) {
          // CSS: hide the resize overlay
          const style = doc.createElement('style');
          style.textContent = '.xterm-overlay { display: none !important; }';
          doc.head.appendChild(style);

          // Intercept Ctrl+V and Ctrl+C in xterm.js:
          // - Ctrl+V: suppress 0x16 control char, let native paste event fire
          // - Ctrl+C with selection: copy selected text, suppress SIGINT (0x03)
          // - Ctrl+C without selection: send SIGINT as normal
          const script = doc.createElement('script');
          script.textContent = `
            (function waitForTerm() {
              if (!window.term) return setTimeout(waitForTerm, 100);
              window.term.attachCustomKeyEventHandler(function(e) {
                // Shift+Enter or Ctrl+Enter: send LF for newline without executing
                if (e.key === 'Enter' && (e.shiftKey || e.ctrlKey)) {
                  if (e.type === 'keydown') {
                    try {
                      window.term._core.coreService.triggerDataEvent('\\n');
                    } catch (_) {
                      window.term.paste('\\n');
                    }
                  }
                  e.preventDefault();
                  return false;
                }

                if (e.type !== 'keydown' || !e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return true;

                // Ctrl+V: suppress 0x16, let native paste event fire
                if (e.key === 'v') return false;

                // Ctrl+C with selection: copy text, suppress SIGINT
                if (e.key === 'c' && window.term.hasSelection()) {
                  var text = window.term.getSelection();
                  if (text) {
                    var ta = document.createElement('textarea');
                    ta.value = text;
                    ta.style.position = 'fixed';
                    ta.style.left = '-9999px';
                    document.body.appendChild(ta);
                    ta.select();
                    document.execCommand('copy');
                    document.body.removeChild(ta);
                  }
                  e.preventDefault();
                  return false;
                }

                return true;
              });
              console.log('[ttyd inject] Shift/Ctrl+Enter, Ctrl+C/V handlers attached');
            })();
          `;
          doc.body.appendChild(script);

        }
      } catch (e) {
        console.warn('[TtydTerminal] iframe injection failed — likely cross-origin. CSS will not work.', e);
      }
    }, []);

    // Send data via tmux send-keys (Quick Paste and programmatic input)
    const sendData = useCallback(async (data: string) => {
      try {
        await api.sendTerminalKeys(sessionId, data);
      } catch (e) {
        console.error('Failed to send keys:', e);
      }
    }, [sessionId]);

    useImperativeHandle(ref, () => ({ sendData }));

    if (error) {
      return (
        <div className="flex items-center justify-center h-full bg-surface-950 text-red-400 text-sm p-4">
          Terminal error: {error}
        </div>
      );
    }

    if (!url) {
      return (
        <div className="flex items-center justify-center h-full bg-surface-950 text-surface-400 text-sm">
          Starting terminal...
        </div>
      );
    }

    return (
      <iframe
        ref={iframeRef}
        src={url}
        className="w-full h-full border-0"
        style={{ background: '#0C0C0C' }}
        title={`Terminal ${sessionId}`}
        onLoad={handleIframeLoad}
      />
    );
  }
));
