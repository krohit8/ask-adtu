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
import { updateSlots, appendToHistory, getHistory } from "@/lib/session/memory";
import { rewriteQueryWithContext } from "@/lib/session/conversation";

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

function detectTopic(query: string): string | null {
  const q = query.toLowerCase();
  if (/fee|tuition|cost|price|amount|payment/.test(q)) return "fee structure";
  if (/eligib|criteria|requirement|qualify/.test(q)) return "eligibility";
  if (/scholarship|financial aid|grant|discount/.test(q)) return "scholarship";
  if (/hostel|accommodation|room|boarding/.test(q)) return "hostel";
  if (/placement|job|career|recruit|internship/.test(q)) return "placement";
  if (/exam|test|semester|result|grade/.test(q)) return "exams";
  if (/admission|apply|application|process|procedure/.test(q)) return "admission";
  if (/library|book|study material/.test(q)) return "library";
  if (/transport|bus|commute/.test(q)) return "transport";
  if (/sport|game|fitness/.test(q)) return "sports";
  return null;
}

function looksLikePhoneNumber(query: string): boolean {
  const cleaned = query.replace(/[\s\-()]/g, "");
  return /^\+?\d{10,15}$/.test(cleaned);
}

function isAgreement(query: string): boolean {
  const q = query.toLowerCase().trim();
  return /^(yes|yeah|yep|sure|okay|ok|agree|alright|right|correct|exactly|of course|please|why not|definitely|certainly|absolutely|yeah sure|yes please|ok sure|sure please)$/i.test(q);
}

function recentAssistantOfferedCounseling(history: ReturnType<typeof getHistory>): boolean {
  const recent = history.slice(-4);
  return recent.some(
    (m) => m.role === "assistant" && /counsel|contact you|phone number|reach you|team.*contact/i.test(m.content)
  );
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
  // The lead is captured at the moment the user sends their phone number (or a bare
  // "yes"), so latestQuery is usually NOT the real question. Store the most recent
  // substantive message instead - skipping phone numbers and one-word agreements.
  const substantiveQuery =
    [...userTexts]
      .reverse()
      .find((t) => t.trim().length > 0 && !looksLikePhoneNumber(t) && !isAgreement(t)) ??
    latestQuery;

  const history = getHistory(sessionId);
  const contextualizedQuery = rewriteQueryWithContext(latestQuery, history, slots);

  const slotToken = slots.programme?.split(/[ /\+]/)[0];
  const enrichedQuery =
    slots.programme && (!slotToken || !new RegExp(slotToken, "i").test(contextualizedQuery))
      ? `${contextualizedQuery} ${slots.programme}`
      : contextualizedQuery;

  const results = await retrieve(enrichedQuery);
  const { context, sources } = buildContext(results);

  const isUnanswered = results.length === 0;
  const topic = detectTopic(latestQuery);

  const historyMessages = ((await convertToModelMessages(messages)) as ModelMessage[]).slice(0, -1);
  const groundedTurn: ModelMessage = {
    role: "user",
    content: `CONTEXT FROM ADTU.IN:
${context || "(no matching context found)"}

QUESTION: ${latestQuery}

${isUnanswered ? "NOTE: No context matches this query. Follow rule #3: say you don't have verified information, then guide the user to the right human channel. Do NOT mention counseling or phone numbers unless the user explicitly asks for human contact." : ""}

Answer per your system rules. Cite [n] for every factual claim.`,
  };

  const lastAssistant = [...history].reverse().find((m) => m.role === "assistant");
  const isShortResponseToAssistant =
    latestQuery.trim().length <= 10 &&
    lastAssistant &&
    /counsel|contact you|phone number|reach you|team.*contact|would you like/i.test(lastAssistant.content);

  const counselingAvailable =
    isUnanswered ||
    topic === "fee structure" ||
    looksLikePhoneNumber(latestQuery) ||
    isAgreement(latestQuery) ||
    recentAssistantOfferedCounseling(history) ||
    isShortResponseToAssistant;
  const allTools = counselingAvailable
    ? { ...adtuTools, request_counseling: counselingTool(sessionId, substantiveQuery) }
    : adtuTools;


  appendToHistory(sessionId, "user", latestQuery);

  const result = streamText({
    model: google(CHAT_MODEL),
    system: buildSystemPrompt(slots, new Date(), sessionId),
    messages: [...historyMessages, groundedTurn],
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
    onEnd: async (event) => {
      const text = event.responseMessage.parts
        .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
        .map((p) => p.text)
        .join("");
      appendToHistory(sessionId, "assistant", text);
    },
    messageMetadata: ({ part }) =>
      part.type === "finish" ? { sources, retrievedCount: results.length } : undefined,
  });
}
