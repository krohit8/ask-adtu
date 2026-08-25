/**
 * Ingest pipeline: pages.json + pdfs/*.md + faq/*.json -> chunk -> embed -> SQLite
 *
 * Prereqs: GOOGLE_GENERATIVE_AI_API_KEY in .env.local, and data/raw populated by:
 *   npm run crawl && npm run pdf
 *
 * Run: npm run ingest   (add -- --limit 20 for a smoke run)
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { rmSync } from "node:fs";
import path from "node:path";
import initSqlJs from "sql.js";
import { EMBED } from "./config";
import { chunkText, hash } from "./util";
import { DB_PATH } from "../src/db/store";
import { embedLocal } from "../src/lib/embeddings/local";

const RAW_DIR = path.resolve(process.cwd(), "data/raw");
const FAQ_DIR = path.resolve(process.cwd(), "scripts/faq");
const PDF_DIR = path.join(RAW_DIR, "pdfs");

interface Rec {
  url: string;
  title: string;
  section: string;
  kind: "page" | "pdf" | "faq";
  text: string;
}

function sectionFromUrl(url: string): string {
  try {
    const p = new URL(url).pathname.replace(/^\/+/, "");
    const seg = p.split("/")[0] || "home";
    return seg.replace(/\.(html?)$/, "") || "home";
  } catch {
    return "misc";
  }
}

async function collectRecords(): Promise<Rec[]> {
  const records: Rec[] = [];
  const seen = new Set<string>();
  let dups = 0;

  const push = (r: Rec) => {
    const key = hash(r.text.replace(/\s+/g, " ").toLowerCase());
    if (seen.has(key) || r.text.trim().length < 60) {
      dups++;
      return;
    }
    seen.add(key);
    records.push(r);
  };

  // 1) HTML pages
  try {
    const pages: Array<{ url: string; title: string; text: string }> = JSON.parse(
      await readFile(path.join(RAW_DIR, "pages.json"), "utf8"),
    );
    for (const page of pages) {
      const full = `${page.title}\n\n${page.text}`;
      for (const c of chunkText(full)) {
        push({
          url: page.url,
          title: page.title,
          section: sectionFromUrl(page.url),
          kind: "page",
          text: c,
        });
      }
    }
    console.log(`pages.json: ${pages.length} pages chunked`);
  } catch {
    console.warn("WARN: data/raw/pages.json missing - did you run `npm run crawl`?");
  }

  // 2) PDFs (markdown with front matter)
  try {
    const files = (await readdir(PDF_DIR)).filter((f) => f.endsWith(".md"));
    for (const f of files) {
      const raw = await readFile(path.join(PDF_DIR, f), "utf8");
      const m = raw.match(/^---\n([\s\S]*?)\n---\n\n?([\s\S]*)$/);
      if (!m) continue;
      const meta = Object.fromEntries(
        m[1]
          .split("\n")
          // split on the FIRST colon only - splitting on every ":" mangled the
          // source URL (https://...) into 3 parts, so it was dropped and PDF
          // chunks fell back to a pdf://<file> url that showed up in citations.
          .map((l): [string, string] | null => {
            const idx = l.indexOf(":");
            return idx === -1 ? null : [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
          })
          .filter((pair): pair is [string, string] => pair !== null && pair[0].length > 0),
      ) as Record<string, string>;
      const body = m[2];
      const url = meta.source ?? `pdf://${f}`;
      const title = meta.title ?? f.replace(/\.md$/, "");
      for (const c of chunkText(body)) {
        push({ url, title, section: "pdf", kind: "pdf", text: c });
      }
    }
    console.log(`pdfs: ${files.length} documents processed`);
  } catch {
    console.warn("WARN: no PDFs extracted - run `npm run pdf` (optional)");
  }

  // 3) Curated FAQ (highest trust - one chunk per Q&A)
  try {
    const faqs: Array<{ id: string; q: string; a: string }> = JSON.parse(
      await readFile(path.join(FAQ_DIR, "adtu-faq.json"), "utf8"),
    );
    for (const f of faqs) {
      push({
        url: `https://adtu.in/faq#${f.id}`,
        title: f.q,
        section: "faq",
        kind: "faq",
        text: `Q: ${f.q}\nA: ${f.a}`,
      });
    }
    console.log(`faq: ${faqs.length} curated entries`);
  } catch {
    console.warn("WARN: faq json missing");
  }

  console.log(`Total unique chunks: ${records.length} (skipped ${dups} dup/tiny)`);
  return records;
}

async function embedAll(texts: string[]): Promise<number[][]> {
  const all: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED.batchSize) {
    const batch = texts.slice(i, i + EMBED.batchSize);
    const vectors = await embedLocal(batch);
    for (const v of vectors) all.push(Array.from(v));
    console.log(`progress embedded=${Math.min(i + EMBED.batchSize, texts.length)}/${texts.length}`);
  }
  return all;
}

async function main() {
  const limitIdx = process.argv.indexOf("--limit");
  const limit = limitIdx > -1 ? Number(process.argv[limitIdx + 1]) : undefined;

  const records = await collectRecords();
  if (records.length === 0) {
    console.error("Nothing to ingest. Crawl first: npm run crawl");
    process.exit(1);
  }
  const selected = limit ? records.slice(0, limit) : records;

  console.log(`Embedding ${selected.length} chunks with ${EMBED.modelId}...`);
  const embeddings = await embedAll(selected.map((r) => r.text));

  rmSync(DB_PATH, { force: true });
  mkdir(path.dirname(DB_PATH), { recursive: true });

  const SQL = await initSqlJs({
    locateFile: (name) => path.resolve(process.cwd(), "node_modules", "sql.js", "dist", name),
  });
  const db = new SQL.Database();
  db.exec(`CREATE TABLE chunks (
    id INTEGER PRIMARY KEY,
    url TEXT NOT NULL,
    title TEXT NOT NULL,
    section TEXT NOT NULL,
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    embedding BLOB NOT NULL
  ); CREATE INDEX idx_kind ON chunks(kind); CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    user_query TEXT NOT NULL,
    interested_domain TEXT,
    topic TEXT,
    phone_number TEXT,
    contact_requested INTEGER DEFAULT 0,
    contact_status TEXT DEFAULT 'pending',
    created_at TEXT NOT NULL
  ); CREATE INDEX idx_leads_session ON leads(session_id); CREATE INDEX idx_leads_status ON leads(contact_status);`);

  db.run("BEGIN TRANSACTION");
  const insert = db.prepare(
    "INSERT INTO chunks (url, title, section, kind, text, embedding) VALUES (?, ?, ?, ?, ?, ?)",
  );
  for (let i = 0; i < selected.length; i++) {
    const r = selected[i];
    insert.run([r.url, r.title, r.section, r.kind, r.text, Buffer.from(new Float32Array(embeddings[i]).buffer)]);
  }
  insert.free();
  db.run("COMMIT");

  const countsResult = db.exec("SELECT kind, COUNT(*) n FROM chunks GROUP BY kind");
  const counts = (countsResult[0]?.values ?? []).map((row) => ({
    kind: row[0] as string,
    n: row[1] as number,
  }));
  console.log("\nIngestion complete:", counts);
  console.log(`DB at ${DB_PATH}`);

  const data = db.export();
  await writeFile(DB_PATH, data);
  db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
