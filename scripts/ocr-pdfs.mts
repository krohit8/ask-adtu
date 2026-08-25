/**
 * OCR fallback for scanned / image-only PDFs that `npm run pdf` could not read.
 *
 * Input : data/raw/needs-ocr.json   (written by scripts/extract-pdf.ts)
 * Output: data/raw/pdfs/<slug>.md    (same front-matter as extract-pdf, so
 *                                      `npm run ingest` picks the text up)
 *
 * How it works: each scanned PDF has no text layer, so we rasterise every page
 * to a PNG (pdf-to-img) and run OCR on the image (tesseract.js), then write the
 * recognised text out in the same markdown format the text extractor uses.
 *
 * NOTE: this is a `.mts` file on purpose. pdf-to-img -> pdfjs-dist uses top-level
 * await, which cannot be compiled to CommonJS. The `.mts` extension makes tsx run
 * it as a real ES module, where top-level await is supported.
 *
 * Requires:  npm install tesseract.js pdf-to-img
 * The first run downloads a Tesseract English model (needs internet), and OCR is
 * CPU-bound and slow (seconds per page) - a 40-page scan can take minutes.
 *
 * Run: npm run ocr   (then re-run `npm run ingest`)
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pdf } from "pdf-to-img";
import { createWorker } from "tesseract.js";
import { cleanText, fetchWithRetry, sleep } from "./util";

const RAW_DIR = path.resolve(process.cwd(), "data/raw");
const PDF_DIR = path.join(RAW_DIR, "pdfs");
const MANIFEST = path.join(RAW_DIR, "needs-ocr.json");

/** Render scale for pdf-to-img. ~3x (~216 DPI) balances OCR accuracy vs speed/memory. */
const RENDER_SCALE = 3;
/** If OCR yields fewer than this many characters, treat the doc as failed rather than
 *  writing a near-empty file (blank scan, rendering failure, wrong language, etc.). */
const MIN_DOC_CHARS = 100;

interface OcrTarget {
  url: string;
  slug: string;
}

async function main() {
  let targets: OcrTarget[];
  try {
    targets = JSON.parse(await readFile(MANIFEST, "utf8"));
  } catch {
    console.error(`No ${MANIFEST}. Run \`npm run pdf\` first - it lists the scanned PDFs that need OCR.`);
    process.exit(1);
  }
  if (!Array.isArray(targets) || targets.length === 0) {
    console.log("needs-ocr.json is empty - nothing to OCR. (Every kept PDF already had a text layer.)");
    return;
  }

  console.log(`OCR queue: ${targets.length} scanned PDF(s). Image OCR is slow - please be patient.`);
  const worker = await createWorker("eng");
  let ok = 0;
  let fail = 0;

  try {
    for (const [i, { url, slug }] of targets.entries()) {
      const outFile = path.join(PDF_DIR, `${slug}.md`);
      console.log(`\n[${i + 1}/${targets.length}] ${url}`);
      try {
        const res = await fetchWithRetry(url, { timeoutMs: 60_000, retries: 1 });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = Buffer.from(await res.arrayBuffer());
        if (data.byteLength > 40 * 1024 * 1024) throw new Error("too large (>40MB)");

        const doc = await pdf(data, { scale: RENDER_SCALE });
        const pageCount = typeof doc.length === "number" ? doc.length : 0;

        const parts: string[] = [];
        let pageNo = 0;
        for await (const image of doc) {
          pageNo++;
          const { data: ocr } = await worker.recognize(image);
          const pageText = (ocr.text ?? "").trim();
          if (pageText) parts.push(pageText);
          process.stdout.write(`  ocr page ${pageNo}/${pageCount || "?"} (${pageText.length} chars)\r`);
        }

        const text = cleanText(parts.join("\n\n"));
        if (text.length < MIN_DOC_CHARS) {
          throw new Error(`OCR produced too little text (${text.length} chars) - is it really text?`);
        }
        const md = `---\nsource: ${url}\ntitle: ${slug}\nkind: pdf\nvia: ocr\n---\n\n${text}\n`;
        await writeFile(outFile, md);
        ok++;
        console.log(`\n  [ok] ${text.length} chars over ${pageNo} page(s) -> ${slug}.md`);
      } catch (e) {
        fail++;
        console.warn(`\n  [fail] ${(e as Error).message}`);
      }
      await sleep(200);
    }
  } finally {
    await worker.terminate();
  }

  console.log(`\nDone. ocr-extracted=${ok} failed=${fail} -> ${PDF_DIR}`);
  if (ok > 0) console.log("Re-run `npm run ingest` to add the OCR'd text to the knowledge base.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
