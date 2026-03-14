/**
 * Cross-session clipboard floating window.
 */

import { useEffect, useState } from 'react';
import { useClipboardStore } from '@/stores/clipboardStore';
import { useLayoutStore, type FloatingWindow } from '@/stores/layoutStore';
import { FloatingWindowShell } from '@/components/workspace/FloatingWindowShell';

interface ClipboardFloatingWindowProps {
  window: FloatingWindow;
}

export function ClipboardFloatingWindow({ window: fw }: ClipboardFloatingWindowProps) {
  const content = useClipboardStore((s) => s.content);
  const copy = useClipboardStore((s) => s.copy);
  const fetch = useClipboardStore((s) => s.fetch);
  const removeFloating = useLayoutStore((s) => s.removeFloating);
  const [localValue, setLocalValue] = useState(content);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch();
  }, [fetch]);

  useEffect(() => {
    setLocalValue(content);
  }, [content]);

  const handleSave = () => {
    copy(localValue);
  };

  const handleCopyToSystem = async () => {
    try {
      const ta = document.createElement('textarea');
      ta.value = content;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      console.warn('Copy to system clipboard failed');
    }
  };

  return (
    <FloatingWindowShell
      window={fw}
      title="Shared Clipboard"
      accentColor="#06b6d4"
      onClose={() => removeFloating(fw.id)}
      icon={
        <svg className="w-3.5 h-3.5 text-cyan-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
      }
      headerActions={
        <button
          onClick={handleCopyToSystem}
          className="text-xs px-2 py-0.5 rounded bg-surface-200 dark:bg-surface-700 hover:bg-surface-300 dark:hover:bg-surface-600 text-surface-600 dark:text-surface-400"
        >
          {copied ? 'Copied!' : 'System Clipboard'}
        </button>
      }
    >
      <div className="flex flex-col h-full">
        <textarea
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
          onBlur={handleSave}
          placeholder="Paste content here to share across sessions..."
          className="flex-1 p-3 text-sm resize-none bg-transparent focus:outline-none font-mono leading-relaxed"
          spellCheck={false}
        />
        <div className="flex items-center justify-between px-3 py-2 border-t border-surface-200 dark:border-surface-700 text-xs text-surface-400">
          <span>{content.length} chars</span>
          <button
            onClick={handleSave}
            className="px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700"
          >
            Save to shared
          </button>
        </div>
      </div>
    </FloatingWindowShell>
  );
}
