import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ServerEventSchema,
  createInteractionEvent,
  type InteractionEvent,
  type ServerEvent,
  type TraceSummary,
  type UserProfile,
} from "@genui-canvas/contracts";
import { createApp } from "../app.js";
import type { ComposerDeps } from "../composer.js";
import type { LlmProvider } from "../llm/provider.js";
import { TraceStore } from "../trace/store.js";

export interface ManipulationCheckOptions {
  query: string;
  profile?: UserProfile | Record<string, unknown>;
}

export interface ManipulationCheckReport {
  query: string;
  pinnedEntityId: string;
  hiddenEntityId: string;
  reorderedEntityId: string;
  controlOrder: string[];
  manipulatedOrder: string[];
  pinnedMovedToTop: boolean;
  hiddenRemoved: boolean;
  orderChanged: boolean;
  httpBoundaryVerified: boolean;
  traceClosedLoop: boolean;
  recordedEventTypes: InteractionEvent["type"][];
  observedTraceSummary: TraceSummary;
}

type CompositionEvent = Extract<ServerEvent, { kind: "composition" }>;
type App = ReturnType<typeof createApp>;

const EMPTY_TRACE: TraceSummary = {
  entityEngagement: [],
  recentEvents: [],
  turnCount: 0,
};

function parseComposition(text: string): CompositionEvent {
  for (const block of text.replace(/\r\n/g, "\n").split("\n\n")) {
    const data = block
      .split("\n")
      .find((line) => line.startsWith("data:"))
      ?.slice("data:".length)
      .trim();
    if (!data) continue;
    const event = ServerEventSchema.safeParse(JSON.parse(data));
    if (event.success && event.data.kind === "composition") return event.data;
  }
  throw new Error("turn did not return a validated composition");
}

async function issueSession(app: App): Promise<string> {
  const response = await app.request("/api/session", { method: "POST" });
  if (!response.ok) throw new Error(`session failed with HTTP ${response.status}`);
  return ((await response.json()) as { sessionId: string }).sessionId;
}

async function appendEvent(app: App, event: InteractionEvent): Promise<void> {
  const response = await app.request("/api/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(event),
  });
  if (!response.ok) throw new Error(`event ${event.type} failed with HTTP ${response.status}`);
}

async function postTurn(app: App, body: Record<string, unknown>): Promise<CompositionEvent> {
  const response = await app.request("/api/turn", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`turn failed with HTTP ${response.status}`);
  return parseComposition(await response.text());
}

function benefitCards(composition: CompositionEvent) {
  return composition.cards.filter(
    (card): card is typeof card & { entityId: string } =>
      card.componentType === "BenefitCard" && typeof card.entityId === "string",
  );
}

/**
 * Exercise the same HTTP and persisted-trace boundary as the browser:
 * session → events → turn → events → turn. The provider is observed rather
 * than bypassed, proving the second composition received the server-derived
 * trace summary rather than a client-injected fixture.
 */
