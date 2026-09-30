import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { Lock, LockOpen, PanelRightOpen, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerClose, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { MOBILE_QUERY, useMediaQuery } from "../hooks/use-media-query.js";
import { deriveCanvasGroups, rowsOf, type CanvasRow } from "../state/canvas-layout.js";
import { isRowSortable } from "../state/drag-reorder.js";
import type { ShellCard } from "../state/shell-store.js";
import { CardFrame } from "./CardFrame.js";

const OPEN_DELAY_MS = 150;
const CLOSE_DELAY_MS = 400;

const SUB_CARD_TYPES = new Set<string>(["ScoreBreakdown", "Checklist", "SourceNotice"]);

export type RowDirection = "up" | "down";

export interface EdgeDrawerProps {
  cards: ShellCard[];
  busy: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPin: (card: ShellCard) => void;
  onHide: (card: ShellCard) => void;
  onExpand: (card: ShellCard) => void;
  /** Move `card`'s whole candidate row one step toward `direction`. */
  onMoveRow: (card: ShellCard, direction: RowDirection) => void;
  onJump: (cardId: string) => void;
}

/** Card ids as the canvas shows them: groups top to bottom, each group's cells left to right. */
function canvasOrder(cards: readonly ShellCard[]): string[] {
  return deriveCanvasGroups(cards).flatMap((group) => group.slots.map((slot) => slot.cardId));
}

/**
 * What the drawer lists: every card except the sub-cards (ScoreBreakdown /
 * Checklist / SourceNotice) of a candidate that has a BenefitCard, hidden or
 * not. A candidate is one row, so it is one entry; bands and orphan sub-cards
 * (no BenefitCard for their entity) stay listed. The order is the canvas's
 * (persona band, candidate rows, deadline band), so the list reads like the
 * page; a hidden card, which the canvas does not show, is listed where it
 * would reappear.
 */
export function listedCards(cards: ShellCard[]): ShellCard[] {
  const candidates = new Set(
    cards.flatMap((card) => (card.componentType === "BenefitCard" && card.entityId ? [card.entityId] : [])),
  );
  const listed = cards.filter(
    (card) => !(SUB_CARD_TYPES.has(card.componentType) && card.entityId !== undefined && candidates.has(card.entityId)),
  );
  const listedIds = new Set(listed.map((card) => card.cardId));
  const order = canvasOrder(cards).filter((id) => listedIds.has(id));
  // Where each card would sit with nothing hidden; an off-canvas card goes right after the
  // nearest card before it there that is already listed (first, if there is none).
  const reappearing = canvasOrder(cards.map((card) => (card.hidden ? { ...card, hidden: false } : card)));
  for (const card of listed) {
    if (order.includes(card.cardId)) continue;
    const at = reappearing.indexOf(card.cardId);
    if (at === -1) {
      order.push(card.cardId); // not placed on the canvas at all (a second card for one cell)
      continue;
    }
    const previous = reappearing
      .slice(0, at)
      .reverse()
      .find((id) => order.includes(id));
    order.splice(previous === undefined ? 0 : order.indexOf(previous) + 1, 0, card.cardId);
  }
  const byId = new Map(listed.map((card) => [card.cardId, card]));
  return order.map((id) => byId.get(id)!);
}

/**
 * The nearest sortable candidate row on `direction`'s side of `card`'s row that
 * has the same pin state, if any. Only a visible BenefitCard owns a sortable
 * row (a hidden one never enters a group), so anything else gets `undefined`.
 */
export function rowNeighbour(rows: readonly CanvasRow[], card: ShellCard, direction: RowDirection): CanvasRow | undefined {
  const sortable = rows.filter(isRowSortable);
  const index = sortable.findIndex((row) => row.benefitCardId === card.cardId);
  const own = sortable[index];
  if (!own) return undefined;
  const side = direction === "up" ? sortable.slice(0, index).reverse() : sortable.slice(index + 1);
  return side.find((row) => row.pinned === own.pinned);
}

/**
 * The card map: hidden by default, revealed when the pointer rests on the
 * right screen edge, reachable through the handle tab on desktop or the
 * toolbar's 카드 목록 button under 48rem, and a bottom sheet on narrow screens
 * (no hover there).
 */
export function EdgeDrawer({ cards, busy, open, onOpenChange, onPin, onHide, onExpand, onMoveRow, onJump }: EdgeDrawerProps) {
  const mobile = useMediaQuery(MOBILE_QUERY);
  const [locked, setLocked] = useState(false);
  // A hover open must not take keyboard focus (the user may be typing elsewhere); a handle
  // or toolbar open still moves focus into the drawer.
  const [openedByHover, setOpenedByHover] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const moveFrame = useRef<number | null>(null);

  const clear = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };
  // Hover is a mouse/pen gesture: a finger's pointerleave fires on lift-off and would close the drawer under it.
  const scheduleOpen = (event: PointerEvent) => {
    if (event.pointerType === "touch") return;
    clear();
    timer.current = setTimeout(() => {
      setOpenedByHover(true);
      onOpenChange(true);
    }, OPEN_DELAY_MS);
  };
  const scheduleClose = (event: PointerEvent) => {
    if (locked || event.pointerType === "touch") return;
    clear();
    timer.current = setTimeout(() => onOpenChange(false), CLOSE_DELAY_MS);
  };
  // Leaving the zone always drops a pending open (the pointer did not rest), but only an open drawer has anything to close.
  const leaveZone = (event: PointerEvent) => {
    clear();
    if (!open) return;
    scheduleClose(event);
  };
  // The lock and the hover origin belong to one opening: whatever closes the drawer (Esc, the handle, a parent) releases them.
  useEffect(() => {
    if (!open) {
      setLocked(false);
      setOpenedByHover(false);
    }
  }, [open]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (moveFrame.current !== null) cancelAnimationFrame(moveFrame.current);
    },
    [],
  );

  const listed = useMemo(() => listedCards(cards), [cards]);
  const rows = useMemo(() => rowsOf(deriveCanvasGroups(cards)), [cards]);
  const titleOf = (card: ShellCard) => card.title ?? card.entityId ?? card.cardId;

  // A move re-sorts the list: the browser drops focus when React moves the focused entry's
  // node (or when the control turns disabled at the end of the list). On the next frame, once
  // the list has re-rendered, focus goes back to the same control, or to the opposite move if
  // the row can go no further, unless the user has already put focus somewhere else.
  const moveRow = (card: ShellCard, direction: RowDirection) => {
    onMoveRow(card, direction);
    if (moveFrame.current !== null) cancelAnimationFrame(moveFrame.current);
    moveFrame.current = requestAnimationFrame(() => {
      moveFrame.current = null;
      const list = listRef.current;
      const active = document.activeElement;
      if (!list || (active && active !== document.body && !list.contains(active))) return;
      const entry = Array.from(list.children).find(
        (child): child is HTMLElement => child instanceof HTMLElement && child.dataset.cardId === card.cardId,
      );
      const control = (towards: RowDirection) =>
        Array.from(entry?.querySelectorAll("button") ?? []).find(
          (button) => button.getAttribute("aria-label") === `${titleOf(card)} ${towards === "up" ? "위로" : "아래로"} 이동` && !button.disabled,
        );
      (control(direction) ?? control(direction === "up" ? "down" : "up"))?.focus();
    });
  };

  return (
    <>
      {!mobile && (
        <div className="edge-zone" data-testid="edge-zone" aria-hidden="true" onPointerEnter={scheduleOpen} onPointerLeave={leaveZone} />
      )}
      {/* Under 48rem the toolbar's 카드 목록 is the single entry, so the handle is desktop-only. */}
      {!mobile && (
        <button
          type="button"
          className="edge-handle"
          aria-label="카드 목록"
          aria-expanded={open}
          aria-controls="edge-drawer"
          data-open={open}
          onClick={() => {
            clear();
            setOpenedByHover(false);
            onOpenChange(!open);
          }}
        >
          <PanelRightOpen aria-hidden="true" />
          <span className="edge-handle__text">카드 목록</span>
        </button>
      )}
      <Drawer
        open={open}
        modal={false}
        disablePointerDismissal
        swipeDirection={mobile ? "down" : "right"}
        onOpenChange={(next) => {
          clear();
          if (!next) setLocked(false);
          onOpenChange(next);
        }}
      >
        <DrawerContent
          id="edge-drawer"
          data-mode={mobile ? "sheet" : "side"}
          initialFocus={openedByHover ? false : undefined}
          onPointerEnter={clear}
          onPointerLeave={scheduleClose}
        >
          <header className="edge-drawer__header">
            <DrawerTitle className="edge-drawer__title">카드 목록</DrawerTitle>
            <div className="edge-drawer__tools">
              <Button
                type="button"
                variant={locked ? "secondary" : "ghost"}
                size="icon-sm"
                aria-label="열어 두기"
                aria-pressed={locked}
                onClick={() => {
                  clear(); // a pending close must not outlive the lock
                  setLocked((value) => !value);
                }}
              >
                {locked ? <Lock aria-hidden="true" /> : <LockOpen aria-hidden="true" />}
              </Button>
              <DrawerClose render={<Button type="button" variant="ghost" size="icon-sm" aria-label="닫기" />}>
                <X aria-hidden="true" />
              </DrawerClose>
            </div>
          </header>
          {listed.length === 0 && <p className="edge-drawer__empty">검색어를 입력하거나 시나리오를 선택하면 카드가 나타납니다.</p>}
          <ol className="edge-drawer__list" ref={listRef}>
            {listed.map((card) => (
              <li key={card.cardId} className="edge-drawer__row" data-card-id={card.cardId} data-hidden={card.hidden ? "true" : "false"}>
                <button
                  type="button"
                  className="edge-drawer__jump"
                  aria-label={`${titleOf(card)}(으)로 이동`}
                  disabled={card.hidden}
                  onClick={() => onJump(card.cardId)}
                >
                  {titleOf(card)}
                  <span className="edge-drawer__badges" aria-hidden="true">
                    {card.pinned && <span>고정</span>}
                    {card.expanded && <span>펼침</span>}
                    {card.hidden && <span>숨김</span>}
                  </span>
                </button>
                <CardFrame
                  card={card}
                  busy={busy}
                  onPin={() => onPin(card)}
                  onHide={() => onHide(card)}
                  onExpand={() => onExpand(card)}
                  canMoveUp={rowNeighbour(rows, card, "up") !== undefined}
                  canMoveDown={rowNeighbour(rows, card, "down") !== undefined}
                  onMoveUp={() => moveRow(card, "up")}
                  onMoveDown={() => moveRow(card, "down")}
                />
              </li>
            ))}
          </ol>
        </DrawerContent>
      </Drawer>
    </>
  );
}
