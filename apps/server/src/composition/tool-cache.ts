import type { EntityRef, BenefitSummary } from "@genui-canvas/contracts";

/**
 * Per-turn cache of gateway tool results, indexed by (toolResult, entityId).
 * The server calls the gateway deterministically and fills this cache; the LLM
 * only produces entityRefs. expand.ts pulls the real data from here, so the LLM
 * can never inject benefit data it did not actually retrieve.
 */
export class ToolResultCache {
  private readonly byRef = new Map<string, unknown>();

  private key(toolResult: string, entityId: string): string {
    return `${toolResult}::${entityId}`;
  }

  put(toolResult: string, entityId: string, data: unknown): void {
    this.byRef.set(this.key(toolResult, entityId), data);
  }

  /** Convenience: index a searchBenefits result array by each summary id. */
  putSearchResults(results: BenefitSummary[]): void {
    for (const summary of results) {
      this.put("searchBenefits", summary.id, summary);
    }
  }

  get(ref: EntityRef): unknown | undefined {
    return this.byRef.get(this.key(ref.toolResult, ref.entityId));
  }

  has(ref: EntityRef): boolean {
    return this.byRef.has(this.key(ref.toolResult, ref.entityId));
  }
}
