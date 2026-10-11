import { describe, expect, test } from "bun:test";
import { parseTopic, selectRelevant } from "../src/recall.js";

describe("parseTopic", () => {
  test("reads topic and caps queries at three", () => {
    const t = parseTopic('{"topic": "Fix the deriver", "queries": ["a", "b", "c", "d"]}');
    expect(t?.topic).toBe("Fix the deriver");
    expect(t?.queries).toEqual(["a", "b", "c"]);
  });

  test("tolerates prose around the JSON object", () => {
    expect(parseTopic('Sure:\n{"topic": "x", "queries": []}\nDone')?.topic).toBe("x");
  });

  test("rejects a missing topic or malformed JSON", () => {
    expect(parseTopic('{"queries": ["a"]}')).toBeNull();
    expect(parseTopic("no json here")).toBeNull();
  });
});

describe("selectRelevant", () => {
  test("keeps facts at or above the threshold, best first, capped", () => {
    const facts = ["low", "mid", "high", "edge"];
    expect(selectRelevant(facts, [0.2, 0.75, 0.95, 0.7], 0.7, 2)).toEqual(["high", "mid"]);
  });

  test("returns nothing when no fact clears the threshold", () => {
    expect(selectRelevant(["a", "b"], [0.1, 0.69], 0.7, 5)).toEqual([]);
  });
});
