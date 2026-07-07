import { z } from "zod";

/**
 * A2UI wire message. The exact v0.9 body is owned by @a2ui/web_core and
 * reconciled with the renderer in milestone M1; here we only assert the version
 * tag and pass the rest through, so the SSE contract does not lock the A2UI
 * schema prematurely.
 */
export const A2uiMessageSchema = z.object({ version: z.literal("v0.9") }).passthrough();
export type A2uiMessage = z.infer<typeof A2uiMessageSchema>;

/** Server → web stream events. */
export const ServerEventSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("status"), message: z.string() }),
  z.object({ kind: z.literal("intent"), text: z.string() }),
  z.object({
    kind: z.literal("composition"),
    compositionId: z.string(),
    messages: z.array(A2uiMessageSchema),
  }),
  // reserved for v2 incremental streaming; unused in v1
  z.object({
    kind: z.literal("composition.partial"),
    compositionId: z.string(),
    messages: z.array(A2uiMessageSchema),
  }),
  z.object({ kind: z.literal("error"), message: z.string() }),
]);
export type ServerEvent = z.infer<typeof ServerEventSchema>;
