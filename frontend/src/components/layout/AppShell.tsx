/**
 * Main application shell — header + sidebar + workspace.
 */

import { useState, useEffect, useRef } from 'react';
import { useSessionStore } from '@/stores/sessionStore';
import { useProjectStore } from '@/stores/projectStore';
import { useLayoutStore } from '@/stores/layoutStore';
import { useNotificationStore } from '@/stores/notificationStore';
import { useConfigStore } from '@/stores/configStore';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useNotifications } from '@/hooks/useNotifications';
import { useIsMobile } from '@/hooks/useIsMobile';
import { Sidebar } from './Sidebar';
import { TilingWorkspace } from '@/components/workspace/TilingWorkspace';
import { MobileSessionCards } from '@/components/workspace/MobileSessionCards';
import { FloatingWindowManager } from '@/components/workspace/FloatingWindowManager';
import { DockZoneOverlay } from '@/components/workspace/DockZoneOverlay';
import { ToastContainer } from '@/components/notifications/ToastContainer';
import { CommandPalette } from '@/components/command-palette/CommandPalette';
import { ScrollbackSearch } from '@/components/search/ScrollbackSearch';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { LayoutPresetBar } from './LayoutPresetBar';
import { WorkspaceTabBar } from './WorkspaceTabBar';
import { SystemPanel } from './SystemPanel';

export function AppShell() {
  const fetchSessions = useSessionStore((s) => s.fetchSessions);
  const fetchProjects = useProjectStore((s) => s.fetchProjects);
  const fetchPresets = useLayoutStore((s) => s.fetchPresets);
  const restoreLayout = useLayoutStore((s) => s.restoreLayout);
  const enableBrowserNotifications = useNotificationStore((s) => s.enableBrowserNotifications);
  const sidebarPinned = useLayoutStore((s) => s.sidebarPinned);
  const toggleSidebarPin = useLayoutStore((s) => s.toggleSidebarPin);
  const openWindow = useLayoutStore((s) => s.openWindow);
  const fetchConfig = useConfigStore((s) => s.fetch);
  const isMobile = useIsMobile();

  // Register global keyboard shortcuts and SSE notifications
  useKeyboardShortcuts();
  useNotifications();

  // Initial data fetch — presets must load before restoreLayout
  // so workspace preset data is available for layout restore
  useEffect(() => {
    // 1. Fetch presets first (needed to find workspace layout data)
    // 2. Then restore layout (loads active workspace, fetches its sessions)
    fetchPresets().then(() => restoreLayout());
    fetchProjects();
    enableBrowserNotifications();
    fetchConfig();

    // Periodic refresh of sessions scoped to active workspace
    const interval = setInterval(() => {
      const wsId = useLayoutStore.getState().activeWorkspaceId;
      fetchSessions(wsId ?? undefined);
    }, 10000);

    return () => clearInterval(interval);
  }, []);

  // Auto-collapse sidebar on small screens
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const handler = (e: MediaQueryListEvent | MediaQueryList) => {
      if (e.matches && useLayoutStore.getState().sidebarPinned) {
        useLayoutStore.getState().setSidebarPinned(false);
      }
    };
    // Check on mount
    handler(mq);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Auto-save layout on changes (debounced) — subscribe to layout store outside render
  useEffect(() => {
    const unsub = useLayoutStore.subscribe(() => {
      clearTimeout((window as any).__cwbSaveTimer);
      (window as any).__cwbSaveTimer = setTimeout(() => useLayoutStore.getState().saveLayout(), 2000);
    });
    return () => {
      unsub();
      clearTimeout((window as any).__cwbSaveTimer);
    };
  }, []);

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden">
      {/* Header */}
      <header className="relative z-[300] h-12 flex-shrink-0 flex items-center justify-between px-2 sm:px-4 border-b border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900">
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Mobile sidebar toggle */}
          <button
            onClick={toggleSidebarPin}
            className="p-2 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 md:hidden"
            aria-label="Toggle sidebar"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <h1 className="text-sm font-bold tracking-tight">
            <span className="text-blue-600 dark:text-blue-400">Claude</span>{' '}
            <span className="text-surface-700 dark:text-surface-300 hidden sm:inline">Workbench</span>
          </h1>
        </div>

        {/* Spacer pushes everything after it to the right */}
        <div className="flex-1" />

        {/* Right: workspace tabs + layout presets + action buttons */}
        <div className="flex items-center gap-1 sm:gap-2 min-w-0">
          <WorkspaceTabBar />
          <LayoutPresetBar />

          {/* Desktop-only toolbar buttons */}
          <div className="hidden md:flex items-center gap-1">
            {/* Divider between layout area and tool buttons */}
            <div className="w-px h-5 bg-surface-200 dark:bg-surface-700 mx-1" />
            {/* Global CLAUDE.md */}
            <button
              onClick={() => {
                import('@/stores/claudeMdStore').then(({ useClaudeMdStore }) => {
                  const path = useConfigStore.getState().globalClaudeMdPath;
                  useClaudeMdStore.getState().openFile(path);
                });
              }}
              className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 text-surface-500 hover:text-amber-500 transition-colors"
              title="Edit Global CLAUDE.md"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </button>

            {/* Snippets KB */}
            <button
              onClick={() => openWindow({ type: 'snippet', snippetId: '__browser__' })}
              className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 text-surface-500 hover:text-violet-500 transition-colors"
              title="Code Snippets"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
              </svg>
            </button>

            {/* Clipboard */}
            <button
              onClick={() => openWindow({ type: 'clipboard' })}
              className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 text-surface-500 hover:text-cyan-500 transition-colors"
              title="Shared Clipboard"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </button>

            {/* Dashboard */}
            <button
              onClick={() => openWindow({ type: 'dashboard' })}
              className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 text-surface-500 hover:text-pink-500 transition-colors"
              title="Project Dashboard"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
              </svg>
            </button>

          </div>

          <SystemPanel />

          <SearchTrigger />

          {/* Mobile overflow menu — shows tools hidden on small screens */}
          <OverflowMenu openWindow={openWindow} />

          <ThemeToggle />
        </div>
      </header>

      {/* Main content */}
      <div className="flex flex-1 min-h-0 relative">
        {/* Mobile sidebar overlay backdrop — shown when sidebar is open (pinned=true on mobile) */}
        {sidebarPinned && (
          <div
            className="fixed inset-0 bg-black/30 z-[320] md:hidden"
            onClick={toggleSidebarPin}
          />
        )}
        <div className={`${sidebarPinned ? 'fixed inset-y-12 left-0 z-[350] md:relative md:inset-auto md:z-auto' : ''}`}>
          <Sidebar />
        </div>
        <main data-workspace-main className="flex-1 min-w-0 relative bg-surface-100 dark:bg-surface-950">
          {isMobile ? <MobileSessionCards /> : <TilingWorkspace />}
          <DockZoneOverlay />
          <FloatingWindowManager />
        </main>
      </div>

      {/* Overlays */}
      <ToastContainer />
      <CommandPalette />
      <ScrollbackSearch />
    </div>
  );
}

