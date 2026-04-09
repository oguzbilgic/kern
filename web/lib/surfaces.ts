"use client";

import { useState, useEffect } from "react";
import type { ReactNode } from "react";

/**
 * A Surface is a content pane that a plugin or core feature registers.
 * Core decides how to display it (modal tab, side panel, etc.)
 * The surface only provides content + metadata.
 */
export interface Surface {
  /** Unique id, e.g. "memory:sessions", "dashboard:homelab" */
  id: string;
  /** Group surfaces into categories for tab grouping */
  group: string;
  /** Display label */
  label: string;
  /** Small icon ReactNode (optional) */
  icon?: ReactNode;
  /** Render the surface content — just the interior, no chrome */
  render: () => ReactNode;
  /** Preferred display mode hint (core decides final presentation) */
  mode?: "modal" | "panel";
  /** Badge count for sidebar/tab indicators */
  badge?: () => number | null;
  /** Preferred panel width range */
  panelWidth?: { min: number; max: number; default: number };
  /** Called by SurfaceManager when user closes this surface */
  onClose?: () => void;
}

// --- Surface registry (singleton) ---

type Listener = () => void;

let _surfaces: Surface[] = [];
const _listeners: Set<Listener> = new Set();

function notify() {
  _listeners.forEach(fn => fn());
}

export function registerSurface(surface: Surface) {
  const idx = _surfaces.findIndex(s => s.id === surface.id);
  if (idx >= 0) {
    _surfaces[idx] = surface; // update in place
  } else {
    _surfaces.push(surface);
  }
  notify();
}

export function unregisterSurface(id: string) {
  const before = _surfaces.length;
  _surfaces = _surfaces.filter(s => s.id !== id);
  if (_surfaces.length !== before) notify();
}

export function getSurfaces(): Surface[] {
  return _surfaces;
}

export function getSurfacesByGroup(group: string): Surface[] {
  return _surfaces.filter(s => s.group === group);
}

export function getSurfaceGroups(): string[] {
  const seen = new Set<string>();
  const groups: string[] = [];
  for (const s of _surfaces) {
    if (!seen.has(s.group)) {
      seen.add(s.group);
      groups.push(s.group);
    }
  }
  return groups;
}

export function onSurfaceChange(fn: Listener): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

export function clearSurfaces() {
  _surfaces = [];
  notify();
}

/** React hook — re-renders when surfaces change */
export function useSurfaces() {
  const [, setTick] = useState(0);
  useEffect(() => onSurfaceChange(() => setTick(t => t + 1)), []);
  return { surfaces: getSurfaces(), hasPanels: getSurfaces().some(s => s.mode === "panel") };
}
