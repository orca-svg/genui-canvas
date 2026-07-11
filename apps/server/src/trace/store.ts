import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  InteractionEventSchema,
  SessionIdSchema,
  type InteractionEvent,
} from "@genui-canvas/contracts";

/**
 * Append-only interaction trace, one JSONL file per session. This is the study
 * artifact and the source the summarizer reads (M4). Swappable behind this
 * class for a DB in a real study.
 */
export class TraceStore {
  private readonly root: string;
  private readonly nextSeqBySession = new Map<string, number>();

  constructor(dir: string) {
    this.root = resolve(dir);
    mkdirSync(this.root, { recursive: true });
  }

  private file(sessionId: string): string {
    if (!SessionIdSchema.safeParse(sessionId).success) {
      throw new TypeError("Invalid session id");
    }
    const path = resolve(this.root, `${sessionId}.jsonl`);
    if (dirname(path) !== this.root) {
      throw new TypeError("Session path escapes storage root");
    }
    return path;
  }

  append(event: InteractionEvent): void {
    let expectedSeq = this.nextSeqBySession.get(event.sessionId);
    if (expectedSeq === undefined) {
      const previous = this.read(event.sessionId).at(-1);
      expectedSeq = previous ? previous.seq + 1 : 0;
    }
    if (event.seq !== expectedSeq) {
      throw new RangeError(`Event sequence conflict: expected ${expectedSeq}`);
    }
    appendFileSync(this.file(event.sessionId), `${JSON.stringify(event)}\n`, "utf8");
    this.nextSeqBySession.set(event.sessionId, expectedSeq + 1);
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
