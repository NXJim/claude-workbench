/**
 * Skill browser — lists all discovered skills (custom + plugin) with search and edit actions.
 */

import { useEffect, useState, useMemo } from 'react';
import { useSkillStore } from '@/stores/skillStore';
import type { SkillData } from '@/api/client';

export function SkillBrowser() {
  const skills = useSkillStore((s) => s.skills);
  const loading = useSkillStore((s) => s.loading);
  const fetchSkills = useSkillStore((s) => s.fetchSkills);
  const openSkill = useSkillStore((s) => s.openSkill);
  const [search, setSearch] = useState('');

  useEffect(() => {
    // Fetch on mount if not already loaded
    if (skills.length === 0) fetchSkills();
  }, []);

  // Filter skills by search query (matches name or description)
  const filtered = useMemo(() => {
    if (!search.trim()) return skills;
    const q = search.toLowerCase();
    return skills.filter(
      (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
    );
  }, [skills, search]);

  // Group by source: custom first, then by plugin name
  const grouped = useMemo(() => {
    const groups: Record<string, SkillData[]> = {};
    for (const skill of filtered) {
      const key = skill.source === 'custom' ? 'Custom Skills' : `Plugin: ${skill.plugin_name || 'unknown'}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(skill);
    }
    // Sort: Custom Skills first, then plugin groups alphabetically
    const sorted: [string, SkillData[]][] = [];
    if (groups['Custom Skills']) {
      sorted.push(['Custom Skills', groups['Custom Skills']]);
    }
    for (const key of Object.keys(groups).sort()) {
      if (key !== 'Custom Skills') sorted.push([key, groups[key]]);
    }
    return sorted;
  }, [filtered]);

  return (
    <div className="flex flex-col h-full">
      {/* Search bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800">
        <svg className="w-4 h-4 text-surface-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search skills..."
          className="flex-1 bg-transparent text-sm text-surface-800 dark:text-surface-200 placeholder-surface-400 outline-none"
          autoFocus
        />
        {search && (
          <button onClick={() => setSearch('')} className="text-surface-400 hover:text-surface-600 dark:hover:text-surface-300">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
        {/* Refresh button */}
        <button
          onClick={() => fetchSkills()}
          className="p-1 rounded hover:bg-surface-200 dark:hover:bg-surface-700 text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 transition-colors"
          title="Refresh skills"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>

      {/* Skill list */}
      <div className="flex-1 overflow-y-auto">
        {loading && skills.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-sm text-surface-400">
            Loading skills...
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-sm text-surface-400">
            {search ? 'No skills match your search' : 'No skills found'}
          </div>
        ) : (
          grouped.map(([groupName, groupSkills]) => (
            <div key={groupName}>
              {/* Group header */}
              <div className="sticky top-0 px-3 py-1.5 text-xs font-semibold text-surface-500 dark:text-surface-400 bg-surface-100 dark:bg-surface-850 border-b border-surface-200 dark:border-surface-700">
                {groupName}
                <span className="ml-1.5 text-surface-400 dark:text-surface-500">({groupSkills.length})</span>
              </div>
              {/* Skill rows */}
              {groupSkills.map((skill) => (
                <SkillRow key={skill.path} skill={skill} onEdit={() => openSkill(skill)} />
              ))}
            </div>
          ))
        )}
      </div>

      {/* Footer with count */}
      <div className="px-3 py-1.5 border-t border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800 text-xs text-surface-400">
        {filtered.length} skill{filtered.length !== 1 ? 's' : ''}
        {search && ` matching "${search}"`}
      </div>
    </div>
  );
}

function SkillRow({ skill, onEdit }: { skill: SkillData; onEdit: () => void }) {
  return (
    <div className="flex items-start gap-2 px-3 py-2 border-b border-surface-100 dark:border-surface-800 hover:bg-surface-50 dark:hover:bg-surface-800/50 transition-colors group">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium text-surface-800 dark:text-surface-200 truncate">
            {skill.name}
          </span>
          {skill.readonly && (
            <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-surface-200 dark:bg-surface-700 text-surface-500 dark:text-surface-400 flex-shrink-0">
              <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              read-only
            </span>
          )}
        </div>
        <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5 line-clamp-2">
          {skill.description || 'No description'}
        </p>
      </div>
      {/* Edit/View button */}
      <button
        onClick={onEdit}
        className="flex-shrink-0 p-1.5 rounded-md text-surface-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors opacity-0 group-hover:opacity-100"
        title={skill.readonly ? 'View skill' : 'Edit skill'}
      >
        {skill.readonly ? (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
        ) : (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        )}
      </button>
    </div>
  );
}
