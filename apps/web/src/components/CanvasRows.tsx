import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { GripVertical } from "lucide-react";
import {
  CanvasSurfaces,
  type A2uiMessages,
  type CanvasActionHandler,
  type CanvasGroup,
  type CanvasSlot,
  type CanvasValue,
  type CanvasValueChange,
  type CanvasWatch,
} from "@genui-canvas/renderer";
import { Sortable, SortableItem, SortableItemHandle, SortableOverlay } from "@/components/reui/sortable";
import { withParticle } from "@/lib/korean";
import { deriveCanvasGroups, rowsOf, ROW_COLUMNS, type CanvasRow } from "../state/canvas-layout.js";
import { isRowSortable, planRowMove, rowBlocksDrop } from "../state/drag-reorder.js";
import type { ShellAction, ShellCard } from "../state/shell-store.js";
import { CardChrome, shortcutAction } from "./CardChrome.js";
import { HiddenRowNotice } from "./HiddenRowNotice.js";

const NOTICE_MS = 6000;
const BOUNDARY_HINT = "고정된 카드는 고정 그룹 안에서만 이동합니다";
const DRAG_INSTRUCTIONS = "순서를 바꾸려면 Space를 누른 뒤 위·아래 화살표로 옮기고 Enter로 놓습니다. Esc는 취소입니다.";
const ALL_HIDDEN = "보이는 카드가 없습니다 · 카드 목록에서 다시 볼 수 있습니다.";

/**
 * SortableItem spreads dnd-kit's draggable attributes onto its wrapper, but
 * the drag listeners live on the handle. The wrapper must not announce
 * "sortable", report dnd-kit's pressed state while carried, or carry the drag
 * instructions, so every group overrides these (the handle carries them instead).
 */
const NO_DND_ATTRIBUTES = {
  "aria-roledescription": undefined,
  "aria-describedby": undefined,
  "aria-disabled": undefined,
  "aria-pressed": undefined,
} as const;

export interface CanvasRowsProps {
  cards: ShellCard[];
  messages: A2uiMessages;
  busy: boolean;
  onManipulate: (action: ShellAction) => void;
  onAction: CanvasActionHandler;
  watch: CanvasWatch[];
  values: CanvasValue[];
  onValueChange: (change: CanvasValueChange) => void;
}

interface Notice {
  cardId: string;
  /** Key of the row that was hidden; focus returns to it on undo. */
  rowKey: string;
  title: string;
  /** Key of the group the hidden row used to precede; null when it was last. */
  beforeKey: string | null;
  /** Key of the group it used to follow; set only when it was last. */
  afterKey: string | null;
}

/**
 * What an empty cell of `row` says about the two-step model: a pin or an
 * expand marks the row, and the sub-card arrives with the next recomposition.
 * The score hint stays after the pin (only its wording changes) so the second
 * step is still explained; an orphan row has nothing to pin or expand.
 */
/**
 * One quiet line under a candidate row naming what the next 조작 반영해 재구성
 * adds beside the card, grouped by what the user still has to do: nothing
 * ("재구성 → …") or pin first ("고정 후 재구성 → …"). Null when nothing is
 * pending, so a row never advertises a card it already has.
 */
