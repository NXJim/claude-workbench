/**
 * Renders all floating windows above the tiling workspace.
 * Dispatches to the appropriate window component by descriptor type.
 */

import { useEffect } from 'react';
import { useLayoutStore, type FloatingWindow } from '@/stores/layoutStore';
import { TerminalFloatingWindow } from './FloatingWindow';
import { NoteFloatingWindow } from '@/components/notes/NoteFloatingWindow';
import { ClaudeMdFloatingWindow } from '@/components/claude-md/ClaudeMdFloatingWindow';
import { SnippetFloatingWindow } from '@/components/snippets/SnippetFloatingWindow';
import { DashboardFloatingWindow } from '@/components/dashboard/DashboardFloatingWindow';
import { ClipboardFloatingWindow } from '@/components/clipboard/ClipboardFloatingWindow';
import { ScratchPadFloatingWindow } from '@/components/scratch-pad/ScratchPadFloatingWindow';
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
    case 'scratch-pad':
      return <ScratchPadFloatingWindow window={fw} sessionId={fw.descriptor.sessionId} />;
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

  // Poll document.activeElement to detect when a cross-origin iframe receives
  // focus. Cross-origin iframes swallow all mouse events so we can't use
  // overlays (blocks the click) or blur events (don't fire for iframe→iframe
  // transitions). Polling is the only reliable approach that doesn't require
  // a second click.
  //
  // We only act on *transitions* (activeElement changing to a new iframe),
  // not on steady state. This prevents the poll from overriding a manual
  // title-bar click — clicking a title bar doesn't change activeElement
  // (mousedown calls preventDefault), so the poll sees no transition.
  useEffect(() => {
    let lastActiveElement: Element | null = null;
    const interval = setInterval(() => {
      const el = document.activeElement;
      if (el === lastActiveElement) return; // no transition — skip
      lastActiveElement = el;
      if (!(el instanceof HTMLIFrameElement)) return;
      const container = el.closest('[data-floating-window-id]');
      if (!container) return;
      const windowId = container.getAttribute('data-floating-window-id')!;
      useLayoutStore.getState().bringToFront(windowId);
    }, 150);
    return () => clearInterval(interval);
  }, []);

  if (floatingWindows.length === 0) return null;

  return (
    <>
      {floatingWindows.map((fw) => (
        <FloatingWindowDispatch key={fw.id} window={fw} />
      ))}
    </>
  );
}
