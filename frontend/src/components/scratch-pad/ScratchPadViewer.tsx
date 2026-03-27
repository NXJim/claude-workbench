/**
 * Scratch pad viewer — reads .cwb-scratch.md from a session's project directory,
 * groups <cb> blocks under their preceding context text as cards,
 * and renders each block as an editable textarea with a copy button.
 * Polls every 3 seconds for changes.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '@/api/client';

interface ScratchPadViewerProps {
  sessionId: string;
}

/** A group: optional header text + one or more copyable code blocks. */
interface Group {
  header: string | null;
  blocks: string[];
}

/** Parse content into groups: each text segment starts a new group,
 *  and subsequent <cb> blocks belong to that group. */
function parseGroups(content: string): Group[] {
  const groups: Group[] = [];
  const cbRegex = /<cb>\n?([\s\S]*?)<\/cb>/g;
  let lastIndex = 0;
  let currentHeader: string | null = null;
  let currentBlocks: string[] = [];

  let match: RegExpExecArray | null;
  while ((match = cbRegex.exec(content)) !== null) {
    // Text before this <cb> block
    if (match.index > lastIndex) {
      const text = content.slice(lastIndex, match.index).trim();
      if (text) {
        // New text segment — flush the previous group if it has blocks
        if (currentBlocks.length > 0) {
          groups.push({ header: currentHeader, blocks: currentBlocks });
          currentBlocks = [];
        }
        currentHeader = text;
      }
    }
    currentBlocks.push(match[1].trimEnd());
    lastIndex = match.index + match[0].length;
  }

  // Flush remaining group
  if (currentBlocks.length > 0) {
    groups.push({ header: currentHeader, blocks: currentBlocks });
  }

  // Trailing text with no blocks
  if (lastIndex < content.length) {
    const text = content.slice(lastIndex).trim();
    if (text) {
      groups.push({ header: text, blocks: [] });
    }
  }

  return groups;
}

function CopyableBlock({ code, blockKey }: { code: string; blockKey: string }) {
  const [value, setValue] = useState(code);
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync with upstream when file changes, but only if user hasn't edited
  const editedRef = useRef(false);
  useEffect(() => {
    if (!editedRef.current) {
      setValue(code);
    }
  }, [code]);

  // Auto-resize textarea to fit content
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = ta.scrollHeight + 'px';
    }
  }, [value]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Fallback for non-HTTPS contexts
      const textarea = document.createElement('textarea');
      textarea.value = value;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [value]);

  return (
    <div className="relative rounded border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/50 overflow-hidden">
      {/* Copy button bar */}
      <div className="flex items-center justify-between px-2.5 py-1 bg-surface-100/60 dark:bg-surface-800/80 border-b border-surface-200 dark:border-surface-700">
        {editedRef.current ? (
          <span className="text-xs text-amber-500 dark:text-amber-400 italic">edited</span>
        ) : (
          <span />
        )}
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
      {/* Editable command area — word-wraps, auto-sizes to content */}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => {
          editedRef.current = true;
          setValue(e.target.value);
        }}
        spellCheck={false}
        className="w-full px-3 py-2 text-sm font-mono leading-relaxed text-surface-800 dark:text-surface-200 bg-transparent resize-none focus:outline-none overflow-hidden"
        style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
        rows={1}
      />
    </div>
  );
}

export function ScratchPadViewer({ sessionId }: ScratchPadViewerProps) {
  const [content, setContent] = useState('');
  const [modifiedAt, setModifiedAt] = useState<string | null>(null);
  const lastModifiedRef = useRef<string | null>(null);

  const fetchContent = useCallback(async () => {
    try {
      const data = await api.getScratchPad(sessionId);
      // Only update state if the file actually changed
      if (data.modified_at !== lastModifiedRef.current) {
        lastModifiedRef.current = data.modified_at;
        setContent(data.content);
        setModifiedAt(data.modified_at);
      }
    } catch {
      // Session may not exist yet or endpoint unavailable — ignore
    }
  }, [sessionId]);

  useEffect(() => {
    fetchContent();
    const interval = setInterval(fetchContent, 3000);
    return () => clearInterval(interval);
  }, [fetchContent]);

  // Empty state
  if (!content) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center">
        <svg className="w-10 h-10 text-surface-300 dark:text-surface-600 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" />
        </svg>
        <p className="text-sm text-surface-400 dark:text-surface-500 max-w-xs">
          No scratch pad content yet. Claude will write copyable output here when it generates commands or code blocks.
        </p>
      </div>
    );
  }

  const groups = parseGroups(content);

  return (
    <div className="flex flex-col h-full">
      {/* Content area */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {groups.map((group, gi) => (
          <div
            key={gi}
            className="rounded-lg border border-surface-200 dark:border-surface-700 overflow-hidden"
          >
            {/* Card header — context text */}
            {group.header && (
              <div className="px-3 py-2 bg-surface-100 dark:bg-surface-800 border-b border-surface-200 dark:border-surface-700">
                <span className="text-xs font-medium text-surface-600 dark:text-surface-300 leading-relaxed">
                  {group.header}
                </span>
              </div>
            )}
            {/* Stacked command blocks */}
            {group.blocks.length > 0 && (
              <div className="p-2 space-y-2 bg-surface-50/50 dark:bg-surface-900/30">
                {group.blocks.map((block, bi) => (
                  <CopyableBlock
                    key={`${gi}-${bi}`}
                    code={block}
                    blockKey={`${gi}-${bi}`}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Footer with last updated timestamp */}
      {modifiedAt && (
        <div className="px-3 py-1.5 border-t border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800">
          <span className="text-xs text-surface-400 dark:text-surface-500">
            Updated {new Date(modifiedAt).toLocaleTimeString()}
          </span>
        </div>
      )}
    </div>
  );
}
