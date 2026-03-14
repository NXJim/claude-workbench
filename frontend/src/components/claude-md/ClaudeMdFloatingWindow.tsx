/**
 * CLAUDE.md floating window — FloatingWindowShell + ClaudeMdEditor.
 */

import { useClaudeMdStore } from '@/stores/claudeMdStore';
import { useLayoutStore, type FloatingWindow } from '@/stores/layoutStore';
import { FloatingWindowShell } from '@/components/workspace/FloatingWindowShell';
import { ClaudeMdEditor } from './ClaudeMdEditor';

interface ClaudeMdFloatingWindowProps {
  window: FloatingWindow;
  filePath: string;
}

export function ClaudeMdFloatingWindow({ window: fw, filePath }: ClaudeMdFloatingWindowProps) {
  const files = useClaudeMdStore((s) => s.files);
  const removeFloating = useLayoutStore((s) => s.removeFloating);

  const file = files.find((f) => f.path === filePath);
  const title = file?.label || filePath.split('/').pop() || 'CLAUDE.md';

  return (
    <FloatingWindowShell
      window={fw}
      title={title}
      accentColor="#f59e0b"
      onClose={() => removeFloating(fw.id)}
      icon={
        <svg className="w-3.5 h-3.5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      }
    >
      <ClaudeMdEditor filePath={filePath} />
    </FloatingWindowShell>
  );
}
