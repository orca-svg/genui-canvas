import { useState, useLayoutEffect, useMemo, useRef, useEffect } from "react";
import { A2uiSurface, MarkdownContext } from "@a2ui/react/v0_9";
import { createProcessor, type A2uiMessages, type CanvasActionHandler } from "./processor.js";

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

const plainTextMarkdownRenderer = async (markdown: string): Promise<string> =>
  markdown.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);

/** One entry per card the shell wants shown, in display order. */
export interface CanvasCardLayout {
  cardId: string;
  expanded?: boolean;
  emphasis?: "primary" | "secondary";
}

/** Data-model paths on one surface whose user edits the shell wants to hear about. */
export interface CanvasWatch {
  surfaceId: string;
  paths: string[];
}

/** A shell-owned boolean the renderer must reflect into a surface's data model. */
export interface CanvasValue {
  surfaceId: string;
  path: string;
  value: boolean;
}

export interface CanvasValueChange {
  surfaceId: string;
  path: string;
  value: unknown;
}

export interface CanvasSurfacesProps {
  messages: A2uiMessages;
  layout?: CanvasCardLayout[];
  /** Receives Button actions; the shell validates them against its action contract. */
  onAction?: CanvasActionHandler;
  /** Paths to observe for user edits (e.g. checklist rows). */
  watch?: CanvasWatch[];
  /** Values the shell owns (undo/redo, carried-over checks); written when they differ. */
  values?: CanvasValue[];
  onValueChange?: (change: CanvasValueChange) => void;
}

/**
 * Renders every A2UI surface produced by a batch of messages. Domain-agnostic:
 * the shell owns card manipulation and action semantics; this component only
 * turns messages into pixels and relays interaction upward.
 */
export function CanvasSurfaces({
  messages,
  layout,
  onAction,
  watch,
  values,
  onValueChange,
}: CanvasSurfacesProps) {
  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;
  const onValueChangeRef = useRef(onValueChange);
  onValueChangeRef.current = onValueChange;

  const processor = useMemo(
    () => createProcessor(messages, (action) => onActionRef.current?.(action)),
    [messages],
  );
  const [surfaces, setSurfaces] = useState(() =>
    Array.from(processor.model.surfacesMap.values()),
  );

  useLayoutEffect(() => {
    const sync = () => setSurfaces(Array.from(processor.model.surfacesMap.values()));
    sync();
    const created = processor.onSurfaceCreated(sync);
    const deleted = processor.onSurfaceDeleted(sync);
    return () => {
      created.unsubscribe();
      deleted.unsubscribe();
    };
  }, [processor]);

  // Tracks paths the `values` effect below just wrote, so the watcher effect can
  // suppress the one echo that write produces instead of reporting it upward as
  // a user edit.
  const shellWritesRef = useRef(new Set<string>());

  // Shell-owned values flow into the data model; only real differences are written,
  // and the watcher below ignores writes it did not observe as changes.
  useEffect(() => {
    if (!values) return;
    for (const { surfaceId, path, value } of values) {
      const surface = processor.model.surfacesMap.get(surfaceId);
      if (!surface) continue;
      if (surface.dataModel.get(path) !== value) {
        shellWritesRef.current.add(`${surfaceId}${path}`);
        surface.dataModel.set(path, value);
      }
    }
  }, [processor, values]);

  // User edits on watched paths flow up as value changes.
  useEffect(() => {
    if (!watch) return;
    const subscriptions: Array<{ unsubscribe: () => void }> = [];
    for (const { surfaceId, paths } of watch) {
      const surface = processor.model.surfacesMap.get(surfaceId);
      if (!surface) continue;
      for (const path of paths) {
        let last: unknown = surface.dataModel.get(path);
        subscriptions.push(
          surface.dataModel.subscribe(path, (value: unknown) => {
            if (shellWritesRef.current.delete(`${surfaceId}${path}`)) {
              last = value;
              return;
            }
            if (value === last) return;
            last = value;
            onValueChangeRef.current?.({ surfaceId, path, value });
          }),
        );
      }
    }
    return () => subscriptions.forEach((subscription) => subscription.unsubscribe());
  }, [processor, watch]);

  const byId = new Map(surfaces.map((surface) => [surface.id, surface]));
  type Entry = { surface: (typeof surfaces)[number]; expanded: boolean; emphasis?: "primary" | "secondary" };
  type Candidate = {
    surface: (typeof surfaces)[number] | undefined;
    expanded: boolean;
    emphasis?: "primary" | "secondary";
  };
  const ordered: Entry[] = layout
    ? layout
        .map(
          (entry): Candidate => ({
            surface: byId.get(entry.cardId),
            expanded: entry.expanded ?? false,
            emphasis: entry.emphasis,
          }),
        )
        .filter((entry): entry is Entry => entry.surface !== undefined)
    : surfaces.map((surface) => ({ surface, expanded: false }));

  return (
    <MarkdownContext.Provider value={plainTextMarkdownRenderer}>
      <div className="genui-canvas-surfaces">
        {ordered.map(({ surface, expanded, emphasis }) => (
          <div
            key={surface.id}
            id={`canvas-card-${surface.id}`}
            className="genui-canvas-card"
            data-card-id={surface.id}
            data-expanded={expanded ? "true" : "false"}
            data-emphasis={emphasis ?? "secondary"}
          >
            <div className="genui-canvas-card__body">
              <A2uiSurface surface={surface} />
            </div>
          </div>
        ))}
      </div>
    </MarkdownContext.Provider>
  );
}
