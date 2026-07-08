import type { EntityEngagement, InteractionEvent, TraceSummary } from "@genui-canvas/contracts";

export interface SummarizeOptions {
  maxEntities?: number;
  maxRecent?: number;
}

interface Mutable {
  entityId: string;
  title: string;
  pinned: boolean;
  hidden: boolean;
  expandCount: number;
  lastAction?: string;
  lastSeq: number;
}

/**
 * Deterministic aggregation of a session's interaction trace into the context
 * the LLM sees at a composition point. LLM-free (so the trace→composition tests
 * are stable) and bounded (entity + recent caps) to keep the prompt small.
 */
export function summarizeTrace(
  events: InteractionEvent[],
  options: SummarizeOptions = {},
): TraceSummary {
  const maxEntities = options.maxEntities ?? 12;
  const maxRecent = options.maxRecent ?? 10;

  const byEntity = new Map<string, Mutable>();
  let turnCount = 0;
  let userReordered = false;

  const touch = (entityId: string): Mutable => {
    let entry = byEntity.get(entityId);
    if (!entry) {
      entry = { entityId, title: entityId, pinned: false, hidden: false, expandCount: 0, lastSeq: -1 };
      byEntity.set(entityId, entry);
    }
    return entry;
  };

  for (const event of events) {
    if (event.type === "query.submit" || event.type === "persona.switch") turnCount += 1;
    if (event.type === "card.reorder") userReordered = true;

    const entityId = event.target?.entityId;
    if (!entityId) continue;
    const entry = touch(entityId);
    entry.lastAction = event.type;
    entry.lastSeq = event.seq;
    switch (event.type) {
      case "card.pin":
        entry.pinned = true;
        break;
      case "card.unpin":
        entry.pinned = false;
        break;
      case "card.hide":
        entry.hidden = true;
        break;
      case "card.unhide":
        entry.hidden = false;
        break;
      case "card.expand":
        entry.expandCount += 1;
        break;
      default:
        break;
    }
  }

  const engagement: EntityEngagement[] = [...byEntity.values()]
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (a.expandCount !== b.expandCount) return b.expandCount - a.expandCount;
      return b.lastSeq - a.lastSeq;
    })
    .slice(0, maxEntities)
    .map((entry) => ({
      entityId: entry.entityId,
      title: entry.title,
      pinned: entry.pinned,
      hidden: entry.hidden,
      expandCount: entry.expandCount,
      ...(entry.lastAction ? { lastAction: entry.lastAction } : {}),
    }));

  const recentEvents = events
    .slice(-maxRecent)
    .map((event) => oneLine(event));

  const summary: TraceSummary = { entityEngagement: engagement, recentEvents, turnCount };

  if (userReordered) {
    summary.orderingSignal = {
      userReordered: true,
      topThreeEntityIds: engagement.filter((e) => !e.hidden).slice(0, 3).map((e) => e.entityId),
    };
  }

  return summary;
}

function oneLine(event: InteractionEvent): string {
  const target = event.target?.entityId ? ` ${event.target.entityId}` : "";
  return `${event.actor} ${event.type}${target}`;
}
