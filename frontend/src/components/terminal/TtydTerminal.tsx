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

    // DIAG START — Relay diagnostic messages from iframe to backend
    useEffect(() => {
      const handler = (event: MessageEvent) => {
        if (event.data?.type !== 'terminal-diag') return;
        // POST batch to backend log endpoint — fire and forget
        fetch('/api/debug/terminal-log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: event.data.sessionId,
            entries: event.data.entries,
          }),
        }).catch(() => { /* ignore relay failures */ });
      };
      window.addEventListener('message', handler);
      return () => window.removeEventListener('message', handler);
    }, []);
    // DIAG END

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

              // DIAG START — Diagnostic logging for terminal garbling investigation
              // Captures write events, buffer snapshots, and detects scrollback corruption.
              // Remove this entire block when debugging is complete.
              (function() {
                var diagBuffer = [];
                var diagSessionId = '${sessionId}';
                // Truncate strings for logging to avoid huge payloads
                function truncate(s, max) { return s.length > max ? s.substring(0, max) + '...[' + s.length + ' total]' : s; }
                // Escape control chars for readable logs — shows cursor sequences clearly
                function escapeCtrl(s) {
                  return s.replace(/\\x1b/g, '<ESC>').replace(/\\r/g, '<CR>').replace(/\\n/g, '<LF>');
                }
                window._diagLog = function(type, data) {
                  diagBuffer.push({ ts: Date.now(), type: type, data: data });
                  if (diagBuffer.length >= 30) {
                    var batch = diagBuffer;
                    diagBuffer = [];
                    window.parent.postMessage({ type: 'terminal-diag', sessionId: diagSessionId, entries: batch }, '*');
                  }
                };
                // Flush diagnostic buffer on a timer (catch low-frequency events)
                setInterval(function() {
                  if (diagBuffer.length > 0) {
                    var batch = diagBuffer;
                    diagBuffer = [];
                    window.parent.postMessage({ type: 'terminal-diag', sessionId: diagSessionId, entries: batch }, '*');
                  }
                }, 3000);
                // Capture a snapshot of lines around the viewport edge for corruption detection
                window._diagSnapshot = function(label) {
                  try {
                    var buf = window.term.buffer.active;
                    var baseY = buf.baseY; // lines scrolled above viewport
                    var viewportY = buf.viewportY; // current scroll position
                    var rows = window.term.rows;
                    var snapshot = [];
                    // Capture 10 lines around the top edge of the visible viewport
                    var start = Math.max(0, baseY - 5);
                    var end = Math.min(buf.length, baseY + 5);
                    for (var i = start; i < end; i++) {
                      var line = buf.getLine(i);
                      if (line) snapshot.push({ row: i, text: line.translateToString(true) });
                    }
                    window._diagLog('buffer-snapshot', {
                      label: label,
                      baseY: baseY,
                      viewportY: viewportY,
                      rows: rows,
                      cols: window.term.cols,
                      totalLines: buf.length,
                      lines: snapshot
                    });
                  } catch (e) {
                    window._diagLog('snapshot-error', { label: label, error: e.message });
                  }
                };
                // Periodic integrity scan — detect scrollback lines that change after being frozen
                var prevScanLines = {};
                setInterval(function() {
                  try {
                    var buf = window.term.buffer.active;
                    var baseY = buf.baseY;
                    if (baseY < 5) return; // not enough scrollback yet
                    // Scan 30 lines in the scrollback region (well above the viewport)
                    var scanStart = Math.max(0, baseY - 40);
                    var scanEnd = baseY - 10;
                    var corruptions = [];
                    var currentLines = {};
                    for (var i = scanStart; i < scanEnd; i++) {
                      var line = buf.getLine(i);
                      if (!line) continue;
                      var text = line.translateToString(true);
                      currentLines[i] = text;
                      // Compare with previous scan — if a frozen line changed, that's corruption
                      if (prevScanLines[i] !== undefined && prevScanLines[i] !== text) {
                        corruptions.push({
                          row: i,
                          was: truncate(escapeCtrl(prevScanLines[i]), 200),
                          now: truncate(escapeCtrl(text), 200)
                        });
                      }
                    }
                    prevScanLines = currentLines;
                    if (corruptions.length > 0) {
                      window._diagLog('corruption-detected', {
                        baseY: baseY,
                        count: corruptions.length,
                        corruptions: corruptions
                      });
                      console.warn('[DIAG] Scrollback corruption detected!', corruptions);
                    }
                  } catch (e) { /* ignore scan errors */ }
                }, 2000);
                console.log('[DIAG] Terminal diagnostic logging enabled for session ' + diagSessionId);
              })();
              // DIAG END

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
                var flushCount = 0; // DIAG — track flush frequency
                function flush() {
                  rafId = null;
                  if (buffer.length === 0) return;
                  // DIAG START — log flush events with buffer snapshot
                  flushCount++;
                  var totalLen = 0;
                  for (var i = 0; i < buffer.length; i++) totalLen += (buffer[i].length || 0);
                  // Log every 10th flush to avoid overwhelming the log, unless it's a big batch
                  if (flushCount % 10 === 0 || buffer.length > 5 || totalLen > 2000) {
                    window._diagLog('flush', { flushNum: flushCount, chunks: buffer.length, totalBytes: totalLen });
                    window._diagSnapshot('post-flush-' + flushCount);
                  }
                  // DIAG END
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
                  // Force full repaint after every write. xterm.js's canvas renderer
                  // has a scroll optimization that copies existing pixels when lines
                  // scroll, but it fails when multiple lines scroll at once (large
                  // blocks from Claude Code, pasted text). The resulting garbling is
                  // purely visual — the buffer data is correct. refresh() forces the
                  // renderer to repaint all visible rows from the buffer.
                  // Use multiple delayed refreshes to ensure we run AFTER xterm.js's
                  // own render passes complete.
                  setTimeout(function() {
                    window.term.refresh(0, window.term.rows - 1);
                  }, 0);
                  setTimeout(function() {
                    window.term.refresh(0, window.term.rows - 1);
                  }, 50);
                  setTimeout(function() {
                    window.term.refresh(0, window.term.rows - 1);
                  }, 150);
                  buffer = [];
                }
                window.term.write = function(data) {
                  // DIAG START — log incoming writes with escape sequence detection
                  if (typeof data === 'string' && data.length > 0) {
                    var hasEsc = data.indexOf('\\x1b') !== -1;
                    var hasCursor = /\\x1b\\[\\d*[ABCDHJ]|\\x1b\\[\\d*;?\\d*[Hf]/.test(data);
                    // Log writes that contain cursor movement (prime suspect for garbling)
                    if (hasCursor) {
                      var escCtrl = data.replace(/\\x1b/g, '<ESC>').replace(/\\r/g, '<CR>').replace(/\\n/g, '<LF>');
                      window._diagLog('write-cursor', {
                        len: data.length,
                        preview: escCtrl.substring(0, 300),
                        hasCursorMove: true
                      });
                    }
                  }
                  // DIAG END
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
