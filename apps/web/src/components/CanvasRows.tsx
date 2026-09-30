import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
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
import { deriveCanvasGroups, rowsOf, ROW_COLUMNS, type CanvasRow } from "../state/canvas-layout.js";
import { isRowSortable, planRowMove, rowBlocksDrop } from "../state/drag-reorder.js";
import type { ShellAction, ShellCard } from "../state/shell-store.js";
import { CardChrome, shortcutAction } from "./CardChrome.js";
import { HiddenRowNotice } from "./HiddenRowNotice.js";

const NOTICE_MS = 6000;
const BOUNDARY_HINT = "고정된 카드는 고정 그룹 안에서만 이동합니다";

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
  title: string;
  /** Key of the group the hidden row used to precede; null when it was last. */
  beforeKey: string | null;
  /** Key of the group it used to follow; set only when it was last. */
  afterKey: string | null;
}

function emptySlotHint(column: string, row: CanvasRow): string | null {
  if (column === "score" && !row.pinned) return "고정하면 점수 분석이 여기 옵니다";
  if ((column === "checklist" || column === "source") && row.expanded) return "재구성하면 체크리스트·출처가 여기 옵니다";
  return null;
}

/**
 * The canvas as the shell sees it: bands and candidate rows derived from
 * `cards`, each row sortable by its handle, chrome on the BenefitCard, and
 * the two-step model explained inside empty slots.
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
  const activeRow = activeKey ? rowByKey.get(activeKey) : undefined;
  const sortableRows = rows.filter(isRowSortable);
  const mixedPinning = sortableRows.some((row) => row.pinned) && sortableRows.some((row) => !row.pinned);
  // The strip is rendered next to a neighbouring group; when no such group is
  // left (the hidden row was the only one, or its neighbour went away too) it
  // falls back to the end of the list so 되돌리기 never disappears early.
  const noticeAnchor = notice ? (notice.beforeKey ?? notice.afterKey) : null;
  const noticeAnchored = noticeAnchor !== null && keys.includes(noticeAnchor);

  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    [],
  );

  function hideRow(row: CanvasRow) {
    if (!row.benefitCardId) return;
    const index = groups.findIndex((group) => group.key === row.key);
    const next = groups[index + 1]?.key ?? null;
    const previous = groups[index - 1]?.key ?? null;
    onManipulate({ type: "card.hide", cardId: row.benefitCardId });
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice({ cardId: row.benefitCardId, title: row.title, beforeKey: next, afterKey: next ? null : previous });
    noticeTimer.current = setTimeout(() => setNotice(null), NOTICE_MS);
  }

  function undoHide() {
    if (!notice) return;
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    onManipulate({ type: "card.unhide", cardId: notice.cardId });
    setNotice(null);
  }

  function actOn(row: CanvasRow, action: "pin" | "hide" | "expand") {
    const card = row.benefitCardId ? cardById.get(row.benefitCardId) : undefined;
    if (!card || busy) return;
    if (action === "pin") onManipulate({ type: card.pinned ? "card.unpin" : "card.pin", cardId: card.cardId });
    if (action === "expand") onManipulate({ type: card.expanded ? "card.collapse" : "card.expand", cardId: card.cardId });
    if (action === "hide") hideRow(row);
  }

  function onRowKeyDown(row: CanvasRow, event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || event.metaKey || event.ctrlKey || event.altKey) return;
    const action = shortcutAction(event.key);
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
            render={<button type="button" aria-label={`${row.title} 순서 바꾸기`} disabled={busy} />}
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

  const renderEmptySlot = (column: string, group: CanvasGroup): ReactNode => {
    const row = group.kind === "row" ? rowByKey.get(group.key) : undefined;
    if (!row) return null;
    const hint = emptySlotHint(column, row);
    return hint ? <span className="genui-canvas-slot__hint">{hint}</span> : null;
  };

  const renderGroup = (group: CanvasGroup, content: ReactNode): ReactNode => {
    const row = group.kind === "row" ? rowByKey.get(group.key) : undefined;
    const sortable = row ? isRowSortable(row) : false;
    const disabled = !sortable || (row !== undefined && rowBlocksDrop(activeRow, row));
    // SortableItem spreads dnd-kit's draggable attributes (role="button",
    // tabindex, aria-*) onto its wrapper, and dims every disabled item. A band
    // is never draggable, so it must not turn into a button that wraps its own
    // buttons or look permanently disabled; a row keeps only the group role
    // and dims only while the pinned boundary blocks it (rowBlocksDrop).
    const item = (
      <SortableItem
        value={group.key}
        disabled={disabled}
        className={sortable ? "canvas-row-item" : "canvas-row-item opacity-100"}
        render={
          row ? (
            <div role="group" aria-label={`${row.title} 카드`} tabIndex={0} onKeyDown={(event) => onRowKeyDown(row, event)} />
          ) : (
            <div
              role={undefined}
              tabIndex={undefined}
              aria-disabled={undefined}
              aria-roledescription={undefined}
              aria-describedby={undefined}
            />
          )
        }
      >
        {content}
      </SortableItem>
    );
    const before = notice && notice.beforeKey === group.key ? <HiddenRowNotice title={notice.title} onUndo={undoHide} /> : null;
    const after = notice && notice.afterKey === group.key ? <HiddenRowNotice title={notice.title} onUndo={undoHide} /> : null;
    return (
      <>
        {before}
        {item}
        {after}
      </>
    );
  };

  const titleOf = (id: string | number) => rowByKey.get(String(id))?.title ?? String(id);
  const positionOf = (id: string | number) => {
    const sortableKeys = sortableRows.map((row) => row.key);
    return { index: sortableKeys.indexOf(String(id)) + 1, total: sortableKeys.length };
  };

  return (
    <div className="canvas-rows">
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
          const active = keys[activeIndex];
          const over = keys[overIndex];
          if (!active || !over) return;
          const action = planRowMove(cards, rows, active, over);
          if (action) onManipulate(action);
        }}
        accessibility={{
          screenReaderInstructions: {
            draggable: "순서를 바꾸려면 Space를 누른 뒤 위·아래 화살표로 옮기고 Enter로 놓습니다. Esc는 취소입니다.",
          },
          announcements: {
            onDragStart: ({ active }) => {
              const { index, total } = positionOf(active.id);
              return `${titleOf(active.id)}을 들었습니다 · ${total}개 중 ${index}번째`;
            },
            onDragOver: ({ active, over }) =>
              over
                ? `${titleOf(active.id)}을 ${positionOf(over.id).index}번째 자리로 옮기는 중`
                : `${titleOf(active.id)}은 놓을 수 없는 자리입니다`,
            onDragEnd: ({ active, over }) =>
              over ? `${titleOf(active.id)}을 ${positionOf(over.id).index}번째로 옮겼습니다` : `${titleOf(active.id)}을 제자리에 두었습니다`,
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
          renderEmptySlot={renderEmptySlot}
          onAction={onAction}
          watch={watch}
          values={values}
          onValueChange={onValueChange}
        />
        <SortableOverlay>{({ value }) => <div className="canvas-row-ghost">{titleOf(value)}</div>}</SortableOverlay>
      </Sortable>
      {notice && !noticeAnchored && <HiddenRowNotice title={notice.title} onUndo={undoHide} />}
    </div>
  );
}
