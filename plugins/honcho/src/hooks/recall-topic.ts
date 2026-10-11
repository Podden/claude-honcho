import { existsSync, readFileSync } from "fs";
import { initHook, loadConfig, isPluginEnabled, getInjectionConfig, getCachedStdin, readStdinText } from "../config.js";
import { logHook } from "../log.js";
import { stripLeadingReminders } from "../prompt-filters.js";
import { generateTopic, scoreRelevance, writeRecallTopic } from "../recall.js";
import { assistantText, isRealUserPrompt } from "./stop.js";

const MAX_CHARS = 8000;
const MAX_TURN_CHARS = 700;

/**
 * The tail of the transcript as "User: …" / "Assistant: …" lines, oldest first,
 * capped at MAX_CHARS. Tool calls and results are left out: the topic lives in
 * what the two sides say, and tool output would crowd it out.
 */
export function recentConversation(transcriptPath: string): string {
  if (!transcriptPath || !existsSync(transcriptPath)) return "";
  let lines: string[];
  try {
    lines = readFileSync(transcriptPath, "utf-8").trim().split("\n");
  } catch {
    return "";
  }
  const turns: string[] = [];
  let total = 0;
  for (let i = lines.length - 1; i >= 0 && total < MAX_CHARS; i--) {
    let entry: any;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    const role = entry.type || entry.role;
    let text = "";
    if (role === "user" && isRealUserPrompt(entry)) {
      const mc = entry.message?.content ?? entry.content;
      const raw = typeof mc === "string" ? mc : Array.isArray(mc) ? mc.filter((b: any) => b.type === "text").map((b: any) => b.text).join(" ") : "";
      text = `User: ${stripLeadingReminders(raw).trim()}`;
    } else if (role === "assistant") {
      const t = assistantText(entry).trim();
      if (t) text = `Assistant: ${t}`;
    }
    if (!text) continue;
    text = text.length > MAX_TURN_CHARS ? `${text.slice(0, MAX_TURN_CHARS)}…` : text;
    turns.push(text);
    total += text.length;
  }
  return turns.reverse().join("\n\n");
}

/** Async Stop hook: refresh this session's recall topic, then keep the reranker warm. */
export async function handleRecallTopic(): Promise<void> {
  const config = loadConfig();
  if (!config || !isPluginEnabled()) process.exit(0);
  const recall = getInjectionConfig(config).recall;
  if (!recall) process.exit(0);

  let hookInput: { session_id?: string; transcript_path?: string; stop_hook_active?: boolean } = {};
  try {
    const input = getCachedStdin() ?? await readStdinText();
    if (input.trim()) hookInput = JSON.parse(input);
  } catch {
    process.exit(0);
  }
  if (hookInput.stop_hook_active || !hookInput.session_id) process.exit(0);

  const conversation = recentConversation(hookInput.transcript_path || "");
  if (!conversation) process.exit(0);

  const topic = await generateTopic(recall, conversation);
  if (topic) {
    writeRecallTopic(hookInput.session_id, topic);
    logHook("recall-topic", `Topic: ${topic.topic} | queries: ${topic.queries.join(" ; ")}`);
    // The decision model unloads after ~5 min idle and cold-starts in ~7 s,
    // longer than the prompt hook waits. One cheap call keeps it loaded.
    await scoreRelevance(recall, topic.topic, [topic.queries[0] ?? topic.topic], 15000);
  } else {
    logHook("recall-topic", "Topic generation failed; keeping previous topic");
  }
  process.exit(0);
}

export async function main(): Promise<void> {
  await initHook();
  await handleRecallTopic();
}
