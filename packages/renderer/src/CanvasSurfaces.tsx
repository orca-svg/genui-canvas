import { useState, useEffect } from "react";
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

export interface CanvasSurfacesProps {
  messages: A2uiMessages;
}

/**
 * Renders every A2UI surface produced by a batch of messages. This is the whole
 * renderer surface for v1 — domain-agnostic. The shell (apps/web) owns card
 * manipulation; here we only turn messages into pixels.
 */
export function CanvasSurfaces({ messages }: CanvasSurfacesProps) {
  const [processor] = useState(() => createProcessor(messages));
  const [surfaces, setSurfaces] = useState(() =>
    Array.from(processor.model.surfacesMap.values()),
  );

  useEffect(() => {
    const sync = () => setSurfaces(Array.from(processor.model.surfacesMap.values()));
    const created = processor.onSurfaceCreated(sync);
    const deleted = processor.onSurfaceDeleted(sync);
    return () => {
      created.unsubscribe();
      deleted.unsubscribe();
    };
  }, [processor]);

  return (
    <MarkdownContext.Provider value={plainTextMarkdownRenderer}>
      <div className="genui-canvas-surfaces">
        {surfaces.map((surface) => (
          <A2uiSurface key={surface.id} surface={surface} />
        ))}
      </div>
    </MarkdownContext.Provider>
  );
}
