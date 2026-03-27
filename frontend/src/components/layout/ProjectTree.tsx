/**
 * Project tree with type grouping, session launch, move-to-category context menu,
 * and project note management (create, rename, move, delete).
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useProjectStore } from '@/stores/projectStore';
import { useSessionStore, SESSION_COLORS } from '@/stores/sessionStore';
import { useLayoutStore } from '@/stores/layoutStore';
import { useClaudeMdStore } from '@/stores/claudeMdStore';
import { windowKey } from '@/types/windows';
import { ProjectMdFileContextMenu } from './ProjectMdFileContextMenu';
import type { ProjectData, ProjectCategory } from '@/api/client';

/* ------------------------------------------------------------------ */
/*  Context menu for project items (right-click → Move, New note)      */
/* ------------------------------------------------------------------ */

function ProjectContextMenu({
  project,
  position,
  categories,
  onClose,
  onNewNote,
}: {
  project: ProjectData;
  position: { x: number; y: number };
  categories: ProjectCategory[];
  onClose: () => void;
  /** Called when user picks "New note" — triggers inline title input in the parent. */
  onNewNote: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [submenuOpen, setSubmenuOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const moveProject = useProjectStore((s) => s.moveProject);

  // Other categories (exclude current)
  const otherCategories = categories.filter((c) => c.name !== project.type);
  const hasActiveSessions = project.session_count > 0;

  // Clamp position so menu doesn't go off-screen
  const [adjustedPos, setAdjustedPos] = useState(position);
  useEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const x = Math.min(position.x, window.innerWidth - rect.width - 8);
    const y = Math.min(position.y, window.innerHeight - rect.height - 8);
    setAdjustedPos({ x: Math.max(4, x), y: Math.max(4, y) });
  }, [position]);

  // Close on outside click or Escape
  const handleOutsideClick = useCallback(
    (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener('mousedown', handleOutsideClick);
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [handleOutsideClick, onClose]);

  const menuItemClass =
    'w-full text-left px-3 py-1.5 text-sm hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors text-surface-800 dark:text-surface-200';
  const disabledClass =
    'w-full text-left px-3 py-1.5 text-sm text-surface-400 dark:text-surface-500 cursor-not-allowed';

  const handleMove = async (targetCategory: string) => {
    setMoving(true);
    try {
      await moveProject(project.path, targetCategory);
    } catch (e) {
      console.error('Failed to move project:', e);
    } finally {
      setMoving(false);
      onClose();
    }
  };

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[9999] min-w-[180px] bg-surface-50 dark:bg-surface-800 border border-surface-300 dark:border-surface-700 rounded-lg shadow-xl py-1"
      style={{ left: adjustedPos.x, top: adjustedPos.y }}
    >
      {/* New note */}
      <button
        className={menuItemClass}
        onClick={() => { onNewNote(); onClose(); }}
      >
        New note
      </button>

      {/* Move to category submenu */}
      {otherCategories.length > 0 && (
        <div
          className="relative"
          onMouseEnter={() => !hasActiveSessions && setSubmenuOpen(true)}
          onMouseLeave={() => setSubmenuOpen(false)}
        >
          <button
            className={hasActiveSessions ? disabledClass : `${menuItemClass} flex items-center justify-between`}
            onClick={() => !hasActiveSessions && setSubmenuOpen((v) => !v)}
            title={hasActiveSessions ? `Cannot move: ${project.session_count} active session(s)` : undefined}
          >
            <span>{moving ? 'Moving...' : 'Move to'}</span>
            {!hasActiveSessions && (
              <svg className="w-3.5 h-3.5 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            )}
            {hasActiveSessions && (
              <span className="text-xs text-surface-400">(active sessions)</span>
            )}
          </button>

          {submenuOpen && !hasActiveSessions && (
            <div className="absolute left-full top-0 ml-0.5 min-w-[160px] bg-surface-50 dark:bg-surface-800 border border-surface-300 dark:border-surface-700 rounded-lg shadow-xl py-1">
              {otherCategories.map((cat) => (
                <button
                  key={cat.name}
                  className={menuItemClass}
                  onClick={() => handleMove(cat.name)}
                >
                  <span className="mr-2">{cat.emoji}</span>
                  {cat.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ */
/*  Individual project row                                            */
/* ------------------------------------------------------------------ */

function ProjectNode({
  project,
  groupType,
  isExpanded,
  onToggleExpand,
  onContextMenu,
  /** If set, show an inline title input for creating a new note in this project. */
  creatingNote,
  onCreateNoteSubmit,
  onCreateNoteCancel,
  /** Inline rename state for .md files */
  renamingFile,
  renameValue,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
  /** Context menu for .md files */
  onMdFileContextMenu,
}: {
  project: ProjectData;
  groupType: string;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onContextMenu: (e: React.MouseEvent, project: ProjectData) => void;
  creatingNote: boolean;
  onCreateNoteSubmit: (title: string) => void;
  onCreateNoteCancel: () => void;
  renamingFile: string | null;
  renameValue: string;
  onRenameChange: (value: string) => void;
  onRenameSubmit: (file: string) => void;
  onRenameCancel: () => void;
  onMdFileContextMenu: (e: React.MouseEvent, project: ProjectData, file: string) => void;
}) {
  const allSessions = useSessionStore((s) => s.sessions);
  const createSession = useSessionStore((s) => s.createSession);
  const popOut = useLayoutStore((s) => s.popOut);
  const openFile = useClaudeMdStore((s) => s.openFile);
  const sessionCount = allSessions.filter(
    (sess) => sess.project_path === project.path && sess.is_alive
  ).length;
  const [newNoteTitle, setNewNoteTitle] = useState('');

  const hasMdFiles = project.md_files && project.md_files.length > 0;

  /** Row click: expand/collapse .md file list (or no-op if no files) */
  const handleRowClick = () => {
    if (hasMdFiles) onToggleExpand();
  };

  /** Always creates a new session (play icon) */
  const handleNewSession = async () => {
    const color = SESSION_COLORS[useSessionStore.getState().sessions.length % SESSION_COLORS.length];
    const session = await createSession(project.path, project.name, color);
    const wId = windowKey({ type: 'terminal', sessionId: session.id });
    popOut(wId, { type: 'terminal', sessionId: session.id });
  };

  /** Get the web URL for a project (frontend port preferred, fallback to backend) */
  const webPort = project.dev_ports?.frontend || project.dev_ports?.backend;
  const webUrl = webPort ? `${window.location.protocol}//${window.location.hostname}:${webPort}` : null;

  /** Open the project's dev site in a new tab */
  const handleOpenSite = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (webUrl) window.open(webUrl, '_blank');
  };

  /** Toggle expand to show .md files */
  const handleToggleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleExpand();
  };

  /** Open a .md file in the editor */
  const handleOpenMdFile = (relativePath: string) => {
    openFile(`${project.path}/${relativePath}`);
  };

  /** Check if a file is in the notes/ subfolder (eligible for context menu) */
  const isNoteFile = (file: string) => file.startsWith('notes/');

  return (
    <div>
      <div className="group">
        <button
          onClick={handleRowClick}
          onContextMenu={(e) => onContextMenu(e, project)}
          className="w-full text-left px-3 py-1.5 text-sm hover:bg-surface-100 dark:hover:bg-surface-800 flex items-center gap-2 rounded-md transition-colors"
          title={project.path}
        >
          {/* Expand chevron for projects with .md files */}
          {hasMdFiles || creatingNote ? (
            <span
              onClick={handleToggleExpand}
              className="flex-shrink-0 p-0.5 -ml-0.5 text-surface-400 hover:text-surface-600 dark:hover:text-surface-300"
              title={isExpanded ? 'Collapse files' : 'Expand files'}
            >
              <svg
                className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </span>
          ) : (
            <span className="w-3 flex-shrink-0" />
          )}
          <span className="text-xs opacity-50">{project.has_claude_md ? '\u{1F4CB}' : '\u{1F4C1}'}</span>
          <span className="truncate flex-1">{project.name}</span>
          {sessionCount > 0 && (
            <span className="text-xs px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400">
              {sessionCount}
            </span>
          )}
          {/* Open site link — any project with a known dev port */}
          {webUrl && (
            <span
              onClick={handleOpenSite}
              className="opacity-0 group-hover:opacity-100 p-0.5 text-blue-500 hover:text-blue-400"
              title={`Open site (port ${webPort})`}
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
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

      {/* Expanded .md file list + inline note creation form */}
      {(isExpanded || creatingNote) && (
        <div className="pl-8 py-0.5">
          {/* Inline note creation form */}
          {creatingNote && (
            <div className="px-2 py-1">
              <input
                value={newNoteTitle}
                onChange={(e) => setNewNoteTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newNoteTitle.trim()) {
                    onCreateNoteSubmit(newNoteTitle.trim());
                    setNewNoteTitle('');
                  }
                  if (e.key === 'Escape') {
                    setNewNoteTitle('');
                    onCreateNoteCancel();
                  }
                }}
                placeholder="Note title..."
                className="w-full text-xs bg-white dark:bg-surface-900 border border-surface-300 dark:border-surface-600 rounded px-2 py-1 focus:outline-none focus:border-blue-500"
                autoFocus
              />
            </div>
          )}
          {/* .md file items */}
          {hasMdFiles && project.md_files.map((file) => {
            const fileName = file.split('/').pop() || file;
            const isRenaming = renamingFile === file;

            return (
              <div key={file} className="group/file">
                {isRenaming ? (
                  // Inline rename input
                  <div className="px-2 py-1">
                    <input
                      value={renameValue}
                      onChange={(e) => onRenameChange(e.target.value)}
                      onBlur={() => onRenameSubmit(file)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') onRenameSubmit(file);
                        if (e.key === 'Escape') onRenameCancel();
                      }}
                      className="w-full text-xs font-mono bg-white dark:bg-surface-900 border border-surface-300 dark:border-surface-600 rounded px-2 py-1 focus:outline-none focus:border-blue-500"
                      autoFocus
                    />
                  </div>
                ) : (
                  <button
                    onClick={() => handleOpenMdFile(file)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onMdFileContextMenu(e, project, file);
                    }}
                    className="w-full text-left px-2 py-1 text-xs hover:bg-surface-100 dark:hover:bg-surface-800 flex items-center gap-1.5 rounded transition-colors text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-300"
                    title={`Open ${file} (right-click for options)`}
                  >
                    <svg className="w-3 h-3 flex-shrink-0 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <span className="truncate font-mono">{file}</span>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Project tree with category grouping                               */
/* ------------------------------------------------------------------ */

export function ProjectTree() {
  const projects = useProjectStore((s) => s.projects);
  const categories = useProjectStore((s) => s.categories);
  const loading = useProjectStore((s) => s.loading);
  const expandedTypes = useProjectStore((s) => s.expandedTypes);
  const toggleType = useProjectStore((s) => s.toggleType);
  const createProjectNote = useProjectStore((s) => s.createProjectNote);
  const renameProjectFile = useProjectStore((s) => s.renameProjectFile);

  // Per-project expand/collapse for .md file tree
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const toggleProject = useCallback((path: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  // Project context menu state
  const [contextMenu, setContextMenu] = useState<{
    project: ProjectData;
    x: number;
    y: number;
  } | null>(null);

  // .md file context menu state
  const [mdFileContextMenu, setMdFileContextMenu] = useState<{
    filePath: string;
    fileName: string;
    projectPath: string;
    x: number;
    y: number;
  } | null>(null);

  // Inline note creation: which project is creating a note
  const [creatingNoteProject, setCreatingNoteProject] = useState<string | null>(null);

  // Inline rename for .md files: { projectPath, relativePath }
  const [renamingState, setRenamingState] = useState<{ projectPath: string; file: string } | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const handleContextMenu = (e: React.MouseEvent, project: ProjectData) => {
    e.preventDefault();
    setContextMenu({ project, x: e.clientX, y: e.clientY });
  };

  const handleMdFileContextMenu = (e: React.MouseEvent, project: ProjectData, file: string) => {
    const fileName = file.split('/').pop() || file;
    setMdFileContextMenu({
      filePath: `${project.path}/${file}`,
      fileName,
      projectPath: project.path,
      x: e.clientX,
      y: e.clientY,
    });
  };

  const handleNewNote = (projectPath: string) => {
    // Auto-expand the project tree to show the creation form
    setExpandedProjects((prev) => new Set(prev).add(projectPath));
    setCreatingNoteProject(projectPath);
  };

  const handleCreateNoteSubmit = async (projectPath: string, title: string) => {
    await createProjectNote(projectPath, title);
    setCreatingNoteProject(null);
  };

  const handleStartRename = (projectPath: string, file: string) => {
    const fileName = file.split('/').pop() || file;
    setRenamingState({ projectPath, file });
    setRenameValue(fileName.replace(/\.md$/, ''));
  };

  const handleRenameSubmit = async (projectPath: string, file: string) => {
    if (renameValue.trim()) {
      const filePath = `${projectPath}/${file}`;
      await renameProjectFile(filePath, renameValue.trim());
    }
    setRenamingState(null);
  };

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
                <ProjectNode
                  key={p.path}
                  project={p}
                  groupType={type}
                  isExpanded={expandedProjects.has(p.path)}
                  onToggleExpand={() => toggleProject(p.path)}
                  onContextMenu={handleContextMenu}
                  creatingNote={creatingNoteProject === p.path}
                  onCreateNoteSubmit={(title) => handleCreateNoteSubmit(p.path, title)}
                  onCreateNoteCancel={() => setCreatingNoteProject(null)}
                  renamingFile={renamingState?.projectPath === p.path ? renamingState.file : null}
                  renameValue={renameValue}
                  onRenameChange={setRenameValue}
                  onRenameSubmit={(file) => handleRenameSubmit(p.path, file)}
                  onRenameCancel={() => setRenamingState(null)}
                  onMdFileContextMenu={handleMdFileContextMenu}
                />
              ))}
            </div>
          )}
        </div>
      ))}

      {/* Project context menu */}
      {contextMenu && (
        <ProjectContextMenu
          project={contextMenu.project}
          position={{ x: contextMenu.x, y: contextMenu.y }}
          categories={categories}
          onClose={() => setContextMenu(null)}
          onNewNote={() => handleNewNote(contextMenu.project.path)}
        />
      )}

      {/* .md file context menu — all files get "Open in new tab", notes/ files get full options */}
      {mdFileContextMenu && (
        <ProjectMdFileContextMenu
          filePath={mdFileContextMenu.filePath}
          fileName={mdFileContextMenu.fileName}
          projectPath={mdFileContextMenu.projectPath}
          position={{ x: mdFileContextMenu.x, y: mdFileContextMenu.y }}
          onClose={() => setMdFileContextMenu(null)}
          isNote={mdFileContextMenu.fileName.startsWith('notes/') || mdFileContextMenu.filePath.includes('/notes/')}
          onRename={() => {
            // Find the relative file path from the full path
            const project = projects.find((p) => p.path === mdFileContextMenu.projectPath);
            const relFile = project?.md_files.find((f) =>
              `${mdFileContextMenu.projectPath}/${f}` === mdFileContextMenu.filePath
            );
            if (relFile) handleStartRename(mdFileContextMenu.projectPath, relFile);
          }}
        />
      )}
    </div>
  );
}
