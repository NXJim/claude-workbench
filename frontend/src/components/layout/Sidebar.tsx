/**
 * Collapsible sidebar with project tree, active sessions, and notes.
 * Layout presets moved to header bar (LayoutPresetBar).
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useSessionStore, SESSION_COLORS } from '@/stores/sessionStore';
import { useLayoutStore } from '@/stores/layoutStore';
import { useConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useIsMobile } from '@/hooks/useIsMobile';
import { ProjectTree } from './ProjectTree';
import { NotesSidebarSection } from '@/components/notes/NotesSidebarSection';
import { ResizeDivider } from '@/components/ui/ResizeDivider';
import { windowKey } from '@/types/windows';

/** Vertical drag handle on the sidebar's right edge for horizontal resizing. */
function SidebarWidthHandle({ onDrag }: { onDrag: (deltaX: number) => void }) {
  const onDragRef = useRef(onDrag);
  onDragRef.current = onDrag;

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    let lastX = e.clientX;

    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientX - lastX;
      lastX = ev.clientX;
      onDragRef.current(delta);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  return (
    <div
      className="flex-shrink-0 cursor-col-resize group relative"
      style={{ width: 4 }}
      onMouseDown={handleMouseDown}
    >
      {/* Wider invisible hit area */}
      <div className="absolute -left-1 -right-1 top-0 bottom-0" />
      {/* Visible line on hover */}
      <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px opacity-0 group-hover:opacity-100 bg-blue-500/40 transition-opacity" />
    </div>
  );
}

