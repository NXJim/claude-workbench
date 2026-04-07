/**
 * Skill editor — CodeMirror with markdown highlighting and 500ms debounce auto-save.
 * Read-only for plugin skills.
 */

import { useCallback } from 'react';
import { useSkillStore } from '@/stores/skillStore';
import { CodeMirrorEditor } from '@/components/ui/CodeMirrorEditor';

interface SkillEditorProps {
  skillPath: string;
}

export function SkillEditor({ skillPath }: SkillEditorProps) {
  const content = useSkillStore((s) => s.openSkillContents[skillPath] ?? '');
  const readonly = useSkillStore((s) => s.openSkillReadonly[skillPath] ?? false);
  const saveSkillContent = useSkillStore((s) => s.saveSkillContent);
  const status = useSkillStore((s) => s.saveStatus[skillPath] ?? 'idle');

  // Derive skill name from path (last directory name before SKILL.md)
  const pathParts = skillPath.split('/');
  const skillDirName = pathParts[pathParts.length - 2] || 'Skill';

  const handleChange = useCallback((value: string) => {
    saveSkillContent(skillPath, value);
  }, [skillPath, saveSkillContent]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs text-surface-500 truncate">
            {skillDirName}
          </span>
          {/* Read-only badge */}
          {readonly && (
            <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 flex-shrink-0">
              <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              Plugin (read-only)
            </span>
          )}
          {/* Save indicator */}
          {!readonly && status === 'saving' && (
            <span className="flex items-center gap-1 text-xs text-surface-400 flex-shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-surface-400 animate-pulse" />
              Saving
            </span>
          )}
          {!readonly && status === 'saved' && (
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
        language="md"
        readOnly={readonly}
        placeholder={readonly ? '' : 'Write your skill...'}
      />
    </div>
  );
}
