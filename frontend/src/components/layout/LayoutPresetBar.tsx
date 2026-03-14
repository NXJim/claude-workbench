/**
 * Layout preset menu — a single grid-icon button that opens a dropdown
 * of template presets (not workspaces).
 */

import { useState, useRef, useEffect } from 'react';
import { useLayoutStore } from '@/stores/layoutStore';

export function LayoutPresetBar() {
  const presets = useLayoutStore((s) => s.presets);
  const loadPreset = useLayoutStore((s) => s.loadPreset);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Only show template presets, not workspaces
  const templates = presets.filter((p) => !p.is_workspace);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (templates.length === 0) return null;

  return (
    <div ref={menuRef} className="relative hidden md:block">
      <button
        onClick={() => setOpen(!open)}
        className={`p-1.5 rounded-lg transition-colors ${
          open
            ? 'bg-surface-200 dark:bg-surface-700 text-surface-700 dark:text-surface-300'
            : 'hover:bg-surface-100 dark:hover:bg-surface-800 text-surface-500 hover:text-surface-700 dark:hover:text-surface-300'
        }`}
        title="Layout presets"
      >
        {/* 4-squares grid icon */}
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM14 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-[9999] bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-lg shadow-lg py-1 min-w-36">
          {templates.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                loadPreset(p.layout_json);
                setOpen(false);
              }}
              className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-xs hover:bg-surface-100 dark:hover:bg-surface-700 text-surface-700 dark:text-surface-300 transition-colors"
            >
              {p.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
