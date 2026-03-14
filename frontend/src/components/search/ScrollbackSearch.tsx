/**
 * Cross-session scrollback search modal.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '@/api/client';

interface SearchResult {
  session_id: string;
  session_name: string | null;
  session_color: string;
  lines: string[];
  captured_at: string;
}

export function ScrollbackSearch() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Listen for open-search custom event
  useEffect(() => {
    const handler = () => setIsOpen(true);
    window.addEventListener('open-search', handler);
    return () => window.removeEventListener('open-search', handler);
  }, []);

  // Focus on open
  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
    }
  }, [isOpen]);

  // Debounced search
  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const data = await api.searchScrollback(q);
      setResults(data);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setQuery(q);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => doSearch(q), 300);
  };

  const handleClose = () => {
    setIsOpen(false);
    setQuery('');
    setResults([]);
  };

  if (!isOpen) return null;

  const totalMatches = results.reduce((sum, r) => sum + r.lines.length, 0);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-start justify-center pt-[5vh] sm:pt-[10vh]"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-2xl mx-2 sm:mx-auto bg-white dark:bg-surface-800 rounded-xl shadow-2xl border border-surface-200 dark:border-surface-700 overflow-hidden max-h-[80vh] sm:max-h-[70vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-surface-200 dark:border-surface-700">
          <svg className="w-5 h-5 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={handleQueryChange}
            onKeyDown={(e) => { if (e.key === 'Escape') handleClose(); }}
            placeholder="Search across all session scrollback..."
            className="flex-1 bg-transparent outline-none text-sm"
          />
          {loading && (
            <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          )}
          <kbd className="text-xs px-1.5 py-0.5 bg-surface-100 dark:bg-surface-700 rounded text-surface-400">ESC</kbd>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          {query && !loading && results.length === 0 && (
            <p className="px-4 py-8 text-sm text-surface-400 text-center">No matches found</p>
          )}

          {results.length > 0 && (
            <div className="px-4 py-2 text-xs text-surface-400 border-b border-surface-100 dark:border-surface-700">
              {totalMatches} match{totalMatches !== 1 ? 'es' : ''} across {results.length} session{results.length !== 1 ? 's' : ''}
            </div>
          )}

          {results.map((r) => (
            <div key={r.session_id} className="border-b border-surface-100 dark:border-surface-700 last:border-b-0">
              {/* Session header */}
              <div className="flex items-center gap-2 px-4 py-2 bg-surface-50 dark:bg-surface-800/50">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: r.session_color }}
                />
                <span className="text-sm font-medium">{r.session_name || r.session_id}</span>
                <span className="text-xs text-surface-400">({r.lines.length} matches)</span>
              </div>
              {/* Matching lines */}
              <div className="px-4 py-2 space-y-1">
                {r.lines.slice(0, 20).map((line, i) => (
                  <div
                    key={i}
                    className="text-xs font-mono text-surface-600 dark:text-surface-400 bg-surface-50 dark:bg-surface-900 rounded px-2 py-1 truncate"
                    title={line}
                  >
                    {highlightMatch(line, query)}
                  </div>
                ))}
                {r.lines.length > 20 && (
                  <p className="text-xs text-surface-400 px-2">...and {r.lines.length - 20} more</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Highlight matching text in a line. */
function highlightMatch(line: string, query: string) {
  if (!query) return line;
  const idx = line.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return line;
  return (
    <>
      {line.slice(0, idx)}
      <span className="bg-yellow-200 dark:bg-yellow-800 text-yellow-900 dark:text-yellow-100 rounded px-0.5">
        {line.slice(idx, idx + query.length)}
      </span>
      {line.slice(idx + query.length)}
    </>
  );
}
