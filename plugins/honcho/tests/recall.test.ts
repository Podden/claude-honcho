import { describe, expect, test } from "bun:test";
import { parseTopic, scoreSameTask, selectRelevant } from "../src/recall.js";

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

describe("topic switch", () => {
  test("scoreSameTask asks one choice about topic and message and reads P(A)", async () => {
    let body: any;
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        body = await req.json();
        return Response.json({ answers: { same: { choice: "B", probabilities: { A: 0.08, B: 0.92 } } } });
      },
    });
    try {
      const cfg = { topicBaseUrl: "", topicModel: "", rerankUrl: `http://127.0.0.1:${server.port}/` };
      expect(await scoreSameTask(cfg, "Update the honcho plugin", "Was war mit dem Lüfter?", 2000)).toBe(0.08);
      expect(body.state).toEqual({ topic: "Update the honcho plugin", message: "Was war mit dem Lüfter?" });
      expect(Object.keys(body.questions)).toEqual(["same"]);
    } finally {
      server.stop(true);
    }
  });

  test("scoreSameTask returns null when the decision model is unreachable or errors", async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response("busy", { status: 503 }) });
    const port = server.port;
    try {
      expect(await scoreSameTask({ topicBaseUrl: "", topicModel: "", rerankUrl: `http://127.0.0.1:${port}` }, "t", "m", 2000)).toBeNull();
    } finally {
      server.stop(true);
    }
    expect(await scoreSameTask({ topicBaseUrl: "", topicModel: "", rerankUrl: `http://127.0.0.1:${port}` }, "t", "m", 500)).toBeNull();
  });
});
