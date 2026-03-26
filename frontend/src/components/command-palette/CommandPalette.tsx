/**
 * Command palette (Ctrl+K) — fuzzy search over actions.
 */

import { useEffect, useRef, useState, useMemo } from 'react';
import { useCommandPaletteStore, type PaletteCommand } from '@/stores/commandPaletteStore';
import { useSessionStore, SESSION_COLORS } from '@/stores/sessionStore';
import { useLayoutStore } from '@/stores/layoutStore';
import { useProjectStore } from '@/stores/projectStore';
import { useClaudeMdStore } from '@/stores/claudeMdStore';
import { useConfigStore } from '@/stores/configStore';
import { windowKey } from '@/types/windows';

export function CommandPalette() {
  const isOpen = useCommandPaletteStore((s) => s.isOpen);
  const query = useCommandPaletteStore((s) => s.query);
  const close = useCommandPaletteStore((s) => s.close);
  const setQuery = useCommandPaletteStore((s) => s.setQuery);
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);

  // Build commands from current state when palette is open
  const commands = useMemo<PaletteCommand[]>(() => {
    if (!isOpen) return [];

    const currentSessions = useSessionStore.getState().sessions;
    const currentProjects = useProjectStore.getState().projects;
    const currentPresets = useLayoutStore.getState().presets;
    const result: PaletteCommand[] = [];

    // Session commands
    currentSessions.filter((s) => s.is_alive).forEach((s) => {
      result.push({
        id: `switch-${s.id}`,
        label: `Switch to: ${s.display_name}`,
        category: 'Sessions',
        action: () => {
          const wId = windowKey({ type: 'terminal', sessionId: s.id });
          useLayoutStore.getState().popOut(wId, { type: 'terminal', sessionId: s.id });
          close();
        },
      });
    });

    // Project launch commands
    currentProjects.forEach((p) => {
      result.push({
        id: `launch-${p.path}`,
        label: `New session: ${p.name}`,
        category: 'Projects',
        action: async () => {
          const color = SESSION_COLORS[currentSessions.length % SESSION_COLORS.length];
          const session = await useSessionStore.getState().createSession(p.path, p.name, color);
          const wId = windowKey({ type: 'terminal', sessionId: session.id });
          useLayoutStore.getState().popOut(wId, { type: 'terminal', sessionId: session.id });
          close();
        },
      });
    });

    // Layout presets
    currentPresets.forEach((p) => {
      result.push({
        id: `layout-${p.id}`,
        label: `Layout: ${p.name}`,
        category: 'Layouts',
        action: () => {
          useLayoutStore.getState().loadPreset(p.layout_json);
          close();
        },
      });
    });

    // Generic commands
    result.push({
      id: 'toggle-sidebar',
      label: 'Pin/Unpin Sidebar',
      category: 'View',
      shortcut: 'Ctrl+B',
      action: () => { useLayoutStore.getState().toggleSidebarPin(); close(); },
    });

    result.push({
      id: 'search-scrollback',
      label: 'Search Scrollback',
      category: 'Search',
      action: () => {
        close();
        window.dispatchEvent(new CustomEvent('open-search'));
      },
    });

    // Tool commands
    result.push({
      id: 'open-snippets',
      label: 'Open Snippet Browser',
      category: 'Tools',
      action: () => {
        useLayoutStore.getState().openWindow({ type: 'snippet', snippetId: '__browser__' });
        close();
      },
    });

    result.push({
      id: 'open-clipboard',
      label: 'Open Shared Clipboard',
      category: 'Tools',
      action: () => {
        useLayoutStore.getState().openWindow({ type: 'clipboard' });
        close();
      },
    });

    result.push({
      id: 'open-dashboard',
      label: 'Open Project Dashboard',
      category: 'View',
      action: () => {
        useLayoutStore.getState().openWindow({ type: 'dashboard' });
        close();
      },
    });

    // CLAUDE.md commands
    result.push({
      id: 'edit-global-claude-md',
      label: 'Edit Global CLAUDE.md',
      category: 'CLAUDE.md',
      action: () => {
        const path = useConfigStore.getState().globalClaudeMdPath;
        if (path) {
          useClaudeMdStore.getState().openFile(path);
        }
        close();
      },
    });

    // Per-project CLAUDE.md commands
    currentProjects.filter(p => p.has_claude_md).forEach((p) => {
      result.push({
        id: `edit-claude-md-${p.path}`,
        label: `Edit CLAUDE.md: ${p.name}`,
        category: 'CLAUDE.md',
        action: () => {
          useClaudeMdStore.getState().openFile(`${p.path}/CLAUDE.md`);
          close();
        },
      });
    });

    return result;
  }, [isOpen, close]);

  // Filter commands based on query
  const filtered = useMemo(() => {
    if (!query.trim()) return commands;
    const q = query.toLowerCase();
    return commands.filter(
      (cmd) =>
        cmd.label.toLowerCase().includes(q) ||
        cmd.category.toLowerCase().includes(q)
    );
  }, [commands, query]);

  // Focus input on open
  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
      setSelectedIdx(0);
    }
  }, [isOpen]);

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  if (!isOpen) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[selectedIdx]) {
        filtered[selectedIdx].action();
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 command-palette-overlay bg-black/30 flex items-start justify-center pt-[5vh] sm:pt-[15vh]"
      onClick={close}
    >
      <div
        className="w-full max-w-lg mx-2 sm:mx-auto bg-white dark:bg-surface-800 rounded-xl shadow-2xl border border-surface-200 dark:border-surface-700 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-surface-200 dark:border-surface-700">
          <svg className="w-5 h-5 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command..."
            className="flex-1 bg-transparent outline-none text-sm"
          />
          <kbd className="text-xs px-1.5 py-0.5 bg-surface-100 dark:bg-surface-700 rounded text-surface-400">ESC</kbd>
        </div>

        {/* Results */}
        <div className="max-h-72 overflow-y-auto py-2">
          {filtered.length === 0 ? (
            <p className="px-4 py-6 text-sm text-surface-400 text-center">No matching commands</p>
          ) : (
            filtered.map((cmd, i) => (
              <button
                key={cmd.id}
                onClick={cmd.action}
                className={`w-full text-left px-4 py-2 text-sm flex items-center justify-between transition-colors ${
                  i === selectedIdx
                    ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                    : 'hover:bg-surface-50 dark:hover:bg-surface-700'
                }`}
              >
                <div>
                  <span>{cmd.label}</span>
                  <span className="ml-2 text-xs text-surface-400">{cmd.category}</span>
                </div>
                {cmd.shortcut && (
                  <kbd className="text-xs px-1.5 py-0.5 bg-surface-100 dark:bg-surface-700 rounded">{cmd.shortcut}</kbd>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