/** Mobile overflow menu — groups secondary toolbar actions behind "..." button. */
function OverflowMenu({ openWindow }: { openWindow: (desc: any) => void }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const items = [
    {
      label: 'CLAUDE.md',
      color: 'text-amber-500',
      icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
      action: () => {
        import('@/stores/claudeMdStore').then(({ useClaudeMdStore }) => {
          const path = useConfigStore.getState().globalClaudeMdPath;
          useClaudeMdStore.getState().openFile(path);
        });
      },
    },
    {
      label: 'Snippets',
      color: 'text-violet-500',
      icon: 'M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4',
      action: () => openWindow({ type: 'snippet', snippetId: '__browser__' }),
    },
    {
      label: 'Clipboard',
      color: 'text-cyan-500',
      icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
      action: () => openWindow({ type: 'clipboard' }),
    },
    {
      label: 'Dashboard',
      color: 'text-pink-500',
      icon: 'M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z',
      action: () => openWindow({ type: 'dashboard' }),
    },
  ];

  return (
    <div ref={menuRef} className="relative md:hidden">
      <button
        onClick={() => setOpen(!open)}
        className="p-2 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 text-surface-500 transition-colors"
        aria-label="More tools"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v.01M12 12v.01M12 19v.01" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-lg shadow-lg py-1 min-w-48">
          {items.map((item) => (
            <button
              key={item.label}
              onClick={() => { item.action(); setOpen(false); }}
              className="flex items-center gap-3 w-full text-left px-4 py-2.5 text-sm hover:bg-surface-100 dark:hover:bg-surface-700 text-surface-700 dark:text-surface-300 transition-colors"
            >
              <svg className={`w-4 h-4 ${item.color} flex-shrink-0`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
              </svg>
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Search button in header — opens scrollback search. */
function SearchTrigger() {
  return (
    <button
      onClick={() => {
        window.dispatchEvent(new CustomEvent('open-search'));
      }}
      className="flex items-center gap-2 px-2 sm:px-3 py-1.5 text-sm text-surface-400 bg-surface-100 dark:bg-surface-800 rounded-lg hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors min-h-[44px] sm:min-h-0"
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <span className="hidden sm:inline">Search</span>
      <kbd className="hidden md:inline text-xs px-1.5 py-0.5 bg-surface-200 dark:bg-surface-700 rounded">Ctrl+F</kbd>
    </button>
  );
}
