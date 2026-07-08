import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { InteractionEventSchema, type InteractionEvent } from "@genui-canvas/contracts";

/**
 * Append-only interaction trace, one JSONL file per session. This is the study
 * artifact and the source the summarizer reads (M4). Swappable behind this
 * class for a DB in a real study.
 */
export class TraceStore {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  private file(sessionId: string): string {
    return join(this.dir, `${sessionId}.jsonl`);
  }

  append(event: InteractionEvent): void {
    appendFileSync(this.file(event.sessionId), `${JSON.stringify(event)}\n`, "utf8");
  }

  read(sessionId: string): InteractionEvent[] {
    const path = this.file(sessionId);
    if (!existsSync(path)) return [];
    return readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => InteractionEventSchema.parse(JSON.parse(line)));
  }
}
