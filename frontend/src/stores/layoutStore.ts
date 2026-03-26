/**
 * Layout state — tiling (react-mosaic) + floating windows.
 *
 * Tiling nodes are either a window key string, null (empty slot), or
 * a split {direction, first, second, splitPercentage}.
 *
 * Window keys encode both the window type and its content ID:
 *   "term:abc123" — terminal session
 *   "note:xyz"    — note editor
 *   "snip:xyz"    — snippet viewer
 *   "cmd:/path"   — CLAUDE.md editor
 *   "dash:_"      — project dashboard
 *   "clip:_"      — cross-session clipboard
 *
 * Legacy keys (no colon) are treated as terminal session IDs for
 * backward compatibility with saved layouts.
 */

import { create } from 'zustand';
import { api } from '@/api/client';
import type { LayoutPresetData } from '@/api/client';
import type { MosaicNode } from 'react-mosaic-component';
import { useSessionStore } from './sessionStore';
import { type WindowDescriptor, windowKey, parseWindowKey, isTerminalKey, sessionIdFromKey } from '@/types/windows';

// Our layout tree allows null leaves (empty slots)
export type LayoutNode = MosaicNode<string> | null;

/** Dock target during floating window drag. */
export type DockTarget =
  | { type: 'maximize' }
  | { type: 'tile'; tileWindowId: string };

export interface FloatingWindow {
  /** Unique window key — e.g., "term:abc123", "note:xyz" */
  id: string;
  /** Describes what content this window holds. */
  descriptor: WindowDescriptor;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
}

interface LayoutState {
  tilingLayout: LayoutNode;
  floatingWindows: FloatingWindow[];
  sidebarPinned: boolean;
  sidebarWidth: number;
  sidebarSectionRatios: [number, number, number]; // Projects, Sessions, Notes
  presets: Array<LayoutPresetData>;
  nextZIndex: number;
  activeWorkspaceId: number | null;
  /** Current dock target while dragging a floating window. */
  dockTarget: DockTarget | null;
  /** Timestamp until which bringToFront is suppressed (prevents iframe focus
   *  polling from scrambling z-order during workspace switch / layout restore). */
  zOrderFrozenUntil: number;

  setTilingLayout: (layout: LayoutNode) => void;
  addToTiling: (windowId: string) => void;
  removeFromTiling: (windowId: string) => void;
  /** Open any window type as floating. */
  openWindow: (descriptor: WindowDescriptor) => void;
  popOut: (windowId: string, descriptor?: WindowDescriptor) => void;
  dockBack: (windowId: string) => void;
  /** Dock a floating window into a specific tile slot, evicting its current occupant. */
  dockToTile: (floatingWindowId: string, targetTileWindowId: string) => void;
  setDockTarget: (target: DockTarget | null) => void;
  clearDrag: () => void;
  updateFloatingWindow: (windowId: string, updates: Partial<FloatingWindow>) => void;
  bringToFront: (windowId: string) => void;
  removeFloating: (windowId: string) => void;
  toggleSidebarPin: () => void;
  setSidebarPinned: (pinned: boolean) => void;
  setSidebarWidth: (width: number) => void;
  setSidebarSectionRatios: (ratios: [number, number, number]) => void;
  fetchPresets: () => Promise<void>;
  saveLayout: () => Promise<void>;
  restoreLayout: () => Promise<void>;
  loadPreset: (layoutJson: string) => void;

  // Workspace actions
  switchWorkspace: (presetId: number) => Promise<void>;
  saveAsWorkspace: (name: string) => Promise<void>;
  loadWorkspace: (preset: LayoutPresetData) => void;
  updateWorkspace: (presetId: number) => Promise<void>;
  deleteWorkspace: (presetId: number, terminateSessions?: boolean) => Promise<void>;
  renameWorkspace: (presetId: number, name: string) => Promise<void>;
  reorderWorkspaces: (orderedIds: number[]) => Promise<void>;
  setWorkspaceColor: (presetId: number, color: string | null) => Promise<void>;
}

/** Collect all window IDs currently in the layout tree. */
function collectIds(node: LayoutNode): string[] {
  if (node === null) return [];
  if (typeof node === 'string') return [node];
  return [...collectIds(node.first), ...collectIds(node.second)];
}

