/**
 * Project dashboard — grid of project status cards.
 * Uses existing project and session data, no new backend needed.
 */

import { useProjectStore } from '@/stores/projectStore';
import { useSessionStore } from '@/stores/sessionStore';
import type { ProjectData } from '@/api/client';

export function ProjectDashboard() {
  const projects = useProjectStore((s) => s.projects);
  const sessions = useSessionStore((s) => s.sessions);
  const loading = useProjectStore((s) => s.loading);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-surface-400 text-sm">
        Loading projects...
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {projects.map((p) => (
          <ProjectDashboardCard
            key={p.path}
            project={p}
            activeSessions={sessions.filter(s => s.project_path === p.path && s.is_alive).length}
          />
        ))}
      </div>
    </div>
  );
}

function ProjectDashboardCard({ project, activeSessions }: { project: ProjectData; activeSessions: number }) {
  return (
    <div className="rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 p-3 hover:border-surface-300 dark:hover:border-surface-600 transition-colors">
      {/* Header */}
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium truncate flex-1">{project.display_name || project.name}</h3>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-100 dark:bg-surface-700 text-surface-500">
          {project.type}
        </span>
      </div>

      {/* Status details */}
      <div className="mt-2 space-y-1">
        {/* Git info */}
        {project.git_info && (
          <div className="flex items-center gap-2 text-xs text-surface-500">
            <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <span className="truncate">{project.git_info.branch}</span>
            {project.git_info.dirty && (
              <span className="text-yellow-500 flex-shrink-0" title="Uncommitted changes">*</span>
            )}
          </div>
        )}

        {/* Sessions */}
        <div className="flex items-center gap-2 text-xs text-surface-500">
          <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <span>{activeSessions} active session{activeSessions !== 1 ? 's' : ''}</span>
        </div>

        {/* Indicators */}
        <div className="flex gap-1 mt-1">
          {project.has_claude_md && (
            <span className="text-[10px] px-1 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400">CLAUDE.md</span>
          )}
        </div>
      </div>
    </div>
  );
}