export function Sidebar() {
  const sessions = useSessionStore((s) => s.sessions);
  const createSession = useSessionStore((s) => s.createSession);
  const deleteSession = useSessionStore((s) => s.deleteSession);
  const updateSession = useSessionStore((s) => s.updateSession);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const sidebarCollapsed = useLayoutStore((s) => s.sidebarCollapsed);
  const sidebarWidth = useLayoutStore((s) => s.sidebarWidth);
  const toggleSidebar = useLayoutStore((s) => s.toggleSidebar);
  const popOut = useLayoutStore((s) => s.popOut);
  const removeFromTiling = useLayoutStore((s) => s.removeFromTiling);
  const removeFloating = useLayoutStore((s) => s.removeFloating);
  const setSidebarWidth = useLayoutStore((s) => s.setSidebarWidth);
  const sidebarSectionRatios = useLayoutStore((s) => s.sidebarSectionRatios);
  const setSidebarSectionRatios = useLayoutStore((s) => s.setSidebarSectionRatios);
  const confirmDialog = useConfirmDialog();
  const isMobile = useIsMobile();
  const aliveSessions = sessions.filter((s) => s.is_alive);

  // Measure container height for ratio-based section sizing
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerHeight, setContainerHeight] = useState(0);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height);
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Resize divider handlers
  const handleDividerDrag = useCallback((index: number, deltaY: number) => {
    if (containerHeight <= 0) return;
    const ratios = [...sidebarSectionRatios] as [number, number, number];
    const deltaRatio = deltaY / containerHeight;

    // Grow section[index], shrink section[index+1]
    ratios[index] = Math.max(0.1, ratios[index] + deltaRatio);
    ratios[index + 1] = Math.max(0.1, ratios[index + 1] - deltaRatio);

    // Normalize to sum to 1
    const total = ratios[0] + ratios[1] + ratios[2];
    ratios[0] /= total;
    ratios[1] /= total;
    ratios[2] /= total;

    setSidebarSectionRatios(ratios);
  }, [containerHeight, sidebarSectionRatios, setSidebarSectionRatios]);

  const handleWidthDrag = useCallback((deltaX: number) => {
    const newWidth = Math.max(180, Math.min(600, sidebarWidth + deltaX));
    setSidebarWidth(newWidth);
  }, [sidebarWidth, setSidebarWidth]);

  /** Get the window key for a terminal session. */
  const termKey = (sessionId: string) => windowKey({ type: 'terminal', sessionId });

  if (sidebarCollapsed) {
    return (
      <div className="w-12 flex-shrink-0 border-r border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-900 flex flex-col items-center py-3 gap-3">
        <button
          onClick={toggleSidebar}
          className="p-2 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800"
          title="Expand sidebar (Ctrl+B)"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
        {/* Session dots */}
        {aliveSessions.map((s) => (
          <button
            key={s.id}
            onClick={() => popOut(termKey(s.id), { type: 'terminal', sessionId: s.id })}
            className="w-3 h-3 rounded-full border-2 border-transparent hover:border-surface-400 transition-colors"
            style={{ backgroundColor: s.color }}
            title={s.display_name || s.id}
          />
        ))}
      </div>
    );
  }

  const handleNewSession = async () => {
    const color = SESSION_COLORS[sessions.length % SESSION_COLORS.length];
    const session = await createSession(undefined, undefined, color);
    popOut(termKey(session.id), { type: 'terminal', sessionId: session.id });
  };

  return (
    <div className="flex flex-row flex-shrink-0 h-full" style={{ width: sidebarWidth }}>
    <div
      className="flex-1 min-w-0 bg-surface-50 dark:bg-surface-900 flex flex-col overflow-hidden h-full"
    >
      {/* Resizable sections container */}
      <div ref={containerRef} className="flex-1 flex flex-col min-h-0">
        {/* Section 1: Project tree */}
        <div
          className="overflow-y-auto"
          style={{ height: containerHeight > 0 ? containerHeight * sidebarSectionRatios[0] : 'auto' }}
        >
          <div className="flex items-center justify-between px-3 py-2 sticky top-0 bg-surface-50 dark:bg-surface-900 z-10">
            <span className="text-xs font-semibold uppercase tracking-wider text-surface-500">
              Projects
            </span>
            <button
              onClick={toggleSidebar}
              className="p-1 rounded hover:bg-surface-200 dark:hover:bg-surface-700 text-surface-500"
              title="Collapse sidebar (Ctrl+B)"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          </div>
          <ProjectTree />
        </div>

        <ResizeDivider onDrag={(dy) => handleDividerDrag(0, dy)} />

        {/* Section 2: Active sessions */}
        <div
          className="overflow-y-auto border-t border-surface-200 dark:border-surface-700"
          style={{ height: containerHeight > 0 ? containerHeight * sidebarSectionRatios[1] : 'auto' }}
        >
          <div className="flex items-center justify-between px-3 py-2 sticky top-0 bg-surface-50 dark:bg-surface-900 z-10">
            <span className="text-xs font-semibold uppercase tracking-wider text-surface-500">
              Sessions ({aliveSessions.length})
            </span>
            <button
              onClick={handleNewSession}
              className="p-1 rounded hover:bg-surface-200 dark:hover:bg-surface-700 text-surface-500"
              title="New session (Ctrl+N)"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>
          <div className="pb-2">
            {aliveSessions.length === 0 ? (
              <p className="px-3 py-2 text-xs text-surface-400">No active sessions</p>
            ) : (
              aliveSessions.map((s) => (
                <div
                  key={s.id}
                  className="group flex items-center gap-2 px-3 py-1.5 hover:bg-surface-100 dark:hover:bg-surface-800 cursor-pointer"
                  onClick={() => {
                    popOut(termKey(s.id), { type: 'terminal', sessionId: s.id });
                    // Auto-close sidebar drawer on mobile after selecting a session
                    if (isMobile && !sidebarCollapsed) toggleSidebar();
                  }}
                  onDoubleClick={(e) => {
                    // Double-tap/click to rename (touch-friendly alternative to right-click)
                    e.stopPropagation();
                    setRenamingId(s.id);
                    setRenameValue(s.display_name || '');
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setRenamingId(s.id);
                    setRenameValue(s.display_name || '');
                  }}
                >
                  <div
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: s.color }}
                  />
                  {renamingId === s.id ? (
                    <input
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={async () => {
                        if (renameValue.trim() && renameValue !== s.display_name) {
                          await updateSession(s.id, { display_name: renameValue.trim() });
                        }
                        setRenamingId(null);
                      }}
                      onKeyDown={async (e) => {
                        if (e.key === 'Enter') {
                          if (renameValue.trim() && renameValue !== s.display_name) {
                            await updateSession(s.id, { display_name: renameValue.trim() });
                          }
                          setRenamingId(null);
                        }
                        if (e.key === 'Escape') setRenamingId(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="text-sm bg-white dark:bg-surface-900 border border-surface-300 dark:border-surface-600 rounded px-1 py-0.5 flex-1 min-w-0"
                      autoFocus
                      placeholder="Session name..."
                    />
                  ) : (
                    <span className="text-sm truncate flex-1">{s.display_name || `Session ${s.id.slice(0, 8)}`}</span>
                  )}
                  <span className={`text-xs ${s.status === 'connected' ? 'text-green-500' : 'text-surface-400'}`}>
                    {s.status === 'connected' ? 'on' : s.status}
                  </span>
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      const confirmed = await confirmDialog({
                        title: 'Delete session?',
                        itemName: s.display_name || `Session ${s.id.slice(0, 8)}`,
                        message: 'This will kill the tmux session and close its terminal process. This action cannot be undone.',
                        confirmLabel: 'Delete',
                        confirmVariant: 'danger',
                      });
                      if (confirmed) {
                        try {
                          const wId = termKey(s.id);
                          await deleteSession(s.id);
                          removeFromTiling(wId);
                          removeFloating(wId);
                        } catch (err) {
                          console.error('Failed to delete session:', err);
                        }
                      }
                    }}
                    className="opacity-100 md:opacity-0 md:group-hover:opacity-100 p-1.5 md:p-0.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-surface-400 hover:text-red-500"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <ResizeDivider onDrag={(dy) => handleDividerDrag(1, dy)} />

        {/* Section 3: Notes */}
        <div
          className="overflow-y-auto border-t border-surface-200 dark:border-surface-700"
          style={{ height: containerHeight > 0 ? containerHeight * sidebarSectionRatios[2] : 'auto' }}
        >
          <NotesSidebarSection />
        </div>
      </div>
    </div>
    {/* Hide width resize handle on mobile — sidebar is full-width drawer */}
    <div className="hidden md:block">
      <SidebarWidthHandle onDrag={handleWidthDrag} />
    </div>
    </div>
  );
}
