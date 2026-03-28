/**
 * Scratch pad viewer — persistent command library.
 *
 * The backend ingests entries from .cwb-scratch.md into a persistent JSON store.
 * This viewer polls the backend for the full history and renders each entry as a
 * card with metadata (description, machine, language, date), CodeMirror syntax
 * highlighting, copy/pin/delete controls, and search filtering.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { api, type ScratchEntry } from '@/api/client';
import { CodeMirrorEditor } from '@/components/ui/CodeMirrorEditor';

interface ScratchPadViewerProps {
  sessionId: string;
}

/** Machine badge color mapping */
const MACHINE_COLORS: Record<string, { bg: string; text: string }> = {
  prod: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-300' },
  production: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-300' },
  dev: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-300' },
  development: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-300' },
  local: { bg: 'bg-surface-100 dark:bg-surface-700/50', text: 'text-surface-600 dark:text-surface-300' },
  docker: { bg: 'bg-cyan-100 dark:bg-cyan-900/30', text: 'text-cyan-700 dark:text-cyan-300' },
};

const DEFAULT_MACHINE_COLOR = {
  bg: 'bg-purple-100 dark:bg-purple-900/30',
  text: 'text-purple-700 dark:text-purple-300',
};

/** Format a relative time string from an ISO date */
function relativeTime(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  // Beyond a week, show the date
  return new Date(isoDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function ScratchCard({
  entry,
  sessionId,
  onDelete,
  onTogglePin,
}: {
  entry: ScratchEntry;
  sessionId: string;
  onDelete: (id: string) => void;
  onTogglePin: (id: string, pinned: boolean) => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(entry.code);
    } catch {
      // Fallback for non-HTTPS contexts
      const textarea = document.createElement('textarea');
      textarea.value = entry.code;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [entry.code]);

  const machineColor = entry.machine
    ? MACHINE_COLORS[entry.machine.toLowerCase()] || DEFAULT_MACHINE_COLOR
    : null;

  return (
    <div className="rounded-lg border border-surface-200 dark:border-surface-700 overflow-hidden">
      {/* Card header — description, machine badge, timestamp, pin, delete */}
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-surface-100 dark:bg-surface-800 border-b border-surface-200 dark:border-surface-700">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {/* Description */}
          {entry.desc && (
            <span className="text-xs font-medium text-surface-700 dark:text-surface-200 truncate">
              {entry.desc}
            </span>
          )}
          {/* Machine badge */}
          {entry.machine && machineColor && (
            <span
              className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0 ${machineColor.bg} ${machineColor.text}`}
            >
              {entry.machine}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Timestamp */}
          <span className="text-[10px] text-surface-400 dark:text-surface-500 whitespace-nowrap">
            {relativeTime(entry.created_at)}
          </span>
          {/* Pin button */}
          <button
            onClick={() => onTogglePin(entry.id, !entry.pinned)}
            className={`p-0.5 rounded transition-colors ${
              entry.pinned
                ? 'text-amber-500 dark:text-amber-400'
                : 'text-surface-300 dark:text-surface-600 hover:text-amber-400 dark:hover:text-amber-500'
            }`}
            title={entry.pinned ? 'Unpin' : 'Pin'}
          >
            <svg className="w-3 h-3" fill={entry.pinned ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
            </svg>
          </button>
          {/* Delete button */}
          <button
            onClick={() => onDelete(entry.id)}
            className="p-0.5 rounded text-surface-300 dark:text-surface-600 hover:text-red-500 dark:hover:text-red-400 transition-colors"
            title="Delete"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Code block — read-only CodeMirror with syntax highlighting */}
      <div className="scratch-pad-codemirror">
        <CodeMirrorEditor
          value={entry.code}
          onChange={() => {}}
          language={entry.lang}
          readOnly
          minimal
        />
      </div>

      {/* Footer — language badge + copy button */}
      <div className="flex items-center justify-between px-2.5 py-1 bg-surface-50/60 dark:bg-surface-800/60 border-t border-surface-200 dark:border-surface-700">
        <span className="text-[10px] text-surface-400 dark:text-surface-500 font-mono">
          {entry.lang}
        </span>
        <button
          onClick={handleCopy}
          className={`text-xs px-2 py-0.5 rounded transition-colors ${
            copied
              ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'
              : 'text-surface-500 hover:bg-surface-200 dark:hover:bg-surface-700 hover:text-surface-700 dark:hover:text-surface-300'
          }`}
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

export function ScratchPadViewer({ sessionId }: ScratchPadViewerProps) {
  const [entries, setEntries] = useState<ScratchEntry[]>([]);
  const [search, setSearch] = useState('');
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const lastCountRef = useRef<number>(0);

  const fetchEntries = useCallback(async () => {
    try {
      const data = await api.getScratchPad(sessionId);
      // Only update if count changed (avoid re-renders on every poll)
      if (data.count !== lastCountRef.current || data.count === 0) {
        lastCountRef.current = data.count;
        setEntries(data.entries);
      }
    } catch {
      // Session may not exist yet — ignore
    }
  }, [sessionId]);

  useEffect(() => {
    fetchEntries();
    const interval = setInterval(fetchEntries, 3000);
    return () => clearInterval(interval);
  }, [fetchEntries]);

  // Optimistic delete
  const handleDelete = useCallback(
    async (entryId: string) => {
      setEntries((prev) => prev.filter((e) => e.id !== entryId));
      lastCountRef.current -= 1;
      try {
        await api.deleteScratchEntry(sessionId, entryId);
      } catch {
        // Re-fetch on failure to restore state
        fetchEntries();
      }
    },
    [sessionId, fetchEntries],
  );

  // Optimistic pin toggle
  const handleTogglePin = useCallback(
    async (entryId: string, pinned: boolean) => {
      setEntries((prev) =>
        prev.map((e) => (e.id === entryId ? { ...e, pinned } : e)),
      );
      try {
        await api.updateScratchEntry(sessionId, entryId, { pinned });
      } catch {
        fetchEntries();
      }
    },
    [sessionId, fetchEntries],
  );

  // Clear all (pinned survive)
  const handleClearAll = useCallback(async () => {
    setShowClearConfirm(false);
    const pinned = entries.filter((e) => e.pinned);
    setEntries(pinned);
    lastCountRef.current = pinned.length;
    try {
      await api.clearScratchPad(sessionId);
    } catch {
      fetchEntries();
    }
  }, [sessionId, entries, fetchEntries]);

  // Filter and sort: pinned first, then newest first
  const filteredEntries = useMemo(() => {
    let result = entries;
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (e) =>
          (e.desc && e.desc.toLowerCase().includes(q)) ||
          e.code.toLowerCase().includes(q) ||
          (e.machine && e.machine.toLowerCase().includes(q)) ||
          e.lang.toLowerCase().includes(q),
      );
    }
    // Sort: pinned first, then by created_at descending
    return [...result].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.created_at.localeCompare(a.created_at);
    });
  }, [entries, search]);

  // Empty state
  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center">
        <svg
          className="w-10 h-10 text-surface-300 dark:text-surface-600 mb-3"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z"
          />
        </svg>
        <p className="text-sm text-surface-400 dark:text-surface-500 max-w-xs">
          No scratch pad entries yet. Claude will write copyable output here when it generates
          commands or code blocks.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar — search + clear all */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/50">
        {/* Search input */}
        <div className="flex-1 relative">
          <svg
            className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-surface-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
            />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter entries..."
            className="w-full pl-7 pr-2 py-1 text-xs rounded border border-surface-200 dark:border-surface-600 bg-white dark:bg-surface-800 text-surface-700 dark:text-surface-200 placeholder:text-surface-400 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>
        {/* Entry count */}
        <span className="text-[10px] text-surface-400 dark:text-surface-500 whitespace-nowrap">
          {filteredEntries.length} / {entries.length}
        </span>
        {/* Clear all button */}
        {showClearConfirm ? (
          <div className="flex items-center gap-1">
            <button
              onClick={handleClearAll}
              className="text-[10px] px-1.5 py-0.5 rounded bg-red-500 text-white hover:bg-red-600 transition-colors"
            >
              Confirm
            </button>
            <button
              onClick={() => setShowClearConfirm(false)}
              className="text-[10px] px-1.5 py-0.5 rounded text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowClearConfirm(true)}
            className="text-[10px] px-1.5 py-0.5 rounded text-surface-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors whitespace-nowrap"
            title="Clear all entries (pinned entries survive)"
          >
            Clear all
          </button>
        )}
      </div>

      {/* Entry cards */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {filteredEntries.map((entry) => (
          <ScratchCard
            key={entry.id}
            entry={entry}
            sessionId={sessionId}
            onDelete={handleDelete}
            onTogglePin={handleTogglePin}
          />
        ))}
        {filteredEntries.length === 0 && search && (
          <div className="text-center py-6">
            <p className="text-xs text-surface-400 dark:text-surface-500">
              No entries match "{search}"
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
