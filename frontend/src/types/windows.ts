/**
 * Window descriptor types for the generalized window system.
 *
 * Every content type (terminal, note, snippet, etc.) uses the same
 * float/dock/tile infrastructure. The WindowDescriptor discriminated
 * union tells the window system what to render inside a given window.
 */

export type WindowType = 'terminal' | 'note' | 'snippet' | 'claude-md' | 'dashboard' | 'clipboard' | 'scratch-pad' | 'skill-browser' | 'skill-editor';

export interface TerminalWindow { type: 'terminal'; sessionId: string }
export interface NoteWindow { type: 'note'; noteId: string }
export interface SnippetWindow { type: 'snippet'; snippetId: string }
export interface ClaudeMdWindow { type: 'claude-md'; filePath: string }
export interface DashboardWindow { type: 'dashboard' }
export interface ClipboardWindow { type: 'clipboard' }
export interface ScratchPadWindow { type: 'scratch-pad'; sessionId: string }
export interface SkillBrowserWindow { type: 'skill-browser' }
export interface SkillEditorWindow { type: 'skill-editor'; skillPath: string }
export type WindowDescriptor =
  | TerminalWindow
  | NoteWindow
  | SnippetWindow
  | ClaudeMdWindow
  | DashboardWindow
  | ClipboardWindow
  | ScratchPadWindow
  | SkillBrowserWindow
  | SkillEditorWindow;

/** Prefix separators for window key encoding. */
const TYPE_PREFIXES: Record<WindowType, string> = {
  terminal: 'term',
  note: 'note',
  snippet: 'snip',
  'claude-md': 'cmd',
  dashboard: 'dash',
  clipboard: 'clip',
  'scratch-pad': 'spad',
  'skill-browser': 'sklb',
  'skill-editor': 'skle',
};

/** Generate a unique string key from a WindowDescriptor.
 *  e.g., "term:abc123", "note:xyz", "dash:_" */
export function windowKey(desc: WindowDescriptor): string {
  switch (desc.type) {
    case 'terminal': return `${TYPE_PREFIXES.terminal}:${desc.sessionId}`;
    case 'note': return `${TYPE_PREFIXES.note}:${desc.noteId}`;
    case 'snippet': return `${TYPE_PREFIXES.snippet}:${desc.snippetId}`;
    case 'claude-md': return `${TYPE_PREFIXES['claude-md']}:${desc.filePath}`;
    case 'dashboard': return `${TYPE_PREFIXES.dashboard}:_`;
    case 'clipboard': return `${TYPE_PREFIXES.clipboard}:_`;
    case 'scratch-pad': return `${TYPE_PREFIXES['scratch-pad']}:${desc.sessionId}`;
    case 'skill-browser': return `${TYPE_PREFIXES['skill-browser']}:_`;
    case 'skill-editor': return `${TYPE_PREFIXES['skill-editor']}:${desc.skillPath}`;
  }
}

/** Parse a window key string back into a WindowDescriptor.
 *  Handles legacy keys (no prefix) as terminal windows for backward compat. */
export function parseWindowKey(key: string): WindowDescriptor {
  const colonIdx = key.indexOf(':');

  // Legacy key — no prefix means terminal session ID
  if (colonIdx === -1) {
    return { type: 'terminal', sessionId: key };
  }

  const prefix = key.slice(0, colonIdx);
  const value = key.slice(colonIdx + 1);

  switch (prefix) {
    case 'term': return { type: 'terminal', sessionId: value };
    case 'note': return { type: 'note', noteId: value };
    case 'snip': return { type: 'snippet', snippetId: value };
    case 'cmd': return { type: 'claude-md', filePath: value };
    case 'dash': return { type: 'dashboard' };
    case 'clip': return { type: 'clipboard' };
    case 'spad': return { type: 'scratch-pad', sessionId: value };
    case 'sklb': return { type: 'skill-browser' };
    case 'skle': return { type: 'skill-editor', skillPath: value };
    default:
      // Unknown prefix — treat as terminal session ID for safety
      return { type: 'terminal', sessionId: key };
  }
}

/** Check if a window key represents a terminal window. */
export function isTerminalKey(key: string): boolean {
  return !key.includes(':') || key.startsWith('term:');
}

/** Extract the session ID from a terminal window key. */
export function sessionIdFromKey(key: string): string | null {
  if (!key.includes(':')) return key;
  if (key.startsWith('term:')) return key.slice(5);
  return null;
}

/** Get a human-readable title for a window descriptor. */
export function windowTitle(desc: WindowDescriptor): string {
  switch (desc.type) {
    case 'terminal': return `Terminal`;
    case 'note': return `Note`;
    case 'snippet': return `Snippet`;
    case 'claude-md': return `CLAUDE.md`;
    case 'dashboard': return `Dashboard`;
    case 'clipboard': return `Clipboard`;
    case 'scratch-pad': return `Scratch Pad`;
    case 'skill-browser': return `Skills`;
    case 'skill-editor': return `Skill Editor`;
  }
}
