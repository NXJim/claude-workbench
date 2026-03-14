/**
 * Layout preset chips for the header bar.
 * Shows all presets inline.
 */

import { useLayoutStore } from '@/stores/layoutStore';

export function LayoutPresetBar() {
  const presets = useLayoutStore((s) => s.presets);
  const loadPreset = useLayoutStore((s) => s.loadPreset);

  if (presets.length === 0) return null;

  return (
    <div className="hidden sm:flex items-center gap-1">
      {presets.map((p) => (
        <button
          key={p.id}
          onClick={() => loadPreset(p.layout_json)}
          className="text-xs px-2 py-0.5 rounded-md bg-surface-100 dark:bg-surface-800 hover:bg-surface-200 dark:hover:bg-surface-700 text-surface-600 dark:text-surface-400 transition-colors"
          title={`Load layout: ${p.name}`}
        >
          {p.name}
        </button>
      ))}
    </div>
  );
}
