import { Fragment, useState, useLayoutEffect, useMemo, useRef, useEffect, type ReactNode } from "react";
import { A2uiSurface, MarkdownContext } from "@a2ui/react/v0_9";
import { createProcessor, type A2uiMessages, type CanvasActionHandler } from "./processor.js";

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

/** One card the shell places in a group. `column` is an opaque name to the renderer. */
export interface CanvasSlot {
  cardId: string;
  column: string;
  expanded?: boolean;
  emphasis?: "primary" | "secondary";
}

/** A band (full-width cards) or a row (cells ordered by `rowColumns`), in display order. */
export interface CanvasGroup {
  key: string;
  kind: "band" | "row";
  slots: CanvasSlot[];
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
  /** Shell-derived bands and candidate rows. Omitted: every surface, message order, one band each. */
  groups?: CanvasGroup[];
  /** Column order inside a row; opaque names. Omitted: the order slots appear. */
  rowColumns?: readonly string[];
  /** Lets the shell wrap a group (e.g. a sortable item) without the renderer knowing why. */
  renderGroup?: (group: CanvasGroup, content: ReactNode) => ReactNode;
  /** Shell chrome rendered before a card's body (handle, buttons, badges). */
  renderChrome?: (slot: CanvasSlot, group: CanvasGroup) => ReactNode;
  /** Content for a row cell that has no card yet (hints). */
  renderEmptySlot?: (column: string, group: CanvasGroup) => ReactNode;
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
  groups,
  rowColumns,
  renderGroup,
  renderChrome,
  renderEmptySlot,
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

  // A single delimiter-joined key, shared by both effects below, so a value the
  // `values` effect writes and a path the `watch` effect subscribes to always
  // agree on identity regardless of effect ordering within a commit.
  const valueKey = (surfaceId: string, path: string) => `${surfaceId}\u0000${path}`;

  // Last value each effect has seen per (surface, path). The `values` effect
  // records the shell's value BEFORE writing it, so the watcher treats the
  // resulting notification as already known; a real user edit always differs
  // from it. Seeded fresh whenever `processor` is rebuilt, since a new
  // processor means new data models and the old entries no longer apply.
  const lastValuesRef = useRef(new Map<string, unknown>());
  const lastProcessorRef = useRef<typeof processor | undefined>(undefined);

  // Shell-owned values flow into the data model; only real differences are
  // written, and the value is recorded as "known" before the write so the
  // watcher effect (whether its subscription already exists or is created in
  // this same commit) never reports the resulting notification upward.
  useEffect(() => {
    if (!values) return;
    for (const { surfaceId, path, value } of values) {
      const surface = processor.model.surfacesMap.get(surfaceId);
      if (!surface) continue;
      if (surface.dataModel.get(path) !== value) {
        lastValuesRef.current.set(valueKey(surfaceId, path), value);
        surface.dataModel.set(path, value);
      }
    }
  }, [processor, values]);

  // User edits on watched paths flow up as value changes.
  useEffect(() => {
    if (lastProcessorRef.current !== processor) {
      lastValuesRef.current.clear();
      lastProcessorRef.current = processor;
    }
    if (!watch) return;
    const subscriptions: Array<{ unsubscribe: () => void }> = [];
    for (const { surfaceId, paths } of watch) {
      const surface = processor.model.surfacesMap.get(surfaceId);
      if (!surface) continue;
      for (const path of paths) {
        const key = valueKey(surfaceId, path);
        if (!lastValuesRef.current.has(key)) {
          lastValuesRef.current.set(key, surface.dataModel.get(path));
        }
        subscriptions.push(
          surface.dataModel.subscribe(path, (value: unknown) => {
            const known = lastValuesRef.current.get(key);
            if (value === known) return;
            lastValuesRef.current.set(key, value);
            onValueChangeRef.current?.({ surfaceId, path, value });
          }),
        );
      }
    }
    return () => subscriptions.forEach((subscription) => subscription.unsubscribe());
  }, [processor, watch]);

  const byId = new Map(surfaces.map((surface) => [surface.id, surface]));
  const effectiveGroups: CanvasGroup[] =
    groups ??
    surfaces.map((surface) => ({
      key: `band:${surface.id}`,
      kind: "band",
      slots: [{ cardId: surface.id, column: "band" }],
    }));

  const renderCard = (slot: CanvasSlot, group: CanvasGroup) => {
    const surface = byId.get(slot.cardId);
    if (!surface) return null;
    return (
      <div
        key={surface.id}
        id={`canvas-card-${surface.id}`}
        className="genui-canvas-card"
        data-testid={`card-${surface.id}`}
        data-card-id={surface.id}
        data-column={slot.column}
        data-expanded={slot.expanded ? "true" : "false"}
        data-emphasis={slot.emphasis ?? "secondary"}
      >
        {renderChrome?.(slot, group)}
        <div className="genui-canvas-card__body">
          <A2uiSurface surface={surface} />
        </div>
      </div>
    );
  };

  const renderRow = (group: CanvasGroup) => {
    const columns = rowColumns ?? group.slots.map((slot) => slot.column);
    return (
      <div
        className="genui-canvas-row"
        data-testid={`group-${group.key}`}
        data-group-key={group.key}
        data-columns={columns.length}
      >
        {columns.map((column) => {
          const slot = group.slots.find((candidate) => candidate.column === column);
          const card = slot ? renderCard(slot, group) : null;
          return (
            card ?? (
              <div key={column} className="genui-canvas-slot genui-canvas-slot--empty" data-column={column}>
                {renderEmptySlot?.(column, group)}
              </div>
            )
          );
        })}
      </div>
    );
  };

  const renderBand = (group: CanvasGroup) => (
    <div className="genui-canvas-band" data-testid={`group-${group.key}`} data-group-key={group.key}>
      {group.slots.map((slot) => renderCard(slot, group))}
    </div>
  );

  return (
    <MarkdownContext.Provider value={plainTextMarkdownRenderer}>
      <div className="genui-canvas-surfaces">
        {effectiveGroups.map((group) => {
          const content = group.kind === "row" ? renderRow(group) : renderBand(group);
          return <Fragment key={group.key}>{renderGroup ? renderGroup(group, content) : content}</Fragment>;
        })}
      </div>
    </MarkdownContext.Provider>
  );
}