/** Check if a window ID exists anywhere in the tree. */
function containsId(node: LayoutNode, id: string): boolean {
  if (node === null) return false;
  if (typeof node === 'string') return node === id;
  return containsId(node.first, id) || containsId(node.second, id);
}

/** Replace the first null leaf with the given window ID. Returns
 *  the new tree, or the same reference if no null was found. */
function fillFirstNull(node: LayoutNode, windowId: string): LayoutNode {
  if (node === null) return windowId;
  if (typeof node === 'string') return node;
  const filledFirst = fillFirstNull(node.first, windowId);
  if (filledFirst !== node.first) return { ...node, first: filledFirst as MosaicNode<string> };
  const filledSecond = fillFirstNull(node.second, windowId);
  if (filledSecond !== node.second) return { ...node, second: filledSecond as MosaicNode<string> };
  return node;
}

/** Replace a specific null leaf (by path) with a window ID. */
function fillAtPath(node: LayoutNode, path: number[], windowId: string): LayoutNode {
  if (path.length === 0) return node === null ? windowId : node;
  if (node === null || typeof node === 'string') return node;
  const [head, ...rest] = path;
  if (head === 0) return { ...node, first: fillAtPath(node.first, rest, windowId) as MosaicNode<string> };
  return { ...node, second: fillAtPath(node.second, rest, windowId) as MosaicNode<string> };
}

/** Replace a leaf node's window ID with a new one. */
function replaceLeaf(node: LayoutNode, oldId: string, newId: string): LayoutNode {
  if (node === null) return null;
  if (typeof node === 'string') return node === oldId ? newId : node;
  return {
    ...node,
    first: replaceLeaf(node.first, oldId, newId) as MosaicNode<string>,
    second: replaceLeaf(node.second, oldId, newId) as MosaicNode<string>,
  };
}

/**
 * Validate window references against live sessions.
 * - Terminal keys referencing dead sessions are nullified in tiling, removed from floating.
 * - Non-terminal windows always pass.
 */
function validateTilingReferences(node: LayoutNode, liveSessionIds: Set<string>): LayoutNode {
  if (node === null) return null;
  if (typeof node === 'string') {
    if (isTerminalKey(node)) {
      const sid = sessionIdFromKey(node);
      return sid && liveSessionIds.has(sid) ? node : null;
    }
    return node; // Non-terminal windows always valid
  }
  const first = validateTilingReferences(node.first, liveSessionIds);
  const second = validateTilingReferences(node.second, liveSessionIds);
  return { ...node, first: first as MosaicNode<string>, second: second as MosaicNode<string> };
}

function validateFloatingReferences(windows: FloatingWindow[], liveSessionIds: Set<string>): FloatingWindow[] {
  return windows.filter((fw) => {
    if (isTerminalKey(fw.id)) {
      const sid = sessionIdFromKey(fw.id);
      return sid && liveSessionIds.has(sid);
    }
    return true; // Non-terminal windows always valid
  });
}

