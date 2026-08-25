/**
 * Crawler for adtu.in -> data/raw/pages.json (+ pdf-urls.json)
 * BFS with topical URL filtering, politeness delay, per-request timeout/retry.
 *
 * Run: npm run crawl
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import { load as $load } from "cheerio";
import { CRAWL } from "./config";
import { cleanText, fetchWithRetry, normalizeUrl, sleep } from "./util";

const RAW_DIR = path.resolve(process.cwd(), "data/raw");

interface Page {
  url: string;
  title: string;
  text: string;
  crawledAt: string;
}

function isIncluded(u: URL): boolean {
  if (!(CRAWL.allowedHosts as readonly string[]).includes(u.host)) return false;
  if (u.pathname === "/" || u.pathname === "") return true;
  return CRAWL.include.some((re) => re.test(u.pathname));
}

function isExcluded(url: string): boolean {
  return CRAWL.exclude.some((re) => re.test(url));
}

function extractContent($: cheerio.CheerioAPI): { title: string; text: string } {
  $("script, style, noscript, iframe, svg, form, template").remove();
  $(
    "header, nav, footer, aside, [role=banner], [role=navigation], [role=contentinfo], .navbar, .menu, #masthead, #footer",
  ).remove();

  const rawTitle =
    $("title").first().text().trim() ||
    $('meta[property="og:title"]').attr("content")?.trim() ||
    $("h1").first().text().trim() ||
    "";

  const container =
    $("main").first().length
      ? $("main").first()
      : $("article").first().length
        ? $("article").first()
        : $(".entry-content").first().length
          ? $(".entry-content").first()
          : $("body");

  const text = cleanText(container.text());
  // strip common WP site suffix from titles
  const title = rawTitle.replace(/\s*[|\-–—]\s*Assam down town University.*$/i, "").trim();
  return { title, text };
}

async function main() {
  await mkdir(RAW_DIR, { recursive: true });

  const queue: Array<{ url: string; depth: number }> = [];
  const enqueued = new Set<string>();
  const visited = new Set<string>();
  const pages: Page[] = [];
  const pdfUrls = new Set<string>();

  for (const seed of CRAWL.seeds) {
    const n = normalizeUrl(seed);
    if (n && !enqueued.has(n)) {
      enqueued.add(n);
      queue.push({ url: n, depth: 0 });
    }
  }

  let active = 0;
  let nextAllowedAt = 0;
  let failures = 0;

  async function worker(id: number) {
    while (queue.length > 0 || active > 0) {
      const item = queue.shift();
      if (!item) {
        await sleep(100);
        continue;
      }
      const { url, depth } = item;
      if (visited.has(url) || pages.length >= CRAWL.maxPages) continue;
      visited.add(url);
      active++;

      try {
        // global politeness pacing
        const wait = nextAllowedAt - Date.now();
        if (wait > 0) await sleep(wait);
        nextAllowedAt = Date.now() + Math.ceil(CRAWL.delayMs / CRAWL.concurrency);

        if (/\.pdf(\?|$)/i.test(url)) {
          pdfUrls.add(url);
          process.stdout.write(
            `\r[worker ${id}] pdf=${pdfUrls.size} queue=${queue.length} fails=${failures}  last=${url.slice(0, 70)}          `,
          );
          active--;
          continue;
        }

        const res = await fetchWithRetry(url, {
          timeoutMs: CRAWL.timeoutMs,
          retries: 1,
          headers: { Accept: "text/html,application/xhtml+xml" },
        });
        const ct = res.headers.get("content-type") ?? "";
        if (!ct.includes("html")) throw new Error(`non-html ${ct}`);

        const html = await res.text();
        const $ = $load(html);
        const { title, text } = extractContent($);

        if (text.length > 200) {
          pages.push({ url, title, text, crawledAt: new Date().toISOString() });
          process.stdout.write(
            `\r[worker ${id}] pages=${pages.length} queue=${queue.length} fails=${failures}  last=${url.slice(0, 70)}          `,
          );
        }

        if (depth < CRAWL.maxDepth) {
          $("a[href]").each((_i, el) => {
            const href = $(el).attr("href");
            if (!href || isExcluded(href)) return;
            const abs = normalizeUrl(new URL(href, url).toString());
            if (!abs) return;
            if (isExcluded(abs)) return;

            if (/\.pdf(\?|$)/i.test(abs)) {
              pdfUrls.add(abs);
              return;
            }
            const u2 = new URL(abs);
            if (!isIncluded(u2) || enqueued.has(abs) || visited.has(abs)) return;
            enqueued.add(abs);
            const item = { url: abs, depth: depth + 1 };
            // priority lanes: student-critical pages jump the queue
            if (/\/programme\/|admission|scholar|\bfees?\b|exam|placement|hostel|faculties/i.test(abs)) {
              queue.unshift(item);
            } else {
              queue.push(item);
            }
          });
        }
      } catch (e) {
        failures++;
        console.warn(`\n[skip] ${url} -> ${(e as Error).message}`);
      } finally {
        active--;
      }
    }
  }

  await Promise.all(Array.from({ length: CRAWL.concurrency }, (_v, i) => worker(i)));
  console.log(`\n\nDone. ${pages.length} pages, ${pdfUrls.size} PDF links, ${failures} failures.`);

  await writeFile(path.join(RAW_DIR, "pages.json"), JSON.stringify(pages, null, 1));
  await writeFile(
    path.join(RAW_DIR, "pdf-urls.json"),
    JSON.stringify([...pdfUrls], null, 1),
  );
  console.log(`Wrote ${path.join(RAW_DIR, "pages.json")} and pdf-urls.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
