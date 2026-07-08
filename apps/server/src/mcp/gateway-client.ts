import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { UserProfile } from "@genui-canvas/contracts";

// The gateway package only defines the ESM ("import") export condition, which
// CJS require.resolve rejects, and import.meta.resolve is unavailable under the
// vitest SSR transform. Walk up node_modules to the physical entry instead —
// robust in dev, test, and the compiled build.
function resolveGatewayEntry(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, "node_modules", "@mcp-gen-ui", "mcp-server", "dist", "index.js");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Could not locate @mcp-gen-ui/mcp-server entry");
}

export interface GatewayClientOptions {
  /** SQLite snapshot path for the spawned gateway (defaults to a temp file). */
  dbPath?: string;
  /** Override the gateway entry (tests); defaults to the published package. */
  serverEntry?: string;
}

interface ToolContent {
  type: string;
  text?: string;
}

/**
 * Long-lived MCP client that spawns the published, LLM-free gateway over stdio
 * and calls its deterministic tools. The gateway needs no API key of its own.
 */
export class GatewayClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;

  constructor(private readonly options: GatewayClientOptions = {}) {}

  async connect(): Promise<void> {
    if (this.client) return;

    const entry = this.options.serverEntry ?? resolveGatewayEntry();
    const dbPath =
      this.options.dbPath ?? join(tmpdir(), `genui-canvas-gateway-${process.pid}.db`);

    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) env[key] = value;
    }
    env.MCP_GEN_UI_DB_PATH = dbPath;

    this.transport = new StdioClientTransport({ command: process.execPath, args: [entry], env });
    this.client = new Client({ name: "genui-canvas", version: "0.0.0" }, { capabilities: {} });
    await this.client.connect(this.transport);
  }

  private async call(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.client) throw new Error("GatewayClient is not connected");
    const result = (await this.client.callTool({ name, arguments: args })) as {
      content?: ToolContent[];
    };
    const text = (result.content ?? []).find((c) => c.type === "text")?.text ?? "null";
    return JSON.parse(text) as unknown;
  }

  searchBenefits(query: string, profile: UserProfile | Record<string, unknown> = {}): Promise<unknown> {
    return this.call("searchBenefits", { query, profile });
  }

  getBenefitDetail(id: string): Promise<unknown> {
    return this.call("getBenefitDetail", { id });
  }

  buildChecklist(benefitId: string): Promise<unknown> {
    return this.call("buildChecklist", { benefitId });
  }

  getUpcomingDeadlines(profile: UserProfile | Record<string, unknown> = {}): Promise<unknown> {
    return this.call("getUpcomingDeadlines", { profile });
  }

  listPersonas(): Promise<unknown> {
    return this.call("listPersonas", {});
  }

  async close(): Promise<void> {
    await this.client?.close();
    this.client = null;
    this.transport = null;
  }
}
