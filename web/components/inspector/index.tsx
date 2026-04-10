"use client";

import { useEffect, useRef } from "react";
import { registerSurface, unregisterSurface } from "../../lib/surfaces";
import { SessionsTab } from "./SessionsTab";
import { SegmentsTab } from "./SegmentsTab";
import { NotesTab } from "./NotesTab";
import { RecallTab } from "./RecallTab";
import { MediaTab } from "./MediaTab";
import { ContextTab } from "./ContextTab";

interface Props {
  baseUrl: string;
  token: string | null;
}

const MEMORY_TABS = [
  { id: "memory:sessions", label: "Sessions", Component: SessionsTab },
  { id: "memory:segments", label: "Segments", Component: SegmentsTab },
  { id: "memory:notes", label: "Notes", Component: NotesTab },
  { id: "memory:recall", label: "Recall", Component: RecallTab },
  { id: "memory:media", label: "Media", Component: MediaTab },
  { id: "memory:context", label: "Context", Component: ContextTab },
];

/**
 * Hook that registers Memory Inspector tabs as modal surfaces.
 * Call once at app root. Surfaces are re-registered when agent changes
 * so each tab gets fresh props.
 */
export function useMemorySurfaces({ baseUrl, token }: Props) {
  const propsRef = useRef({ baseUrl, token });
  propsRef.current = { baseUrl, token };

  useEffect(() => {
    // Register all memory tabs as modal surfaces
    for (const tab of MEMORY_TABS) {
      registerSurface({
        id: tab.id,
        group: "memory",
        label: tab.label,
        mode: "modal",
        render: () => {
          const { baseUrl: b, token: t } = propsRef.current;
          return <tab.Component baseUrl={b} token={t} />;
        },
      });
    }

    return () => {
      for (const tab of MEMORY_TABS) {
        unregisterSurface(tab.id);
      }
    };
  }, []); // Register once, use ref for fresh props
}

/** First surface ID for opening the modal */
export const MEMORY_SURFACE_ID = MEMORY_TABS[0].id;
