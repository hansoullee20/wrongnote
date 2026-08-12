import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { QueueError } from "./errors.js";

export const WRONGNOTE_SUBMIT_TOOL = "wrongnote_submit_analysis";

const InputSchema = z
  .object({
    eventId: z
      .string()
      .min(1)
      .describe(
        "Producer idempotency key for this analysis event. Generate it once and reuse the exact same eventId when retrying the same submission."
      ),
    payload: z
      .record(z.string(), z.unknown())
      .describe(
        "Completed Wrongnote AI-import JSON object. The companion queues it as untrusted data; Wrongnote validates it again with parseAiImport before any note is saved."
      ),
  })
  .strict();

function safeErrorDetails(err) {
  const details = {};
  for (const key of ["committed", "durability", "degradedReasons", "result", "bytes", "limit"]) {
    if (err?.[key] !== undefined) details[key] = err[key];
  }
  return details;
}

function asToolResult(structuredContent, { isError = false, guidance } = {}) {
  const text = guidance || JSON.stringify(structuredContent);
  return {
    content: [{ type: "text", text }],
    structuredContent,
    ...(isError ? { isError: true } : {}),
  };
}

function successGuidance(result) {
  if (result.status === "waiting") {
    return `Queued Wrongnote analysis ${result.eventId}. The browser can now claim it.`;
  }
  if (result.status === "duplicate") {
    return `Wrongnote analysis ${result.eventId} was already queued or settled. Do not create a replacement eventId for this same analysis.`;
  }
  return JSON.stringify(result);
}

function logicalFailureGuidance(result) {
  if (result.status === "idempotency_conflict") {
    return `eventId ${result.eventId} already belongs to different content. Reuse an eventId only for an exact retry of the same analysis; use a new eventId only for a genuinely distinct analysis event.`;
  }
  if (result.status === "queue_full") {
    return `Wrongnote's local AI queue is full (${result.limit} active items). Do not invent a new eventId to bypass the queue limit.`;
  }
  return JSON.stringify(result);
}

export async function submitWrongnoteAnalysis(store, { eventId, payload }, { logger = console } = {}) {
  try {
    const result = await store.submit(eventId, payload);
    const structuredContent = { ok: !["idempotency_conflict", "queue_full"].includes(result.status), ...result };
    if (!structuredContent.ok) {
      return asToolResult(structuredContent, {
        isError: true,
        guidance: logicalFailureGuidance(result),
      });
    }
    return asToolResult(structuredContent, { guidance: successGuidance(result) });
  } catch (err) {
    if (err instanceof QueueError || typeof err?.code === "string") {
      const structuredContent = {
        ok: false,
        code: err.code || "queue_error",
        message: err.message || "Wrongnote queue operation failed",
        ...safeErrorDetails(err),
      };
      const guidance = err?.committed === true
        ? `Wrongnote reports that the submission may already have committed but crash durability is uncertain. Retry the exact same tool call with the exact same eventId ${eventId}; do not generate a new eventId.`
        : `Wrongnote rejected or could not queue analysis ${eventId}: ${structuredContent.code}. Keep the same eventId if you retry the same analysis.`;
      return asToolResult(structuredContent, { isError: true, guidance });
    }

    logger?.error?.("wrongnote MCP submit failed", err);
    return asToolResult(
      { ok: false, code: "internal_error", message: "Wrongnote companion internal error" },
      {
        isError: true,
        guidance: `Wrongnote could not queue analysis ${eventId} because of an internal companion error. If retrying, keep the same eventId.`,
      }
    );
  }
}

export function createWrongnoteMcpServer(store, { logger = console } = {}) {
  if (!store || typeof store.submit !== "function") {
    throw new Error("Wrongnote MCP server requires a queue store with submit(eventId, payload)");
  }

  const server = new McpServer(
    { name: "wrongnote-companion", version: "0.3.0" },
    {
      instructions:
        "Wrongnote accepts completed math-error analyses as untrusted queue items. Use wrongnote_submit_analysis only after you have produced the complete AI-import JSON. Generate one stable eventId per distinct analysis and reuse that exact eventId on retries. Never create a replacement eventId merely because a previous call returned an ambiguous or retryable error.",
    }
  );

  server.registerTool(
    WRONGNOTE_SUBMIT_TOOL,
    {
      title: "Submit Wrongnote analysis",
      description:
        "Queue one completed Wrongnote AI analysis for the local browser app. The payload is not trusted or saved as a note here. Reuse the same eventId for exact retries; different analysis events require different eventIds.",
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async (args) => submitWrongnoteAnalysis(store, args, { logger })
  );

  return server;
}
