import { useState, useEffect, useMemo } from "react";
import { A2uiSurface, MarkdownContext } from "@a2ui/react/v0_9";
import { createProcessor, type A2uiMessages } from "./processor.js";

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * Minimal renderer that treats agent text as plain text (HTML-escaped). Rich
 * markdown is a v2 polish (wire @a2ui/markdown-it); benefit copy is plain, and
 * escaping keeps gateway strings safe from HTML injection.
 */
const plainTextMarkdownRenderer = async (markdown: string): Promise<string> =>
  markdown.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);

/** One entry per card the shell wants shown, in display order. */
export interface CanvasCardLayout {
  cardId: string;
  expanded?: boolean;
}

export interface CanvasSurfacesProps {
  messages: A2uiMessages;
  /**
   * Shell-driven display order / visibility / expansion. When provided, cards
   * render in this order, hidden cards (absent from the list) are dropped, and
   * `expanded` is exposed as `data-expanded` for styling — all instantly,
   * without re-composing. When omitted, every surface renders in message order.
   */
  layout?: CanvasCardLayout[];
}

/**
 * Renders every A2UI surface produced by a batch of messages. This is the whole
 * renderer surface for v1 — domain-agnostic. The shell (apps/web) owns card
 * manipulation; here we only turn messages into pixels.
 */
export function CanvasSurfaces({ messages, layout }: CanvasSurfacesProps) {
  // Rebuild the processor whenever the message batch changes. The live app
  // mounts with an empty canvas and only sets messages after the first turn,
  // so a once-only useState initializer would leave the canvas permanently
  // blank.
  const processor = useMemo(() => createProcessor(messages), [messages]);
  const [surfaces, setSurfaces] = useState(() =>
    Array.from(processor.model.surfacesMap.values()),
  );

  useEffect(() => {
    const sync = () => setSurfaces(Array.from(processor.model.surfacesMap.values()));
    // createProcessor() processed the messages synchronously, so any surfaces
    // already exist before we subscribe — pick them up now, then track changes.
    sync();
    const created = processor.onSurfaceCreated(sync);
    const deleted = processor.onSurfaceDeleted(sync);
    return () => {
      created.unsubscribe();
      deleted.unsubscribe();
    };
  }, [processor]);

  const byId = new Map(surfaces.map((surface) => [surface.id, surface]));
  const ordered: Array<{ surface: (typeof surfaces)[number]; expanded: boolean }> = layout
    ? layout
        .map((entry) => ({ surface: byId.get(entry.cardId), expanded: entry.expanded ?? false }))
        .filter((entry): entry is { surface: (typeof surfaces)[number]; expanded: boolean } =>
          entry.surface !== undefined,
        )
    : surfaces.map((surface) => ({ surface, expanded: false }));

  return (
    <MarkdownContext.Provider value={plainTextMarkdownRenderer}>
      <div className="genui-canvas-surfaces">
        {ordered.map(({ surface, expanded }) => (
          <div
            key={surface.id}
            className="genui-canvas-card"
            data-card-id={surface.id}
            data-expanded={expanded ? "true" : "false"}
          >
            <A2uiSurface surface={surface} />
          </div>
        ))}
      </div>
    </MarkdownContext.Provider>
  );
}
