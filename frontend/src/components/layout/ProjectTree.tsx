/**
 * Project tree with type grouping and session launch.
 */

import { useProjectStore } from '@/stores/projectStore';
import { useSessionStore, SESSION_COLORS } from '@/stores/sessionStore';
import { useLayoutStore } from '@/stores/layoutStore';
import { useClaudeMdStore } from '@/stores/claudeMdStore';
import { windowKey } from '@/types/windows';
import type { ProjectData } from '@/api/client';

function ProjectNode({ project }: { project: ProjectData }) {
  const allSessions = useSessionStore((s) => s.sessions);
  const createSession = useSessionStore((s) => s.createSession);
  const popOut = useLayoutStore((s) => s.popOut);
  const openFile = useClaudeMdStore((s) => s.openFile);
  const sessionCount = allSessions.filter(
    (sess) => sess.project_path === project.path && sess.is_alive
  ).length;

  /** Row click: focus existing session or create new one */
  const handleFocus = () => {
    const existing = allSessions.find(
      (sess) => sess.project_path === project.path && sess.is_alive
    );
    if (existing) {
      const wId = windowKey({ type: 'terminal', sessionId: existing.id });
      popOut(wId, { type: 'terminal', sessionId: existing.id });
      return;
    }
    handleNewSession();
  };

  /** Always creates a new session (play icon) */
  const handleNewSession = async () => {
    const color = SESSION_COLORS[useSessionStore.getState().sessions.length % SESSION_COLORS.length];
    const session = await createSession(project.path, project.name, color);
    const wId = windowKey({ type: 'terminal', sessionId: session.id });
    popOut(wId, { type: 'terminal', sessionId: session.id });
  };

  /** Open CLAUDE.md editor */
  const handleEditClaudeMd = (e: React.MouseEvent) => {
    e.stopPropagation();
    openFile(`${project.path}/CLAUDE.md`);
  };

  return (
    <div className="group">
      <button
        onClick={handleFocus}
        className="w-full text-left px-3 py-1.5 text-sm hover:bg-surface-100 dark:hover:bg-surface-800 flex items-center gap-2 rounded-md transition-colors"
        title={`Focus session for ${project.path}`}
      >
        <span className="text-xs opacity-50">{project.has_claude_md ? '\u{1F4CB}' : '\u{1F4C1}'}</span>
        <span className="truncate flex-1">{project.name}</span>
        {sessionCount > 0 && (
          <span className="text-xs px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400">
            {sessionCount}
          </span>
        )}
        {/* CLAUDE.md edit icon — visible on hover for projects that have it */}
        {project.has_claude_md && (
          <span
            onClick={handleEditClaudeMd}
            className="opacity-0 group-hover:opacity-100 p-0.5 text-amber-500 hover:text-amber-400"
            title="Edit CLAUDE.md"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          </span>
        )}
        {/* New session button — always creates new session */}
        <span
          onClick={(e) => { e.stopPropagation(); handleNewSession(); }}
          className="opacity-0 group-hover:opacity-100 text-surface-400 hover:text-blue-500 p-0.5"
          title="New session"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
        </span>
      </button>
    </div>
  );
}

export function ProjectTree() {
  const projects = useProjectStore((s) => s.projects);
  const categories = useProjectStore((s) => s.categories);
  const loading = useProjectStore((s) => s.loading);
  const expandedTypes = useProjectStore((s) => s.expandedTypes);
  const toggleType = useProjectStore((s) => s.toggleType);

  // Build icon map from categories, with fallback
  const typeIcons: Record<string, string> = categories.reduce(
    (m, c) => ({ ...m, [c.name]: c.emoji }),
    {} as Record<string, string>,
  );

  if (loading) {
    return (
      <div className="p-4 space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-4 bg-surface-200 dark:bg-surface-700 rounded animate-pulse" />
        ))}
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-surface-400">
        No projects found
      </div>
    );
  }

  // Group by type
  const grouped = projects.reduce<Record<string, ProjectData[]>>((acc, p) => {
    (acc[p.type] = acc[p.type] || []).push(p);
    return acc;
  }, {});

  return (
    <div className="py-2">
      {Object.entries(grouped).map(([type, items]) => (
        <div key={type} className="mb-1">
          <button
            onClick={() => toggleType(type)}
            className="w-full text-left px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-300 flex items-center gap-1"
          >
            <svg
              className={`w-3 h-3 transition-transform ${expandedTypes[type] ? 'rotate-90' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            <span>{typeIcons[type] || '\u{1F4C1}'}</span>
            <span>{type}</span>
            <span className="text-surface-400 font-normal">({items.length})</span>
          </button>
          {expandedTypes[type] && (
            <div className="pl-3">
              {items.map((p) => (
                <ProjectNode key={p.path} project={p} />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
