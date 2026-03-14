/**
 * Debug utility — UI-STANDARDS Section 2.1
 * Enable with localStorage.setItem('DEBUG', 'true')
 */

const DEBUG = localStorage.getItem('DEBUG') === 'true';

export function debug(id: string, description: string, data?: unknown) {
  if (!DEBUG) return;
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${id}] ${description}`, data ?? '');
}
