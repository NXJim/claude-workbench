/**
 * Voice input dropdown panel for terminal header.
 * Uses the Web Speech API to transcribe speech, shows an editable preview,
 * and sends the text to the terminal via the same sendData pipeline as Quick Paste.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';

interface VoiceInputPanelProps {
  onSend: (text: string) => void;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
}

export function VoiceInputPanel({ onSend, onClose, anchorRef }: VoiceInputPanelProps) {
  const {
    isSupported,
    isListening,
    interimTranscript,
    finalTranscript,
    error,
    startListening,
    stopListening,
    resetTranscript,
  } = useSpeechRecognition();

  // Editable text field — new transcription is appended even after user edits
  const [editText, setEditText] = useState('');
  const prevTranscriptRef = useRef('');
  const panelRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Continuously track the anchor button's position so the panel follows
  // the floating window during drag (getBoundingClientRect changes as window moves).
  const [pos, setPos] = useState({ top: 0, left: 0 });
  useEffect(() => {
    let rafId: number;
    const track = () => {
      if (anchorRef.current) {
        const rect = anchorRef.current.getBoundingClientRect();
        setPos((prev) => {
          const top = rect.bottom + 4;
          const left = rect.right;
          // Only update state if position actually changed (avoids unnecessary re-renders)
          if (prev.top === top && prev.left === left) return prev;
          return { top, left };
        });
      }
      rafId = requestAnimationFrame(track);
    };
    track();
    return () => cancelAnimationFrame(rafId);
  }, [anchorRef]);

  // Auto-start listening when the panel opens
  useEffect(() => {
    if (isSupported) {
      startListening();
    }
    return () => {
      stopListening();
    };
    // Only on mount/unmount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Append new transcription to editText (works even after user edits).
  // Compares current finalTranscript against the last-seen value to extract
  // only the newly-transcribed portion, then appends it.
  useEffect(() => {
    if (finalTranscript === prevTranscriptRef.current) return;
    const prev = prevTranscriptRef.current;
    prevTranscriptRef.current = finalTranscript;
    // Extract the new portion that was just transcribed
    const delta = finalTranscript.startsWith(prev)
      ? finalTranscript.slice(prev.length)
      : finalTranscript;
    if (delta) {
      setEditText((cur) => cur + delta);
    }
  }, [finalTranscript]);

  // Auto-resize textarea to fit content
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [editText, interimTranscript]);

  // Close on outside click (excluding the anchor/mic button) or Escape
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      // Ignore clicks on the anchor button — let the toggle handler in TerminalHeader handle it
      if (anchorRef.current?.contains(target)) return;
      if (panelRef.current && !panelRef.current.contains(target)) {
        onClose();
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [onClose, anchorRef]);

  const handleSend = useCallback(() => {
    const text = editText.trim();
    if (!text) return;
    onSend(text);
    onClose();
  }, [editText, onSend, onClose]);

  const handleClear = useCallback(() => {
    resetTranscript();
    prevTranscriptRef.current = '';
    setEditText('');
    textareaRef.current?.focus();
  }, [resetTranscript]);

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setEditText(e.target.value);
  };

  // Ctrl+Enter sends
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  const hasText = editText.trim().length > 0;

  // Unsupported browser fallback
  if (!isSupported) {
    return (
      <div
        ref={panelRef}
        onMouseDown={(e) => e.stopPropagation()}
        className="fixed z-[9999] bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-lg shadow-lg p-4 w-72"
        style={{ top: pos.top, left: pos.left, transform: 'translateX(-100%)' }}
      >
        <div className="flex items-center gap-2 mb-2">
          <svg className="w-5 h-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          <span className="text-sm font-medium">Voice Input Unavailable</span>
        </div>
        <p className="text-xs text-surface-500 dark:text-surface-400">
          Voice input requires Chrome, Edge, or Safari 14.5+. Firefox has limited support behind a flag.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={panelRef}
      onMouseDown={(e) => e.stopPropagation()}
      className="fixed z-[9999] bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-lg shadow-lg w-80"
      style={{ top: pos.top, left: pos.left, transform: 'translateX(-100%)' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-surface-200 dark:border-surface-700">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-surface-500 dark:text-surface-400 uppercase tracking-wider">
            Voice Input
          </span>
          {isListening && (
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-xs text-red-500 dark:text-red-400">Listening</span>
            </span>
          )}
        </div>
        <button
          onClick={() => isListening ? stopListening() : startListening()}
          className={`text-xs px-2 py-0.5 rounded ${isListening
            ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
            : 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
          }`}
        >
          {isListening ? 'Stop' : 'Start'}
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="px-3 py-2 bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800">
          <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* Transcript area with inline clear button */}
      <div className="px-3 py-2">
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={editText}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            placeholder={isListening ? 'Speak now...' : 'Click Start to begin listening'}
            rows={2}
            className="w-full text-sm bg-surface-50 dark:bg-surface-900 border border-surface-300 dark:border-surface-600 rounded px-2 py-1.5 pr-7 resize-none focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          {/* Inline clear button (X) inside the textarea area */}
          {(hasText || editText.length > 0) && (
            <button
              onClick={handleClear}
              className="absolute top-2 right-2 p-0.5 rounded-full text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors"
              title="Clear text"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        {/* Live interim preview */}
        {interimTranscript && (
          <p className="text-xs text-surface-400 dark:text-surface-500 italic mt-1 truncate">
            {interimTranscript}
          </p>
        )}
      </div>

      {/* Action buttons — Send + Close */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-t border-surface-200 dark:border-surface-700">
        <button
          onClick={handleSend}
          disabled={!hasText}
          className="flex-1 text-xs py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
          title="Send text to terminal"
        >
          Send
        </button>
        <button
          onClick={onClose}
          className="text-xs py-1.5 px-3 rounded border border-surface-300 dark:border-surface-600 hover:bg-surface-100 dark:hover:bg-surface-700 text-surface-600 dark:text-surface-300"
        >
          Close
        </button>
      </div>

      {/* Hint */}
      <div className="px-3 pb-2">
        <p className="text-[10px] text-surface-400 dark:text-surface-500">
          Ctrl+Enter to send. Edit text before sending.
        </p>
      </div>
    </div>
  );
}
