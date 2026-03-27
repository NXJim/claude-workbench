/**
 * Shared CodeMirror 6 editor wrapper with syntax highlighting,
 * dark/light theme support, and language auto-detection.
 */

import { useRef, useEffect, useCallback } from 'react';
import { EditorView, placeholder as cmPlaceholder } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { basicSetup } from 'codemirror';
import { oneDark } from '@codemirror/theme-one-dark';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { html } from '@codemirror/lang-html';
import { json } from '@codemirror/lang-json';
import { css } from '@codemirror/lang-css';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { languages } from '@codemirror/language-data';

interface CodeMirrorEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** File extension or language hint (e.g., "md", "json", "html"). */
  language?: string;
  readOnly?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
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
    default:
      // Default to markdown for .md files and notes
      return markdown({ base: markdownLanguage, codeLanguages: languages });
  }
}

/** Check if dark mode is active (Tailwind class-based). */
function isDarkMode(): boolean {
  return document.documentElement.classList.contains('dark');
}

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

    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        themeCompartment.current.of(themeExt),
        langCompartment.current.of(langExt),
        readOnlyCompartment.current.of(EditorView.editable.of(!readOnly)),
        EditorView.lineWrapping,
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
