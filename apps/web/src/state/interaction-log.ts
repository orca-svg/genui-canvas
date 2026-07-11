import { createInteractionEvent, type InteractionEvent } from "@genui-canvas/contracts";
import { visibleCardIds, type ShellAction, type ShellState } from "./shell-store.js";

export interface EventMeta {
  sessionId: string;
  seq: number;
  triggeredBy?: string;
}

/**
 * Turn a manipulation into a structured InteractionEvent, snapshotting the
 * screen (compositionId + visible cards) the user acted upon. This fidelity is
 * what lets a later study reconstruct stimulus → response, and what feeds the
 * next composition (trace → composition).
 */
export function deriveInteractionEvent(
  action: ShellAction,
  stateBefore: ShellState,
  meta: EventMeta,
): InteractionEvent {
  const card = stateBefore.cards.find((c) => c.cardId === action.cardId);
  const payload = action.type === "card.reorder" ? { toIndex: action.toIndex } : undefined;

  return createInteractionEvent({
    sessionId: meta.sessionId,
    seq: meta.seq,
    actor: "user",
    type: action.type,
    target: {
      cardId: action.cardId,
      entityId: card?.entityId,
      componentType: card?.componentType,
    },
    payload,
    context: {
      compositionId: stateBefore.compositionId,
      visibleCardIds: visibleCardIds(stateBefore),
    },
  });
}

export function deriveCompositionPointEvent(
  trigger: { type: "query.submit"; text: string } | { type: "persona.switch"; personaId: string },
  stateBefore: ShellState,
  meta: EventMeta,
): InteractionEvent {
  return createInteractionEvent({
    sessionId: meta.sessionId,
    seq: meta.seq,
    actor: "user",
    type: trigger.type,
    payload: trigger.type === "query.submit" ? { text: trigger.text } : { personaId: trigger.personaId },
    context: {
      compositionId: stateBefore.compositionId,
      visibleCardIds: visibleCardIds(stateBefore),
    },
  });
}

export function deriveCompositionAppliedEvent(
  stateAfter: ShellState,
  meta: EventMeta,
): InteractionEvent {
  return createInteractionEvent({
    sessionId: meta.sessionId,
    seq: meta.seq,
    actor: "system",
    type: "composition.applied",
    context: {
      compositionId: stateAfter.compositionId,
      visibleCardIds: visibleCardIds(stateAfter),
    },
    causality: meta.triggeredBy ? { triggeredBy: meta.triggeredBy } : undefined,
  });
}

export function deriveCompositionRejectedEvent(
  stateBefore: ShellState,
  reason: "turn_failed" | "composition_invalid",
  meta: EventMeta,
): InteractionEvent {
  return createInteractionEvent({
    sessionId: meta.sessionId,
    seq: meta.seq,
    actor: "system",
    type: "composition.rejected",
    payload: { reason },
    context: {
      compositionId: stateBefore.compositionId,
      visibleCardIds: visibleCardIds(stateBefore),
    },
    causality: meta.triggeredBy ? { triggeredBy: meta.triggeredBy } : undefined,
  });
}
