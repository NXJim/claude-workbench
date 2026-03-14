/**
 * Dashboard floating window wrapper.
 */

import { useLayoutStore, type FloatingWindow } from '@/stores/layoutStore';
import { FloatingWindowShell } from '@/components/workspace/FloatingWindowShell';
import { ProjectDashboard } from './ProjectDashboard';

interface DashboardFloatingWindowProps {
  window: FloatingWindow;
}

export function DashboardFloatingWindow({ window: fw }: DashboardFloatingWindowProps) {
  const removeFloating = useLayoutStore((s) => s.removeFloating);

  return (
    <FloatingWindowShell
      window={fw}
      title="Project Dashboard"
      accentColor="#ec4899"
      onClose={() => removeFloating(fw.id)}
      icon={
        <svg className="w-3.5 h-3.5 text-pink-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
        </svg>
      }
    >
      <ProjectDashboard />
    </FloatingWindowShell>
  );
}
