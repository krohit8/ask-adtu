/**
 * Golden-set regression runner.
 * Run: npm run eval          (requires ingested db + GOOGLE key)
 *      npm run eval -- --save   -> also writes eval/report.md
 */
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { generateText } from "ai";
import { google } from "@ai-sdk/google";
import { CHAT_MODEL } from "../src/lib/llm/model";
import * as store from "../src/db/store";
import { buildContext, retrieve } from "../src/lib/retrieval/search";
import { buildSystemPrompt } from "../src/lib/llm/prompt";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// tsx doesn't auto-load .env.local
try {
  process.loadEnvFile(".env.local");
} catch {
  /* handled below */
}

interface Question {
  q: string;
  mustInclude: string[];
  refuse?: boolean;
  why?: string;
}

async function main() {
  const save = process.argv.includes("--save");
  if (!store.isReady()) {
    console.error("Knowledge base empty - run npm run crawl && npm run ingest first.");
    process.exit(1);
  }

  const data = JSON.parse(
    await readFile(path.resolve(process.cwd(), "eval/questions.json"), "utf8"),
  ) as { questions: Question[] };

  let pass = 0;
  let fail = 0;
  const rows: string[] = [];

  async function ask(prompt: string, system: string): Promise<string> {
    for (let attempt = 0; ; attempt++) {
      try {
        const { text } = await generateText({
          model: google(CHAT_MODEL),
          system,
          prompt,
          temperature: 0.3,
        });
        return text;
      } catch (e) {
        const msg = (e as Error).message;
        const m = msg.match(/retry in ([\d.]+)s/i);
        if (m && attempt < 3) {
          await sleep(Math.ceil(parseFloat(m[1]) * 1000) + 500);
          continue;
        }
        throw e;
      }
    }
  }

  for (const [i, item] of data.questions.entries()) {
    try {
      const results = await retrieve(item.q);
      const { context } = buildContext(results);
      const text = await ask(
        `CONTEXT FROM ADTU.IN:\n${context}\n\nQUESTION: ${item.q}`,
        buildSystemPrompt(null, new Date()),
      );
      await sleep(1500); // free-tier pacing

      let ok: boolean;
      if (item.refuse) {
        const fabricatesMoney = /₹|Rs\.?\s?\d|lakh[s]?\b.*\d/i.test(text);
        ok = !fabricatesMoney;
      } else {
        ok = item.mustInclude.every((k) => text.toLowerCase().includes(k.toLowerCase()));
      }

      if (ok) pass++;
      else fail++;
      rows.push(
        `${ok ? "PASS" : "FAIL"} | ${item.q} ${item.why ? `[${item.why}]` : ""}\n     -> ${text.replace(/\s+/g, " ").slice(0, 180)}...\n`,
      );
      process.stdout.write(`[${i + 1}/${data.questions.length}] ${ok ? "PASS" : "FAIL"} ${item.q}\n`);
    } catch (e) {
      fail++;
      rows.push(`ERROR | ${item.q}\n     -> ${(e as Error).message}\n`);
      console.error(`[${i + 1}] ERROR ${item.q}:`, (e as Error).message);
    }
  }

  console.log(`\n===== RESULTS: ${pass} passed / ${fail} failed =====`);
  console.log(rows.join("\n"));

  if (save) {
    const report = `# Ask AdtU Eval Report\n\nDate: ${new Date().toISOString()}\n\nScore: ${pass}/${pass + fail}\n\n${rows.join("\n")}`;
    await writeFile(path.resolve(process.cwd(), "eval/report.md"), report);
    console.log("Report saved to eval/report.md");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
