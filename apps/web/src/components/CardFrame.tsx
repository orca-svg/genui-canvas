import type { ReactNode } from "react";
import {
  Award,
  BarChart3,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  ExternalLink,
  Info,
  ListChecks,
  Maximize2,
  Minimize2,
  Pin,
  Users,
} from "lucide-react";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment";
import type { ShellCard } from "../state/shell-store.js";

const MEDIA: Record<string, { icon: ReactNode; label: string }> = {
  BenefitCard: { icon: <Award />, label: "혜택 카드" },
  ScoreBreakdown: { icon: <BarChart3 />, label: "점수 분석" },
  Checklist: { icon: <ListChecks />, label: "체크리스트" },
  DeadlineList: { icon: <CalendarClock />, label: "마감 일정" },
  PersonaSelector: { icon: <Users />, label: "페르소나" },
  SourceNotice: { icon: <Info />, label: "출처 안내" },
};

const KOREAN_DATE = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeZone: "Asia/Seoul",
});

function formatSourceDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : KOREAN_DATE.format(date);
}

/** How a shell card's flags map onto the Attachment state machine. */
function frameState(card: ShellCard, busy: boolean): "processing" | "idle" | "done" {
  if (busy) return "processing"; // an LLM (re)composition is in flight -> shimmer
  if (card.hidden) return "idle"; // dropped from the canvas -> dashed/idle
  return "done";
}

export interface CardFrameProps {
  card: ShellCard;
  busy: boolean;
  onPin: () => void;
  onHide: () => void;
  onExpand: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
}

/**
 * The shell chrome around one canvas card. The A2UI surface renders the card
 * *body*; this frame owns the interaction affordances (pin/hide/expand) and
 * surfaces the composition state — the `processing` shimmer is the UI telling
 * you the LLM is re-composing in response to your last manipulation.
 */
export function CardFrame({
  card,
  busy,
  onPin,
  onHide,
  onExpand,
  onMoveUp,
  onMoveDown,
  canMoveUp = false,
  canMoveDown = false,
}: CardFrameProps) {
  const media = MEDIA[card.componentType] ?? { icon: <Award />, label: card.componentType };
  const title = card.title ?? card.entityId ?? card.cardId;
  const sourceDate = formatSourceDate(card.sourceCheckedAt);
  const meta = [media.label, card.pinned ? "고정됨" : undefined, sourceDate ? `게이트웨이 수집 ${sourceDate}` : undefined]
    .filter(Boolean)
    .join(" · ");

  return (
    <Attachment state={frameState(card, busy)} size="default" orientation="horizontal">
      <AttachmentMedia variant="icon">{media.icon}</AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>{title}</AttachmentTitle>
        <AttachmentDescription>{meta}</AttachmentDescription>
      </AttachmentContent>
      <AttachmentActions>
        {card.sourceUrl && (
          <a
            className="card-source-link"
            href={card.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${title} 출처 페이지 열기`}
          >
            <ExternalLink aria-hidden="true" />
          </a>
        )}
        <AttachmentAction
          aria-label={`${title} 위로 이동`}
          disabled={busy || !canMoveUp}
          onClick={onMoveUp}
        >
          <ChevronUp />
        </AttachmentAction>
        <AttachmentAction
          aria-label={`${title} 아래로 이동`}
          disabled={busy || !canMoveDown}
          onClick={onMoveDown}
        >
          <ChevronDown />
        </AttachmentAction>
        <AttachmentAction
          aria-label={`${title} ${card.pinned ? "고정 해제" : "고정"}`}
          aria-pressed={card.pinned}
          disabled={busy}
          variant={card.pinned ? "secondary" : "ghost"}
          onClick={onPin}
        >
          <Pin />
        </AttachmentAction>
        <AttachmentAction
          aria-label={`${title} ${card.hidden ? "다시 보기" : "숨기기"}`}
          aria-pressed={card.hidden}
          disabled={busy}
          onClick={onHide}
        >
          {card.hidden ? <Eye /> : <EyeOff />}
        </AttachmentAction>
        <AttachmentAction
          aria-label={`${title} ${card.expanded ? "접기" : "펼치기"}`}
          aria-controls={card.hidden ? undefined : `canvas-card-${card.cardId}`}
          aria-expanded={card.expanded}
          disabled={busy || card.hidden}
          onClick={onExpand}
        >
          {card.expanded ? <Minimize2 /> : <Maximize2 />}
        </AttachmentAction>
      </AttachmentActions>
    </Attachment>
  );
}
