/**
 * Settings floating window — projects root and category editor.
 * Replaces the old SystemPanel with a lightweight settings UI.
 */

import { useState, useEffect } from 'react';
import { useLayoutStore, type FloatingWindow } from '@/stores/layoutStore';
import { useProjectStore } from '@/stores/projectStore';
import { FloatingWindowShell } from '@/components/workspace/FloatingWindowShell';
import { api, type ProjectCategory } from '@/api/client';

// Color palette for category badges
const COLOR_PALETTE = [
  { key: 'blue', bg: 'bg-blue-100 dark:bg-blue-900/40', dot: 'bg-blue-500' },
  { key: 'purple', bg: 'bg-purple-100 dark:bg-purple-900/40', dot: 'bg-purple-500' },
  { key: 'amber', bg: 'bg-amber-100 dark:bg-amber-900/40', dot: 'bg-amber-500' },
  { key: 'emerald', bg: 'bg-emerald-100 dark:bg-emerald-900/40', dot: 'bg-emerald-500' },
  { key: 'red', bg: 'bg-red-100 dark:bg-red-900/40', dot: 'bg-red-500' },
  { key: 'pink', bg: 'bg-pink-100 dark:bg-pink-900/40', dot: 'bg-pink-500' },
  { key: 'cyan', bg: 'bg-cyan-100 dark:bg-cyan-900/40', dot: 'bg-cyan-500' },
  { key: 'orange', bg: 'bg-orange-100 dark:bg-orange-900/40', dot: 'bg-orange-500' },
];

export function SettingsFloatingWindow({ window: fw }: { window: FloatingWindow }) {
  const removeFloating = useLayoutStore((s) => s.removeFloating);
  const fetchProjects = useProjectStore((s) => s.fetchProjects);

  // Local state
  const [projectsRoot, setProjectsRoot] = useState('');
  const [categories, setCategories] = useState<ProjectCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Load settings on mount
  useEffect(() => {
    (async () => {
      try {
        const settings = await api.getSettings();
        setProjectsRoot(settings.projects_root);
        setCategories(settings.project_categories);
      } catch (e) {
        setError('Failed to load settings');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await api.updateSettings({ projects_root: projectsRoot, project_categories: categories });
      setDirty(false);
      setSuccess('Settings saved');
      fetchProjects(); // Refresh sidebar
      setTimeout(() => setSuccess(''), 2000);
    } catch (e: any) {
      setError(e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const updateCategory = (idx: number, field: keyof ProjectCategory, value: string) => {
    const updated = [...categories];
    updated[idx] = { ...updated[idx], [field]: value };
    setCategories(updated);
    setDirty(true);
  };

  const removeCategory = (idx: number) => {
    if (categories.length <= 1) return;
    setCategories(categories.filter((_, i) => i !== idx));
    setDirty(true);
  };

  const addCategory = () => {
    setCategories([...categories, { name: '', emoji: '📁', color: 'blue' }]);
    setDirty(true);
  };

  return (
    <FloatingWindowShell
      window={fw}
      title="Settings"
      icon={
        <svg className="w-4 h-4 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      }
      onClose={() => removeFloating(fw.id)}
    >
      {loading ? (
        <div className="flex items-center justify-center h-full text-surface-400 text-sm">Loading...</div>
      ) : (
        <div className="p-4 space-y-6 overflow-y-auto h-full text-sm">
          {/* Projects Root */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-surface-500 mb-2">
              Projects Root
            </label>
            <input
              type="text"
              value={projectsRoot}
              onChange={(e) => { setProjectsRoot(e.target.value); setDirty(true); }}
              className="w-full px-3 py-2 rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900 text-sm font-mono"
              placeholder="~/projects"
            />
            <p className="text-xs text-surface-400 mt-1">
              Directory scanned for project subdirectories (organized by category).
            </p>
          </div>

          {/* Project Categories */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-surface-500 mb-2">
              Project Categories
            </label>
            <div className="space-y-2">
              {categories.map((cat, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  {/* Emoji */}
                  <input
                    type="text"
                    value={cat.emoji}
                    onChange={(e) => updateCategory(idx, 'emoji', e.target.value)}
                    className="w-10 text-center px-1 py-1.5 rounded border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900 text-sm"
                    maxLength={2}
                  />
                  {/* Name */}
                  <input
                    type="text"
                    value={cat.name}
                    onChange={(e) => updateCategory(idx, 'name', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                    className="flex-1 px-2 py-1.5 rounded border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900 text-sm font-mono"
                    placeholder="category-name"
                  />
                  {/* Color dots */}
                  <div className="flex gap-1">
                    {COLOR_PALETTE.map((c) => (
                      <button
                        key={c.key}
                        onClick={() => updateCategory(idx, 'color', c.key)}
                        className={`w-4 h-4 rounded-full ${c.dot} ${cat.color === c.key ? 'ring-2 ring-offset-1 ring-blue-500 dark:ring-offset-surface-800' : 'opacity-50 hover:opacity-100'}`}
                        title={c.key}
                      />
                    ))}
                  </div>
                  {/* Remove */}
                  <button
                    onClick={() => removeCategory(idx)}
                    disabled={categories.length <= 1}
                    className="p-1 text-surface-400 hover:text-red-500 disabled:opacity-30 disabled:cursor-not-allowed"
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
              onClick={addCategory}
              className="mt-2 text-xs text-blue-500 hover:text-blue-400 flex items-center gap-1"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Add Category
            </button>
          </div>

          {/* Save button + status */}
          <div className="flex items-center gap-3 pt-2 border-t border-surface-200 dark:border-surface-700">
            <button
              onClick={handleSave}
              disabled={!dirty || saving}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
            {error && <span className="text-xs text-red-500">{error}</span>}
            {success && <span className="text-xs text-green-500">{success}</span>}
          </div>
        </div>
      )}
    </FloatingWindowShell>
  );
}
