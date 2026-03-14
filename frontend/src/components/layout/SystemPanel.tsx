/**
 * System management panel — services, projects, deploy, backups.
 * Opens from a gear icon in the header.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { api, createDeployWs, type ProjectData, type BackupData, type DeployLogMessage, type PortEntry, type UfwRule, type SettingsData, type ProjectCategory } from '@/api/client';
import { useProjectStore } from '@/stores/projectStore';

interface ServiceStatus {
  active: string;
  state: string;
  sub_state: string;
  pid: string;
  started_at: string;
  memory: string;
}

const SERVICES = [
  {
    id: 'workbench-backend',
    label: 'Backend',
    description: 'FastAPI server that manages tmux sessions, WebSocket connections, and the database. Handles all API requests.',
  },
  {
    id: 'workbench-frontend',
    label: 'Frontend',
    description: 'Vite dev server that serves the React UI. Proxies API and WebSocket requests to the backend.',
  },
] as const;

type ServiceId = typeof SERVICES[number]['id'];
type TabId = 'status' | 'logs' | 'projects' | 'deploy' | 'backups' | 'ports' | 'settings';

// --- Color palette for project category badges ---
// All Tailwind classes written out statically so they aren't purged.
const COLOR_PALETTE: Record<string, { badge: string; label: string; dot: string }> = {
  blue:    { badge: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400', label: 'Blue', dot: 'bg-blue-500' },
  purple:  { badge: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400', label: 'Purple', dot: 'bg-purple-500' },
  amber:   { badge: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400', label: 'Amber', dot: 'bg-amber-500' },
  emerald: { badge: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400', label: 'Emerald', dot: 'bg-emerald-500' },
  red:     { badge: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400', label: 'Red', dot: 'bg-red-500' },
  pink:    { badge: 'bg-pink-100 dark:bg-pink-900/30 text-pink-700 dark:text-pink-400', label: 'Pink', dot: 'bg-pink-500' },
  cyan:    { badge: 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-400', label: 'Cyan', dot: 'bg-cyan-500' },
  orange:  { badge: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400', label: 'Orange', dot: 'bg-orange-500' },
};

/** Get badge classes for a project type by looking up its color from categories. */
function getTypeBadge(type: string, categories: ProjectCategory[]): string {
  const cat = categories.find((c) => c.name === type);
  const colorKey = cat?.color || 'blue';
  return COLOR_PALETTE[colorKey]?.badge || COLOR_PALETTE.blue.badge;
}

// --- Health dot component ---
function HealthDot({ status }: { status: string | null }) {
  if (!status) return <span className="w-2 h-2 rounded-full bg-surface-300 dark:bg-surface-600 inline-block" title="Not configured" />;
  return (
    <span
      className={`w-2 h-2 rounded-full inline-block ${status === 'up' ? 'bg-green-400' : 'bg-red-400'}`}
      title={status === 'up' ? 'Running' : 'Down'}
    />
  );
}

