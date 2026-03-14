/**
 * Renders all floating windows above the tiling workspace.
 * Dispatches to the appropriate window component by descriptor type.
 */

import { useLayoutStore, type FloatingWindow } from '@/stores/layoutStore';
import { TerminalFloatingWindow } from './FloatingWindow';
import { NoteFloatingWindow } from '@/components/notes/NoteFloatingWindow';
import { ClaudeMdFloatingWindow } from '@/components/claude-md/ClaudeMdFloatingWindow';
import { SnippetFloatingWindow } from '@/components/snippets/SnippetFloatingWindow';
import { DashboardFloatingWindow } from '@/components/dashboard/DashboardFloatingWindow';
import { ClipboardFloatingWindow } from '@/components/clipboard/ClipboardFloatingWindow';
import { SettingsFloatingWindow } from '@/components/settings/SettingsFloatingWindow';
import { FloatingWindowShell } from './FloatingWindowShell';

function FloatingWindowDispatch({ window: fw }: { window: FloatingWindow }) {
  switch (fw.descriptor.type) {
    case 'terminal':
      return <TerminalFloatingWindow window={fw} />;
    case 'note':
      return <NoteFloatingWindow window={fw} noteId={fw.descriptor.noteId} />;
    case 'claude-md':
      return <ClaudeMdFloatingWindow window={fw} filePath={fw.descriptor.filePath} />;
    case 'snippet':
      return <SnippetFloatingWindow window={fw} snippetId={fw.descriptor.snippetId} />;
    case 'dashboard':
      return <DashboardFloatingWindow window={fw} />;
    case 'clipboard':
      return <ClipboardFloatingWindow window={fw} />;
    case 'settings':
      return <SettingsFloatingWindow window={fw} />;
    default:
      return (
        <FloatingWindowShell
          window={fw}
          title="Unknown"
          onClose={() => useLayoutStore.getState().removeFloating(fw.id)}
        >
          <div className="flex items-center justify-center h-full text-surface-400 text-sm">
            Unknown window type
          </div>
        </FloatingWindowShell>
      );
  }
}

export function FloatingWindowManager() {
  const floatingWindows = useLayoutStore((s) => s.floatingWindows);

  if (floatingWindows.length === 0) return null;

  return (
    <>
      {floatingWindows.map((fw) => (
        <FloatingWindowDispatch key={fw.id} window={fw} />
      ))}
    </>
  );
}
