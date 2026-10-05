import { describe, expect, test } from "bun:test";
import { isHarnessInjected, stripLeadingReminders } from "../src/prompt-filters";

const worktreeNotice =
  "<system-reminder>\nYou are operating in a git worktree.\nWorktree path: /tmp/wt\n</system-reminder>\n\n";
const taskNotice = "<system-reminder>\nThe user started your suggested background task.\n</system-reminder>\n";

describe("stripLeadingReminders", () => {
  test("removes a leading reminder and keeps the typed text", () => {
    expect(stripLeadingReminders(worktreeNotice + "is this resolved on main?")).toBe("is this resolved on main?");
  });

  test("removes stacked reminders", () => {
    expect(stripLeadingReminders(worktreeNotice + taskNotice + "go")).toBe("go");
  });

  test("leaves reminders that are not leading", () => {
    const p = "see this <system-reminder>x</system-reminder>";
    expect(stripLeadingReminders(p)).toBe(p);
  });
});

describe("isHarnessInjected", () => {
  test("typed prompt behind a reminder is user input", () => {
    expect(isHarnessInjected(worktreeNotice + "This live llm test failed")).toBe(false);
  });

  test("reminder with nothing after it is harness-injected", () => {
    expect(isHarnessInjected(taskNotice)).toBe(true);
  });

  test("unclosed reminder is harness-injected", () => {
    expect(isHarnessInjected("<system-reminder>\ntruncated")).toBe(true);
  });

  test("other harness tags behind a reminder are still harness-injected", () => {
    expect(isHarnessInjected(worktreeNotice + "<task-notification>done</task-notification>")).toBe(true);
  });

  test("plain prompt is user input", () => {
    expect(isHarnessInjected("do the thing")).toBe(false);
  });

  test("subagent hand-back behind the message preamble is harness-injected", () => {
    const p =
      'Another Claude session sent a message:\n<agent-message from="ab6797cbd3dbb120a">\n[Subagent hand-back] report';
    expect(isHarnessInjected(p)).toBe(true);
  });

  test("cross-session message behind the preamble is harness-injected", () => {
    const p = 'Another Claude session sent a message:\n<cross-session-message from-name="einsprecher">\nhi';
    expect(isHarnessInjected(p)).toBe(true);
  });

  test("bare agent-message envelope is harness-injected", () => {
    expect(isHarnessInjected('<agent-message from="a1">\nreport')).toBe(true);
  });

  test("prompt that only mentions agent-message is user input", () => {
    expect(isHarnessInjected("why does <agent-message> end up in honcho?")).toBe(false);
  });
});
