import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import {
  BenefitDetailSchema,
  BenefitSearchResponseSchema,
  ChecklistResponseSchema,
  RecommendationPersonaSchema,
  RecommendationWeightsSchema,
  UpcomingDeadlinesResponseSchema,
  type BenefitDetail,
  type BenefitSearchResponse,
  type ChecklistResponse,
  type UpcomingDeadlinesResponse,
  type UserProfile,
} from "@genui-canvas/contracts";

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
  /** Hard upper bound for one MCP tool call. */
  toolTimeoutMs?: number;
}

const DEFAULT_TOOL_TIMEOUT_MS = 15_000;

/** The LLM-free gateway receives only the SDK's safe runtime allowlist. */
export function createGatewayEnvironment(dbPath: string): Record<string, string> {
  return { ...getDefaultEnvironment(), MCP_GEN_UI_DB_PATH: dbPath };
}

interface ToolContent {
  type: string;
  text?: string;
}

interface GatewayToolResult {
  content?: ToolContent[];
  structuredContent?: unknown;
  isError?: boolean;
}

const PersonaPresetSchema = z
  .object({
    id: RecommendationPersonaSchema,
    description: z.string(),
    weights: RecommendationWeightsSchema,
  })
  .strict();
const PersonaListResponseSchema = z.object({ personas: z.array(PersonaPresetSchema) }).strict();
export type PersonaListResponse = z.infer<typeof PersonaListResponseSchema>;

/** Validate both current text-only and future structured MCP tool responses. */
export function parseGatewayToolResult<TSchema extends z.ZodTypeAny>(
  result: GatewayToolResult,
  schema: TSchema,
): z.output<TSchema> {
  if (result.isError) throw new Error("Gateway tool reported an error");

  const text = (result.content ?? []).find((item) => item.type === "text")?.text;
  let textValue: unknown;
  if (text !== undefined) {
    try {
      textValue = JSON.parse(text) as unknown;
    } catch {
      throw new Error("Gateway returned malformed JSON text output");
    }
  }

  if (
    result.structuredContent !== undefined &&
    text !== undefined &&
    !isDeepStrictEqual(result.structuredContent, textValue)
  ) {
    throw new Error("Gateway returned inconsistent structured and text output");
  }

  const value = result.structuredContent ?? textValue;
  if (value === undefined) throw new Error("Gateway returned no structured output");
  return schema.parse(value) as z.output<TSchema>;
}

/**
 * Long-lived MCP client that spawns the published, LLM-free gateway over stdio
 * and calls its deterministic tools. The gateway needs no API key of its own.
 */
export class GatewayClient {
  private client: Client | null = null;

  constructor(private readonly options: GatewayClientOptions = {}) {}

  async connect(): Promise<void> {
    if (this.client) return;

    const entry = this.options.serverEntry ?? resolveGatewayEntry();
    const dbPath =
      this.options.dbPath ?? join(tmpdir(), `genui-canvas-gateway-${process.pid}.db`);

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [entry],
      env: createGatewayEnvironment(dbPath),
    });
    const client = new Client(
      { name: "genui-canvas", version: "0.0.0" },
      { capabilities: {} },
    );
    try {
      await client.connect(transport);
      this.client = client;
    } catch (error) {
      await transport.close().catch(() => undefined);
      this.client = null;
      throw error;
    }
  }

  private async call<TSchema extends z.ZodTypeAny>(
    name: string,
    args: Record<string, unknown>,
    schema: TSchema,
  ): Promise<z.output<TSchema>> {
    if (!this.client) throw new Error("GatewayClient is not connected");
    const timeout = this.options.toolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
    const result = (await this.client.callTool(
      { name, arguments: args },
      undefined,
      { timeout, maxTotalTimeout: timeout },
    )) as GatewayToolResult;
    return parseGatewayToolResult(result, schema);
  }

  searchBenefits(
    query: string,
    profile: UserProfile | Record<string, unknown> = {},
  ): Promise<BenefitSearchResponse> {
    return this.call("searchBenefits", { query, profile }, BenefitSearchResponseSchema);
  }

  getBenefitDetail(id: string): Promise<BenefitDetail> {
    return this.call("getBenefitDetail", { id }, BenefitDetailSchema);
  }

  buildChecklist(benefitId: string): Promise<ChecklistResponse> {
    return this.call("buildChecklist", { benefitId }, ChecklistResponseSchema);
  }

  getUpcomingDeadlines(
    profile: UserProfile | Record<string, unknown> = {},
  ): Promise<UpcomingDeadlinesResponse> {
    return this.call("getUpcomingDeadlines", { profile }, UpcomingDeadlinesResponseSchema);
  }

  listPersonas(): Promise<PersonaListResponse> {
    return this.call("listPersonas", {}, PersonaListResponseSchema);
  }

  async close(): Promise<void> {
    await this.client?.close();
    this.client = null;
  }
}
