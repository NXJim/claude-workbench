/**
 * CLAUDE.md editor — textarea with toggle preview, 500ms debounce auto-save.
 */

import { useState, useCallback } from 'react';
import { useClaudeMdStore } from '@/stores/claudeMdStore';

interface ClaudeMdEditorProps {
  filePath: string;
}

export function ClaudeMdEditor({ filePath }: ClaudeMdEditorProps) {
  const content = useClaudeMdStore((s) => s.openContents[filePath] ?? '');
  const saveFile = useClaudeMdStore((s) => s.saveFile);
  const [isPreview, setIsPreview] = useState(false);

  // Extract filename for display
  const label = filePath.split('/').slice(-2).join('/');

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    saveFile(filePath, e.target.value);
  }, [filePath, saveFile]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800">
        <span className="text-xs text-surface-500 truncate font-mono">{label}</span>
        <button
          onClick={() => setIsPreview(!isPreview)}
          className={`text-xs px-2 py-0.5 rounded ${
            isPreview
              ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
              : 'text-surface-500 hover:bg-surface-200 dark:hover:bg-surface-700'
          }`}
        >
          {isPreview ? 'Edit' : 'Preview'}
        </button>
      </div>

      {/* Content */}
      {isPreview ? (
        <div className="flex-1 overflow-y-auto p-4">
          <pre className="whitespace-pre-wrap font-mono text-sm text-surface-700 dark:text-surface-300">{content}</pre>
        </div>
      ) : (
        <textarea
          value={content}
          onChange={handleChange}
          placeholder="# CLAUDE.md instructions..."
          className="flex-1 p-3 text-sm resize-none bg-transparent focus:outline-none font-mono leading-relaxed"
          spellCheck={false}
        />
      )}
    </div>
  );
}
