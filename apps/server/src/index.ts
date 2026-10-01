import { serve } from "@hono/node-server";
import { join } from "node:path";
import { loadDotenv } from "./config/env.js";
import { GatewayClient } from "./mcp/gateway-client.js";
import { createProvider } from "./llm/factory.js";
import { RuleBasedProvider } from "./llm/provider.js";
import { TraceStore } from "./trace/store.js";
import { createApp } from "./app.js";

// BYOK: pull the operator's own key from apps/server/.env before we select a
// provider. No key => rule-based (zero config).
loadDotenv();

const gateway = new GatewayClient();
await gateway.connect();

const provider = createProvider();
// A BYOK LLM that fails (quota, network, a malformed answer) must not turn the
// canvas into "구성 중 오류가 발생했습니다": the rule-based provider composes
// that turn instead and the composition says which provider did.
const fallbackProvider = provider.name === "rule-based" ? undefined : new RuleBasedProvider();
const traceStore = new TraceStore(process.env.GENUI_TRACE_DIR ?? join(process.cwd(), "data", "sessions"));
const app = createApp({ gateway, provider, fallbackProvider, traceStore });

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port });
// eslint-disable-next-line no-console
console.log(`[genui-canvas] server listening on :${port} (LLM provider: ${provider.name})`);
