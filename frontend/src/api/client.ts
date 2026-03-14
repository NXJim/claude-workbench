/**
 * REST client helpers.
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
}

export interface ProjectData {
  name: string;
  path: string;
  type: string;
  session_count: number;
  has_claude_md: boolean;
  git_info: { branch: string | null; dirty: boolean; last_commit_msg: string | null } | null;
  display_name: string | null;
}

export interface ProjectCreateData {
  name: string;
  type: string;
  description?: string;
  tech_stack?: string;
  backend_port?: number | null;
  frontend_port?: number | null;
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
  is_default: boolean;
}

export interface ActiveLayoutData {
  tiling_json: string | null;
  floating_json: string | null;
  sidebar_collapsed: boolean;
  sidebar_width: number;
  sidebar_section_ratios: [number, number, number] | null;
}

export const api = {
  // Sessions
  listSessions: () => request<SessionData[]>('/sessions'),
  createSession: (data: { project_path?: string; display_name?: string; color?: string }) =>
    request<SessionData>('/sessions', { method: 'POST', body: JSON.stringify(data) }),
  updateSession: (id: string, data: { display_name?: string; color?: string; notes?: string }) =>
    request<SessionData>(`/sessions/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteSession: (id: string) =>
    request<{ status: string }>(`/sessions/${id}`, { method: 'DELETE' }),
  updateNotes: (id: string, notes: string) =>
    request<SessionData>(`/sessions/${id}/notes`, { method: 'PUT', body: JSON.stringify({ notes }) }),

  // Projects
  listProjects: () => request<ProjectData[]>('/projects'),
  createProject: (data: ProjectCreateData) =>
    request<{ path: string; name: string; display_name: string; type: string; created_files: string[] }>(
      '/projects', { method: 'POST', body: JSON.stringify(data) }
    ),

  // Layouts
  listLayoutPresets: () => request<LayoutPresetData[]>('/layouts'),
  createLayoutPreset: (data: { name: string; layout_json: string }) =>
    request<LayoutPresetData>('/layouts', { method: 'POST', body: JSON.stringify(data) }),
  deleteLayoutPreset: (id: number) =>
    request<{ status: string }>(`/layouts/${id}`, { method: 'DELETE' }),
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
