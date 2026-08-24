# Ask AdtU — University Council Agent

AI assistant for **Assam down town University (AdtU)**, Guwahati. Answers student queries about admissions, fees, scholarships, hostels, placements and exams — grounded strictly in crawled adtu.in content with inline citations.

100% TypeScript. Single Next.js app.

## Architecture

```
adtu.in ──crawl──▶ data/raw/pages.json ─┐
PDFs    ──extract─▶ data/raw/pdfs/*.md ─┼─▶ ingest ─▶ src/db/chunks.db (SQLite + vectors)
FAQ     ──curated─▶ scripts/faq/*.json ─┘
                                            │
query ─▶ embedLocal(MiniLM) + MiniSearch ─▶ RRF fusion ─▶ top-8 context
                                                              │
                              Gemini flash-lite ◀── grounded prompt (+ tools, slot memory)
                                                              │
                                        SSE stream ─▶ Next.js chat UI (citations, sources)
```

- **Embeddings:** local `all-MiniLM-L6-v2` via transformers.js — free, offline, no rate limits
- **Retrieval:** hybrid dense cosine + keyword (MiniSearch), reciprocal-rank fusion, FAQ trust boost
- **Generation:** `gemini-2.5-flash-lite` (see `src/lib/llm/model.ts` — one-line swap)
- **Guardrails:** answer-only-from-context, `[n]` citations, refusal + human referral when ungrounded, mock APIs visibly labeled SIMULATED

## Setup

```bash
npm install
# put your key in .env.local:
#   GOOGLE_GENERATIVE_AI_API_KEY=...
```

## Knowledge base pipeline

```bash
npm run crawl     # adtu.in -> data/raw/pages.json (~185 topical pages)
npm run pdf       # download+extract key PDFs -> data/raw/pdfs/*.md (optional)
npm run ingest    # chunk -> embed locally -> src/db/chunks.db (~3100 chunks)
```

Re-run any time content changes; embeddings cost nothing.

## Run

```bash
npm run dev       # http://localhost:3000
```

## Evaluate

```bash
npm run eval            # 30-question golden set incl. hallucination tripwires
npm run eval -- --save  # writes eval/report.md
```

⚠️ Free tier is capped at ~20 requests/day/model (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`). The eval needs ~30 calls — either enable billing on the AI Studio project or run after the daily reset (midnight US-Pacific).

## Demo script (90 seconds)

1. "How do I apply for B.Tech CSE?" → steps + apply.adtu.in link, sources cited
2. Follow up: "what's the fee?" → slot memory resolves programme from context
3. "Is there a scholarship for girls?" → Jyoti scholarship + amounts
4. Trap: "What is the MBBS fee?" → clean refusal (not offered), no invented numbers
5. Tool demo: "Check my application status ADTU2026-12345" → SIMULATED badge visible
6. Point out source chips under each answer → click through to adtu.in

## Troubleshooting

| Symptom | Fix |
|---|---|
| `/api/chat` returns 503 | knowledge base empty → run crawl + ingest |
| `quota exceeded` in logs | daily free cap hit → billing or wait for reset |
| Retrieval looks wrong | delete `src/db/chunks.db`, re-ingest |
| Model retired error | swap id in `src/lib/llm/model.ts` |
