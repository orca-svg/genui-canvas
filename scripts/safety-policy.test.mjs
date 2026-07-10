import assert from "node:assert/strict";
import test from "node:test";
import { checkCredentialText, checkSourceText } from "./safety-policy.mjs";

test("rejects persistent browser storage and raw model prompt channels", () => {
  assert.ok(
    checkSourceText("apps/web/src/App.tsx", "localStorage.setItem('profile', value)").length > 0,
  );
  assert.ok(
    checkSourceText(
      "apps/server/src/llm/prompts.ts",
      "const line = context.trigger.text + resource.title",
    ).length > 0,
  );
});

test("rejects unsafe blank-target links and definitive eligibility copy", () => {
  assert.ok(
    checkSourceText(
      "apps/web/src/Unsafe.tsx",
      '<a href="https://example.test" target="_blank">받을 수 있습니다</a>',
    ).length >= 2,
  );
});

test("accepts bounded semantic prompt data and a hardened external link", () => {
  assert.deepEqual(
    checkSourceText(
      "apps/web/src/Safe.tsx",
      '<a href={sourceUrl} target="_blank" rel="noopener noreferrer">출처 페이지</a>',
    ),
    [],
  );
  assert.deepEqual(
    checkSourceText(
      "apps/server/src/llm/prompts.ts",
      "const line = `entityId=${candidate.entityId} score=${candidate.score}`",
    ),
    [],
  );
});

test("finds credentials in non-code tracked text", () => {
  assert.equal(
    checkCredentialText("README.md", `token=${"ghp_"}${"1234567890abcdefghij"}`).length,
    1,
  );
  assert.deepEqual(checkCredentialText("README.md", "GEMINI_API_KEY=your-own-key"), []);
});
