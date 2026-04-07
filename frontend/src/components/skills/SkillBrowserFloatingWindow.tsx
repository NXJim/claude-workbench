/**
 * Skill browser floating window — FloatingWindowShell + SkillBrowser.
 */

import { useLayoutStore, type FloatingWindow } from '@/stores/layoutStore';
import { FloatingWindowShell } from '@/components/workspace/FloatingWindowShell';
import { SkillBrowser } from './SkillBrowser';

interface SkillBrowserFloatingWindowProps {
  window: FloatingWindow;
}

export function SkillBrowserFloatingWindow({ window: fw }: SkillBrowserFloatingWindowProps) {
  const removeFloating = useLayoutStore((s) => s.removeFloating);

  return (
    <FloatingWindowShell
      window={fw}
      title="Skills"
      accentColor="#f43f5e"
      onClose={() => removeFloating(fw.id)}
      icon={
        <svg className="w-3.5 h-3.5 text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      }
    >
      <SkillBrowser />
    </FloatingWindowShell>
  );
}
