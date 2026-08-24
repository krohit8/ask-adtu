import MiniSearch from "minisearch";
import { embedLocal } from "../embeddings/local";
import type { RetrievedChunk, Source } from "../types";
import { getChunks } from "../../db/store";
import { RETRIEVE } from "../../../scripts/config";

interface IndexedDoc {
  id: number;
  title: string;
  text: string;
}

let mini: MiniSearch<IndexedDoc> | null = null;

async function buildKeywordIndex() {
  const chunks = await getChunks();
  mini = new MiniSearch<IndexedDoc>({
    fields: ["title", "text"],
    storeFields: ["id"],
    searchOptions: { boost: { title: 3 }, prefix: true, fuzzy: 0.2 },
  });
  mini.addAll(chunks.map((c) => ({ id: c.id, title: c.title, text: c.text })));
  return mini;
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
}

/** Hybrid retrieval: dense cosine + keyword (BM25-ish) fused with reciprocal-rank fusion. */
export async function retrieve(query: string, topN = RETRIEVE.finalTopN): Promise<RetrievedChunk[]> {
  const chunks = await getChunks();
  if (chunks.length === 0) return [];
  const index = mini ?? (await buildKeywordIndex());

  // 1) dense (local model - free, offline)
  const [q] = await embedLocal([query]);

  const vecRanked: Array<{ id: number; s: number }> = [];
  for (const c of chunks) vecRanked.push({ id: c.id, s: cosine(q, c.embedding) });
  vecRanked.sort((a, b) => b.s - a.s);
  const topVec = new Map(vecRanked.slice(0, RETRIEVE.vectorTopK).map((r) => [r.id, r.s]));

  // 2) sparse
  const kwHits = index.search(query).slice(0, RETRIEVE.keywordTopK);

  // 3) reciprocal-rank fusion
  const rrf = new Map<number, number>();
  [...topVec.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([id], i) => {
      rrf.set(id, (rrf.get(id) ?? 0) + 1 / (RETRIEVE.rrfK + i + 1));
    });
  kwHits.forEach((h, i) => {
    rrf.set(h.id, (rrf.get(h.id) ?? 0) + 1 / (RETRIEVE.rrfK + i + 1));
  });

  const merged = [...rrf.entries()]
    .map(([id, s]) => ({ chunk: chunks.find((c) => c.id === id)!, s }))
    .filter((x) => x.chunk)
    .sort((a, b) => b.s - a.s);

  // curated FAQ gets a gentle trust boost
  merged.forEach((m) => {
    if (m.chunk.kind === "faq") m.s *= 1.15;
  });
  merged.sort((a, b) => b.s - a.s);

  const out: RetrievedChunk[] = [];
  for (const { chunk, s } of merged) {
    if (out.length >= topN) break;
    out.push({
      id: chunk.id,
      url: chunk.url,
      title: chunk.title,
      section: chunk.section,
      kind: chunk.kind,
      text: chunk.text,
      score: Number(s.toFixed(5)),
    });
  }
  return out;
}

/** Build numbered context block + ordered unique source list. */
export function buildContext(results: RetrievedChunk[]): {
  context: string;
  sources: Source[];
} {
  const lines: string[] = [];
  const sources: Source[] = [];
  results.forEach((r, i) => {
    const n = i + 1;
    lines.push(`[${n}] (${r.kind} | ${r.url})\n${r.text}`);
    sources.push({ n, url: r.url, title: r.title || r.url, kind: r.kind });
  });
  return { context: lines.join("\n\n---\n\n"), sources };
}