// --- Format helpers ---
function formatMemory(bytes: string) {
  const n = parseInt(bytes, 10);
  if (isNaN(n) || n === 0) return '—';
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatUptime(timestamp: string) {
  if (!timestamp) return '—';
  try {
    const started = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - started.getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ${mins % 60}m`;
    return `${Math.floor(hrs / 24)}d ${hrs % 24}h`;
  } catch {
    return '—';
  }
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatTimestamp(ts: string) {
  try {
    const d = new Date(ts);
    return d.toLocaleString();
  } catch {
    return ts;
  }
}

// --- New Project Form ---
function NewProjectForm({ onCreated }: { onCreated: () => void }) {
  const categories = useProjectStore((s) => s.categories);
  const [isOpen, setIsOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [form, setForm] = useState({
    name: '',
    type: (categories[0]?.name || 'web') as string,
    description: '',
    tech_stack: '',
    backend_port: '' as string,
    frontend_port: '' as string,
    open_ufw_ports: false,
  });

  const handleCreate = async () => {
    if (!form.name.trim()) { setMessage({ text: 'Project name is required', error: true }); return; }
    setCreating(true);
    setMessage(null);
    try {
      const result = await api.createProject({
        name: form.name.trim(),
        type: form.type,
        description: form.description.trim(),
        tech_stack: form.tech_stack.trim(),
        backend_port: form.backend_port ? parseInt(form.backend_port, 10) : null,
        frontend_port: form.frontend_port ? parseInt(form.frontend_port, 10) : null,
        open_ufw_ports: form.open_ufw_ports,
      });
      setMessage({ text: `Created ${result.display_name} at ${result.path}`, error: false });
      setForm({ name: '', type: 'web', description: '', tech_stack: '', backend_port: '', frontend_port: '', open_ufw_ports: false });
      setIsOpen(false);
      onCreated();
    } catch (e) {
      setMessage({ text: (e as Error).message, error: true });
    } finally {
      setCreating(false);
    }
  };

  if (!isOpen) {
    return (
      <div className="space-y-1">
        <button
          onClick={() => setIsOpen(true)}
          className="text-xs px-3 py-1.5 rounded bg-green-600 text-white hover:bg-green-700 font-medium"
        >
          + New Project
        </button>
        {message && (
          <div className={`text-xs px-2 py-1 rounded ${message.error ? 'text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-400' : 'text-green-600 bg-green-50 dark:bg-green-900/20 dark:text-green-400'}`}>
            {message.text}
          </div>
        )}
      </div>
    );
  }

  const inputClass = "w-full text-sm bg-surface-100 dark:bg-surface-700 border border-surface-200 dark:border-surface-600 rounded px-2 py-1.5";

  return (
    <div className="border border-blue-200 dark:border-blue-800 rounded-lg p-3 bg-blue-50/50 dark:bg-blue-900/10 space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">New Project</h4>
        <button onClick={() => setIsOpen(false)} className="text-xs text-surface-400 hover:text-surface-600">Cancel</button>
      </div>

      {/* Name + Type row */}
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Project name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className={`${inputClass} flex-1`}
          autoFocus
        />
        <select
          value={form.type}
          onChange={(e) => setForm({ ...form, type: e.target.value })}
          className="text-sm bg-surface-100 dark:bg-surface-700 border border-surface-200 dark:border-surface-600 rounded px-2 py-1.5"
        >
          {categories.map((c) => <option key={c.name} value={c.name}>{c.emoji} {c.name}</option>)}
        </select>
      </div>

      {/* Description */}
      <input
        type="text"
        placeholder="Description (optional)"
        value={form.description}
        onChange={(e) => setForm({ ...form, description: e.target.value })}
        className={inputClass}
      />

      {/* Tech stack */}
      <input
        type="text"
        placeholder="Tech stack (optional, e.g. FastAPI + React + MySQL)"
        value={form.tech_stack}
        onChange={(e) => setForm({ ...form, tech_stack: e.target.value })}
        className={inputClass}
      />

      {/* Ports row */}
      <div className="flex gap-2 items-center">
        <input
          type="number"
          placeholder="Backend port"
          value={form.backend_port}
          onChange={(e) => setForm({ ...form, backend_port: e.target.value })}
          className={`${inputClass} w-28`}
        />
        <input
          type="number"
          placeholder="Frontend port"
          value={form.frontend_port}
          onChange={(e) => setForm({ ...form, frontend_port: e.target.value })}
          className={`${inputClass} w-28`}
        />
        <label className="flex items-center gap-1.5 text-xs text-surface-500 whitespace-nowrap cursor-pointer">
          <input
            type="checkbox"
            checked={form.open_ufw_ports}
            onChange={(e) => setForm({ ...form, open_ufw_ports: e.target.checked })}
            className="rounded"
          />
          Open UFW
        </label>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleCreate}
          disabled={creating || !form.name.trim()}
          className="text-xs px-3 py-1.5 rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 font-medium"
        >
          {creating ? 'Creating...' : 'Create Project'}
        </button>
        <span className="text-[10px] text-surface-400">
          Creates: folder, git init, CLAUDE.md, CHANGELOG.md, TODO.md, IDEAS.md{form.backend_port || form.frontend_port ? ', deploy.yaml' : ''}
        </span>
      </div>

      {message && (
        <div className={`text-xs px-2 py-1 rounded ${message.error ? 'text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-400' : 'text-green-600 bg-green-50 dark:bg-green-900/20 dark:text-green-400'}`}>
          {message.text}
        </div>
      )}
    </div>
  );
}

// --- Projects Tab ---
function ProjectsTab({ projects, onRefresh, loading }: { projects: ProjectData[]; onRefresh: () => void; loading: boolean }) {
  const categories = useProjectStore((s) => s.categories);
  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold">All Projects</h3>
        <button onClick={onRefresh} disabled={loading} className="text-xs px-2 py-1 rounded bg-surface-100 dark:bg-surface-700 hover:bg-surface-200 dark:hover:bg-surface-600 disabled:opacity-50">
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {/* New project form */}
      <NewProjectForm onCreated={onRefresh} />

      <div className="space-y-2 max-h-[350px] overflow-y-auto">
        {projects.map((p) => (
          <div key={p.path} className="border border-surface-200 dark:border-surface-700 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-1.5">
              {/* Health dots */}
              <div className="flex items-center gap-1" title={`BE: ${p.health_status?.backend ?? 'n/a'} | FE: ${p.health_status?.frontend ?? 'n/a'}`}>
                <HealthDot status={p.health_status?.backend ?? null} />
                <HealthDot status={p.health_status?.frontend ?? null} />
              </div>
              {/* Name */}
              <span className="text-sm font-semibold truncate flex-1">{p.display_name || p.name}</span>
              {/* Type badge */}
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${getTypeBadge(p.type, categories)}`}>
                {p.type}
              </span>
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-surface-500 dark:text-surface-400">
              {/* Ports */}
              {p.dev_ports.backend != null && (
                <span>BE:{p.dev_ports.backend}</span>
              )}
              {p.dev_ports.frontend != null && (
                <span>FE:{p.dev_ports.frontend}</span>
              )}
              {/* Git branch */}
              {p.git_info?.branch && (
                <span className="flex items-center gap-1">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
                  {p.git_info.branch}
                  {p.git_info.dirty && <span className="text-amber-500">*</span>}
                </span>
              )}
              {/* Last deploy */}
              {p.last_deploy && (
                <span className={p.last_deploy.status === 'success' ? 'text-green-500' : 'text-red-500'}>
                  Last deploy: {formatTimestamp(p.last_deploy.timestamp)}
                </span>
              )}
            </div>

            {/* Config indicators */}
            <div className="flex gap-2 mt-1.5">
              {p.has_claude_md && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-100 dark:bg-surface-700 text-surface-500">CLAUDE.md</span>
              )}
              {p.has_deploy_yaml && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400">deploy.yaml</span>
              )}
              {p.has_deploy_script && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400">deploy.sh</span>
              )}
            </div>
          </div>
        ))}

        {projects.length === 0 && (
          <p className="text-sm text-surface-400 text-center py-4">No projects found</p>
        )}
      </div>
    </div>
  );
}

