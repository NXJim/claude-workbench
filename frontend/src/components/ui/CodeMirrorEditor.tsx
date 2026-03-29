/**
 * Shared CodeMirror 6 editor wrapper with syntax highlighting,
 * dark/light theme support, and language auto-detection.
 */

import { useRef, useEffect, useCallback } from 'react';
import { EditorView, ViewPlugin, ViewUpdate, Decoration, DecorationSet, placeholder as cmPlaceholder } from '@codemirror/view';
import { EditorState, Compartment, RangeSetBuilder } from '@codemirror/state';
import { useConfigStore } from '@/stores/configStore';
import { basicSetup } from 'codemirror';
import { oneDark } from '@codemirror/theme-one-dark';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { html } from '@codemirror/lang-html';
import { json } from '@codemirror/lang-json';
import { css } from '@codemirror/lang-css';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { languages } from '@codemirror/language-data';
import { StreamLanguage } from '@codemirror/language';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { standardSQL } from '@codemirror/legacy-modes/mode/sql';
import { yaml } from '@codemirror/legacy-modes/mode/yaml';
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { highlightSpecialChars, drawSelection } from '@codemirror/view';

interface CodeMirrorEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** File extension or language hint (e.g., "md", "json", "html", "bash"). */
  language?: string;
  readOnly?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
  /** Minimal mode — syntax highlighting only, no line numbers/gutters/autocomplete.
   *  Ideal for read-only code blocks in the scratch pad. */
  minimal?: boolean;
}

/** Map file extension to CodeMirror language extension. */
function getLanguageExtension(lang?: string) {
  switch (lang?.toLowerCase().replace(/^\./, '')) {
    case 'md':
    case 'markdown':
      // Markdown with embedded code block highlighting via language-data
      return markdown({ base: markdownLanguage, codeLanguages: languages });
    case 'html':
    case 'htm':
      return html();
    case 'json':
      return json();
    case 'css':
      return css();
    case 'js':
    case 'jsx':
      return javascript({ jsx: true });
    case 'ts':
    case 'tsx':
      return javascript({ typescript: true, jsx: true });
    case 'py':
    case 'python':
      return python();
    case 'bash':
    case 'sh':
    case 'shell':
    case 'zsh':
      return StreamLanguage.define(shell);
    case 'sql':
      return StreamLanguage.define(standardSQL);
    case 'yaml':
    case 'yml':
      return StreamLanguage.define(yaml);
    default:
      // Default to markdown for .md files and notes
      return markdown({ base: markdownLanguage, codeLanguages: languages });
  }
}

/** Check if dark mode is active (Tailwind class-based). */
function isDarkMode(): boolean {
  return document.documentElement.classList.contains('dark');
}

/**
 * File path link detection plugin — makes local file paths (~/... /home/...)
 * clickable in the editor. Ctrl+Click opens the file in a floating window.
 * Skips paths inside fenced code blocks to avoid false positives.
 */
const FILE_PATH_RE = /(~\/|\/home\/\w+\/|\/etc\/|\/var\/|\/opt\/)[^\s`'"()\[\]{}<>]+\.\w{1,5}/g;
const FENCE_RE = /^```/;

const fileLinkMark = Decoration.mark({
  class: 'cm-file-link',
  attributes: { title: 'Ctrl+Click to open' },
});

/** Build decorations for all file paths in the visible range, skipping code fences. */
function buildFilePathDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;

  // Pre-scan the entire document to determine which lines are inside fenced code blocks.
  // We need full-document context because a fence opened above the viewport affects
  // lines inside the viewport.
  let insideFence = false;
  const fencedLines = new Set<number>();
  for (let i = 1; i <= doc.lines; i++) {
    const lineText = doc.line(i).text;
    if (FENCE_RE.test(lineText.trimStart())) {
      insideFence = !insideFence;
      fencedLines.add(i);  // the fence marker line itself
      continue;
    }
    if (insideFence) {
      fencedLines.add(i);
    }
  }

  // Now scan visible ranges for file paths, skipping fenced lines
  for (const { from, to } of view.visibleRanges) {
    const startLine = doc.lineAt(from).number;
    const endLine = doc.lineAt(to).number;
    for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
      if (fencedLines.has(lineNum)) continue;
      const line = doc.line(lineNum);
      FILE_PATH_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = FILE_PATH_RE.exec(line.text)) !== null) {
        const matchFrom = line.from + match.index;
        const matchTo = matchFrom + match[0].length;
        builder.add(matchFrom, matchTo, fileLinkMark);
      }
    }
  }

  return builder.finish();
}

