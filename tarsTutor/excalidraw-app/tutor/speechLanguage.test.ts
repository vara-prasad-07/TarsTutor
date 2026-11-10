import { describe, expect, it } from "vitest";
import { speechLanguage } from "./speechLanguage";

describe("speech language", () => {
  it.each([
    ["Explain the area", "en-IN"],
    ["వైశాల్యం మూడు గుణం ఏడు", "te-IN"],
    ["teach circles in Telugu", "te-IN"],
    ["हिंदी में समझाओ", "hi-IN"],
    ["தமிழில் விளக்கவும்", "ta-IN"],
  ])("routes %s to %s", (text, expected) => {
    expect(speechLanguage(text)).toBe(expected);
  });
});
