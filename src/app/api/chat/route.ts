import { NextResponse } from "next/server";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  type ModelMessage,
  type UIMessage,
} from "ai";
import { google } from "@ai-sdk/google";
import { CHAT_MODEL } from "@/lib/llm/model";
import * as store from "@/db/store";
import { buildContext, retrieve } from "@/lib/retrieval/search";
import { buildSystemPrompt } from "@/lib/llm/prompt";
import { adtuTools, counselingTool } from "@/lib/llm/tools";
import { updateSlots } from "@/lib/session/memory";

export const runtime = "nodejs";
export const maxDuration = 60;

interface ChatBody {
  messages: UIMessage[];
  sessionId?: string;
}

function textOf(m: UIMessage): string {
  return m.parts
    .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join(" ");
}

export async function POST(req: Request) {
  let body: ChatBody;
  try {
    body = (await req.json()) as ChatBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { messages = [], sessionId = "anon" } = body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "messages[] required" }, { status: 400 });
  }

  if (!(await store.isReady())) {
    return NextResponse.json(
      {
        error:
          "Knowledge base is empty. Ingest first: npm run crawl && npm run pdf && npm run ingest",
      },
      { status: 503 },
    );
  }

  const userTexts = messages.filter((m) => m.role === "user").map(textOf);
  const slots = updateSlots(sessionId, userTexts);
  const latestQuery = userTexts[userTexts.length - 1] ?? "";

  const slotToken = slots.programme?.split(/[ /\+]/)[0];
  const enrichedQuery =
    slots.programme && (!slotToken || !new RegExp(slotToken, "i").test(latestQuery))
      ? `${latestQuery} ${slots.programme}`
      : latestQuery;

  const results = await retrieve(enrichedQuery);
  const { context, sources } = buildContext(results);

  const isUnanswered = results.length === 0;

  const history = ((await convertToModelMessages(messages)) as ModelMessage[]).slice(0, -1);
  const groundedTurn: ModelMessage = {
    role: "user",
    content: `CONTEXT FROM ADTU.IN:
${context || "(no matching context found)"}

QUESTION: ${latestQuery}

${isUnanswered ? "NOTE: No context matches this query. Follow rule #3: say you don't have verified information, then offer counseling contact if the user agrees. If the user agrees and provides a phone number, call the request_counseling tool." : ""}

Answer per your system rules. Cite [n] for every factual claim.`,
  };

  const allTools = { ...adtuTools, request_counseling: counselingTool(sessionId, slots.programme, latestQuery) };

  const result = streamText({
    model: google(CHAT_MODEL),
    system: buildSystemPrompt(slots, new Date(), sessionId),
    messages: [...history, groundedTurn],
    tools: allTools,
    stopWhen: stepCountIs(4),
    temperature: 0.3,
    maxRetries: 1,
    onError: ({ error }) => console.error("[chat]", error),
  });

  return result.toUIMessageStreamResponse({
    onError: (error: unknown) => {
      const msg = String((error as Error)?.message ?? error ?? "Unknown error");
      if (/quota|exceed/i.test(msg)) {
        return "Gemini free-tier daily limit reached (resets ~midnight US-Pacific). Enable billing on your AI Studio key or try again later.";
      }
      if (/not found|no longer available/i.test(msg)) {
        return "Chat model unavailable - update the model id in src/lib/llm/model.ts.";
      }
      return `LLM error: ${msg.slice(0, 180)}`;
    },
    messageMetadata: ({ part }) =>
      part.type === "finish" ? { sources, retrievedCount: results.length } : undefined,
  });
}
