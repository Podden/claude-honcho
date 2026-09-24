import { describe, expect, test } from "bun:test";
import { recallBoundary, scopeForSession } from "../src/config";
import { extractConclusions } from "../src/hooks/user-prompt";
import { isHarnessInjected } from "../src/prompt-filters";

const scopes = { work: ["db-regio", "officeit"], home: ["thermobt"] };

describe("recallBoundary", () => {
  test("peer (default) stays unscoped", () => {
    expect(recallBoundary({}, "db-regio")).toEqual({});
    expect(recallBoundary({ recallScope: "peer", scopes }, "db-regio")).toEqual({});
  });

  test("session pins the current session", () => {
    expect(recallBoundary({ recallScope: "session", scopes }, "db-regio")).toEqual({ session: "db-regio" });
  });

  test("scope picks the session's scope", () => {
    expect(recallBoundary({ recallScope: "scope", scopes }, "thermobt")).toEqual({ scope: "home" });
  });

  test("scope falls back to the session when no scope lists it", () => {
    expect(recallBoundary({ recallScope: "scope", scopes }, "honcho")).toEqual({ session: "honcho" });
    expect(scopeForSession({}, "honcho")).toBeUndefined();
  });
});

describe("extractConclusions", () => {
  test("keeps conclusion heads and drops premise/source metadata", () => {
    const representation = [
      "## Explicit Observations",
      "",
      "[2026-09-24 08:00:00] daniel uses Paperless",
      "",
      "## Deductive Observations",
      "",
      "[2026-09-24 08:00:00] daniel automates document tagging",
      "   Premises:",
      "   - daniel uses Paperless",
      "",
      "## Inductive Observations",
      "",
      " **Pattern** [high]: daniel prefers self-hosted tools",
      "   **Type**: preference",
      "   **Sources**:",
      "   - abc",
    ].join("\n");
    expect(extractConclusions({ representation })).toEqual([
      "daniel uses Paperless",
      "daniel automates document tagging",
      "daniel prefers self-hosted tools",
    ]);
  });
});

describe("isHarnessInjected envelopes (#131)", () => {
  test("cross-session and channel deliveries are harness-injected", () => {
    expect(isHarnessInjected('<cross-session-message from-name="einsprecher" from-mode="bypass">\nhi\n</cross-session-message>')).toBe(true);
    expect(isHarnessInjected('<channel source="slack">\nhi\n</channel>')).toBe(true);
  });

  test("typed text mentioning the tag is user input", () => {
    expect(isHarnessInjected("why is <cross-session-message> saved?")).toBe(false);
  });
});
