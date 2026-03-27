/**
 * CLAUDE.md / .md file editor — CodeMirror with auto-detected language highlighting
 * and 500ms debounce auto-save.
 */

import { useCallback } from 'react';
import { useClaudeMdStore } from '@/stores/claudeMdStore';
import { CodeMirrorEditor } from '@/components/ui/CodeMirrorEditor';

interface ClaudeMdEditorProps {
  filePath: string;
}

/** Extract language hint from file path extension. */
function langFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  return ext || 'md';
}

export function ClaudeMdEditor({ filePath }: ClaudeMdEditorProps) {
  const content = useClaudeMdStore((s) => s.openContents[filePath] ?? '');
  const saveFile = useClaudeMdStore((s) => s.saveFile);
  const status = useClaudeMdStore((s) => s.saveStatus[filePath] ?? 'idle');

  // Extract filename for display
  const label = filePath.split('/').slice(-2).join('/');

  const handleChange = useCallback((value: string) => {
    saveFile(filePath, value);
  }, [filePath, saveFile]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs text-surface-500 truncate font-mono">{label}</span>
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
        language={langFromPath(filePath)}
        placeholder="Start writing..."
      />
    </div>
  );
}
