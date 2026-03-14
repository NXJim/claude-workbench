/**
 * Snippet floating window — shows browser or individual snippet.
 */

import { useLayoutStore, type FloatingWindow } from '@/stores/layoutStore';
import { FloatingWindowShell } from '@/components/workspace/FloatingWindowShell';
import { SnippetBrowser } from './SnippetBrowser';
import { SnippetViewer } from './SnippetViewer';

interface SnippetFloatingWindowProps {
  window: FloatingWindow;
  snippetId: string;
}

export function SnippetFloatingWindow({ window: fw, snippetId }: SnippetFloatingWindowProps) {
  const removeFloating = useLayoutStore((s) => s.removeFloating);
  const isBrowser = snippetId === '__browser__';

  return (
    <FloatingWindowShell
      window={fw}
      title={isBrowser ? 'Snippet Browser' : 'Snippet'}
      accentColor="#8b5cf6"
      onClose={() => removeFloating(fw.id)}
      icon={
        <svg className="w-3.5 h-3.5 text-violet-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
        </svg>
      }
    >
      {isBrowser ? (
        <SnippetBrowser />
      ) : (
        <SnippetViewer snippetId={snippetId} />
      )}
    </FloatingWindowShell>
  );
}