export async function runManipulationCheck(
  deps: ComposerDeps,
  options: ManipulationCheckOptions,
): Promise<ManipulationCheckReport> {
  const traceDir = mkdtempSync(join(tmpdir(), "genui-http-replay-"));
  const traceStore = new TraceStore(traceDir);
  let observedTraceSummary: TraceSummary = EMPTY_TRACE;
  const observedProvider: LlmProvider = {
    name: `observed:${deps.provider.name}`,
    async compose(request) {
      observedTraceSummary = structuredClone(request.context.traceSummary);
      return deps.provider.compose(request);
    },
  };
  const app = createApp({
    gateway: deps.gateway,
    provider: observedProvider,
    traceStore,
  });

  try {
    const profile = options.profile ?? {};
    const sessionId = await issueSession(app);
    let seq = 0;

    await appendEvent(
      app,
      createInteractionEvent({
        sessionId,
        seq: seq++,
        actor: "user",
        type: "query.submit",
        payload: { text: options.query },
        context: { compositionId: "comp-0", visibleCardIds: [] },
      }),
    );
    const control = await postTurn(app, {
      sessionId,
      trigger: { type: "query.submit", text: options.query },
      profile,
      currentComposition: { cards: [] },
    });
    const controlCards = benefitCards(control);
    const controlOrder = controlCards.map((card) => card.entityId);
    if (controlCards.length < 3) {
      throw new Error("manipulation-check needs at least three BenefitCard candidates");
    }

    await appendEvent(
      app,
      createInteractionEvent({
        sessionId,
        seq: seq++,
        actor: "system",
        type: "composition.applied",
        context: {
          compositionId: control.compositionId,
          visibleCardIds: controlCards.map((card) => card.cardId),
        },
      }),
    );

    const hidden = controlCards[0]!;
    const pinned = controlCards.at(-1)!;
    const reordered = controlCards.find(
      (card) => card.entityId !== hidden.entityId && card.entityId !== pinned.entityId,
    )!;

    const manipulationEvents: Array<InteractionEvent> = [
      createInteractionEvent({
        sessionId,
        seq: seq++,
        actor: "user",
        type: "card.pin",
        target: {
          cardId: pinned.cardId,
          entityId: pinned.entityId,
          componentType: pinned.componentType,
        },
        context: {
          compositionId: control.compositionId,
          visibleCardIds: controlCards.map((card) => card.cardId),
        },
      }),
      createInteractionEvent({
        sessionId,
        seq: seq++,
        actor: "user",
        type: "card.hide",
        target: {
          cardId: hidden.cardId,
          entityId: hidden.entityId,
          componentType: hidden.componentType,
        },
        context: {
          compositionId: control.compositionId,
          visibleCardIds: controlCards
            .filter((card) => card.cardId !== hidden.cardId)
            .map((card) => card.cardId),
        },
      }),
      createInteractionEvent({
        sessionId,
        seq: seq++,
        actor: "user",
        type: "card.reorder",
        target: {
          cardId: reordered.cardId,
          entityId: reordered.entityId,
          componentType: reordered.componentType,
        },
        payload: { toIndex: 1 },
        context: {
          compositionId: control.compositionId,
          visibleCardIds: [pinned.cardId, reordered.cardId],
        },
      }),
      createInteractionEvent({
        sessionId,
        seq: seq++,
        actor: "user",
        type: "card.expand",
        target: {
          cardId: reordered.cardId,
          entityId: reordered.entityId,
          componentType: reordered.componentType,
        },
        context: {
          compositionId: control.compositionId,
          visibleCardIds: [pinned.cardId, reordered.cardId],
        },
      }),
    ];
    for (const event of manipulationEvents) await appendEvent(app, event);

    const currentCards = [
      {
        cardId: pinned.cardId,
        entityId: pinned.entityId,
        componentType: pinned.componentType,
        pinned: true,
        hidden: false,
        expanded: false,
      },
      {
        cardId: reordered.cardId,
        entityId: reordered.entityId,
        componentType: reordered.componentType,
        pinned: false,
        hidden: false,
        expanded: true,
      },
      ...control.cards
        .filter(
          (card) =>
            card.cardId !== pinned.cardId &&
            card.cardId !== reordered.cardId &&
            card.cardId !== hidden.cardId,
        )
        .map((card) => ({
          cardId: card.cardId,
          entityId: card.entityId,
          componentType: card.componentType,
          pinned: false,
          hidden: false,
          expanded: false,
        })),
      {
        cardId: hidden.cardId,
        entityId: hidden.entityId,
        componentType: hidden.componentType,
        pinned: false,
        hidden: true,
        expanded: false,
      },
    ];

    await appendEvent(
      app,
      createInteractionEvent({
        sessionId,
        seq: seq++,
        actor: "user",
        type: "query.submit",
        payload: { text: options.query },
        context: {
          compositionId: control.compositionId,
          visibleCardIds: [pinned.cardId, reordered.cardId],
        },
      }),
    );
    const manipulated = await postTurn(app, {
      sessionId,
      trigger: { type: "query.submit", text: options.query },
      profile,
      currentComposition: { cards: currentCards },
    });
    const manipulatedOrder = benefitCards(manipulated).map((card) => card.entityId);

    await appendEvent(
      app,
      createInteractionEvent({
        sessionId,
        seq: seq++,
        actor: "system",
        type: "composition.applied",
        context: {
          compositionId: manipulated.compositionId,
          visibleCardIds: manipulated.cards.map((card) => card.cardId),
        },
      }),
    );

    const recorded = traceStore.read(sessionId);
    const pinnedTrace = observedTraceSummary.entityEngagement.find(
      (entry) => entry.entityId === pinned.entityId,
    );
    const hiddenTrace = observedTraceSummary.entityEngagement.find(
      (entry) => entry.entityId === hidden.entityId,
    );
    const traceClosedLoop =
      observedTraceSummary.turnCount === 2 &&
      observedTraceSummary.orderingSignal?.userReordered === true &&
      pinnedTrace?.pinned === true &&
      hiddenTrace?.hidden === true;

    return {
      query: options.query,
      pinnedEntityId: pinned.entityId,
      hiddenEntityId: hidden.entityId,
      reorderedEntityId: reordered.entityId,
      controlOrder,
      manipulatedOrder,
      pinnedMovedToTop: manipulatedOrder[0] === pinned.entityId,
      hiddenRemoved: !manipulatedOrder.includes(hidden.entityId),
      orderChanged: JSON.stringify(controlOrder) !== JSON.stringify(manipulatedOrder),
      httpBoundaryVerified: true,
      traceClosedLoop,
      recordedEventTypes: recorded.map((event) => event.type),
      observedTraceSummary,
    };
  } finally {
    rmSync(traceDir, { recursive: true, force: true });
  }
}
