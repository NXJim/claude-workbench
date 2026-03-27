/**
 * Standalone full-page markdown editor — rendered at /edit?path=...
 * Loads and auto-saves via the claude-md API. No AppShell or floating window chrome.
 */

import { useState, useEffect, useCallback } from 'react';
import { useClaudeMdStore } from '@/stores/claudeMdStore';
import { CodeMirrorEditor } from '@/components/ui/CodeMirrorEditor';
import { api } from '@/api/client';

/** Extract language hint from file path extension. */
function langFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  return ext || 'md';
}

export function EditorPage() {
  const path = new URLSearchParams(window.location.search).get('path');
  const content = useClaudeMdStore((s) => (path ? s.openContents[path] ?? null : null));
  const saveFile = useClaudeMdStore((s) => s.saveFile);
  const status = useClaudeMdStore((s) => (path ? s.saveStatus[path] ?? 'idle' : 'idle'));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Derive display label from path
  const label = path ? path.split('/').slice(-3).join('/') : '';
  const filename = path ? path.split('/').pop() || '' : '';

  // Set page title
  useEffect(() => {
    document.title = filename ? `${filename} — Claude Workbench` : 'Editor — Claude Workbench';
  }, [filename]);

  // Load file content on mount
  useEffect(() => {
    if (!path) {
      setError('No file path specified. Use /edit?path=...');
      setLoading(false);
      return;
    }

    (async () => {
      try {
        const result = await api.readClaudeMd(path);
        useClaudeMdStore.setState((s) => ({
          openContents: { ...s.openContents, [path]: result.content },
        }));
      } catch (e) {
        setError(`Failed to load file: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setLoading(false);
      }
    })();
  }, [path]);

  const handleChange = useCallback((value: string) => {
    if (path) saveFile(path, value);
  }, [path, saveFile]);

  // Error state
  if (error) {
    return (
      <div className="h-screen flex items-center justify-center bg-surface-50 dark:bg-surface-950">
        <div className="text-center max-w-md px-6">
          <svg className="w-12 h-12 mx-auto mb-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          <p className="text-surface-600 dark:text-surface-400">{error}</p>
        </div>
      </div>
    );
  }

  // Loading state
  if (loading || content === null) {
    return (
      <div className="h-screen flex items-center justify-center bg-surface-50 dark:bg-surface-950">
        <div className="text-sm text-surface-400 animate-pulse">Loading...</div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-white dark:bg-surface-950">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-sm text-surface-500 truncate font-mono">{label}</span>
          {/* Save indicator */}
          {status === 'saving' && (
            <span className="flex items-center gap-1 text-xs text-surface-400 flex-shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-surface-400 animate-pulse" />
              Saving
            </span>
          )}
          {status === 'saved' && (
            <span className="flex items-center gap-1 text-xs text-green-500 dark:text-green-400 flex-shrink-0">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Saved
            </span>
          )}
        </div>
      </div>

      {/* CodeMirror editor */}
      <CodeMirrorEditor
        value={content}
        onChange={handleChange}
        language={path ? langFromPath(path) : 'md'}
        placeholder="Start writing..."
        autoFocus
      />
    </div>
  );
}
