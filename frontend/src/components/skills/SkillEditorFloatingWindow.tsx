/**
 * Skill editor floating window — FloatingWindowShell + SkillEditor.
 */

import { useSkillStore } from '@/stores/skillStore';
import { useLayoutStore, type FloatingWindow } from '@/stores/layoutStore';
import { FloatingWindowShell } from '@/components/workspace/FloatingWindowShell';
import { SkillEditor } from './SkillEditor';

interface SkillEditorFloatingWindowProps {
  window: FloatingWindow;
  skillPath: string;
}

export function SkillEditorFloatingWindow({ window: fw, skillPath }: SkillEditorFloatingWindowProps) {
  const removeFloating = useLayoutStore((s) => s.removeFloating);
  const readonly = useSkillStore((s) => s.openSkillReadonly[skillPath] ?? false);

  // Derive skill name from path
  const pathParts = skillPath.split('/');
  const skillDirName = pathParts[pathParts.length - 2] || 'Skill';

  return (
    <FloatingWindowShell
      window={fw}
      title={skillDirName}
      accentColor={readonly ? '#f59e0b' : '#8b5cf6'}
      onClose={() => removeFloating(fw.id)}
      icon={
        readonly ? (
          <svg className="w-3.5 h-3.5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5 text-violet-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        )
      }
    >
      <SkillEditor skillPath={skillPath} />
    </FloatingWindowShell>
  );
}
