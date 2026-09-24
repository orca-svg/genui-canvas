import {
  CHECKLIST_MAX_ITEMS,
  type EntityEngagement,
  type InteractionEvent,
  type TraceSummary,
} from "@genui-canvas/contracts";

export interface SummarizeOptions {
  maxEntities?: number;
  maxRecent?: number;
}

/** Server bookkeeping rows: kept in the trace, never shown to the provider as "recent activity". */
const SILENT_EVENT_TYPES = new Set<InteractionEvent["type"]>(["tool.called", "session.start"]);

interface Mutable {
  entityId: string;
  pinned: boolean;
  hidden: boolean;
  expandCount: number;
  checkedItems: Set<number>;
  lastAction?: string;
  lastSeq: number;
}

/**
 * Deterministic aggregation of a session's interaction trace into the context
 * the provider sees at a composition point. LLM-free and bounded.
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
      entry = {
        entityId,
        pinned: false,
        hidden: false,
        expandCount: 0,
        checkedItems: new Set(),
        lastSeq: -1,
      };
      byEntity.set(entityId, entry);
    }
    return entry;
  };

  for (const event of events) {
    if (SILENT_EVENT_TYPES.has(event.type)) continue;
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
      case "checklist.check": {
        const index = checklistIndex(event);
        if (index !== undefined) entry.checkedItems.add(index);
        break;
      }
      case "checklist.uncheck": {
        const index = checklistIndex(event);
        if (index !== undefined) entry.checkedItems.delete(index);
        break;
      }
      default:
        break;
    }
  }

  const engagement: EntityEngagement[] = [...byEntity.values()]
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      const aEngaged = a.expandCount + a.checkedItems.size;
      const bEngaged = b.expandCount + b.checkedItems.size;
      if (aEngaged !== bEngaged) return bEngaged - aEngaged;
      return b.lastSeq - a.lastSeq;
    })
    .slice(0, maxEntities)
    .map((entry) => ({
      entityId: entry.entityId,
      pinned: entry.pinned,
      hidden: entry.hidden,
      expandCount: entry.expandCount,
      checkedItems: [...entry.checkedItems].sort((a, b) => a - b).slice(0, CHECKLIST_MAX_ITEMS),
      ...(entry.lastAction ? { lastAction: entry.lastAction } : {}),
    }));

  const recentEvents = events
    .filter((event) => !SILENT_EVENT_TYPES.has(event.type))
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

function checklistIndex(event: InteractionEvent): number | undefined {
  const raw = event.payload?.itemIndex;
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 0 && raw < CHECKLIST_MAX_ITEMS
    ? raw
    : undefined;
}

function oneLine(event: InteractionEvent): string {
  const target = event.target?.entityId ? ` ${event.target.entityId}` : "";
  return `${event.actor} ${event.type}${target}`;
}
