/**
 * react-mosaic tiling container.
 * Renders tiles in a resizable grid layout.
 * Supports null leaves as empty slots with a session picker.
 * Dispatches tile content by window key prefix (term:, note:, etc.).
 */

import { useMemo, useCallback } from 'react';
import { Mosaic, MosaicWindow, type MosaicNode } from 'react-mosaic-component';
import { useLayoutStore, type LayoutNode } from '@/stores/layoutStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useShallow } from 'zustand/react/shallow';
import { TerminalTile } from './TerminalTile';
import { isTerminalKey, sessionIdFromKey, windowKey } from '@/types/windows';
import 'react-mosaic-component/react-mosaic-component.css';

/** Unique key for null leaves so react-mosaic can track them. */
const NULL_PREFIX = '__empty__';

/** Assign stable placeholder IDs to null leaves in the layout tree.
 *  Uses a path-based key so the same null slot always gets the same ID. */
function assignNullIds(node: LayoutNode, path: string = 'root'): any {
  if (node === null) return `${NULL_PREFIX}${path}`;
  if (typeof node === 'string') return node;
  return {
    ...node,
    first: assignNullIds(node.first, `${path}_0`),
    second: assignNullIds(node.second, `${path}_1`),
  };
}

/** Convert mosaic changes back to our LayoutNode format,
 *  restoring __empty__ strings to null. */
function fromMosaicNode(node: any): LayoutNode {
  if (node === null || node === undefined) return null;
  if (typeof node === 'string') {
    return node.startsWith(NULL_PREFIX) ? null : node;
  }
  return {
    ...node,
    first: fromMosaicNode(node.first),
    second: fromMosaicNode(node.second),
  };
}

/** Deep structural equality for layout trees. */
function layoutsEqual(a: LayoutNode, b: LayoutNode): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a === 'string' || typeof b === 'string') return a === b;
  return (
    a.direction === b.direction &&
    a.splitPercentage === b.splitPercentage &&
    layoutsEqual(a.first, b.first) &&
    layoutsEqual(a.second, b.second)
  );
}

/** Replace the null at the given path-based ID in the layout tree. */
function fillNullByPath(node: LayoutNode, targetPath: string, windowId: string, currentPath: string = 'root'): LayoutNode {
  if (node === null) {
    return currentPath === targetPath ? windowId : null;
  }
  if (typeof node === 'string') return node;
  const first = fillNullByPath(node.first, targetPath, windowId, `${currentPath}_0`);
  if (first !== node.first) return { ...node, first: first as MosaicNode<string> };
  const second = fillNullByPath(node.second, targetPath, windowId, `${currentPath}_1`);
  if (second !== node.second) return { ...node, second: second as MosaicNode<string> };
  return node;
}

/** Empty slot component — shows available sessions to pick from. */
function EmptySlot({ slotId }: { slotId: string }) {
  const sessions = useSessionStore(useShallow((s) => s.sessions.filter((s) => s.is_alive)));
  const { tilingLayout, setTilingLayout } = useLayoutStore();

  const handleSelect = (sessionId: string) => {
    const path = slotId.replace(NULL_PREFIX, '');
    const wId = windowKey({ type: 'terminal', sessionId });
    const filled = fillNullByPath(tilingLayout, path, wId);
    setTilingLayout(filled);
  };

  // Collect IDs already in the layout to avoid duplicates
  const usedIds = new Set<string>();
  const collect = (node: LayoutNode) => {
    if (node === null) return;
    if (typeof node === 'string') { usedIds.add(node); return; }
    collect(node.first);
    collect(node.second);
  };
  collect(tilingLayout);

  // Extract session IDs from used window keys
  const usedSessionIds = new Set<string>();
  usedIds.forEach((id) => {
    const sid = sessionIdFromKey(id);
    if (sid) usedSessionIds.add(sid);
  });

  const available = sessions.filter(s => !usedSessionIds.has(s.id));

  return (
    <div className="flex items-center justify-center h-full bg-surface-50 dark:bg-surface-900">
      <div className="text-center space-y-3 p-4">
        {available.length === 0 ? (
          <>
            <p className="text-sm font-medium text-surface-400 dark:text-surface-500">No sessions available</p>
            <p className="text-xs text-surface-500 dark:text-surface-600">Create one with Ctrl+N</p>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-surface-500 dark:text-surface-400">Select a session</p>
            <div className="max-h-48 overflow-y-auto space-y-1">
              {available.map((s) => (
                <button
                  key={s.id}
                  onClick={() => handleSelect(s.id)}
                  className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-sm rounded hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors text-surface-700 dark:text-surface-300"
                >
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: s.color }}
                  />
                  {s.display_name || `Session ${s.id.slice(0, 8)}`}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Dispatch tile content by window key prefix. */
function TileContent({ windowId }: { windowId: string }) {
  // Terminal windows (most common)
  if (isTerminalKey(windowId)) {
    const sid = sessionIdFromKey(windowId);
    if (sid) return <TerminalTile sessionId={sid} windowId={windowId} />;
  }

  // Future tile types:
  // if (windowId.startsWith('note:')) return <NoteTile noteId={windowId.slice(5)} />;
  // if (windowId.startsWith('snip:')) return <SnippetTile snippetId={windowId.slice(5)} />;
  // if (windowId.startsWith('cmd:'))  return <ClaudeMdTile filePath={windowId.slice(4)} />;
  // if (windowId.startsWith('dash:')) return <DashboardTile />;
  // if (windowId.startsWith('clip:')) return <ClipboardTile />;

  return (
    <div className="flex items-center justify-center h-full bg-surface-50 dark:bg-surface-900 text-surface-400 text-sm">
      Unknown window: {windowId}
    </div>
  );
}

export function TilingWorkspace() {
  const { tilingLayout, setTilingLayout } = useLayoutStore();

  // Generate stable mosaic value from layout with null placeholders.
  const mosaicValue = useMemo(() => {
    if (!tilingLayout) return null;
    return assignNullIds(tilingLayout);
  }, [tilingLayout]);

  // Stable onChange that skips no-op updates
  const handleChange = useCallback((newLayout: any) => {
    if (!newLayout) return;
    const converted = fromMosaicNode(newLayout);
    const current = useLayoutStore.getState().tilingLayout;
    if (!layoutsEqual(current, converted)) {
      setTilingLayout(converted);
    }
  }, [setTilingLayout]);

  if (!tilingLayout || !mosaicValue) {
    return (
      <div className="flex items-center justify-center h-full text-surface-400 dark:text-surface-500">
        <div className="text-center">
          <svg className="w-16 h-16 mx-auto mb-4 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <p className="text-lg font-medium mb-1">No sessions open</p>
          <p className="text-sm">Click a project in the sidebar or press Ctrl+N to create a session</p>
        </div>
      </div>
    );
  }

  return (
    <Mosaic<string>
      renderTile={(id, path) => {
        const isEmpty = id.startsWith(NULL_PREFIX);
        return (
          <MosaicWindow<string> path={path} title="" toolbarControls={<></>}>
            <div data-tile-window-id={id} className="h-full">
              {isEmpty ? (
                <EmptySlot slotId={id} />
              ) : (
                <TileContent windowId={id} />
              )}
            </div>
          </MosaicWindow>
        );
      }}
      value={mosaicValue}
      onChange={handleChange}
      className="mosaic-blueprint-theme"
    />
  );
}