/** ViewPlugin that decorates file paths and handles Ctrl+Click to open them. */
const filePathLinkPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildFilePathDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildFilePathDecorations(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    eventHandlers: {
      click(event: MouseEvent, view: EditorView) {
        // Only handle Ctrl+Click (Cmd+Click on Mac)
        if (!event.ctrlKey && !event.metaKey) return false;

        const target = event.target as HTMLElement;
        if (!target.classList.contains('cm-file-link')) return false;

        // Get the position in the document from the click coordinates
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos === null) return false;

        // Find the decoration range at this position to extract the full path
        const line = view.state.doc.lineAt(pos);
        FILE_PATH_RE.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = FILE_PATH_RE.exec(line.text)) !== null) {
          const matchFrom = line.from + match.index;
          const matchTo = matchFrom + match[0].length;
          if (pos >= matchFrom && pos <= matchTo) {
            // Found the path — expand ~ and open it
            let filePath = match[0];
            if (filePath.startsWith('~/')) {
              const homeDir = useConfigStore.getState().homeDir;
              if (homeDir) {
                filePath = homeDir + filePath.slice(1);
              }
            }
            // Open in a floating editor window via the claude-md store
            import('@/stores/claudeMdStore').then(({ useClaudeMdStore }) => {
              useClaudeMdStore.getState().openFile(filePath);
            });
            event.preventDefault();
            return true;
          }
        }
        return false;
      },
    },
  }
);

/** Light theme — minimal styling to match the existing UI. */
const lightTheme = EditorView.theme({
  '&': {
    fontSize: '13px',
    fontFamily: "'JetBrains Mono', monospace",
  },
  '.cm-content': {
    padding: '12px 0',
  },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    borderRight: 'none',
    color: 'var(--tw-surface-400, #9ca3af)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
  },
  '&.cm-focused .cm-activeLine': {
    backgroundColor: 'rgba(0, 0, 0, 0.04)',
  },
  '.cm-activeLine': {
    backgroundColor: 'transparent',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-placeholder': {
    color: 'var(--tw-surface-400, #9ca3af)',
  },
});

export function CodeMirrorEditor({
  value,
  onChange,
  language,
  readOnly = false,
  placeholder = '',
  autoFocus = false,
  className = '',
  minimal = false,
}: CodeMirrorEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const themeCompartment = useRef(new Compartment());
  const langCompartment = useRef(new Compartment());
  const readOnlyCompartment = useRef(new Compartment());
  // Track whether the change came from us (external sync) vs user typing
  const isExternalUpdate = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Initialize editor
  useEffect(() => {
    if (!containerRef.current) return;

    const dark = isDarkMode();
    const themeExt = dark ? oneDark : lightTheme;
    const langExt = getLanguageExtension(language);

    // Minimal mode: syntax highlighting only, no line numbers/gutters/autocomplete
    const baseExtensions = minimal
      ? [
          highlightSpecialChars(),
          drawSelection(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        ]
      : [basicSetup];

    const state = EditorState.create({
      doc: value,
      extensions: [
        ...baseExtensions,
        themeCompartment.current.of(themeExt),
        langCompartment.current.of(langExt),
        readOnlyCompartment.current.of(EditorView.editable.of(!readOnly)),
        EditorView.lineWrapping,
        filePathLinkPlugin,
        placeholder ? cmPlaceholder(placeholder) : [],
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !isExternalUpdate.current) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;
    if (autoFocus) view.focus();

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only run on mount
  }, []);

  // Sync external value changes (e.g., from store/polling) without resetting cursor
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const currentDoc = view.state.doc.toString();
    if (currentDoc !== value) {
      isExternalUpdate.current = true;
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: value },
      });
      isExternalUpdate.current = false;
    }
  }, [value]);

  // Sync language changes
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: langCompartment.current.reconfigure(getLanguageExtension(language)),
    });
  }, [language]);

  // Sync readOnly changes
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: readOnlyCompartment.current.reconfigure(EditorView.editable.of(!readOnly)),
    });
  }, [readOnly]);

  // Watch for dark mode changes via MutationObserver on <html> class
  const updateTheme = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    const dark = isDarkMode();
    view.dispatch({
      effects: themeCompartment.current.reconfigure(dark ? oneDark : lightTheme),
    });
  }, []);

  useEffect(() => {
    const observer = new MutationObserver(() => updateTheme());
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => observer.disconnect();
  }, [updateTheme]);

  return (
    <div
      ref={containerRef}
      className={`flex-1 overflow-auto ${className}`}
    />
  );
}
