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
import type { MosaicNode } from 'react-mosaic-component';
import { useSessionStore } from './sessionStore';
import { type WindowDescriptor, windowKey, isTerminalKey } from '@/types/windows';

// Our layout tree allows null leaves (empty slots)
export type LayoutNode = MosaicNode<string> | null;

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
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  sidebarSectionRatios: [number, number, number]; // Projects, Sessions, Notes
  presets: Array<{ id: number; name: string; layout_json: string; is_default: boolean }>;
  nextZIndex: number;

  setTilingLayout: (layout: LayoutNode) => void;
  addToTiling: (windowId: string) => void;
  removeFromTiling: (windowId: string) => void;
  /** Open any window type as floating. */
  openWindow: (descriptor: WindowDescriptor) => void;
  popOut: (windowId: string, descriptor?: WindowDescriptor) => void;
  dockBack: (windowId: string) => void;
  updateFloatingWindow: (windowId: string, updates: Partial<FloatingWindow>) => void;
  bringToFront: (windowId: string) => void;
  removeFloating: (windowId: string) => void;
  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;
  setSidebarSectionRatios: (ratios: [number, number, number]) => void;
  fetchPresets: () => Promise<void>;
  saveLayout: () => Promise<void>;
  restoreLayout: () => Promise<void>;
  loadPreset: (layoutJson: string) => void;
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

export const useLayoutStore = create<LayoutState>((set, get) => ({
  tilingLayout: null,
  floatingWindows: [],
  sidebarCollapsed: false,
  sidebarWidth: 280,
  sidebarSectionRatios: [0.5, 0.3, 0.2],
  presets: [],
  nextZIndex: 100,

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

  updateFloatingWindow: (windowId, updates) => {
    set((s) => ({
      floatingWindows: s.floatingWindows.map((fw) =>
        fw.id === windowId ? { ...fw, ...updates } : fw
      ),
    }));
  },

  bringToFront: (windowId) => {
    const { floatingWindows, nextZIndex } = get();
    // Skip if already the topmost window — avoids a re-render that
    // clears text selection inside cross-origin iframes.
    const target = floatingWindows.find((fw) => fw.id === windowId);
    if (target) {
      const maxZ = Math.max(...floatingWindows.map((fw) => fw.zIndex));
      if (target.zIndex >= maxZ) return;
    }
    set((s) => ({
      floatingWindows: s.floatingWindows.map((fw) =>
        fw.id === windowId ? { ...fw, zIndex: nextZIndex } : fw
      ),
      nextZIndex: nextZIndex + 1,
    }));
  },

  removeFloating: (windowId) => {
    set((s) => ({
      floatingWindows: s.floatingWindows.filter((fw) => fw.id !== windowId),
    }));
  },

  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

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
    const { tilingLayout, floatingWindows, sidebarCollapsed, sidebarWidth, sidebarSectionRatios } = get();
    try {
      await api.saveActiveLayout({
        tiling_json: tilingLayout ? JSON.stringify(tilingLayout) : null,
        floating_json: floatingWindows.length > 0 ? JSON.stringify(floatingWindows) : null,
        sidebar_collapsed: sidebarCollapsed,
        sidebar_width: sidebarWidth,
        sidebar_section_ratios: sidebarSectionRatios,
      });
    } catch {
      // Non-critical
    }
  },

  restoreLayout: async () => {
    try {
      const layout = await api.getActiveLayout();
      // Always start fresh — no sessions open. Only restore sidebar preferences.
      set({
        tilingLayout: null,
        floatingWindows: [],
        sidebarCollapsed: layout.sidebar_collapsed,
        sidebarWidth: layout.sidebar_width,
        sidebarSectionRatios: layout.sidebar_section_ratios || [0.5, 0.3, 0.2],
      });
    } catch {
      // Start fresh
    }
  },

  loadPreset: (layoutJson) => {
    try {
      const layout = JSON.parse(layoutJson) as LayoutNode;

      // Auto-fill null slots with available session IDs (as window keys)
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

      set({ tilingLayout: filled, floatingWindows: [] });
    } catch {
      // Invalid preset
    }
  },
}));

// Re-export helpers for use in TilingWorkspace
export { collectIds, containsId, fillFirstNull, fillAtPath };