// --- Deploy Tab ---
function DeployTab({ projects }: { projects: ProjectData[] }) {
  const deployableProjects = projects.filter((p) => p.has_deploy_yaml);
  const [selectedProject, setSelectedProject] = useState<string>(deployableProjects[0]?.name || '');
  const [deployStatus, setDeployStatus] = useState<'idle' | 'running' | 'success' | 'failed'>('idle');
  const [logLines, setLogLines] = useState<string[]>([]);
  const [lastDeploy, setLastDeploy] = useState<ProjectData['last_deploy'] | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const deployStatusRef = useRef(deployStatus);

  // Keep ref in sync
  useEffect(() => { deployStatusRef.current = deployStatus; }, [deployStatus]);

  // Load last deploy info when project changes
  useEffect(() => {
    if (!selectedProject) return;
    api.getDeployStatus(selectedProject).then((data) => {
      setLastDeploy(data.last_deploy);
      if (data.deploying) setDeployStatus('running');
    }).catch(() => {});
  }, [selectedProject]);

  // Load existing deploy log when project changes
  useEffect(() => {
    if (!selectedProject) return;
    api.getDeployLog(selectedProject).then((data) => {
      if (data.exists && data.log) {
        setLogLines(data.log.split('\n'));
      } else {
        setLogLines([]);
      }
    }).catch(() => {});
  }, [selectedProject]);

  // Auto-scroll log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logLines]);

  const startDeploy = (options: { skip_build?: boolean; dry_run?: boolean } = {}) => {
    if (!selectedProject || deployStatus === 'running') return;

    setDeployStatus('running');
    setLogLines([]);

    const ws = createDeployWs(selectedProject);
    wsRef.current = ws;

    ws.onopen = () => {
      // Send deploy options
      ws.send(JSON.stringify(options));
    };

    ws.onmessage = (event) => {
      try {
        const msg: DeployLogMessage = JSON.parse(event.data);
        if (msg.type === 'log' && msg.line != null) {
          setLogLines((prev) => [...prev, msg.line!]);
        } else if (msg.type === 'status') {
          if (msg.status === 'success') {
            setDeployStatus('success');
            // Refresh last deploy info
            api.getDeployStatus(selectedProject).then((data) => {
              setLastDeploy(data.last_deploy);
            }).catch(() => {});
          } else if (msg.status === 'failed') {
            setDeployStatus('failed');
          }
        } else if (msg.type === 'error') {
          setLogLines((prev) => [...prev, `ERROR: ${msg.message}`]);
          setDeployStatus('failed');
        }
      } catch {
        // Plain text fallback
        setLogLines((prev) => [...prev, event.data]);
      }
    };

    ws.onerror = () => {
      setDeployStatus('failed');
      setLogLines((prev) => [...prev, 'WebSocket error — connection failed']);
    };

    ws.onclose = () => {
      wsRef.current = null;
      if (deployStatusRef.current === 'running') {
        // If still "running" when WS closes, check final status
        api.getDeployStatus(selectedProject).then((data) => {
          setLastDeploy(data.last_deploy);
          if (!data.deploying) {
            setDeployStatus(data.last_deploy?.status === 'success' ? 'success' : 'failed');
          }
        }).catch(() => setDeployStatus('failed'));
      }
    };
  };

  // Cleanup WS on unmount
  useEffect(() => {
    return () => {
      wsRef.current?.close();
    };
  }, []);

  const statusColors: Record<string, string> = {
    idle: 'text-surface-400',
    running: 'text-blue-500',
    success: 'text-green-500',
    failed: 'text-red-500',
  };

  return (
    <div className="flex flex-col" style={{ height: 450 }}>
      {/* Controls */}
      <div className="p-3 border-b border-surface-200 dark:border-surface-700 space-y-2">
        <div className="flex items-center gap-2">
          <select
            value={selectedProject}
            onChange={(e) => { setSelectedProject(e.target.value); setDeployStatus('idle'); }}
            className="text-sm bg-surface-100 dark:bg-surface-700 border border-surface-200 dark:border-surface-600 rounded px-2 py-1 flex-1"
          >
            {deployableProjects.length === 0 && <option value="">No deployable projects</option>}
            {deployableProjects.map((p) => (
              <option key={p.name} value={p.name}>{p.display_name || p.name}</option>
            ))}
          </select>
          <span className={`text-xs font-medium ${statusColors[deployStatus]}`}>
            {deployStatus.toUpperCase()}
          </span>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => startDeploy()}
            disabled={!selectedProject || deployStatus === 'running'}
            className="text-xs px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 font-medium"
          >
            Full Deploy
          </button>
          <button
            onClick={() => startDeploy({ skip_build: true })}
            disabled={!selectedProject || deployStatus === 'running'}
            className="text-xs px-3 py-1.5 rounded bg-surface-200 dark:bg-surface-600 hover:bg-surface-300 dark:hover:bg-surface-500 disabled:opacity-50"
          >
            Skip Build
          </button>
          <button
            onClick={() => startDeploy({ dry_run: true })}
            disabled={!selectedProject || deployStatus === 'running'}
            className="text-xs px-3 py-1.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 hover:bg-amber-200 dark:hover:bg-amber-900/50 disabled:opacity-50"
          >
            Dry Run
          </button>
        </div>

        {/* Last deploy info */}
        {lastDeploy && (
          <div className="text-xs text-surface-500 dark:text-surface-400 flex gap-3">
            <span>Last: {formatTimestamp(lastDeploy.timestamp)}</span>
            <span className={lastDeploy.status === 'success' ? 'text-green-500' : 'text-red-500'}>
              {lastDeploy.status}
            </span>
            {lastDeploy.commit && <span>@{lastDeploy.commit}</span>}
            {lastDeploy.dry_run && <span className="text-amber-500">(dry run)</span>}
          </div>
        )}
      </div>

      {/* Log output */}
      <div className="flex-1 overflow-auto p-2 bg-surface-950 font-mono text-xs leading-relaxed">
        {logLines.length === 0 ? (
          <p className="text-surface-500 p-2">Select a project and start a deploy to see output</p>
        ) : (
          logLines.map((line, i) => (
            <div
              key={i}
              className={`px-2 py-0.5 ${
                line.includes('ERROR') || line.includes('FAILED')
                  ? 'text-red-400'
                  : line.includes('WARNING')
                    ? 'text-yellow-400'
                    : line.startsWith('===')
                      ? 'text-blue-400 font-semibold'
                      : line.startsWith('---')
                        ? 'text-surface-400 font-semibold'
                        : 'text-surface-300'
              }`}
            >
              {line}
            </div>
          ))
        )}
        <div ref={logEndRef} />
      </div>
    </div>
  );
}

