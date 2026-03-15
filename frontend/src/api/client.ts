/**
 * REST + WebSocket client helpers.
 */

const API_BASE = '/api';

// --- REST helpers ---

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API error ${res.status}: ${err}`);
  }
  return res.json();
}

// --- Session API ---

export interface SessionData {
  id: string;
  tmux_name: string;
  project_path: string | null;
  display_name: string | null;
  color: string;
  status: string;
  notes: string;
  created_at: string;
  last_activity_at: string;
  is_alive: boolean;
  workspace_id: number | null;
}

export interface ProjectData {
  name: string;
  path: string;
  type: string;
  session_count: number;
  has_claude_md: boolean;
  dev_ports: { backend: number | null; frontend: number | null };
  health_endpoint: string | null;
  health_status: { backend: string | null; frontend: string | null } | null;
  git_info: { branch: string | null; dirty: boolean; last_commit_msg: string | null } | null;
  display_name: string | null;
}

export interface BackupData {
  filename: string;
  size: number;
  created_at: string;
}

export interface ProjectCreateData {
  name: string;
  type: string;
  description?: string;
  tech_stack?: string;
  backend_port?: number | null;
  frontend_port?: number | null;
  open_ufw_ports?: boolean;
}

export interface PortEntry {
  project: string;
  project_name: string;
  type: string;
  backend_port: number | null;
  backend_ufw: boolean;
  frontend_port: number | null;
  frontend_ufw: boolean;
}

export interface UfwRule {
  port: number | null;
  port_proto: string;
  protocol: string | null;
  action: string;
  comment: string;
}

export interface PortsOverview {
  project_ports: PortEntry[];
  ufw_rules: UfwRule[];
}

export interface ProjectCategory {
  name: string;
  emoji: string;
  color: string;
}

export interface SettingsData {
  projects_root: string;
  project_categories: ProjectCategory[];
}

export interface LayoutPresetData {
  id: number;
  name: string;
  layout_json: string;
  floating_json: string | null;
  is_default: boolean;
  is_workspace: boolean;
}

export interface ActiveLayoutData {
  tiling_json: string | null;
  floating_json: string | null;
  sidebar_collapsed: boolean;
  sidebar_width: number;
  sidebar_section_ratios: [number, number, number] | null;
  active_workspace_id: number | null;
}

export const api = {
  // Sessions
  listSessions: (workspaceId?: number) =>
    request<SessionData[]>(`/sessions${workspaceId != null ? `?workspace_id=${workspaceId}` : ''}`),
  createSession: (data: { project_path?: string; display_name?: string; color?: string; workspace_id?: number }) =>
    request<SessionData>('/sessions', { method: 'POST', body: JSON.stringify(data) }),
  updateSession: (id: string, data: { display_name?: string; color?: string; notes?: string }) =>
    request<SessionData>(`/sessions/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteSession: (id: string) =>
    request<{ status: string }>(`/sessions/${id}`, { method: 'DELETE' }),
  /** Count alive sessions for a workspace (used by close-tab confirmation). */
  countWorkspaceSessions: (workspaceId: number) =>
    request<SessionData[]>(`/sessions?workspace_id=${workspaceId}`).then(
      (sessions) => sessions.filter((s) => s.is_alive).length
    ),
  updateNotes: (id: string, notes: string) =>
    request<SessionData>(`/sessions/${id}/notes`, { method: 'PUT', body: JSON.stringify({ notes }) }),

  // Projects
  listProjects: () => request<ProjectData[]>('/projects'),
  createProject: (data: ProjectCreateData) =>
    request<{ path: string; name: string; display_name: string; type: string; created_files: string[]; ufw_results: Array<{ port: number; success: boolean; output: string }> }>(
      '/projects', { method: 'POST', body: JSON.stringify(data) }
    ),
  getPortsOverview: () => request<PortsOverview>('/projects/ports'),

  // Layouts
  listLayoutPresets: () => request<LayoutPresetData[]>('/layouts'),
  createLayoutPreset: (data: { name: string; layout_json: string; floating_json?: string | null; is_workspace?: boolean }) =>
    request<LayoutPresetData>('/layouts', { method: 'POST', body: JSON.stringify(data) }),
  updateLayoutPreset: (id: number, data: { name?: string; layout_json?: string; floating_json?: string | null }) =>
    request<LayoutPresetData>(`/layouts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteLayoutPreset: (id: number, terminateSessions?: boolean) =>
    request<{ status: string }>(`/layouts/${id}${terminateSessions ? '?terminate_sessions=true' : ''}`, { method: 'DELETE' }),
  getActiveLayout: () => request<ActiveLayoutData>('/layout/active'),
  saveActiveLayout: (data: Partial<ActiveLayoutData>) =>
    request<ActiveLayoutData>('/layout/active', { method: 'PUT', body: JSON.stringify(data) }),

  // Search
  searchScrollback: (q: string) =>
    request<Array<{
      session_id: string;
      session_name: string | null;
      session_color: string;
      lines: string[];
      captured_at: string;
    }>>(`/search?q=${encodeURIComponent(q)}`),
  // System management
  getSystemStatus: () =>
    request<Record<string, {
      active: string;
      state: string;
      sub_state: string;
      pid: string;
      started_at: string;
      memory: string;
    }>>('/system/status'),
  restartServices: (service?: string) =>
    request<{ status: string; message: string }>(`/system/restart${service ? `?service=${service}` : ''}`, { method: 'POST' }),
  stopServices: (service?: string) =>
    request<{ status: string }>(`/system/stop${service ? `?service=${service}` : ''}`, { method: 'POST' }),
  getServiceLogs: (service: string, lines = 100) =>
    request<{ service: string; lines: string[]; count: number }>(`/system/logs?service=${service}&lines=${lines}`),

  // Health
  getProjectsHealth: () =>
    request<Record<string, { backend: string | null; frontend: string | null }>>('/health/projects'),

  // Terminal (ttyd)
  getTerminalUrl: (sessionId: string) =>
    request<{ port: number; session_id: string }>(`/terminal/url?session_id=${encodeURIComponent(sessionId)}`),
  sendTerminalKeys: (sessionId: string, keys: string) =>
    request<{ success: boolean }>('/terminal/send-keys', {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId, keys }),
    }),
  stopTerminal: (sessionId: string) =>
    request<{ stopped: boolean }>(`/terminal/stop?session_id=${encodeURIComponent(sessionId)}`, { method: 'POST' }),

  // Settings
  getSettings: () => request<SettingsData>('/settings'),
  updateSettings: (data: Partial<SettingsData>) =>
    request<SettingsData>('/settings', { method: 'PUT', body: JSON.stringify(data) }),

  // Backups
  listBackups: () => request<BackupData[]>('/backup'),
  createBackup: (projectName: string) =>
    request<BackupData & { path: string }>(`/backup/${encodeURIComponent(projectName)}`, { method: 'POST' }),
  deleteBackup: (filename: string) =>
    request<{ status: string; filename: string }>(`/backup/${encodeURIComponent(filename)}`, { method: 'DELETE' }),

  // Notes
  listNotes: (scope = 'global', projectPath?: string) => {
    const params = new URLSearchParams({ scope });
    if (projectPath) params.set('path', projectPath);
    return request<Array<{ id: string; title: string; created_at: string; updated_at: string; pinned: boolean }>>(`/notes?${params}`);
  },
  createNote: (data: { title: string; content?: string; scope?: string; project_path?: string }) =>
    request<{ id: string; title: string; created_at: string; updated_at: string; pinned: boolean }>('/notes', { method: 'POST', body: JSON.stringify(data) }),
  getNote: (id: string, scope = 'global', projectPath?: string) => {
    const params = new URLSearchParams({ scope });
    if (projectPath) params.set('path', projectPath);
    return request<{ id: string; title: string; content: string; created_at: string; updated_at: string; pinned: boolean }>(`/notes/${id}?${params}`);
  },
  updateNoteContent: (id: string, content: string, scope = 'global', projectPath?: string) => {
    const params = new URLSearchParams({ scope });
    if (projectPath) params.set('path', projectPath);
    return request<{ id: string; title: string; updated_at: string }>(`/notes/${id}?${params}`, { method: 'PUT', body: JSON.stringify({ content }) });
  },
  updateNoteMetadata: (id: string, data: { title?: string; pinned?: boolean }, scope = 'global', projectPath?: string) => {
    const params = new URLSearchParams({ scope });
    if (projectPath) params.set('path', projectPath);
    return request<{ id: string; title: string; updated_at: string }>(`/notes/${id}?${params}`, { method: 'PATCH', body: JSON.stringify(data) });
  },
  deleteNote: (id: string, scope = 'global', projectPath?: string) => {
    const params = new URLSearchParams({ scope });
    if (projectPath) params.set('path', projectPath);
    return request<{ status: string }>(`/notes/${id}?${params}`, { method: 'DELETE' });
  },

  // CLAUDE.md
  listClaudeMdFiles: () =>
    request<Array<{ path: string; label: string; category: string; project_name: string | null }>>('/claude-md/list'),
  readClaudeMd: (path: string) =>
    request<{ path: string; content: string }>(`/claude-md?path=${encodeURIComponent(path)}`),
  writeClaudeMd: (path: string, content: string) =>
    request<{ path: string; size: number }>('/claude-md', { method: 'PUT', body: JSON.stringify({ path, content }) }),

  // Snippets
  listSnippets: (q?: string, tag?: string, lang?: string) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (tag) params.set('tag', tag);
    if (lang) params.set('lang', lang);
    const qs = params.toString();
    return request<Array<{
      id: string; title: string; description: string; language: string;
      code: string; tags: string; source_project: string | null;
      created_at: string; updated_at: string;
    }>>(`/snippets${qs ? '?' + qs : ''}`);
  },
  createSnippet: (data: { title: string; description?: string; language?: string; code: string; tags?: string; source_project?: string | null }) =>
    request<{ id: string; title: string; description: string; code: string; language: string; tags: string; source_project: string | null; created_at: string; updated_at: string }>('/snippets', { method: 'POST', body: JSON.stringify(data) }),
  updateSnippet: (id: string, data: Record<string, unknown>) =>
    request<{ id: string }>(`/snippets/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteSnippet: (id: string) =>
    request<{ status: string }>(`/snippets/${id}`, { method: 'DELETE' }),
  listSnippetTags: () =>
    request<string[]>('/snippets/tags'),

  // Session Groups
  listSessionGroups: () =>
    request<Array<{ id: string; name: string; project_path: string | null; session_configs: Array<Record<string, unknown>>; created_at: string }>>('/session-groups'),
  createSessionGroup: (data: { name: string; session_configs: Array<Record<string, unknown>>; project_path?: string }) =>
    request<{ id: string; name: string }>('/session-groups', { method: 'POST', body: JSON.stringify(data) }),
  updateSessionGroup: (id: string, data: Record<string, unknown>) =>
    request<{ id: string }>(`/session-groups/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteSessionGroup: (id: string) =>
    request<{ status: string }>(`/session-groups/${id}`, { method: 'DELETE' }),
  launchSessionGroup: (id: string) =>
    request<{ status: string; session_ids: string[] }>(`/session-groups/${id}/launch`, { method: 'POST' }),
  closeSessionGroup: (id: string) =>
    request<{ status: string; session_ids: string[] }>(`/session-groups/${id}/close`, { method: 'POST' }),

  // Clipboard
  getClipboard: () =>
    request<{ content: string }>('/clipboard'),
  setClipboard: (content: string) =>
    request<{ content: string; size: number }>('/clipboard', { method: 'PUT', body: JSON.stringify({ content }) }),
};