export const useLayoutStore = create<LayoutState>((set, get) => ({
  tilingLayout: null,
  floatingWindows: [],
  sidebarPinned: true,
  sidebarWidth: 280,
  sidebarSectionRatios: [0.5, 0.3, 0.2],
  presets: [],
  nextZIndex: 10,
  activeWorkspaceId: null,
  zOrderFrozenUntil: 0,
  dockTarget: null,

  setTilingLayout: (layout) => {
    set({ tilingLayout: layout });
  },

  addToTiling: (windowId) => {
    const { tilingLayout } = get();

    // No layout — set as root
    if (!tilingLayout) {
      set({ tilingLayout: windowId });
      return;
    }

    // Already present
    if (containsId(tilingLayout, windowId)) return;

    // Try to fill an empty slot first
    const filled = fillFirstNull(tilingLayout, windowId);
    if (filled !== tilingLayout) {
      set({ tilingLayout: filled });
      return;
    }

    // No empty slots — add as new split
    const newLayout: MosaicNode<string> = {
      direction: 'row',
      first: tilingLayout as MosaicNode<string>,
      second: windowId,
      splitPercentage: 60,
    };
    set({ tilingLayout: newLayout });
  },

  removeFromTiling: (windowId) => {
    const { tilingLayout } = get();
    if (!tilingLayout) return;
    if (typeof tilingLayout === 'string') {
      if (tilingLayout === windowId) {
        set({ tilingLayout: null });
      }
      return;
    }
    const remove = (node: LayoutNode): LayoutNode => {
      if (node === null) return null;
      if (typeof node === 'string') {
        return node === windowId ? null : node;
      }
      const first = remove(node.first);
      const second = remove(node.second);
      if (!first && !second) return null;
      if (!first) return second;
      if (!second) return first;
      return { ...node, first, second };
    };
    set({ tilingLayout: remove(tilingLayout) });
  },

  openWindow: (descriptor) => {
    const wId = windowKey(descriptor);
    const { floatingWindows, nextZIndex, tilingLayout } = get();

    // Already floating — bring to front
    if (floatingWindows.some((fw) => fw.id === wId)) {
      get().bringToFront(wId);
      return;
    }

    // Already tiled — skip
    if (containsId(tilingLayout, wId)) return;

    const fw: FloatingWindow = {
      id: wId,
      descriptor,
      x: 100 + floatingWindows.length * 30,
      y: 100 + floatingWindows.length * 30,
      width: 800,
      height: 500,
      zIndex: nextZIndex,
    };
    set({
      floatingWindows: [...floatingWindows, fw],
      nextZIndex: nextZIndex + 1,
    });
  },

  popOut: (windowId, descriptor) => {
    const { floatingWindows, nextZIndex, tilingLayout } = get();

    // Already floating — just bring to front
    if (floatingWindows.some((fw) => fw.id === windowId)) {
      get().bringToFront(windowId);
      return;
    }

    // Already tiled — skip (user must pop-out via header button)
    if (containsId(tilingLayout, windowId)) {
      return;
    }

    // Build descriptor from windowId if not provided
    const desc: WindowDescriptor = descriptor || (
      windowId.includes(':')
        ? (() => {
            const [prefix, ...rest] = windowId.split(':');
            const value = rest.join(':');
            switch (prefix) {
              case 'term': return { type: 'terminal' as const, sessionId: value };
              case 'note': return { type: 'note' as const, noteId: value };
              case 'snip': return { type: 'snippet' as const, snippetId: value };
              case 'cmd': return { type: 'claude-md' as const, filePath: value };
              case 'dash': return { type: 'dashboard' as const };
              case 'clip': return { type: 'clipboard' as const };
              default: return { type: 'terminal' as const, sessionId: windowId };
            }
          })()
        : { type: 'terminal' as const, sessionId: windowId }
    );

    // Normalize the windowId to use prefixed format
    const normalizedId = windowKey(desc);

    const fw: FloatingWindow = {
      id: normalizedId,
      descriptor: desc,
      x: 100 + floatingWindows.length * 30,
      y: 100 + floatingWindows.length * 30,
      width: 800,
      height: 500,
      zIndex: nextZIndex,
    };
    set({
      floatingWindows: [...floatingWindows, fw],
      nextZIndex: nextZIndex + 1,
    });
  },

  dockBack: (windowId) => {
    set((s) => ({
      floatingWindows: s.floatingWindows.filter((fw) => fw.id !== windowId),
    }));
    get().addToTiling(windowId);
  },

  dockToTile: (floatingWindowId, targetTileWindowId) => {
    const { tilingLayout, floatingWindows, nextZIndex } = get();
    const fw = floatingWindows.find((f) => f.id === floatingWindowId);
    if (!fw) return;

    const NULL_PREFIX = '__empty__';

    if (targetTileWindowId.startsWith(NULL_PREFIX)) {
      // Empty slot — fill it with the floating window, no eviction
      const newLayout = replaceLeaf(tilingLayout, targetTileWindowId, floatingWindowId);
      set({
        tilingLayout: newLayout,
        floatingWindows: floatingWindows.filter((f) => f.id !== floatingWindowId),
      });
    } else {
      // Occupied tile — swap: dock the floating window, evict the tile to floating
      const newLayout = replaceLeaf(tilingLayout, targetTileWindowId, floatingWindowId);
      const evictedDescriptor = parseWindowKey(targetTileWindowId);
      const evictedFw: FloatingWindow = {
        id: targetTileWindowId,
        descriptor: evictedDescriptor,
        x: fw.x,
        y: fw.y,
        width: fw.width,
        height: fw.height,
        zIndex: nextZIndex,
      };
      set({
        tilingLayout: newLayout,
        floatingWindows: [
          ...floatingWindows.filter((f) => f.id !== floatingWindowId),
          evictedFw,
        ],
        nextZIndex: nextZIndex + 1,
      });
    }
  },

  setDockTarget: (target) => set({ dockTarget: target }),

  clearDrag: () => set({ dockTarget: null }),

  updateFloatingWindow: (windowId, updates) => {
    set((s) => ({
      floatingWindows: s.floatingWindows.map((fw) =>
        fw.id === windowId ? { ...fw, ...updates } : fw
      ),
    }));
  },

  bringToFront: (windowId) => {
    let { floatingWindows, nextZIndex, zOrderFrozenUntil } = get();
    // During workspace switch / layout restore, iframe focus polling fires
    // as terminals load — skip to preserve the saved z-order.
    if (Date.now() < zOrderFrozenUntil) return;
    // Skip if already the topmost window — avoids a re-render that
    // clears text selection inside cross-origin iframes.
    const target = floatingWindows.find((fw) => fw.id === windowId);
    if (target) {
      const maxZ = Math.max(...floatingWindows.map((fw) => fw.zIndex));
      if (target.zIndex >= maxZ) return;
    }

    // Renormalize z-indexes when they drift too high to avoid
    // reaching UI chrome z-index ranges (sidebar/header at z-300+)
    if (nextZIndex > 200) {
      const sorted = [...floatingWindows].sort((a, b) => a.zIndex - b.zIndex);
      const zMap = new Map<string, number>();
      sorted.forEach((fw, i) => zMap.set(fw.id, 10 + i));
      floatingWindows = floatingWindows.map((fw) => ({ ...fw, zIndex: zMap.get(fw.id)! }));
      nextZIndex = 10 + sorted.length;
    }

    set({
      floatingWindows: floatingWindows.map((fw) =>
        fw.id === windowId ? { ...fw, zIndex: nextZIndex } : fw
      ),
      nextZIndex: nextZIndex + 1,
    });
  },

  removeFloating: (windowId) => {
    set((s) => ({
      floatingWindows: s.floatingWindows.filter((fw) => fw.id !== windowId),
    }));
  },

  toggleSidebarPin: () => set((s) => ({ sidebarPinned: !s.sidebarPinned })),

  setSidebarPinned: (pinned) => set({ sidebarPinned: pinned }),

  setSidebarWidth: (width) => set({ sidebarWidth: width }),

  setSidebarSectionRatios: (ratios) => set({ sidebarSectionRatios: ratios }),

  fetchPresets: async () => {
    try {
      const presets = await api.listLayoutPresets();
      set({ presets });
    } catch {
      // Presets are optional
    }
  },

  saveLayout: async () => {
    const { tilingLayout, floatingWindows, sidebarPinned, sidebarWidth, sidebarSectionRatios, activeWorkspaceId } = get();
    try {
      // 1. Sidebar state → active layout singleton (inverted for backward compat)
      // Don't persist the virtual orphaned workspace ID (-1)
      const persistableWsId = activeWorkspaceId && activeWorkspaceId > 0 ? activeWorkspaceId : 0;
      await api.saveActiveLayout({
        sidebar_collapsed: !sidebarPinned,
        sidebar_width: sidebarWidth,
        sidebar_section_ratios: sidebarSectionRatios,
        active_workspace_id: persistableWsId,
      });

      // 2. Tiling + floating → active workspace preset
      if (activeWorkspaceId && activeWorkspaceId > 0) {
        await api.updateLayoutPreset(activeWorkspaceId, {
          layout_json: tilingLayout ? JSON.stringify(tilingLayout) : 'null',
          floating_json: floatingWindows.length > 0 ? JSON.stringify(floatingWindows) : '[]',
        });
      }
    } catch {
      // Non-critical
    }
  },

  restoreLayout: async () => {
    try {
      const layout = await api.getActiveLayout();
      const activeWsId = layout.active_workspace_id ?? null;

      // Fetch sessions filtered by workspace
      const sessionStore = useSessionStore.getState();
      await sessionStore.fetchSessions(activeWsId);

      const liveIds = new Set(
        useSessionStore.getState().sessions.filter((s) => s.is_alive).map((s) => s.id)
      );

      // Load tiling+floating from the workspace preset (not from active_layout)
      let tilingLayout: LayoutNode = null;
      let floatingWindows: FloatingWindow[] = [];

      if (activeWsId) {
        const { presets } = get();
        const wsPreset = presets.find((p) => p.id === activeWsId);
        if (wsPreset) {
          // Parse tiling from workspace preset
          try {
            const parsed = JSON.parse(wsPreset.layout_json);
            tilingLayout = validateTilingReferences(parsed, liveIds);
          } catch {
            // Invalid JSON
          }

          // Parse floating from workspace preset
          if (wsPreset.floating_json) {
            try {
              const parsed = JSON.parse(wsPreset.floating_json) as FloatingWindow[];
              floatingWindows = validateFloatingReferences(parsed, liveIds);
            } catch {
              // Invalid JSON
            }
          }
        }
      }

      // Deduplicate: remove floating windows already present in the tiling tree
      // (stale floating_json from a previous save can cause duplicates)
      const tiledIds = new Set(collectIds(tilingLayout));
      floatingWindows = floatingWindows.filter((fw) => !tiledIds.has(fw.id));

      // Set nextZIndex above any restored z-indices
      const maxZ = floatingWindows.length > 0
        ? Math.max(...floatingWindows.map((fw) => fw.zIndex))
        : 9;

      set({
        tilingLayout,
        floatingWindows,
        sidebarPinned: !layout.sidebar_collapsed,
        sidebarWidth: layout.sidebar_width,
        sidebarSectionRatios: layout.sidebar_section_ratios || [0.5, 0.3, 0.2],
        nextZIndex: maxZ + 1,
        activeWorkspaceId: activeWsId,
        // Suppress bringToFront for 2s while iframes load and steal focus
        zOrderFrozenUntil: Date.now() + 2000,
      });
    } catch {
      // Start fresh
    }
  },

  loadPreset: (layoutJson) => {
    try {
      const layout = JSON.parse(layoutJson) as LayoutNode;

      // Auto-fill null slots with available session IDs from the current workspace
      const sessions = useSessionStore.getState().sessions.filter(s => s.is_alive);
      let filled: LayoutNode = layout;
      for (const session of sessions) {
        const wId = windowKey({ type: 'terminal', sessionId: session.id });
        if (typeof filled === 'string') break; // single leaf, already filled
        if (filled !== null && containsId(filled, wId)) continue;
        const next = fillFirstNull(filled, wId);
        if (next === filled) break; // no more empty slots
        filled = next;
      }

      // Template presets rearrange within the current workspace — don't clear workspace mode
      set({ tilingLayout: filled, floatingWindows: [] });
    } catch {
      // Invalid preset
    }
  },

  // --- Workspace actions ---

  switchWorkspace: async (presetId: number) => {
    const { activeWorkspaceId } = get();

    // Save current workspace's layout before switching
    if (activeWorkspaceId && activeWorkspaceId > 0 && activeWorkspaceId !== presetId) {
      await get().updateWorkspace(activeWorkspaceId);
    }

    // Virtual "Orphaned" workspace (ID=-1) — show orphaned sessions, no layout
    if (presetId === -1) {
      set({ activeWorkspaceId: presetId, tilingLayout: null, floatingWindows: [] });
      await useSessionStore.getState().fetchOrphanedSessions();
      return;
    }

    // Find the target workspace preset
    const { presets } = get();
    const wsPreset = presets.find((p) => p.id === presetId);
    if (!wsPreset) return;

    // Set active workspace
    set({ activeWorkspaceId: presetId });

    // Fetch sessions for the new workspace
    await useSessionStore.getState().fetchSessions(presetId);

    const liveIds = new Set(
      useSessionStore.getState().sessions.filter((s) => s.is_alive).map((s) => s.id)
    );

    // Parse and validate tiling from workspace preset
    let tilingLayout: LayoutNode = null;
    try {
      const parsed = JSON.parse(wsPreset.layout_json);
      tilingLayout = validateTilingReferences(parsed, liveIds);
    } catch {
      // Invalid
    }

    // Parse and validate floating from workspace preset
    let floatingWindows: FloatingWindow[] = [];
    if (wsPreset.floating_json) {
      try {
        const parsed = JSON.parse(wsPreset.floating_json) as FloatingWindow[];
        floatingWindows = validateFloatingReferences(parsed, liveIds);
      } catch {
        // Invalid
      }
    }

    // Deduplicate: remove floating windows already present in the tiling tree
    const tiledIds = new Set(collectIds(tilingLayout));
    floatingWindows = floatingWindows.filter((fw) => !tiledIds.has(fw.id));

    const maxZ = floatingWindows.length > 0
      ? Math.max(...floatingWindows.map((fw) => fw.zIndex))
      : 99;

    set({
      tilingLayout,
      floatingWindows,
      nextZIndex: maxZ + 1,
      // Suppress bringToFront for 2s while iframes load and steal focus
      zOrderFrozenUntil: Date.now() + 2000,
    });

    // Persist active_workspace_id
    try {
      await api.saveActiveLayout({ active_workspace_id: presetId });
    } catch {
      // Non-critical
    }
  },

  saveAsWorkspace: async (name: string) => {
    const { activeWorkspaceId } = get();

    // Save current workspace's layout first (skip virtual orphaned workspace)
    if (activeWorkspaceId && activeWorkspaceId > 0) {
      await get().updateWorkspace(activeWorkspaceId);
    }

    try {
      // Create new empty workspace
      const preset = await api.createLayoutPreset({
        name,
        layout_json: 'null',
        floating_json: null,
        is_workspace: true,
      });

      // Switch to the new empty workspace
      set({
        activeWorkspaceId: preset.id,
        tilingLayout: null,
        floatingWindows: [],
      });

      // Fetch sessions for new workspace (will be empty)
      await useSessionStore.getState().fetchSessions(preset.id);

      // Persist active_workspace_id
      await api.saveActiveLayout({ active_workspace_id: preset.id });

      await get().fetchPresets();
    } catch {
      // Failed to save
    }
  },

  loadWorkspace: (preset: LayoutPresetData) => {
    // Legacy — use switchWorkspace instead for full workspace switching
    get().switchWorkspace(preset.id);
  },

  updateWorkspace: async (presetId: number) => {
    const { tilingLayout, floatingWindows } = get();
    const layoutJson = tilingLayout ? JSON.stringify(tilingLayout) : 'null';
    const floatingJson = floatingWindows.length > 0 ? JSON.stringify(floatingWindows) : '[]';
    try {
      await api.updateLayoutPreset(presetId, {
        layout_json: layoutJson,
        floating_json: floatingJson,
      });
      // Update the local preset copy so switchWorkspace reads fresh data
      set((s) => ({
        presets: s.presets.map((p) =>
          p.id === presetId ? { ...p, layout_json: layoutJson, floating_json: floatingJson } : p
        ),
      }));
    } catch {
      // Non-critical — workspace may have been deleted
    }
  },

  deleteWorkspace: async (presetId: number, terminateSessions = false) => {
    try {
      await api.deleteLayoutPreset(presetId, terminateSessions);

      // Switch to first remaining workspace
      await get().fetchPresets();
      const { presets, activeWorkspaceId } = get();
      const remainingWorkspaces = presets.filter((p) => p.is_workspace);

      if (activeWorkspaceId === presetId && remainingWorkspaces.length > 0) {
        await get().switchWorkspace(remainingWorkspaces[0].id);
      }
    } catch {
      // Failed to delete
    }
  },

  renameWorkspace: async (presetId: number, name: string) => {
    try {
      await api.updateLayoutPreset(presetId, { name });
      await get().fetchPresets();
    } catch {
      // Failed to rename
    }
  },

  reorderWorkspaces: async (orderedIds: number[]) => {
    // Optimistic update — reorder presets locally first
    set((s) => {
      const orderMap = new Map(orderedIds.map((id, idx) => [id, idx]));
      const sorted = [...s.presets].sort((a, b) => {
        const oa = orderMap.get(a.id) ?? a.sort_order;
        const ob = orderMap.get(b.id) ?? b.sort_order;
        return oa - ob;
      });
      return { presets: sorted };
    });
    try {
      await api.reorderWorkspaces(orderedIds);
    } catch {
      // Revert on failure
      await get().fetchPresets();
    }
  },

  setWorkspaceColor: async (presetId: number, color: string | null) => {
    // Optimistic update
    set((s) => ({
      presets: s.presets.map((p) =>
        p.id === presetId ? { ...p, color } : p
      ),
    }));
    try {
      await api.updateLayoutPreset(presetId, { color: color ?? "" });
    } catch {
      await get().fetchPresets();
    }
  },
}));

// Re-export helpers for use in TilingWorkspace
export { collectIds, containsId, fillFirstNull, fillAtPath };
