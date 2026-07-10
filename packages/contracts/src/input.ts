import { z } from "zod";

/** The only user-authored free text accepted by the canvas trace/API. */
export const UserQueryTextSchema = z.string().trim().min(1).max(300);

/** Identifier grammar safe for logs, prompt projections, paths, and DOM ids. */
export const OpaqueIdentifierSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/, "invalid opaque identifier");

/** Opaque gateway identifiers are data keys, never a free-text prompt channel. */
export const OpaqueEntityIdSchema = OpaqueIdentifierSchema;
