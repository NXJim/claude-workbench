/**
 * Scratch pad viewer — reads .cwb-scratch.md from a session's project directory,
 * parses code blocks, and renders each with a copy button.
 * Polls every 3 seconds for changes.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '@/api/client';

interface ScratchPadViewerProps {
  sessionId: string;
}

/** Parsed segment — either plain text (context) or a copyable block. */
interface Segment {
  type: 'text' | 'code';
  content: string;
}

/** Parse content into context text and <cb>...</cb> copyable blocks. */
function parseSegments(content: string): Segment[] {
  const segments: Segment[] = [];
  const cbRegex = /<cb>\n?([\s\S]*?)<\/cb>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = cbRegex.exec(content)) !== null) {
    // Text before this <cb> block — rendered as context label
    if (match.index > lastIndex) {
      const text = content.slice(lastIndex, match.index).trim();
      if (text) segments.push({ type: 'text', content: text });
    }
    segments.push({
      type: 'code',
      content: match[1].trimEnd(),
    });
    lastIndex = match.index + match[0].length;
  }

  // Trailing text after last <cb> block
  if (lastIndex < content.length) {
    const text = content.slice(lastIndex).trim();
    if (text) segments.push({ type: 'text', content: text });
  }

  return segments;
}

export function ScratchPadViewer({ sessionId }: ScratchPadViewerProps) {
  const [content, setContent] = useState('');
  const [modifiedAt, setModifiedAt] = useState<string | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
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

  const handleCopy = useCallback(async (text: string, index: number) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for non-HTTPS contexts
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  }, []);

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

  const segments = parseSegments(content);

  return (
    <div className="flex flex-col h-full">
      {/* Content area */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {segments.map((seg, i) =>
          seg.type === 'code' ? (
            <div key={i} className="relative group rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/50 overflow-hidden">
              {/* Copy button bar */}
              <div className="flex items-center justify-end px-3 py-1.5 bg-surface-100 dark:bg-surface-800 border-b border-surface-200 dark:border-surface-700">
                <button
                  onClick={() => handleCopy(seg.content, i)}
                  className={`text-xs px-2 py-0.5 rounded transition-colors ${
                    copiedIndex === i
                      ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'
                      : 'text-surface-500 hover:bg-surface-200 dark:hover:bg-surface-700 hover:text-surface-700 dark:hover:text-surface-300'
                  }`}
                >
                  {copiedIndex === i ? 'Copied!' : 'Copy'}
                </button>
              </div>
              {/* Code content */}
              <pre className="p-3 overflow-x-auto text-sm font-mono leading-relaxed text-surface-800 dark:text-surface-200">
                <code>{seg.content}</code>
              </pre>
            </div>
          ) : (
            <pre key={i} className="text-sm text-surface-600 dark:text-surface-400 whitespace-pre-wrap leading-relaxed px-1">
              {seg.content}
            </pre>
          )
        )}
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