// --- Backups Tab ---
function BackupsTab({ projects }: { projects: ProjectData[] }) {
  const [backups, setBackups] = useState<BackupData[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [selectedProject, setSelectedProject] = useState<string>(projects[0]?.name || '');
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const fetchBackups = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.listBackups();
      setBackups(data);
    } catch {
      setBackups([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchBackups(); }, [fetchBackups]);

  const handleCreate = async () => {
    if (!selectedProject || creating) return;
    setCreating(true);
    setActionMessage(null);
    try {
      const result = await api.createBackup(selectedProject);
      setActionMessage(`Backup created: ${result.filename} (${formatBytes(result.size)})`);
      fetchBackups();
    } catch (e) {
      setActionMessage(`Error: ${(e as Error).message}`);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (filename: string) => {
    if (!confirm(`Delete backup ${filename}?`)) return;
    try {
      await api.deleteBackup(filename);
      setActionMessage(`Deleted: ${filename}`);
      fetchBackups();
    } catch (e) {
      setActionMessage(`Error: ${(e as Error).message}`);
    }
  };

  return (
    <div className="p-4 space-y-3">
      {/* Create backup */}
      <div className="flex items-center gap-2">
        <select
          value={selectedProject}
          onChange={(e) => setSelectedProject(e.target.value)}
          className="text-sm bg-surface-100 dark:bg-surface-700 border border-surface-200 dark:border-surface-600 rounded px-2 py-1 flex-1"
        >
          {projects.map((p) => (
            <option key={p.name} value={p.name}>{p.display_name || p.name}</option>
          ))}
        </select>
        <button
          onClick={handleCreate}
          disabled={creating || !selectedProject}
          className="text-xs px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 font-medium whitespace-nowrap"
        >
          {creating ? 'Creating...' : 'Create Backup'}
        </button>
        <button
          onClick={fetchBackups}
          disabled={loading}
          className="text-xs px-2 py-1.5 rounded bg-surface-100 dark:bg-surface-700 hover:bg-surface-200 dark:hover:bg-surface-600 disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      {/* Action feedback */}
      {actionMessage && (
        <div className="text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 rounded px-2 py-1.5">
          {actionMessage}
        </div>
      )}

      {/* Backup list */}
      <div className="space-y-1 max-h-[300px] overflow-y-auto">
        {backups.length === 0 && !loading && (
          <p className="text-sm text-surface-400 text-center py-4">No backups found</p>
        )}
        {backups.map((b) => (
          <div key={b.filename} className="flex items-center gap-2 px-3 py-2 border border-surface-200 dark:border-surface-700 rounded-lg text-xs">
            <span className="truncate flex-1 font-mono">{b.filename}</span>
            <span className="text-surface-400 whitespace-nowrap">{formatBytes(b.size)}</span>
            <span className="text-surface-400 whitespace-nowrap">{formatTimestamp(b.created_at)}</span>
            <button
              onClick={() => handleDelete(b.filename)}
              className="text-red-500 hover:text-red-700 px-1"
              title="Delete backup"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Port cell: shows port number + UFW badge ---
function PortCell({ port, ufwOpen }: { port: number | null; ufwOpen: boolean }) {
  if (port == null) return <span className="text-surface-400">—</span>;
  return (
    <span className="flex items-center gap-1.5">
      <span className="font-mono font-semibold">{port}</span>
      {ufwOpen ? (
        <span className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" title="UFW open" />
      ) : (
        <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" title="UFW closed" />
      )}
    </span>
  );
}

// Sort direction arrow indicator
function SortArrow({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) {
  if (!active) return <span className="text-surface-300 dark:text-surface-600 ml-0.5">&darr;</span>;
  return <span className="text-blue-500 ml-0.5">{dir === 'asc' ? '\u2191' : '\u2193'}</span>;
}

type PortSortKey = 'project' | 'backend_port' | 'frontend_port';

// --- Ports Tab ---
function PortsTab() {
  const categories = useProjectStore((s) => s.categories);
  const [projectPorts, setProjectPorts] = useState<PortEntry[]>([]);
  const [ufwRules, setUfwRules] = useState<UfwRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [sortKey, setSortKey] = useState<PortSortKey>('project');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const fetchPorts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getPortsOverview();
      setProjectPorts(data.project_ports);
      setUfwRules(data.ufw_rules);
    } catch {
      setProjectPorts([]);
      setUfwRules([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPorts(); }, [fetchPorts]);

  // Toggle sort: click same column flips direction, click new column sets asc
  const handleSort = (key: PortSortKey) => {
    if (sortKey === key) {
      setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  // Sort the data
  const sorted = [...projectPorts].sort((a, b) => {
    let cmp = 0;
    if (sortKey === 'project') {
      cmp = a.project.toLowerCase().localeCompare(b.project.toLowerCase());
    } else {
      // Sort by port number — nulls always last regardless of direction
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (aVal == null && bVal == null) cmp = 0;
      else if (aVal == null) return 1;
      else if (bVal == null) return -1;
      else cmp = aVal - bVal;
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const colHeaderClass = "text-[10px] font-semibold uppercase tracking-wider text-surface-400 cursor-pointer select-none hover:text-surface-600 dark:hover:text-surface-300 flex items-center";

  return (
    <div className="p-4 space-y-4 max-h-[480px] overflow-y-auto">
      {/* Project ports section */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold">Project Ports</h3>
          <button onClick={fetchPorts} disabled={loading} className="text-xs px-2 py-1 rounded bg-surface-100 dark:bg-surface-700 hover:bg-surface-200 dark:hover:bg-surface-600 disabled:opacity-50">
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>

        {/* Table header — sortable columns */}
        <div className="grid grid-cols-[1fr_80px_80px_50px] gap-2 px-2 pb-1 border-b border-surface-200 dark:border-surface-700">
          <button onClick={() => handleSort('project')} className={colHeaderClass}>
            Project<SortArrow active={sortKey === 'project'} dir={sortDir} />
          </button>
          <button onClick={() => handleSort('backend_port')} className={colHeaderClass}>
            B Port<SortArrow active={sortKey === 'backend_port'} dir={sortDir} />
          </button>
          <button onClick={() => handleSort('frontend_port')} className={colHeaderClass}>
            F Port<SortArrow active={sortKey === 'frontend_port'} dir={sortDir} />
          </button>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-surface-400">Type</span>
        </div>

        <div className="space-y-0.5 mt-1">
          {sorted.map((entry) => (
            <div
              key={entry.project_name}
              className="grid grid-cols-[1fr_80px_80px_50px] gap-2 items-center text-xs px-2 py-1.5 rounded hover:bg-surface-50 dark:hover:bg-surface-700/50"
            >
              <span className="truncate">{entry.project}</span>
              <PortCell port={entry.backend_port} ufwOpen={entry.backend_ufw} />
              <PortCell port={entry.frontend_port} ufwOpen={entry.frontend_ufw} />
              <span className={`text-[10px] px-1 py-0.5 rounded text-center ${getTypeBadge(entry.type, categories)}`}>{entry.type}</span>
            </div>
          ))}
          {projectPorts.length === 0 && !loading && (
            <p className="text-xs text-surface-400 text-center py-3">No project ports configured</p>
          )}
        </div>
      </div>

      {/* UFW rules section */}
      <div>
        <h3 className="text-sm font-semibold mb-2">UFW Firewall Rules</h3>
        <div className="grid grid-cols-[80px_60px_1fr] gap-1 text-[10px] font-semibold uppercase tracking-wider text-surface-400 px-2 pb-1 border-b border-surface-200 dark:border-surface-700">
          <span>Port/Proto</span>
          <span>Action</span>
          <span>Comment</span>
        </div>
        <div className="space-y-0.5 mt-1">
          {ufwRules.map((rule, i) => (
            <div
              key={i}
              className="grid grid-cols-[80px_60px_1fr] gap-1 items-center text-xs px-2 py-1 rounded hover:bg-surface-50 dark:hover:bg-surface-700/50"
            >
              <span className="font-mono">{rule.port_proto}</span>
              <span className={rule.action === 'ALLOW' ? 'text-green-500' : 'text-red-500'}>{rule.action}</span>
              <span className="text-surface-500 truncate">{rule.comment || '—'}</span>
            </div>
          ))}
          {ufwRules.length === 0 && !loading && (
            <p className="text-xs text-surface-400 text-center py-3">No UFW rules found</p>
          )}
        </div>
      </div>

      <div className="text-[10px] text-surface-400 border-t border-surface-200 dark:border-surface-700 pt-2">
        <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" /> UFW open</span>
        <span className="mx-2">|</span>
        <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-red-400 inline-block" /> UFW closed — not accessible from other LAN devices</span>
      </div>
    </div>
  );
}

// --- Settings Tab ---
function SettingsTab() {
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [projectsRoot, setProjectsRoot] = useState('');
  const [categories, setCategories] = useState<ProjectCategory[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [loading, setLoading] = useState(true);

  // Load settings on mount
  useEffect(() => {
    (async () => {
      try {
        const data = await api.getSettings();
        setSettings(data);
        setProjectsRoot(data.projects_root);
        setCategories(data.project_categories);
      } catch (e) {
        setMessage({ text: `Failed to load settings: ${(e as Error).message}`, error: true });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Track whether anything has changed from saved state
  const isRootDirty = settings !== null && projectsRoot.trim() !== settings.projects_root;
  const isCategoriesDirty = settings !== null && JSON.stringify(categories) !== JSON.stringify(settings.project_categories);
  const isDirty = isRootDirty || isCategoriesDirty;

  // Validate categories client-side
  const categoryErrors: string[] = [];
  if (categories.length === 0) {
    categoryErrors.push('At least one category is required');
  }
  const names = categories.map((c) => c.name.trim().toLowerCase());
  names.forEach((name, i) => {
    if (!name) categoryErrors.push(`Category ${i + 1} has an empty name`);
    else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) categoryErrors.push(`"${name}" must be lowercase alphanumeric with hyphens`);
  });
  const dupes = names.filter((n, i) => n && names.indexOf(n) !== i);
  if (dupes.length > 0) categoryErrors.push(`Duplicate name: "${dupes[0]}"`);

  const handleSave = async () => {
    if (categoryErrors.length > 0) {
      setMessage({ text: categoryErrors[0], error: true });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      // Normalize category names before saving
      const normalizedCategories = categories.map((c) => ({
        ...c,
        name: c.name.trim().toLowerCase(),
      }));
      const updated = await api.updateSettings({
        projects_root: projectsRoot.trim(),
        project_categories: normalizedCategories,
      });
      setSettings(updated);
      setProjectsRoot(updated.projects_root);
      setCategories(updated.project_categories);
      setMessage({ text: 'Settings saved.', error: false });
      // Refresh sidebar projects with new categories
      useProjectStore.getState().fetchProjects();
    } catch (e) {
      setMessage({ text: `Failed to save: ${(e as Error).message}`, error: true });
    } finally {
      setSaving(false);
    }
  };

  const updateCategory = (index: number, updates: Partial<ProjectCategory>) => {
    setCategories((prev) => prev.map((c, i) => (i === index ? { ...c, ...updates } : c)));
  };

  const removeCategory = (index: number) => {
    setCategories((prev) => prev.filter((_, i) => i !== index));
  };

  const addCategory = () => {
    setCategories((prev) => [...prev, { name: '', emoji: '\u{1F4C1}', color: 'blue' }]);
  };

  if (loading) {
    return <div className="p-4 text-sm text-surface-500">Loading settings...</div>;
  }

  const inputClass = "w-full text-sm bg-surface-100 dark:bg-surface-700 border border-surface-200 dark:border-surface-600 rounded px-3 py-2 font-mono";

  return (
    <div className="p-4 space-y-5">
      {/* Projects Root */}
      <div className="space-y-2">
        <label className="block text-sm font-semibold text-surface-700 dark:text-surface-200">
          Projects Folder
        </label>
        <p className="text-xs text-surface-500 dark:text-surface-400">
          Root directory where your projects live. The sidebar scans for your configured category subdirectories. Each folder inside those becomes a project entry.
        </p>
        <input
          type="text"
          value={projectsRoot}
          onChange={(e) => setProjectsRoot(e.target.value)}
          placeholder="/home/user/projects"
          className={inputClass}
        />
      </div>

      {/* Project Categories */}
      <div className="space-y-2">
        <label className="block text-sm font-semibold text-surface-700 dark:text-surface-200">
          Project Categories
        </label>
        <p className="text-xs text-surface-500 dark:text-surface-400">
          Categories become subdirectories inside your projects folder (e.g. <code className="text-xs bg-surface-100 dark:bg-surface-700 px-1 rounded">~/projects/web/</code>). Removing a category hides its projects from the sidebar but doesn't delete any files.
        </p>

        <div className="space-y-1.5">
          {categories.map((cat, i) => (
            <div key={i} className="flex items-center gap-2 group">
              {/* Emoji input */}
              <input
                type="text"
                value={cat.emoji}
                onChange={(e) => updateCategory(i, { emoji: e.target.value })}
                className="w-10 text-center text-sm bg-surface-100 dark:bg-surface-700 border border-surface-200 dark:border-surface-600 rounded px-1 py-1.5"
                maxLength={4}
                title="Category emoji"
              />
              {/* Name input */}
              <input
                type="text"
                value={cat.name}
                onChange={(e) => updateCategory(i, { name: e.target.value })}
                placeholder="category-name"
                className="flex-1 text-sm bg-surface-100 dark:bg-surface-700 border border-surface-200 dark:border-surface-600 rounded px-2 py-1.5 font-mono"
              />
              {/* Color picker (row of dots) */}
              <div className="flex items-center gap-1">
                {Object.entries(COLOR_PALETTE).map(([key, val]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => updateCategory(i, { color: key })}
                    className={`w-4 h-4 rounded-full ${val.dot} transition-all ${
                      cat.color === key ? 'ring-2 ring-offset-1 ring-surface-400 dark:ring-surface-500 dark:ring-offset-surface-800 scale-110' : 'opacity-50 hover:opacity-80'
                    }`}
                    title={val.label}
                  />
                ))}
              </div>
              {/* Remove button (disabled if only 1 left) */}
              <button
                type="button"
                onClick={() => removeCategory(i)}
                disabled={categories.length <= 1}
                className="text-surface-400 hover:text-red-500 disabled:opacity-25 disabled:cursor-not-allowed p-1"
                title="Remove category"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={addCategory}
          className="text-xs px-2.5 py-1.5 rounded bg-surface-100 dark:bg-surface-700 hover:bg-surface-200 dark:hover:bg-surface-600 text-surface-600 dark:text-surface-300 font-medium"
        >
          + Add Category
        </button>

        {/* Client-side validation errors */}
        {categoryErrors.length > 0 && isDirty && (
          <p className="text-xs text-red-500">{categoryErrors[0]}</p>
        )}
      </div>

      {/* Save button + message */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving || !isDirty || categoryErrors.length > 0}
          className="text-sm px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
        {message && (
          <span className={`text-xs ${message.error ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
            {message.text}
          </span>
        )}
      </div>
    </div>
  );
}


// --- Main SystemPanel ---
export function SystemPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [tab, setTab] = useState<TabId>('status');
  const [status, setStatus] = useState<Record<string, ServiceStatus> | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [logService, setLogService] = useState<ServiceId>('workbench-backend');
  const [logLines, setLogLines] = useState<string[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [projects, setProjects] = useState<ProjectData[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  // Fetch status when panel opens on services tab
  useEffect(() => {
    if (isOpen && tab === 'status') fetchStatus();
  }, [isOpen, tab]);

  // Fetch projects when switching to projects/deploy/backups tabs
  useEffect(() => {
    if (isOpen && (tab === 'projects' || tab === 'deploy' || tab === 'backups')) {
      fetchProjects();
    }
  }, [isOpen, tab]);

  const fetchStatus = async () => {
    try {
      const data = await api.getSystemStatus();
      setStatus(data);
    } catch {
      setStatus(null);
    }
  };

  const fetchProjects = async () => {
    setProjectsLoading(true);
    try {
      const data = await api.listProjects();
      setProjects(data);
    } catch {
      setProjects([]);
    } finally {
      setProjectsLoading(false);
    }
  };

  const fetchLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const data = await api.getServiceLogs(logService, 200);
      setLogLines(data.lines);
      setTimeout(() => logEndRef.current?.scrollIntoView(), 50);
    } catch {
      setLogLines(['Failed to fetch logs']);
    } finally {
      setLogsLoading(false);
    }
  }, [logService]);

  // Fetch logs when switching to logs tab or changing service
  useEffect(() => {
    if (isOpen && tab === 'logs') fetchLogs();
  }, [isOpen, tab, logService, fetchLogs]);

  const handleRestart = async (service?: string) => {
    setLoading(true);
    setActionMessage(null);
    try {
      const res = await api.restartServices(service);
      setActionMessage(res.message || 'Restart initiated');
      setTimeout(fetchStatus, 3000);
    } catch (e) {
      setActionMessage(`Error: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async (service?: string) => {
    if (!confirm(service
      ? `Stop ${service}? The workbench may become unusable.`
      : 'Stop both services? The workbench will go offline.'
    )) return;
    setLoading(true);
    setActionMessage(null);
    try {
      await api.stopServices(service);
      setActionMessage(service ? `${service} stopped` : 'Both services stopped');
      setTimeout(fetchStatus, 2000);
    } catch (e) {
      setActionMessage(`Error: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const TABS: { id: TabId; label: string }[] = [
    { id: 'status', label: 'Services' },
    { id: 'projects', label: 'Projects' },
    { id: 'deploy', label: 'Deploy' },
    { id: 'backups', label: 'Backups' },
    { id: 'ports', label: 'Ports' },
    { id: 'logs', label: 'Logs' },
    { id: 'settings', label: 'Path' },
  ];

  return (
    <div className="relative" ref={panelRef}>
      {/* Gear button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`p-2 rounded-lg transition-colors ${
          isOpen
            ? 'bg-surface-200 dark:bg-surface-700'
            : 'hover:bg-surface-100 dark:hover:bg-surface-800'
        }`}
        title="System management"
        aria-label="System management"
      >
        <svg className="w-5 h-5 text-surface-500 dark:text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>

      {/* Panel dropdown */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-[calc(100vw-1rem)] sm:w-[580px] max-w-[580px] max-h-[calc(100vh-4rem)] bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-xl shadow-2xl z-[10000] overflow-hidden flex flex-col">
          {/* Tabs */}
          <div className="flex border-b border-surface-200 dark:border-surface-700 overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex-shrink-0 px-3 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
                  tab === t.id
                    ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400'
                    : 'text-surface-500 hover:text-surface-700 dark:hover:text-surface-300'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Scrollable content area */}
          <div className="flex-1 overflow-y-auto min-h-0">

          {/* Services tab */}
          {tab === 'status' && (
            <div className="p-4 space-y-4">
              {SERVICES.map((svc) => {
                const s = status?.[svc.id];
                const isRunning = s?.active === 'active';
                return (
                  <div key={svc.id} className="border border-surface-200 dark:border-surface-700 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${isRunning ? 'bg-green-400' : 'bg-red-400'}`} />
                        <span className="text-sm font-semibold">{svc.label}</span>
                        {s && (
                          <span className={`text-xs px-1.5 py-0.5 rounded ${
                            isRunning
                              ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                              : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                          }`}>
                            {s.active}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleRestart(svc.id)}
                          disabled={loading}
                          className="text-xs px-2 py-1 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50 disabled:opacity-50"
                        >
                          Restart
                        </button>
                        <button
                          onClick={() => handleStop(svc.id)}
                          disabled={loading}
                          className="text-xs px-2 py-1 rounded bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50 disabled:opacity-50"
                        >
                          Stop
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-surface-500 dark:text-surface-400 mb-2">{svc.description}</p>
                    {s && isRunning && (
                      <div className="flex gap-4 text-xs text-surface-400">
                        <span>PID {s.pid}</span>
                        <span>Up {formatUptime(s.started_at)}</span>
                        <span>{formatMemory(s.memory)}</span>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Bulk actions */}
              <div className="border-t border-surface-200 dark:border-surface-700 pt-3 space-y-2">
                <div className="flex gap-2">
                  <button
                    onClick={() => handleRestart()}
                    disabled={loading}
                    className="flex-1 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    {loading ? 'Working...' : 'Restart All'}
                  </button>
                  <button
                    onClick={() => handleStop()}
                    disabled={loading}
                    className="px-4 py-2 text-sm font-medium rounded-lg border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 transition-colors"
                  >
                    Stop All
                  </button>
                  <button
                    onClick={fetchStatus}
                    disabled={loading}
                    className="px-3 py-2 rounded-lg border border-surface-200 dark:border-surface-700 hover:bg-surface-50 dark:hover:bg-surface-700 text-surface-500 disabled:opacity-50"
                    title="Refresh status"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  </button>
                </div>
                <div className="text-xs text-surface-400 space-y-1">
                  <p><strong>Restart All</strong> — Use when sessions won't connect, WebSockets fail, or after editing backend code. Existing tmux sessions are preserved.</p>
                  <p><strong>Stop All</strong> — Takes the workbench fully offline. Tmux sessions keep running and reconnect when you restart.</p>
                </div>
              </div>

              {actionMessage && (
                <div className="text-sm text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 rounded-lg px-3 py-2">
                  {actionMessage}
                </div>
              )}
            </div>
          )}

          {/* Projects tab */}
          {tab === 'projects' && (
            <ProjectsTab projects={projects} onRefresh={fetchProjects} loading={projectsLoading} />
          )}

          {/* Deploy tab */}
          {tab === 'deploy' && (
            <DeployTab projects={projects} />
          )}

          {/* Backups tab */}
          {tab === 'backups' && (
            <BackupsTab projects={projects} />
          )}

          {/* Ports tab */}
          {tab === 'ports' && (
            <PortsTab />
          )}

          {/* Settings tab */}
          {tab === 'settings' && (
            <SettingsTab />
          )}

          {/* Logs tab */}
          {tab === 'logs' && (
            <div className="flex flex-col h-[250px] sm:h-[400px]">
              <div className="flex items-center gap-2 px-4 py-2 border-b border-surface-200 dark:border-surface-700">
                <select
                  value={logService}
                  onChange={(e) => setLogService(e.target.value as ServiceId)}
                  className="text-sm bg-surface-100 dark:bg-surface-700 border border-surface-200 dark:border-surface-600 rounded px-2 py-1"
                >
                  {SERVICES.map((svc) => (
                    <option key={svc.id} value={svc.id}>{svc.label}</option>
                  ))}
                </select>
                <button
                  onClick={fetchLogs}
                  disabled={logsLoading}
                  className="text-xs px-2 py-1 rounded bg-surface-100 dark:bg-surface-700 hover:bg-surface-200 dark:hover:bg-surface-600 disabled:opacity-50"
                >
                  {logsLoading ? 'Loading...' : 'Refresh'}
                </button>
                <p className="text-xs text-surface-400 ml-auto">Showing last 200 lines</p>
              </div>

              <div className="flex-1 overflow-auto p-2 bg-surface-950 font-mono text-xs leading-relaxed">
                {logLines.length === 0 ? (
                  <p className="text-surface-500 p-2">No log entries</p>
                ) : (
                  logLines.map((line, i) => (
                    <div
                      key={i}
                      className={`px-2 py-0.5 ${
                        line.includes('ERROR') || line.includes('error')
                          ? 'text-red-400'
                          : line.includes('WARNING') || line.includes('warn')
                            ? 'text-yellow-400'
                            : 'text-surface-300'
                      }`}
                    >
                      {line}
                    </div>
                  ))
                )}
                <div ref={logEndRef} />
              </div>

              <div className="px-4 py-2 border-t border-surface-200 dark:border-surface-700 text-xs text-surface-400">
                <strong>Backend logs</strong> — API requests, WebSocket events, errors.{' '}
                <strong>Frontend logs</strong> — Vite compilation, HMR updates. Check backend logs first when debugging.
              </div>
            </div>
          )}
          </div>{/* end scrollable content */}
        </div>
      )}
    </div>
  );
}
