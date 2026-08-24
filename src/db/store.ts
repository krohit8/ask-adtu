import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import path from "node:path";

export interface StoredChunk {
  id: number;
  url: string;
  title: string;
  section: string;
  kind: "page" | "pdf" | "faq";
  text: string;
  embedding: Float32Array;
}

export const DB_PATH = path.resolve(process.cwd(), "src/db/chunks.db");

let db: Database.Database | null = null;
let chunksCache: StoredChunk[] | null = null;

function openDb(): Database.Database {
  if (!db) {
    if (!existsSync(DB_PATH)) {
      throw new Error(
        `Knowledge base not found at ${DB_PATH}. Run: npm run crawl && npm run ingest`,
      );
    }
    db = new Database(DB_PATH, { readonly: true });
  }
  return db;
}

export function isReady(): boolean {
  try {
    return getChunks().length > 0;
  } catch {
    return false;
  }
}

/** All chunks with embeddings, loaded once and cached in memory (~few MB). */
export function getChunks(): StoredChunk[] {
  if (chunksCache) return chunksCache;
  const d = openDb();
  const rows = d
    .prepare("SELECT id, url, title, section, kind, text, embedding FROM chunks")
    .all() as Array<{
    id: number;
    url: string;
    title: string;
    section: string;
    kind: StoredChunk["kind"];
    text: string;
    embedding: Buffer;
  }>;
  chunksCache = rows.map((r) => ({
    ...r,
    embedding: new Float32Array(
      r.embedding.buffer,
      r.embedding.byteOffset,
      r.embedding.byteLength / 4,
    ),
  }));
  return chunksCache;
}
