import type { UserProfile } from "@genui-canvas/contracts";
import { composeTurn, type ComposerDeps, type TurnRequest } from "../composer.js";

export interface ManipulationCheckOptions {
  query: string;
  profile?: UserProfile | Record<string, unknown>;
}

export interface ManipulationCheckReport {
  query: string;
  pinnedEntityId: string;
  hiddenEntityId: string;
  controlOrder: string[];
  manipulatedOrder: string[];
  pinnedMovedToTop: boolean;
  hiddenRemoved: boolean;
  orderChanged: boolean;
}

function orderEntityIds(cards: Array<{ entityRef?: { entityId: string } }>): string[] {
  return cards.map((card) => card.entityRef?.entityId).filter((id): id is string => Boolean(id));
}

/**
 * The manipulation-check: run the same query twice — once with no manipulation
 * (control), once after pinning the lowest-ranked candidate and hiding a
 * middle one — and diff the compositions. The delta is the reproducible
 * evidence that interaction reshapes the UI (the prototype of a study
 * manipulation-check). Deterministic with the rule-based provider.
 */
export async function runManipulationCheck(
  deps: ComposerDeps,
  options: ManipulationCheckOptions,
): Promise<ManipulationCheckReport> {
  const profile = options.profile ?? {};
  const controlTurn: TurnRequest = {
    trigger: { type: "query.submit", text: options.query },
    profile,
    traceSummary: { entityEngagement: [], recentEvents: [], turnCount: 0 },
    currentComposition: { cards: [] },
  };

  const control = await composeTurn(deps, controlTurn);
  if (!control.ok) throw new Error(`control turn failed: ${control.errors.join("; ")}`);
  const controlOrder = orderEntityIds(control.spec.cards);
  if (controlOrder.length < 2) {
    throw new Error("manipulation-check needs at least two candidates");
  }

  const pinnedEntityId = controlOrder[controlOrder.length - 1]!; // lowest-ranked → pin to top
  const hiddenEntityId = controlOrder[0]!; // top candidate → hide it

  const manipulated = await composeTurn(deps, {
    ...controlTurn,
    currentComposition: {
      cards: [
        {
          cardId: `card-${pinnedEntityId}`,
          entityId: pinnedEntityId,
          componentType: "BenefitCard",
          state: "pinned",
        },
        {
          cardId: `card-${hiddenEntityId}`,
          entityId: hiddenEntityId,
          componentType: "BenefitCard",
          state: "hidden",
        },
      ],
    },
  });
  if (!manipulated.ok) throw new Error(`manipulated turn failed: ${manipulated.errors.join("; ")}`);
  const manipulatedOrder = orderEntityIds(manipulated.spec.cards);

  return {
    query: options.query,
    pinnedEntityId,
    hiddenEntityId,
    controlOrder,
    manipulatedOrder,
    pinnedMovedToTop: manipulatedOrder[0] === pinnedEntityId,
    hiddenRemoved: !manipulatedOrder.includes(hiddenEntityId),
    orderChanged: JSON.stringify(controlOrder) !== JSON.stringify(manipulatedOrder),
  };
}
