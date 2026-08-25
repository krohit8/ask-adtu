import { createHash } from "node:crypto";
import { CHUNK } from "./config";

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function hash(text: string) {
  return createHash("sha1").update(text).digest("hex");
}

/** Normalize a URL for dedup: lowercase host, strip hash/tracking params/index.html. */
export function normalizeUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    u.hash = "";
    if (u.hostname === "localhost" || u.protocol === "file:") return null;
    u.protocol = "https:";
    u.host = u.host.toLowerCase().replace(/^www\./, "");
    const drop = [...u.searchParams.keys()].filter((k) =>
      /^(utm_|fbclid|gclid|share|replytocom)/i.test(k),
    );
    drop.forEach((k) => u.searchParams.delete(k));
    let s = u.toString();
    if (s.endsWith("/index.html")) s = s.slice(0, -"index.html".length);
    if (s.endsWith("?")) s = s.slice(0, -1);
    return s;
  } catch {
    return null;
  }
}

export function cleanText(raw: string): string {
  return raw
    .replace(/\r/g, "")
    // Drop pdf-parse page separators like "-- 3 of 40 --". They are pure noise in
    // the knowledge base and (worse) accumulate past the extractor's length guard,
    // so a scanned/image PDF with no real text still looks non-empty. Stripping them
    // lets the extractor tell a genuinely empty extraction apart from a real one.
    .replace(/^[ \t]*--[ \t]*\d+[ \t]+of[ \t]+\d+[ \t]*--[ \t]*$/gim, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .trim();
}

/**
 * Paragraph-aware sliding-window chunker.
 * Keeps fee tables / lists intact by never breaking inside a paragraph
 * unless that paragraph alone exceeds maxChars.
 */
export function chunkText(
  text: string,
  opts: { maxChars?: number; overlapChars?: number; minChars?: number } = {},
): string[] {
  const maxChars = opts.maxChars ?? CHUNK.maxChars;
  const overlapChars = opts.overlapChars ?? CHUNK.overlapChars;
  const minChars = opts.minChars ?? CHUNK.minChars;

  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let buf = "";

  const flush = () => {
    const t = buf.trim();
    if (t.length >= minChars) chunks.push(t);
    // carry overlap for continuity between chunks
    if (t.length > overlapChars) {
      buf = t.slice(-overlapChars);
    } else {
      buf = t;
    }
  };

  for (const p of paragraphs) {
    if (p.length > maxChars) {
      if (buf.trim()) flush();
      // hard-split long paragraph at sentence boundaries
      const sentences = p.split(/(?<=[.!?])\s+/);
      let piece = "";
      for (const s of sentences) {
        if ((piece + " " + s).length > maxChars && piece) {
          chunks.push(piece.trim());
          piece = piece.slice(Math.max(0, piece.length - overlapChars)) + " " + s;
        } else {
          piece += (piece ? " " : "") + s;
        }
      }
      if (piece.trim()) buf = piece.trim();
      continue;
    }
    if ((buf + "\n\n" + p).length > maxChars && buf.trim()) {
      flush();
    }
    buf += (buf ? "\n\n" : "") + p;
  }
  if (buf.trim().length >= minChars) chunks.push(buf.trim());
  return chunks;
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit & { timeoutMs?: number; retries?: number } = {},
): Promise<Response> {
  const { timeoutMs = 15_000, retries = 1, ...rest } = init;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        ...rest,
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/pdf,*/*;q=0.8",
          ...(rest.headers ?? {}),
        },
        redirect: "follow",
      });
      if (!res.ok && attempt < retries) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (e) {
      if (attempt === retries) throw e;
      await sleep(500 * (attempt + 1));
    }
  }
  throw new Error("unreachable");
}
