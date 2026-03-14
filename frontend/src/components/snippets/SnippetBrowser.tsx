/**
 * Snippet browser — searchable list with tag/language filters.
 * Opens as a floating window.
 */

import { useEffect, useState } from 'react';
import { useSnippetStore, type Snippet } from '@/stores/snippetStore';

export function SnippetBrowser() {
  const snippets = useSnippetStore((s) => s.snippets);
  const allTags = useSnippetStore((s) => s.allTags);
  const filters = useSnippetStore((s) => s.filters);
  const loading = useSnippetStore((s) => s.loading);
  const fetchSnippets = useSnippetStore((s) => s.fetchSnippets);
  const fetchTags = useSnippetStore((s) => s.fetchTags);
  const setFilter = useSnippetStore((s) => s.setFilter);
  const openSnippet = useSnippetStore((s) => s.openSnippet);
  const deleteSnippet = useSnippetStore((s) => s.deleteSnippet);
  const createSnippet = useSnippetStore((s) => s.createSnippet);

  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newCode, setNewCode] = useState('');
  const [newLang, setNewLang] = useState('text');
  const [newTags, setNewTags] = useState('');

  useEffect(() => {
    fetchSnippets();
    fetchTags();
  }, [fetchSnippets, fetchTags]);

  const handleCreate = async () => {
    if (!newTitle.trim() || !newCode.trim()) return;
    await createSnippet({
      title: newTitle.trim(),
      code: newCode,
      language: newLang,
      tags: newTags,
      description: '',
      source_project: null,
    });
    setNewTitle('');
    setNewCode('');
    setNewLang('text');
    setNewTags('');
    setShowCreate(false);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Search + filters */}
      <div className="p-3 border-b border-surface-200 dark:border-surface-700 space-y-2">
        <input
          value={filters.search}
          onChange={(e) => setFilter('search', e.target.value)}
          placeholder="Search snippets..."
          className="w-full text-sm bg-surface-100 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded px-2 py-1.5 focus:outline-none focus:border-blue-500"
        />
        <div className="flex gap-2">
          {/* Tag filter */}
          <select
            value={filters.tag}
            onChange={(e) => setFilter('tag', e.target.value)}
            className="text-xs bg-surface-100 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded px-2 py-1"
          >
            <option value="">All tags</option>
            {allTags.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          {/* Language filter */}
          <select
            value={filters.language}
            onChange={(e) => setFilter('language', e.target.value)}
            className="text-xs bg-surface-100 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded px-2 py-1"
          >
            <option value="">All languages</option>
            {['javascript', 'typescript', 'python', 'bash', 'go', 'rust', 'sql', 'css', 'html', 'json', 'yaml', 'text'].map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
          <button
            onClick={() => setShowCreate(true)}
            className="ml-auto text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700"
          >
            + New
          </button>
        </div>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="p-3 border-b border-surface-200 dark:border-surface-700 space-y-2 bg-surface-50 dark:bg-surface-800/50">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Title"
            className="w-full text-sm bg-white dark:bg-surface-900 border border-surface-300 dark:border-surface-600 rounded px-2 py-1"
          />
          <div className="flex gap-2">
            <input
              value={newLang}
              onChange={(e) => setNewLang(e.target.value)}
              placeholder="Language"
              className="w-24 text-xs bg-white dark:bg-surface-900 border border-surface-300 dark:border-surface-600 rounded px-2 py-1"
            />
            <input
              value={newTags}
              onChange={(e) => setNewTags(e.target.value)}
              placeholder="Tags (comma-separated)"
              className="flex-1 text-xs bg-white dark:bg-surface-900 border border-surface-300 dark:border-surface-600 rounded px-2 py-1"
            />
          </div>
          <textarea
            value={newCode}
            onChange={(e) => setNewCode(e.target.value)}
            placeholder="Paste code here..."
            className="w-full h-24 text-sm font-mono bg-white dark:bg-surface-900 border border-surface-300 dark:border-surface-600 rounded px-2 py-1 resize-none"
          />
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowCreate(false)} className="text-xs px-3 py-1 rounded text-surface-500 hover:bg-surface-200 dark:hover:bg-surface-700">Cancel</button>
            <button onClick={handleCreate} className="text-xs px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700">Save</button>
          </div>
        </div>
      )}

      {/* Snippets list */}
      <div className="flex-1 overflow-y-auto">
        {loading && snippets.length === 0 ? (
          <p className="p-4 text-sm text-surface-400 text-center">Loading...</p>
        ) : snippets.length === 0 ? (
          <p className="p-4 text-sm text-surface-400 text-center">No snippets found</p>
        ) : (
          <div className="divide-y divide-surface-200 dark:divide-surface-700">
            {snippets.map((s) => (
              <SnippetCard key={s.id} snippet={s} onOpen={() => openSnippet(s.id)} onDelete={() => deleteSnippet(s.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SnippetCard({ snippet, onOpen, onDelete }: { snippet: Snippet; onOpen: () => void; onDelete: () => void }) {
  return (
    <div
      className="group p-3 hover:bg-surface-50 dark:hover:bg-surface-800/50 cursor-pointer"
      onClick={onOpen}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-sm font-medium truncate">{snippet.title}</h4>
          {snippet.description && (
            <p className="text-xs text-surface-500 truncate mt-0.5">{snippet.description}</p>
          )}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); if (confirm(`Delete "${snippet.title}"?`)) onDelete(); }}
          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-surface-400 hover:text-red-500 flex-shrink-0"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="flex items-center gap-2 mt-1.5">
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-200 dark:bg-surface-700 text-surface-600 dark:text-surface-400">
          {snippet.language}
        </span>
        {snippet.tags && snippet.tags.split(',').filter(Boolean).map((tag) => (
          <span key={tag.trim()} className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
            {tag.trim()}
          </span>
        ))}
      </div>
      {/* Code preview */}
      <pre className="mt-2 text-xs font-mono text-surface-600 dark:text-surface-400 bg-surface-100 dark:bg-surface-800 rounded p-2 overflow-hidden max-h-16 line-clamp-3">
        {snippet.code.slice(0, 200)}
      </pre>
    </div>
  );
}
