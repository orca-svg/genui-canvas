import { z } from "zod";
import { BASIC_CATALOG_ID } from "./a2ui.js";
import { CatalogComponentTypeSchema } from "./catalog.js";
import { RecommendationPersonaSchema } from "./gateway.js";
import {
  CHECKLIST_MAX_ITEMS,
  ChecklistItemIndexSchema,
  OpaqueEntityIdSchema,
  OpaqueIdentifierSchema,
} from "./input.js";

/**
 * The bounded A2UI v0.9 subset this project emits. Layout (Column/Row/Card/
 * Divider), text, and exactly two interactive primitives: a Button whose
 * action is one of the canvas's own named actions, and a CheckBox bound to a
 * boolean path. Everything else is rejected at the wire edge.
 */
const SurfaceIdSchema = OpaqueIdentifierSchema;
const ComponentIdSchema = OpaqueIdentifierSchema;
const DataPathSchema = z.string().startsWith("/").max(256);
const BoundValueSchema = z.object({ path: DataPathSchema }).strict();

/** Actions a server-composed Button may raise. The shell maps each to one existing composition point. */
export const CanvasActionSchema = z.discriminatedUnion("name", [
  z
    .object({
      name: z.literal("persona.select"),
      context: z.object({ personaId: RecommendationPersonaSchema }).strict(),
    })
    .strict(),
]);
export type CanvasAction = z.infer<typeof CanvasActionSchema>;

const TextComponentSchema = z
  .object({
    id: ComponentIdSchema,
    component: z.literal("Text"),
    text: BoundValueSchema,
    variant: z.enum(["h1", "h2", "h3", "h4", "h5", "caption", "body"]).optional(),
  })
  .strict();
const ColumnComponentSchema = z
  .object({
    id: ComponentIdSchema,
    component: z.literal("Column"),
    children: z.array(ComponentIdSchema).max(100),
  })
  .strict();
const RowComponentSchema = z
  .object({
    id: ComponentIdSchema,
    component: z.literal("Row"),
    children: z.array(ComponentIdSchema).max(100),
    justify: z.enum(["start", "center", "end", "spaceBetween"]).optional(),
    align: z.enum(["start", "center", "end", "stretch"]).optional(),
  })
  .strict();
const CardComponentSchema = z
  .object({ id: ComponentIdSchema, component: z.literal("Card"), child: ComponentIdSchema })
  .strict();
const DividerComponentSchema = z
  .object({ id: ComponentIdSchema, component: z.literal("Divider") })
  .strict();
const ButtonComponentSchema = z
  .object({
    id: ComponentIdSchema,
    component: z.literal("Button"),
    child: ComponentIdSchema,
    variant: z.enum(["default", "primary", "borderless"]).optional(),
    action: z.object({ event: CanvasActionSchema }).strict(),
  })
  .strict();
const CheckBoxComponentSchema = z
  .object({
    id: ComponentIdSchema,
    component: z.literal("CheckBox"),
    label: BoundValueSchema,
    value: BoundValueSchema,
  })
  .strict();
const BasicComponentSchema = z.discriminatedUnion("component", [
  TextComponentSchema,
  ColumnComponentSchema,
  RowComponentSchema,
  CardComponentSchema,
  DividerComponentSchema,
  ButtonComponentSchema,
  CheckBoxComponentSchema,
]);
export type A2uiBasicComponent = z.infer<typeof BasicComponentSchema>;

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

/** Card metadata so the shell can build its manipulable state without re-parsing A2UI. */
export const CompositionCardSchema = z
  .object({
    cardId: OpaqueIdentifierSchema,
    entityId: OpaqueEntityIdSchema.optional(),
    componentType: CatalogComponentTypeSchema,
    title: z.string().min(1).max(240).optional(),
    sourceUrl: HttpsUrlSchema.optional(),
    sourceCheckedAt: z.string().datetime().optional(),
    emphasis: z.enum(["primary", "secondary"]).optional(),
    /** Shipped but not shown: the user hid this semantic card and may unhide it locally. */
    hidden: z.boolean().optional(),
    /** Checklist only: number of CheckBox rows bound to /checked{i}. */
    itemCount: z.number().int().min(0).max(CHECKLIST_MAX_ITEMS).optional(),
    /** Checklist only: rows the trace says the user ticked; a new shell row starts from these. */
    checkedItems: z.array(ChecklistItemIndexSchema).max(CHECKLIST_MAX_ITEMS).optional(),
  })
  .strict();
export type CompositionCard = z.infer<typeof CompositionCardSchema>;

/** Sequence the client must use for its next trace event; the server always sets it. */
const NextSeqSchema = z.number().int().nonnegative().optional();

/** Server → web stream events. */
export const ServerEventSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("status"), message: z.string().max(500) }).strict(),
  z.object({ kind: z.literal("intent"), text: z.string().max(500) }).strict(),
  z
    .object({
      kind: z.literal("composition"),
      compositionId: OpaqueIdentifierSchema,
      messages: z.array(A2uiMessageSchema).max(200),
      cards: z.array(CompositionCardSchema).max(50).default([]),
      nextSeq: NextSeqSchema,
    })
    .strict(),
  z.object({ kind: z.literal("error"), message: z.string().max(500), nextSeq: NextSeqSchema }).strict(),
]);
export type ServerEvent = z.infer<typeof ServerEventSchema>;
