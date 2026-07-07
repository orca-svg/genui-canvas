// @genui-canvas/contracts — shared contracts between the web shell and the
// orchestrator server.
export const CONTRACTS_SCHEMA_VERSION = 1 as const;

export * from "./gateway.js";
export * from "./interaction-event.js";
export * from "./catalog.js";
export * from "./composition.js";
export * from "./sse-protocol.js";
