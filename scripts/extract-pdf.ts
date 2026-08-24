/**
 * Downloads and extracts text from PDF links found by the crawler.
 * Input : data/raw/pdf-urls.json
 * Output: data/raw/pdfs/<slug>.md  (with front-matter source url)
 *
 * Run: npm run pdf
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFParse } from "pdf-parse";
import { cleanText, fetchWithRetry, sleep } from "./util";

const RAW_DIR = path.resolve(process.cwd(), "data/raw");
const PDF_DIR = path.join(RAW_DIR, "pdfs");

function slugify(url: string): string {
  const base = new URL(url).pathname.split("/").pop() || "doc";
  return base.replace(/\.pdf$/i, "").replace(/[^a-z0-9-_]+/gi, "-").slice(0, 80) || "doc";
}

/** Only keep PDFs likely to contain student-relevant info (skip huge annual reports etc.) */
const KEEP = /brochure|prospectus|\bfee|admission|scholar|ordinance|statute|refund|syllabus|regulation|handbook|policy|grading|guidelines/i;
/** Point-in-time notices that would pollute the KB with stale specifics */
const SKIP = /result[s]?-of|notification-|ret-20|time-table-for|compartmental|awardee|mom\b|minutes/i;

// priority order: money & rules documents first
function rank(url: string): number {
  if (/brochure|prospectus/.test(url)) return 0;
  if (/fee|refund|scholar/.test(url)) return 1;
  if (/statute|ordinance|regulation|grading/.test(url)) return 2;
  return 3;
}

async function main() {
  const urls: string[] = JSON.parse(await readFile(path.join(RAW_DIR, "pdf-urls.json"), "utf8"));
  const selected = urls
    .filter((u) => KEEP.test(u) && !SKIP.test(u))
    .sort((a, b) => rank(a) - rank(b));
  console.log(`Found ${urls.length} PDFs, keeping ${selected.length} after filters.`);

  await mkdir(PDF_DIR, { recursive: true });
  let ok = 0;
  let fail = 0;

  for (const [i, url] of selected.entries()) {
    const slug = slugify(url);
    const outFile = path.join(PDF_DIR, `${slug}.md`);
    try {
      console.log(`[${i + 1}/${selected.length}] ${url}`);
      const res = await fetchWithRetry(url, { timeoutMs: 60_000, retries: 1 });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = new Uint8Array(Buffer.from(await res.arrayBuffer()));
      if (buf.byteLength > 40 * 1024 * 1024) throw new Error("too large (>40MB)");

      const parser = new PDFParse({ data: buf });
      try {
        const result = await parser.getText();
        const text = cleanText(result.text ?? "");
        if (text.length < 200) throw new Error(`extracted too little (${text.length} chars)`);
        const md = `---\nsource: ${url}\ntitle: ${slug}\nkind: pdf\n---\n\n${text}\n`;
        await writeFile(outFile, md);
        ok++;
      } finally {
        await parser.destroy();
      }
    } catch (e) {
      fail++;
      console.warn(`  [fail] ${(e as Error).message}`);
    }
    await sleep(300);
  }

  console.log(`\nDone. extracted=${ok} failed=${fail} -> ${PDF_DIR}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
