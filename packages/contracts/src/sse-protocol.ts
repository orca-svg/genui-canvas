import { z } from "zod";
import { BASIC_CATALOG_ID } from "./a2ui.js";
import { CatalogComponentTypeSchema } from "./catalog.js";
import { OpaqueEntityIdSchema, OpaqueIdentifierSchema } from "./input.js";

/**
 * The bounded A2UI v0.9 subset this project emits. The renderer has only the
 * basic catalog, and deterministic expansion currently uses Column + Text, so
 * unsupported executable or unknown components are rejected at the wire edge.
 */
const SurfaceIdSchema = OpaqueIdentifierSchema;
const TextComponentSchema = z
  .object({
    id: OpaqueIdentifierSchema,
    component: z.literal("Text"),
    text: z.object({ path: z.string().startsWith("/").max(256) }).strict(),
  })
  .strict();
const ColumnComponentSchema = z
  .object({
    id: OpaqueIdentifierSchema,
    component: z.literal("Column"),
    children: z.array(OpaqueIdentifierSchema).max(100),
  })
  .strict();
const BasicComponentSchema = z.discriminatedUnion("component", [
  TextComponentSchema,
  ColumnComponentSchema,
]);

export const A2uiMessageSchema = z.union([
  z
    .object({
      version: z.literal("v0.9"),
      createSurface: z
        .object({ surfaceId: SurfaceIdSchema, catalogId: z.literal(BASIC_CATALOG_ID) })
        .strict(),
    })
    .strict(),
  z
    .object({
      version: z.literal("v0.9"),
      updateComponents: z
        .object({
          surfaceId: SurfaceIdSchema,
          components: z.array(BasicComponentSchema).min(1).max(200),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      version: z.literal("v0.9"),
      updateDataModel: z
        .object({
          surfaceId: SurfaceIdSchema,
          path: z.literal("/"),
          value: z.record(z.string(), z.unknown()),
        })
        .strict(),
    })
    .strict(),
]);
export type A2uiMessage = z.infer<typeof A2uiMessageSchema>;

const HttpsUrlSchema = z
  .string()
  .url()
  .refine((value) => value.startsWith("https://"), "sourceUrl must use HTTPS");

/** Server → web stream events. */
export const ServerEventSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("status"), message: z.string().max(500) }).strict(),
  z.object({ kind: z.literal("intent"), text: z.string().max(500) }).strict(),
  z.object({
    kind: z.literal("composition"),
    compositionId: OpaqueIdentifierSchema,
    messages: z.array(A2uiMessageSchema).max(200),
    // Card metadata so the shell can build its manipulable state (cardId ->
    // entityId) without re-parsing the A2UI messages.
    cards: z
      .array(
        z.object({
          cardId: OpaqueIdentifierSchema,
          entityId: OpaqueEntityIdSchema.optional(),
          componentType: CatalogComponentTypeSchema,
          title: z.string().min(1).max(240).optional(),
          sourceUrl: HttpsUrlSchema.optional(),
          sourceCheckedAt: z.string().datetime().optional(),
        }).strict(),
      )
      .max(50)
      .default([]),
  }).strict(),
  // reserved for v2 incremental streaming; unused in v1
  z.object({
    kind: z.literal("composition.partial"),
    compositionId: OpaqueIdentifierSchema,
    messages: z.array(A2uiMessageSchema).max(200),
  }).strict(),
  z.object({ kind: z.literal("error"), message: z.string().max(500) }).strict(),
]);
export type ServerEvent = z.infer<typeof ServerEventSchema>;
