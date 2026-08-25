import type { HistoryMessage } from "./memory";
import type { Slots } from "./memory";

const SHORT_ANSWER_RE = /^(yes|yeah|yep|nope|no|nah|okay|ok|sure|alright|right|correct|exactly|of course|not now|maybe|nah|nope)$/i;
const TOPIC_RE = /^(fees?|fee structure|cost|price|amount|eligib(?:ility|le)?|criteria|scholarship|scholarships?|hostel|hostels?|accommodation|placement|placements?|exam|exams?|library|libraries|transport|bus|sports|sport|admission|application|process|procedure|how to|steps|tell me more|more info|more information|details|explain|that one|this one|the first|the second|the third|option \d|number \d|first one|second one|third one)$/i;

export function isContextDependent(query: string): boolean {
  const trimmed = query.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.length > 40) return false;
  if (/^(can you|could you|please|i want|i need|i would|help me|what is|what are|what about|how do|how can|is there|are there|do you|does adtu|tell me about|give me|i am|i have|my |our )/i.test(trimmed)) return false;
  if (/\b(where|when|why|which|who|how)\b/i.test(trimmed) && trimmed.length > 10) return false;
  if (SHORT_ANSWER_RE.test(trimmed)) return true;
  if (TOPIC_RE.test(trimmed)) return true;
  if (/^(how\??|what\??|where\??|when\??|why\??|which\??|who\??)$/i.test(trimmed)) return true;
  return false;
}

export function rewriteQueryWithContext(
  query: string,
  history: HistoryMessage[],
  slots: Slots,
): string {
  const trimmed = query.trim();
  if (!isContextDependent(trimmed)) return trimmed;

  const recent = history.slice(-6);
  const lastAssistant = [...recent].reverse().find((m) => m.role === "assistant");
  const programme = slots.programme;
  let contextualized = trimmed;

  if (lastAssistant) {
    const assistantLower = lastAssistant.content.toLowerCase();

    if (SHORT_ANSWER_RE.test(trimmed)) {
      if (/would you like|want to know|interested in|looking for|choose|select|option|or /i.test(assistantLower)) {
        const topicMatch = assistantLower.match(/(?:about|on|for|of)\s+(scholarships?|fees?|fee structure|eligib(?:ility|le)?|hostels?|placements?|exams?|library|transport|sports|admission|application)/i);
        if (topicMatch) {
          contextualized = `${topicMatch[1]} information`;
        } else {
          const optionsMatch = lastAssistant.content.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:or|and)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/);
          if (optionsMatch) {
            contextualized = `${optionsMatch[1]} or ${optionsMatch[2]}`;
          }
        }
      }

      if (/^(yes|yeah|yep|sure|okay|ok|right|correct|exactly|of course)$/i.test(trimmed) && programme) {
        const topicMatch = assistantLower.match(/(?:information|details|know|about|on)\s+(?:on|about|for)?\s*([a-z0-9\s]+?)(?:\?|$)/i);
        if (topicMatch && topicMatch[1].trim().length > 2) {
          contextualized = `${topicMatch[1].trim()} for ${programme}`;
        }
      }
    }

    if (TOPIC_RE.test(trimmed) && !SHORT_ANSWER_RE.test(trimmed)) {
      const topicMatch = trimmed.match(/^(fees?|eligib(?:ility|le)?|scholarship|hostel|placement|exam|library|transport|sports|process|procedure|how to|steps|tell me more|more info|details|explain|that one|this one|option \d|number \d|first one|second one|third one)/i);
      if (topicMatch) {
        const topic = topicMatch[1];
        if (programme) {
          contextualized = `${topic} for ${programme}`;
        } else {
          const progMatch = lastAssistant.content.match(/(B\.?\s?Tech|MCA|MBA|BCA|B\.?\s?Pharm|M\.?\s?Pharm|B\.?\s?Sc|BA|MA|B\.?\s?Com|PhD|Physiotherapy|Forensic|Hotel Management|Social Work|Agriculture)[\w\s/+-]*/i);
          if (progMatch) {
            contextualized = `${topic} for ${progMatch[0].trim()}`;
          }
        }
      }
    }

    if (/^(that one|this one|the first|the second|the third|option \d|number \d|first one|second one|third one)$/i.test(trimmed)) {
      const optionsMatch = lastAssistant.content.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:or|and)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/);
      if (optionsMatch) {
        contextualized = `${optionsMatch[1]} or ${optionsMatch[2]}`;
      }
    }
  }

  if (programme) {
    const programmeToken = programme.split(/[ /\+]/)[0];
    if (!new RegExp(programmeToken, "i").test(contextualized)) {
      contextualized = `${contextualized} ${programme}`;
    }
  }

  return contextualized;
}
