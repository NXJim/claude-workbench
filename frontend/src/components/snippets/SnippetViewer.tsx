/**
 * Read-only snippet viewer with copy button.
 */

import { useState } from 'react';
import { useSnippetStore } from '@/stores/snippetStore';

interface SnippetViewerProps {
  snippetId: string;
}

export function SnippetViewer({ snippetId }: SnippetViewerProps) {
  const snippet = useSnippetStore((s) => s.snippets.find((sn) => sn.id === snippetId));
  const [copied, setCopied] = useState(false);

  if (!snippet) {
    return (
      <div className="flex items-center justify-center h-full text-surface-400 text-sm">
        Snippet not found
      </div>
    );
  }

  const handleCopy = async () => {
    try {
      // Use textarea fallback for HTTP contexts
      const ta = document.createElement('textarea');
      ta.value = snippet.code;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      console.warn('Copy failed');
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-2 border-b border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium truncate">{snippet.title}</h3>
          <button
            onClick={handleCopy}
            className="text-xs px-2 py-1 rounded bg-surface-200 dark:bg-surface-700 hover:bg-surface-300 dark:hover:bg-surface-600 text-surface-600 dark:text-surface-400"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
        {snippet.description && (
          <p className="text-xs text-surface-500 mt-1">{snippet.description}</p>
        )}
        <div className="flex gap-2 mt-1.5">
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-200 dark:bg-surface-700">{snippet.language}</span>
          {snippet.tags && snippet.tags.split(',').filter(Boolean).map((tag) => (
            <span key={tag.trim()} className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
              {tag.trim()}
            </span>
          ))}
        </div>
      </div>

      {/* Code */}
      <div className="flex-1 overflow-auto p-3 bg-surface-950">
        <pre className="text-sm font-mono text-surface-300 whitespace-pre-wrap">{snippet.code}</pre>
      </div>
    </div>
  );
}
