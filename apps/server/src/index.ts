import { serve } from "@hono/node-server";
import { join } from "node:path";
import { GatewayClient } from "./mcp/gateway-client.js";
import { createProvider } from "./llm/factory.js";
import { TraceStore } from "./trace/store.js";
import { createApp } from "./app.js";

const gateway = new GatewayClient();
await gateway.connect();

const provider = createProvider();
const traceStore = new TraceStore(process.env.GENUI_TRACE_DIR ?? join(process.cwd(), "data", "sessions"));
const app = createApp({ gateway, provider, traceStore });

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port });
// eslint-disable-next-line no-console
console.log(`[genui-canvas] server listening on :${port} (LLM provider: ${provider.name})`);
