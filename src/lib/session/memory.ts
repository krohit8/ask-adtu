export interface Slots {
  programme?: string;
  audience?: "prospective" | "enrolled";
  interests: string[];
}

interface Session {
  slots: Slots;
  updatedAt: number;
}

const sessions = new Map<string, Session>();
const SESSION_TTL_MS = 60 * 60 * 1000;

/** Programme alias table - extend as needed. */
const PROGRAMME_PATTERNS: Array<[RegExp, string]> = [
  [/\bb\.?\s?tech\b|\bbtech\b|\bb\.?e\.?\b/i, "B.Tech"],
  [/\bm\.?\s?tech\b|\bmtech\b/i, "M.Tech"],
  [/\bbca\b|bachelor of computer applications?|computer applications?\b/i, "BCA"],
  [/\bmca\b/i, "MCA"],
  [/\bmba\b|master of business administration/i, "MBA"],
  [/\bbba\b|bachelor of business administration/i, "BBA"],
  [/\bb\.?com\b|bachelor of commerce/i, "B.Com"],
  [/\bb\.?\s?sc\.?\s*nursing|bsc nursing|gnm|auxiliary nursing/i, "B.Sc Nursing"],
  [/\bpharm\s?d\b/i, "Pharm.D"],
  [/\bb\.?\s?pharm|bpharm|d\.?\s?pharm|dpharm|diploma in pharmacy/i, "B.Pharm"],
  [/\bm\.?\s?pharm|mpharm/i, "M.Pharm"],
  [/\bphd\b|doctor of philosophy|doctoral/i, "PhD"],
  [/b\.?\s?sc\.?\sagriculture|agriculture|horticulture/i, "B.Sc Agriculture"],
  [/\bphysiotherapy\b|bpt\b|mpt\b/i, "Physiotherapy"],
  [/\bforensic\b/i, "Forensic Science"],
  [/hotel management|hospitality|bhmct/i, "Hotel Management"],
  [/social work|msw|bsw/i, "Social Work"],
  [/\bb\.?\s?sc\b|\bbsc\b|microbiology|biotechnology|food science/i, "B.Sc"],
  [/\bba\b.*honours|bachelor of arts/i, "BA"],
  [/\bma\b\b|master of arts/i, "MA"],
  [/data science|ai\b|artificial intelligence|machine learning/i, "AI/Data Science programmes"],
];

function detectProgramme(text: string): string | undefined {
  for (const [re, name] of PROGRAMME_PATTERNS) if (re.test(text)) return name;
  return undefined;
}

function detectAudience(text: string): "prospective" | "enrolled" | undefined {
  if (
    /\b(my|our)\b.*(result|attendance|semester|backlog|hostel room)|\brevaluation\b|exam form|i am (a )?(current )?(student|enrolled)/i.test(
      text,
    )
  )
    return "enrolled";
  if (/admission|apply|eligib|scholarship|how (do|to) (i )?(apply|join|get|take)|new student|cutoff/i.test(text))
    return "prospective";
  return undefined;
}

export function updateSlots(sessionId: string, userTexts: string[]): Slots {
  // opportunistic GC
  if (sessions.size > 500) {
    const now = Date.now();
    for (const [k, v] of sessions) if (now - v.updatedAt > SESSION_TTL_MS) sessions.delete(k);
  }

  const s =
    sessions.get(sessionId) ?? { updatedAt: Date.now(), slots: { interests: [] } };
  for (const t of userTexts) {
    const p = detectProgramme(t);
    if (p) s.slots.programme = p;
    const a = detectAudience(t);
    if (a) s.slots.audience = a;
    if (/(hostel|placement|scholarship|fee|exam|library|transport|sports)/i.test(t)) {
      const m = t.toLowerCase().match(/(hostel|placement|scholarship|fees?|exam|library|transport|sports)/g);
      for (const x of m ?? []) if (!s.slots.interests.includes(x)) s.slots.interests.push(x);
    }
  }
  s.updatedAt = Date.now();
  sessions.set(sessionId, s);
  return s.slots;
}
