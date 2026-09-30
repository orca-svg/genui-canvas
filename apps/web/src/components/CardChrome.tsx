import type { ReactNode } from "react";
import { ChevronDown, ChevronRight, ExternalLink, EyeOff, Pin, PinOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import type { ShellCard } from "../state/shell-store.js";

export const CARD_SHORTCUTS = { pin: "p", hide: "h", expand: "e" } as const;

export function shortcutAction(key: string): "pin" | "hide" | "expand" | null {
  switch (key.toLowerCase()) {
    case CARD_SHORTCUTS.pin:
      return "pin";
    case CARD_SHORTCUTS.hide:
      return "hide";
    case CARD_SHORTCUTS.expand:
      return "expand";
    default:
      return null;
  }
}

export interface CardChromeProps {
  card: ShellCard;
  title: string;
  busy: boolean;
  handle?: ReactNode;
  onPin: () => void;
  onHide: () => void;
  onExpand: () => void;
}

/**
 * The shell's controls on a BenefitCard, next to the card body: always-visible
 * drag handle and 더 알아보기; hover/focus-revealed 고정·숨기기·출처 that stay
 * in the tab order. Every button fires the same shell manipulations the
 * sidebar used, so the trace and the server see nothing new.
 */
export function CardChrome({ card, title, busy, handle, onPin, onHide, onExpand }: CardChromeProps) {
  const expandLabel = card.expanded ? "접기" : "더 알아보기";
  const pinLabel = card.pinned ? "고정 해제" : "고정";
  return (
    <div className="card-chrome" data-slot="card-chrome">
      {handle}
      <Tooltip label={`${expandLabel} · E`}>
        <Button
          type="button"
          variant={card.expanded ? "secondary" : "default"}
          size="sm"
          className="card-chrome__primary"
          aria-label={`${title} ${expandLabel}`}
          aria-expanded={card.expanded}
          aria-controls={`canvas-card-${card.cardId}`}
          disabled={busy}
          onClick={onExpand}
        >
          {card.expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
          {expandLabel}
        </Button>
      </Tooltip>
      {card.pinned && <span className="card-chrome__badge">고정됨</span>}
      <div className="card-chrome__secondary">
        <Tooltip label={`${pinLabel} · P`}>
          <Button
            type="button"
            variant={card.pinned ? "secondary" : "ghost"}
            size="sm"
            aria-label={`${title} ${pinLabel}`}
            aria-pressed={card.pinned}
            disabled={busy}
            onClick={onPin}
          >
            {card.pinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
            {pinLabel}
          </Button>
        </Tooltip>
        <Tooltip label="숨기기 · H">
          <Button type="button" variant="ghost" size="sm" aria-label={`${title} 숨기기`} disabled={busy} onClick={onHide}>
            <EyeOff aria-hidden="true" />
            숨기기
          </Button>
        </Tooltip>
        {card.sourceUrl && (
          <Tooltip label="출처 페이지 열기">
            <a
              className="card-chrome__source"
              href={card.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${title} 출처 페이지 열기`}
            >
              <ExternalLink aria-hidden="true" />
              출처
            </a>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
