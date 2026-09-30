import { describe, expect, it } from "vitest";
import { withParticle } from "./korean.js";

describe("withParticle", () => {
  it("picks the particle from the last syllable's final consonant", () => {
    expect(withParticle("국민취업지원제도", "을/를")).toBe("국민취업지원제도를");
    expect(withParticle("국가장학금", "을/를")).toBe("국가장학금을");
    expect(withParticle("월세 지원", "은/는")).toBe("월세 지원은");
    expect(withParticle("국민취업지원제도", "은/는")).toBe("국민취업지원제도는");
    expect(withParticle("국가장학금", "이/가")).toBe("국가장학금이");
    expect(withParticle("청년 도약 계좌", "이/가")).toBe("청년 도약 계좌가");
  });

  it("uses the first particle when the word does not end in a Hangul syllable", () => {
    expect(withParticle("test-benefit", "을/를")).toBe("test-benefit을");
    expect(withParticle("", "은/는")).toBe("은");
  });
});
