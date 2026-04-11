// ============================================================
// src/engine/claude-client.ts
//
// PRODUCTION CLAUDE CLIENT
//
// Creates a singleton Anthropic client and exports production
// implementations of ClaudeCallFn and the summary call function.
// This file is imported by production-init.ts and NEVER by tests.
// ============================================================

import Anthropic from "@anthropic-ai/sdk";
import {
  AI_MODEL,
  AI_MAX_TOKENS,
  AI_TEMPERATURE,
  AI_TIMEOUT_MS,
  type ClaudeCallFn,
} from "./ai-response/contract";

// ── Singleton client ──────────────────────────────────────────

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ── Production ClaudeCallFn ───────────────────────────────────

/**
 * Production implementation of ClaudeCallFn.
 * Calls client.messages.create() with a timeout race.
 * Returns the raw text content of Claude's first response block.
 */
export const productionClaudeCall: ClaudeCallFn = async (
  systemPrompt,
  conversationHistory,
) => {
  // Add assistant prefill to force JSON output.
  // Claude will continue from "{" which guarantees a JSON response.
  const messagesWithPrefill = [
    ...conversationHistory,
    { role: "assistant" as const, content: "{" },
  ];

  const apiCall = client.messages.create({
    model: AI_MODEL,
    max_tokens: AI_MAX_TOKENS,
    temperature: AI_TEMPERATURE,
    system: systemPrompt,
    messages: messagesWithPrefill,
  });

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(`Claude API timeout after ${AI_TIMEOUT_MS}ms`)),
      AI_TIMEOUT_MS,
    ),
  );

  const response = await Promise.race([apiCall, timeout]);

  const first = response.content[0];
  if (!first || first.type !== "text") {
    throw new Error("Claude returned no text content");
  }

  // Prepend the "{" we used as prefill back onto the response
  return "{" + first.text;
};

// ── Production summary ClaudeCallFn ──────────────────────────

/**
 * Production implementation for regenerateSummary.
 * Uses the same client with a larger token budget for summaries.
 */
export const productionSummaryCall: ClaudeCallFn = async (
  systemPrompt,
  conversationHistory,
) => {
  const apiCall = client.messages.create({
    model: AI_MODEL,
    max_tokens: 400, // Summaries are shorter
    temperature: 0.3, // Lower temp for more factual summaries
    system: systemPrompt,
    messages: conversationHistory,
  });

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(`Claude summary timeout after ${AI_TIMEOUT_MS}ms`)),
      AI_TIMEOUT_MS,
    ),
  );

  const response = await Promise.race([apiCall, timeout]);

  const first = response.content[0];
  if (!first || first.type !== "text") {
    throw new Error("Claude returned no text content for summary");
  }

  return first.text;
};
