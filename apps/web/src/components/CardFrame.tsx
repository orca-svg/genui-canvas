import type { ReactNode } from "react";
import {
  Award,
  BarChart3,
  CalendarClock,
  Eye,
  EyeOff,
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
}

/**
 * The shell chrome around one canvas card. The A2UI surface renders the card
 * *body*; this frame owns the interaction affordances (pin/hide/expand) and
 * surfaces the composition state — the `processing` shimmer is the UI telling
 * you the LLM is re-composing in response to your last manipulation.
 */
export function CardFrame({ card, busy, onPin, onHide, onExpand }: CardFrameProps) {
  const media = MEDIA[card.componentType] ?? { icon: <Award />, label: card.componentType };
  const title = card.entityId ?? card.cardId;
  const meta = card.pinned ? `${media.label} · 고정됨` : media.label;

  return (
    <Attachment state={frameState(card, busy)} size="default" orientation="horizontal">
      <AttachmentMedia variant="icon">{media.icon}</AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>{title}</AttachmentTitle>
        <AttachmentDescription>{meta}</AttachmentDescription>
      </AttachmentContent>
      <AttachmentActions>
        <AttachmentAction
          aria-label={card.pinned ? "고정 해제" : "고정"}
          aria-pressed={card.pinned}
          variant={card.pinned ? "secondary" : "ghost"}
          onClick={onPin}
        >
          <Pin />
        </AttachmentAction>
        <AttachmentAction
          aria-label={card.hidden ? "다시 보기" : "숨기기"}
          aria-pressed={card.hidden}
          onClick={onHide}
        >
          {card.hidden ? <Eye /> : <EyeOff />}
        </AttachmentAction>
        <AttachmentAction
          aria-label={card.expanded ? "접기" : "펼치기"}
          aria-pressed={card.expanded}
          onClick={onExpand}
        >
          {card.expanded ? <Minimize2 /> : <Maximize2 />}
        </AttachmentAction>
      </AttachmentActions>
    </Attachment>
  );
}
