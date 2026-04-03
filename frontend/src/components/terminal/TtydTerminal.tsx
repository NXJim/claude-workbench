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

// Module-level cache — survives unmount/remount across workspace switches.
// Keyed by sessionId → ttyd iframe URL. Avoids re-fetching + 500ms delay
// when the ttyd process is already running.
const urlCache = new Map<string, string>();

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

    // Fetch ttyd URL on mount — uses cache for instant remount after workspace switch
    useEffect(() => {
      let cancelled = false;

      // Fast path: ttyd already running, URL known from a previous mount
      const cached = urlCache.get(sessionId);
      if (cached) {
        setUrl(cached);
        useSessionStore.getState().setSessionStatus(sessionId, 'connected');
        return;
      }

      // Slow path: first mount — fetch URL and wait for ttyd to bind its port
      async function fetchUrl() {
        try {
          const data = await api.getTerminalUrl(sessionId);
          if (cancelled) return;

          await new Promise((r) => setTimeout(r, 500));
          if (cancelled) return;

          const ttydUrl = `/ttyd/${data.port}/`;
          urlCache.set(sessionId, ttydUrl);
          setUrl(ttydUrl);
          useSessionStore.getState().setSessionStatus(sessionId, 'connected');
        } catch (e) {
          if (!cancelled) {
            urlCache.delete(sessionId);
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

              // Write coalescing — batch rapid term.write() calls into one per
              // animation frame. Without this, streaming output (Claude responses,
              // large commands) arrives as many small WebSocket frames, each
              // triggering a separate xterm.js parse+render cycle. Rapid cursor
              // positioning sequences split across renders cause garbled/torn text.
              // requestAnimationFrame naturally syncs with the display refresh rate.
              (function() {
                var origWrite = window.term.write.bind(window.term);
                var buffer = [];
                var rafId = null;
                function flush() {
                  rafId = null;
                  if (buffer.length === 0) return;
                  // Concatenate all buffered chunks into one write
                  if (buffer.length === 1) {
                    origWrite(buffer[0]);
                  } else {
                    // For binary (Uint8Array) data, merge into single array
                    if (buffer[0] instanceof Uint8Array) {
                      var total = 0;
                      for (var i = 0; i < buffer.length; i++) total += buffer[i].length;
                      var merged = new Uint8Array(total);
                      var offset = 0;
                      for (var i = 0; i < buffer.length; i++) {
                        merged.set(buffer[i], offset);
                        offset += buffer[i].length;
                      }
                      origWrite(merged);
                    } else {
                      origWrite(buffer.join(''));
                    }
                  }
                  buffer = [];
                }
                window.term.write = function(data) {
                  buffer.push(data);
                  if (rafId === null) {
                    rafId = requestAnimationFrame(flush);
                  }
                };
                // Expose original write for cases that need immediate output
                window.term._writeImmediate = origWrite;
                console.log('[ttyd inject] Write coalescing enabled (rAF batching)');
              })();

              window.term.attachCustomKeyEventHandler(function(e) {
                // Shift+Enter or Ctrl+Enter: send LF for newline without executing
                if (e.key === 'Enter' && (e.shiftKey || e.ctrlKey)) {
                  if (e.type === 'keydown') {
                    try {
                      // xterm.js 5.x public API, falls back to 4.x private API
                      if (window.term.input) {
                        window.term.input('\\n');
                      } else {
                        window.term._core.coreService.triggerDataEvent('\\n');
                      }
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
              // Suppress Android IME autocorrect/prediction on xterm's hidden textarea.
              // Without this, Gboard and similar keyboards buffer and garble input
              // because they expect a standard editable text field with cursor tracking,
              // but xterm.js uses a raw input stream.
              var ta = document.querySelector('.xterm-helper-textarea');
              if (ta) {
                ta.setAttribute('autocorrect', 'off');
                ta.setAttribute('autocomplete', 'off');
                ta.setAttribute('autocapitalize', 'none');
                ta.setAttribute('spellcheck', 'false');
                // data-gramm attributes suppress Grammarly and similar extensions
                ta.setAttribute('data-gramm', 'false');
                ta.setAttribute('data-gramm_editor', 'false');
                ta.setAttribute('data-enable-grammarly', 'false');
              }
              console.log('[ttyd inject] Shift/Ctrl+Enter, Ctrl+C/V, IME suppression attached');

              // Force xterm.js to fully redraw all rows after tmux scrollback replay.
              // On workspace switch, the iframe is recreated and tmux replays content
              // into a fresh xterm.js instance. Rendering artifacts (overlapping text)
              // can accumulate during this replay. refresh(0, rows-1) forces a clean
              // re-render of every row, clearing any overlap.
              setTimeout(function() { window.term.refresh(0, window.term.rows - 1); }, 500);
              setTimeout(function() { window.term.refresh(0, window.term.rows - 1); }, 2000);

              // Restore scrollback history from tmux after reconnection.
              // When the iframe is recreated (workspace switch), xterm.js's in-memory
              // scrollback buffer is lost. tmux still has the full history — fetch it
              // and write it into xterm.js so the user can scroll up to see past output.
              // The fetch runs async; by the time it resolves, the live screen content
              // is already rendered, so the history appears above it in the buffer.
              fetch('/api/sessions/${sessionId}/scrollback')
                .then(function(res) { return res.ok ? res.text() : ''; })
                .then(function(history) {
                  if (!history || !history.trim()) return;
                  // Write history into xterm.js buffer. Each line becomes a row in scrollback.
                  // Use \\r\\n line endings so xterm.js positions each line correctly.
                  var lines = history.split('\\n');
                  // Remove trailing empty line from tmux capture-pane output
                  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
                  if (lines.length === 0) return;
                  // Write history directly (bypass coalescing to avoid mixing with live output)
                  (window.term._writeImmediate || window.term.write).call(window.term, lines.join('\\r\\n') + '\\r\\n');
                  setTimeout(function() { window.term.refresh(0, window.term.rows - 1); }, 100);
                  console.log('[ttyd inject] Restored ' + lines.length + ' lines of scrollback history');
                })
                .catch(function(err) {
                  console.warn('[ttyd inject] Failed to restore scrollback:', err);
                });
            })();
          `;
          doc.body.appendChild(script);

        }
      } catch (e) {
        console.warn('[TtydTerminal] iframe injection failed — likely cross-origin. CSS will not work.', e);
      }
    }, [sessionId]);

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
        data-terminal-iframe={sessionId}
        className="w-full h-full border-0"
        style={{ background: '#0C0C0C' }}
        title={`Terminal ${sessionId}`}
        onLoad={handleIframeLoad}
      />
    );
  }
));
