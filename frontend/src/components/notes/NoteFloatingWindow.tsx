/**
 * Note floating window — FloatingWindowShell + NoteEditor.
 */

import { useNoteStore } from '@/stores/noteStore';
import { useLayoutStore, type FloatingWindow } from '@/stores/layoutStore';
import { FloatingWindowShell } from '@/components/workspace/FloatingWindowShell';
import { NoteEditor } from './NoteEditor';

interface NoteFloatingWindowProps {
  window: FloatingWindow;
  noteId: string;
}

export function NoteFloatingWindow({ window: fw, noteId }: NoteFloatingWindowProps) {
  const note = useNoteStore((s) => s.notes.find((n) => n.id === noteId));
  const removeFloating = useLayoutStore((s) => s.removeFloating);

  return (
    <FloatingWindowShell
      window={fw}
      title={note?.title || 'Note'}
      accentColor="#22c55e"
      onClose={() => removeFloating(fw.id)}
      icon={
        <svg className="w-3.5 h-3.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
      }
    >
      <NoteEditor noteId={noteId} />
    </FloatingWindowShell>
  );
}
