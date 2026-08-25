/**
 * Downloads and extracts text from PDF links found by the crawler.
 * Input : data/raw/pdf-urls.json
 * Output: data/raw/pdfs/<slug>.md  (with front-matter source url)
 *
 * Run: npm run pdf
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
/** Known image-based / scanned PDFs that have no extractable text */
const SKIP_URLS = [/brochure-2026\.pdf$/i];
/** Below this many real characters (page markers already stripped) the PDF has no
 *  usable text layer - it is scanned/image-only and needs OCR, not a text parser. */
const MIN_TEXT_CHARS = 200;

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
    .filter((u) => KEEP.test(u) && !SKIP.test(u) && !SKIP_URLS.some((re) => re.test(u)))
    .sort((a, b) => rank(a) - rank(b));
  console.log(`Found ${urls.length} PDFs, keeping ${selected.length} after filters.`);

  await mkdir(PDF_DIR, { recursive: true });
  let ok = 0;
  let fail = 0;
  let noText = 0;
  const needsOcr: Array<{ url: string; slug: string }> = [];

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
        if (text.length < MIN_TEXT_CHARS) {
          // No real text layer (page markers were stripped by cleanText). This is
          // almost always a scanned / image-only PDF, so there is nothing for a text
          // parser to read. Remove any stale blank file left by a previous run and
          // queue the doc for OCR instead of writing an empty document into the KB.
          await rm(outFile, { force: true });
          needsOcr.push({ url, slug });
          noText++;
          console.warn(`  [no-text] likely scanned/image PDF (${text.length} chars) - queued for OCR`);
        } else {
          const md = `---\nsource: ${url}\ntitle: ${slug}\nkind: pdf\n---\n\n${text}\n`;
          await writeFile(outFile, md);
          ok++;
        }
      } finally {
        await parser.destroy();
      }
    } catch (e) {
      fail++;
      console.warn(`  [fail] ${(e as Error).message}`);
    }
    await sleep(300);
  }

  const ocrManifest = path.join(RAW_DIR, "needs-ocr.json");
  await writeFile(ocrManifest, JSON.stringify(needsOcr, null, 2) + "\n");

  console.log(`\nDone. extracted=${ok} no-text/needs-ocr=${noText} failed=${fail} -> ${PDF_DIR}`);
  if (needsOcr.length) {
    console.log(
      `${needsOcr.length} scanned/image PDF(s) had no text layer (listed in ${ocrManifest}). ` +
        `A text parser cannot read these - they need OCR to be ingested.`,
    );
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
