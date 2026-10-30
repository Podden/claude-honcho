/**
 * Topic-aware recall: the async Stop hook distills the recent conversation into
 * a topic plus search queries (LLM, off the prompt path), and the prompt hook
 * reranks its candidates against that topic with a System-One decision model.
 * A raw prompt is a poor search query: meta comments ("why did you do that?")
 * and word echoes ("modelswitch" -> "network switches") pull unrelated facts.
 */

import { homedir } from "os";
import { join } from "path";
import { readFileSync, writeFileSync } from "fs";
import type { RecallPipelineConfig } from "./config.js";

export interface RecallTopic {
  topic: string;
  queries: string[];
  updatedAt: number;
}

const DIR = join(homedir(), ".honcho");

function topicFile(sessionId: string): string {
  return join(DIR, `recall-${sessionId}.json`);
}

export function writeRecallTopic(sessionId: string, topic: RecallTopic): void {
  try {
    writeFileSync(topicFile(sessionId), JSON.stringify(topic));
  } catch {
    // best-effort — the prompt hook falls back to the raw prompt
  }
}

export function readRecallTopic(sessionId: string): RecallTopic | null {
  try {
    const t = JSON.parse(readFileSync(topicFile(sessionId), "utf8"));
    return typeof t?.topic === "string" && Array.isArray(t.queries) ? t : null;
  } catch {
    return null;
  }
}

const TOPIC_SYSTEM_PROMPT =
  "You maintain the search context of a long-term memory attached to a coding assistant. " +
  "Read the recent conversation and return JSON only: " +
  '{"topic": "one English sentence naming the concrete task currently being worked on and the systems, services, hosts, repos or files involved", ' +
  '"queries": ["2 to 3 short English search queries that would find long-term facts about the user relevant to this task"]}. ' +
  "Describe the work itself, not remarks about the assistant's behavior.";

/** Ask the topic LLM for {topic, queries}. Null on any failure or malformed answer. */
export async function generateTopic(cfg: RecallPipelineConfig, conversation: string, timeoutMs = 60000): Promise<RecallTopic | null> {
  try {
    const res = await fetch(`${cfg.topicBaseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model: cfg.topicModel,
        messages: [
          { role: "system", content: TOPIC_SYSTEM_PROMPT },
          { role: "user", content: conversation },
        ],
        reasoning_effort: "none",
        response_format: { type: "json_object" },
        max_tokens: 300,
        temperature: 0,
      }),
    });
    if (!res.ok) return null;
    const content = (await res.json())?.choices?.[0]?.message?.content;
    return parseTopic(typeof content === "string" ? content : "");
  } catch {
    return null;
  }
}

export function parseTopic(content: string): RecallTopic | null {
  const json = content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1);
  try {
    const t = JSON.parse(json);
    const topic = typeof t.topic === "string" ? t.topic.trim() : "";
    const queries = Array.isArray(t.queries) ? t.queries.filter((q: unknown) => typeof q === "string" && q.trim()).slice(0, 3) : [];
    return topic ? { topic, queries, updatedAt: Date.now() } : null;
  } catch {
    return null;
  }
}

// Validated 2026-10-11 on decider-4b-v2.1 (34 hand-labelled fact/task pairs):
// P(A) >= 0.7 kept 92% of relevant facts at 0.80 precision. A/B keys instead
// of noul — noul sticks to its labels on short texts.
const RELEVANT_QUESTION = {
  relevant: {
    type: "choice",
    instructions: "Would `fact` help an assistant working on `task`?",
    criteria: {
      A: "yes: the fact is about the same system, service, host or problem as the task",
      B: "no: the fact is about a different project, tool or topic and would only distract",
    },
  },
};

/** P(relevant) per fact, or null when the decision model is unreachable. */
export async function scoreRelevance(cfg: RecallPipelineConfig, task: string, facts: string[], timeoutMs: number): Promise<number[] | null> {
  const url = `${cfg.rerankUrl.replace(/\/$/, "")}/v1/systemone`;
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    // One request per fact: each is its own state. The server has a single
    // worker, so these queue rather than run in parallel.
    return await Promise.all(facts.map(async (fact) => {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal,
        body: JSON.stringify({ state: { task, fact }, questions: RELEVANT_QUESTION }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const p = (await res.json())?.answers?.relevant?.probabilities?.A;
      if (typeof p !== "number") throw new Error("no probability");
      return p;
    }));
  } catch {
    return null;
  }
}

// Validated 2026-10-30 on d1-3B (50 hand-labelled topic/prompt pairs from 11
// projects, German prompts against English topics): AUC 0.90; P(A) < 0.2 caught
// 12/16 topic switches at 3/34 false switches. Translating the prompt to English
// first did not help (AUC 0.89) and would add ~0.5 s.
const SAME_TASK_QUESTION = {
  same: {
    type: "choice",
    instructions: "Is `message` about the same task as `topic`, or does it start a different subject?",
    criteria: {
      A: "same task: a follow-up, question, correction, confirmation or status remark about `topic` or the systems in it",
      B: "different subject: a new problem, project, device or request unrelated to `topic`",
    },
  },
};

/** P(the prompt continues the topic), or null when the decision model is unreachable. */
export async function scoreSameTask(cfg: RecallPipelineConfig, topic: string, prompt: string, timeoutMs: number): Promise<number | null> {
  try {
    const res = await fetch(`${cfg.rerankUrl.replace(/\/$/, "")}/v1/systemone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({ state: { topic, message: prompt.slice(0, 1500) }, questions: SAME_TASK_QUESTION }),
    });
    if (!res.ok) return null;
    const p = (await res.json())?.answers?.same?.probabilities?.A;
    return typeof p === "number" ? p : null;
  } catch {
    return null;
  }
}

/** Facts at or above the threshold, best first, capped at maxInject. */
export function selectRelevant(facts: string[], scores: number[], threshold: number, maxInject: number): string[] {
  return facts
    .map((fact, i) => ({ fact, p: scores[i] }))
    .filter((x) => x.p >= threshold)
    .sort((a, b) => b.p - a.p)
    .slice(0, maxInject)
    .map((x) => x.fact);
}
