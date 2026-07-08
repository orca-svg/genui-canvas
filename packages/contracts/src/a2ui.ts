/**
 * The built-in A2UI v0.9 primitive catalog id. The server's expand.ts stamps
 * this into every createSurface message; the renderer's MessageProcessor is
 * created with the matching basicCatalog. The renderer package asserts this
 * constant equals `basicCatalog.id` so the two never drift.
 */
export const BASIC_CATALOG_ID =
  "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json";