function rowHint(row: CanvasRow): string | null {
  if (!row.benefitCardId) return null;
  const present = new Set(row.slots.map((slot) => slot.column));
  const onRecompose: string[] = [];
  const afterPin: string[] = [];
  if (!present.has("score")) (row.pinned ? onRecompose : afterPin).push("점수 분석");
  if (row.expanded) {
    if (!present.has("checklist")) onRecompose.push("체크리스트");
    if (!present.has("source")) onRecompose.push("출처 안내");
  }
  const parts: string[] = [];
  if (onRecompose.length > 0) parts.push(`재구성 → ${onRecompose.join("·")}`);
  if (afterPin.length > 0) parts.push(`고정 후 재구성 → ${afterPin.join("·")}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * The canvas as the shell sees it: bands and candidate rows derived from
 * `cards`, each row sortable by its handle, chrome on the BenefitCard, and
 * the two-step model explained in one line under each row.
 */
export function CanvasRows({ cards, messages, busy, onManipulate, onAction, watch, values, onValueChange }: CanvasRowsProps) {
  const groups = useMemo(() => deriveCanvasGroups(cards), [cards]);
  const rows = useMemo(() => rowsOf(groups), [groups]);
  const rowByKey = useMemo(() => new Map(rows.map((row) => [row.key, row])), [rows]);
  const cardById = useMemo(() => new Map(cards.map((card) => [card.cardId, card])), [cards]);
  const keys = useMemo(() => groups.map((group) => group.key), [groups]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const allHiddenRef = useRef<HTMLParagraphElement>(null);
  const instructionsId = useId();
  // Read by timer callbacks, which outlive the render that created them.
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  const pendingFocusKey = useRef<string | null>(null);
  const activeRow = activeKey ? rowByKey.get(activeKey) : undefined;
  const sortableRows = rows.filter(isRowSortable);
  const mixedPinning = sortableRows.some((row) => row.pinned) && sortableRows.some((row) => !row.pinned);
  // The strip only means something while its card is still hidden: an undo
  // from elsewhere (the global 실행 취소) makes it stale, so it is dropped.
  const noticeStale = notice !== null && cardById.get(notice.cardId)?.hidden !== true;
  const shownNotice = notice && !noticeStale ? notice : null;
  // The strip is rendered next to a neighbouring group; when no such group is
  // left (the hidden row was the only one, or its neighbour went away too) it
  // falls back to the end of the list so 되돌리기 never disappears early.
  const noticeAnchor = shownNotice ? (shownNotice.beforeKey ?? shownNotice.afterKey) : null;
  const noticeAnchored = noticeAnchor !== null && keys.includes(noticeAnchor);

  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (noticeStale) dismissNotice();
  }, [noticeStale]);

  // After an undo the row only exists once the shell has re-rendered.
  useEffect(() => {
    const key = pendingFocusKey.current;
    if (key === null) return;
    pendingFocusKey.current = null;
    focusRow(key);
  });

  function focusRow(key: string | null) {
    if (!key) return;
    const wrappers = rootRef.current?.querySelectorAll<HTMLElement>("[data-row-key]") ?? [];
    Array.from(wrappers)
      .find((wrapper) => wrapper.dataset.rowKey === key)
      ?.focus();
  }

  /** The row closest to `anchor` (itself first, then forward, then backward). */
  function nearestRowKey(anchor: string | null): string | null {
    const list = groupsRef.current;
    const at = anchor ? list.findIndex((group) => group.key === anchor) : -1;
    if (at === -1) return list.find((group) => group.kind === "row")?.key ?? null;
    for (let distance = 0; distance < list.length; distance += 1) {
      if (list[at + distance]?.kind === "row") return list[at + distance]!.key;
      if (list[at - distance]?.kind === "row") return list[at - distance]!.key;
    }
    return null;
  }

  function dismissNotice() {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = null;
    setNotice(null);
  }

  function expireNotice(expired: Notice) {
    // Focus still on the strip would fall to <body> when it disappears; anywhere
    // else means the user has moved on, and focus is theirs to keep.
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.closest(".hidden-notice")) {
      const key = nearestRowKey(expired.beforeKey ?? expired.afterKey);
      // No row left to take it: the sentence saying so does (it renders when nothing is visible).
      if (key) focusRow(key);
      else allHiddenRef.current?.focus();
    }
    dismissNotice();
  }

  function hideRow(row: CanvasRow) {
    if (!row.benefitCardId) return;
    const index = groups.findIndex((group) => group.key === row.key);
    const next = groups[index + 1]?.key ?? null;
    const previous = groups[index - 1]?.key ?? null;
    onManipulate({ type: "card.hide", cardId: row.benefitCardId });
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    const created: Notice = {
      cardId: row.benefitCardId,
      rowKey: row.key,
      title: row.title,
      beforeKey: next,
      afterKey: next ? null : previous,
    };
    setNotice(created);
    noticeTimer.current = setTimeout(() => expireNotice(created), NOTICE_MS);
  }

  function undoHide() {
    if (!notice || busy) return;
    pendingFocusKey.current = notice.rowKey;
    onManipulate({ type: "card.unhide", cardId: notice.cardId });
    dismissNotice();
  }

  function actOn(row: CanvasRow, action: "pin" | "hide" | "expand") {
    const card = row.benefitCardId ? cardById.get(row.benefitCardId) : undefined;
    if (!card || busy) return;
    if (action === "pin") onManipulate({ type: card.pinned ? "card.unpin" : "card.pin", cardId: card.cardId });
    if (action === "expand") onManipulate({ type: card.expanded ? "card.collapse" : "card.expand", cardId: card.cardId });
    if (action === "hide") hideRow(row);
  }

  function onRowKeyDown(row: CanvasRow, event: KeyboardEvent<HTMLDivElement>) {
    // No shortcuts mid-drag (H would hide the row being carried), on held-down
    // repeats, on rows without a BenefitCard (nothing to act on, so the key
    // keeps its default), inside editable controls, or with a modifier held.
    if (activeKey || event.repeat || !row.benefitCardId) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if ((event.target as Element).closest("input,textarea,select,[contenteditable]")) return;
    const action = shortcutAction(event.key, event.code);
    if (!action) return;
    event.preventDefault();
    actOn(row, action);
  }

  const renderChrome = (slot: CanvasSlot, group: CanvasGroup): ReactNode => {
    if (group.kind !== "row" || slot.column !== "benefit") return null;
    const row = rowByKey.get(group.key);
    const card = cardById.get(slot.cardId);
    if (!row || !card) return null;
    return (
      <CardChrome
        card={card}
        title={row.title}
        busy={busy}
        handle={
          <SortableItemHandle
            className="card-chrome__handle"
            render={
              <button
                type="button"
                aria-label={`${row.title} 순서 바꾸기`}
                aria-roledescription="정렬 가능한 카드"
                aria-describedby={instructionsId}
                disabled={busy}
              />
            }
          >
            <GripVertical aria-hidden="true" />
          </SortableItemHandle>
        }
        onPin={() => actOn(row, "pin")}
        onHide={() => actOn(row, "hide")}
        onExpand={() => actOn(row, "expand")}
      />
    );
  };

  const renderGroup = (group: CanvasGroup, content: ReactNode): ReactNode => {
    const row = group.kind === "row" ? rowByKey.get(group.key) : undefined;
    const hint = row ? rowHint(row) : null;
    const sortable = row ? isRowSortable(row) : false;
    const disabled = !sortable || (row !== undefined && rowBlocksDrop(activeRow, row));
    // SortableItem also spreads role="button" and tabindex onto its wrapper and
    // dims every disabled item. A band is never draggable, so it must not turn
    // into a button that wraps its own buttons or look permanently disabled; a
    // row keeps only the group role and dims only while the pinned boundary
    // blocks it (rowBlocksDrop). The drag aria-* attributes go on no wrapper.
    const item = (
      <SortableItem
        value={group.key}
        disabled={disabled}
        className={sortable ? "canvas-row-item" : "canvas-row-item opacity-100"}
        render={
          row ? (
            <div
              role="group"
              aria-label={`${row.title} 카드`}
              tabIndex={0}
              data-row-key={row.key}
              aria-keyshortcuts={row.benefitCardId ? "P H E" : undefined}
              onKeyDown={(event) => onRowKeyDown(row, event)}
              {...NO_DND_ATTRIBUTES}
            />
          ) : (
            // tabIndex -1: out of the tab order, but the card list's jump can focus a band.
            <div role={undefined} tabIndex={-1} {...NO_DND_ATTRIBUTES} />
          )
        }
      >
        {content}
        {hint ? <p className="canvas-row__hint">{hint}</p> : null}
      </SortableItem>
    );
    const strip =
      shownNotice && (shownNotice.beforeKey === group.key || shownNotice.afterKey === group.key) ? (
        <HiddenRowNotice key={shownNotice.cardId} title={shownNotice.title} busy={busy} onUndo={undoHide} />
      ) : null;
    const before = shownNotice?.beforeKey === group.key ? strip : null;
    const after = shownNotice?.afterKey === group.key ? strip : null;
    return (
      <>
        {before}
        {item}
        {after}
      </>
    );
  };

  const titleOf = (id: string | number) => rowByKey.get(String(id))?.title ?? String(id);
  const objectOf = (id: string | number) => withParticle(titleOf(id), "을/를");
  const positionOf = (id: string | number) => {
    const sortableKeys = sortableRows.map((row) => row.key);
    return { index: sortableKeys.indexOf(String(id)) + 1, total: sortableKeys.length };
  };

  return (
    <div className="canvas-rows" ref={rootRef}>
      <p id={instructionsId} className="sr-only">
        {DRAG_INSTRUCTIONS}
      </p>
      {cards.length > 0 && groups.length === 0 && (
        <p className="canvas__empty" tabIndex={-1} ref={allHiddenRef}>
          {ALL_HIDDEN}
        </p>
      )}
      {activeRow && mixedPinning && (
        <p className="canvas-rows__hint" role="status">
          {BOUNDARY_HINT}
        </p>
      )}
      <Sortable
        value={keys}
        onValueChange={() => {}}
        getItemValue={(key) => key}
        strategy="vertical"
        onDragStart={(event) => setActiveKey(String(event.active.id))}
        onDragEnd={() => setActiveKey(null)}
        onDragCancel={() => setActiveKey(null)}
        onMove={({ activeIndex, overIndex }) => {
          // The handle is disabled while a turn is in flight, but a drag that still ends
          // then (say, a touch drag) must not record a move the incoming composition replaces.
          if (busy) return;
          const active = keys[activeIndex];
          const over = keys[overIndex];
          if (!active || !over) return;
          const action = planRowMove(cards, rows, active, over);
          if (action) onManipulate(action);
        }}
        accessibility={{
          screenReaderInstructions: { draggable: DRAG_INSTRUCTIONS },
          announcements: {
            onDragStart: ({ active }) => {
              const { index, total } = positionOf(active.id);
              return `${objectOf(active.id)} 들었습니다 · ${total}개 중 ${index}번째`;
            },
            onDragOver: ({ active, over }) =>
              over
                ? `${objectOf(active.id)} ${positionOf(over.id).index}번째 자리로 옮기는 중`
                : `${withParticle(titleOf(active.id), "은/는")} 놓을 수 없는 자리입니다`,
            onDragEnd: ({ active, over }) =>
              over ? `${objectOf(active.id)} ${positionOf(over.id).index}번째로 옮겼습니다` : `${objectOf(active.id)} 제자리에 두었습니다`,
            onDragCancel: ({ active }) => `${titleOf(active.id)} 이동을 취소했습니다`,
          },
        }}
      >
        <CanvasSurfaces
          messages={messages}
          groups={groups}
          rowColumns={ROW_COLUMNS}
          renderGroup={renderGroup}
          renderChrome={renderChrome}
          onAction={onAction}
          watch={watch}
          values={values}
          onValueChange={onValueChange}
        />
        <SortableOverlay>{({ value }) => <div className="canvas-row-ghost">{titleOf(value)}</div>}</SortableOverlay>
      </Sortable>
      {shownNotice && !noticeAnchored && (
        <HiddenRowNotice key={shownNotice.cardId} title={shownNotice.title} busy={busy} onUndo={undoHide} />
      )}
    </div>
  );
}
