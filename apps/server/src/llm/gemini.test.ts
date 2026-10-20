import { beforeEach, describe, expect, it } from "vitest";
import {
  COMPOSITION_RESPONSE_SCHEMA,
  DEFAULT_GEMINI_MODEL,
  GeminiProvider,
  buildGeminiGenerateRequest,
} from "./gemini.js";
import { ProviderError, type ComposeRequest } from "./provider.js";
import { SYSTEM_PROMPT } from "./prompts.js";

describe("Gemini composition response schema", () => {
  it("uses the requested rolling Flash alias", () => {
    expect(DEFAULT_GEMINI_MODEL).toBe("gemini-flash-latest");
  });

  it("keeps trusted instructions in the Gemini system channel", () => {
    const request: ComposeRequest = {
      context: {
        trigger: { type: "query.submit", text: "사용자 원문" },
        currentComposition: { cards: [] },
        traceSummary: { entityEngagement: [], recentEvents: [], turnCount: 0 },
        profile: {},
      },
      candidates: [],
      resources: [],
    };
    const generated = buildGeminiGenerateRequest(DEFAULT_GEMINI_MODEL, request);
    expect(generated.config.systemInstruction).toBe(SYSTEM_PROMPT);
    expect(generated.contents).not.toContain(SYSTEM_PROMPT);
  });

  it("encodes the same six component/tool discriminants as CompositionSpecSchema", () => {
    const cardItems = COMPOSITION_RESPONSE_SCHEMA.properties.cards.items as {
      anyOf?: Array<{
        properties: {
          componentType: { enum: string[] };
          entityRef: { properties: { toolResult: { enum: string[] } } };
        };
      }>;
    };
    const pairs = (cardItems.anyOf ?? []).map((variant) => [
      variant.properties.componentType.enum[0],
      variant.properties.entityRef.properties.toolResult.enum[0],
    ]);

    expect(pairs).toEqual([
      ["BenefitCard", "searchBenefits"],
      ["ScoreBreakdown", "searchBenefits"],
      ["Checklist", "buildChecklist"],
      ["DeadlineList", "getUpcomingDeadlines"],
      ["PersonaSelector", "listPersonas"],
      ["SourceNotice", "getBenefitDetail"],
    ]);
  });
});

describe("GeminiProvider resilience", () => {
  const request: ComposeRequest = {
    context: {
      trigger: { type: "query.submit", text: "x" },
      currentComposition: { cards: [] },
      traceSummary: { entityEngagement: [], recentEvents: [], turnCount: 0 },
      profile: {},
    },
    candidates: [],
    resources: [],
  };
  const answer = { intentSummary: "s", cards: [], order: [] };
  const ok = JSON.stringify(answer);
  // Built at runtime so the repository safety scanner never sees a key-shaped literal.
  const fakeKey = "AIza" + "Sy" + "X".repeat(33);

  /** The SDK's ApiError carries the HTTP status on `status`; the provider reads only that. */
  function apiError(status: number, message = `HTTP ${status}`): Error {
    return Object.assign(new Error(message), { status });
  }

  /** A fake generateContent that plays the given outcomes in order and records the model of each call. */
  function scripted(outcomes: Array<Error | string>) {
    const calls: string[] = [];
    const generate = async (req: { model: string }) => {
      calls.push(req.model);
      const next = outcomes.shift();
      if (next === undefined) throw new Error("no scripted outcome left");
      if (next instanceof Error) throw next;
      return { text: next };
    };
    return { calls, generate };
  }

  const sleeps: number[] = [];
  const sleep = async (ms: number) => {
    sleeps.push(ms);
  };
  beforeEach(() => {
    sleeps.length = 0;
  });

  function provider(generate: ReturnType<typeof scripted>["generate"], extra: { fallbackModel?: string } = {}) {
    return new GeminiProvider({ apiKey: "test", model: "primary", generate, sleep, log: () => undefined, ...extra });
  }

  async function failure(promise: Promise<unknown>): Promise<ProviderError> {
    const error = await promise.then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ProviderError);
    return error as ProviderError;
  }

  it("retries a 503 with growing waits and returns the answer that follows", async () => {
    const { calls, generate } = scripted([apiError(503), apiError(503), ok]);
    await expect(provider(generate).compose(request)).resolves.toEqual(answer);
    expect(calls).toEqual(["primary", "primary", "primary"]);
    expect(sleeps).toEqual([400, 800]);
  });

  it("moves to the fallback model once the primary stays overloaded", async () => {
    const { calls, generate } = scripted([apiError(503), apiError(503), apiError(503), ok]);
    await expect(provider(generate, { fallbackModel: "backup" }).compose(request)).resolves.toEqual(answer);
    expect(calls).toEqual(["primary", "primary", "primary", "backup"]);
  });

  it("goes straight to the fallback model when the primary model does not exist", async () => {
    const { calls, generate } = scripted([apiError(404), ok]);
    await expect(provider(generate, { fallbackModel: "backup" }).compose(request)).resolves.toEqual(answer);
    expect(calls).toEqual(["primary", "backup"]);
  });

  it("reports a primary that stays overloaded, with no fallback model, as an overloaded failure", async () => {
    const { calls, generate } = scripted([apiError(503), apiError(503), apiError(503)]);
    const error = await failure(provider(generate).compose(request));
    expect(error).toMatchObject({ kind: "overloaded", status: 503 });
    expect(calls).toHaveLength(3);
  });

  it("retries a 429 and then reports it as rate limited", async () => {
    const { calls, generate } = scripted([apiError(429), apiError(429), apiError(429)]);
    const error = await failure(provider(generate).compose(request));
    expect(error).toMatchObject({ kind: "rate_limited", status: 429 });
    expect(calls).toHaveLength(3);
  });

  it("reports a missing model without retrying it", async () => {
    const { calls, generate } = scripted([apiError(404)]);
    const error = await failure(provider(generate).compose(request));
    expect(error).toMatchObject({ kind: "model_unavailable", status: 404 });
    expect(calls).toEqual(["primary"]);
  });

  it.each([
    [401, "Unauthorized"],
    [403, "Permission denied"],
    [400, "API key not valid. Please pass a valid API key."],
  ])("treats HTTP %i (%s) as a key problem: no retry and no fallback model", async (status, message) => {
    const { calls, generate } = scripted([apiError(status, message)]);
    const error = await failure(provider(generate, { fallbackModel: "backup" }).compose(request));
    expect(error.kind).toBe("auth");
    expect(calls).toEqual(["primary"]);
  });

  it("reports text that is not JSON as an invalid response", async () => {
    const { calls, generate } = scripted(["not json"]);
    const error = await failure(provider(generate).compose(request));
    expect(error.kind).toBe("invalid_response");
    expect(calls).toEqual(["primary"]);
  });

  it("never repeats the API key in its error message", async () => {
    const { generate } = scripted([apiError(403, `request with key=${fakeKey} was rejected`)]);
    const error = await failure(provider(generate).compose(request));
    expect(error.message).not.toContain(fakeKey);
  });
});
