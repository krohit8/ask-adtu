export const CRAWL = {
  seeds: [
    "https://adtu.in/",
    "https://adtu.in/all-programmes/",
    "https://adtu.in/about/about_adtu/",
    "https://adtu.in/exam/",
    "https://adtu.in/placement/",
    "https://adtu.in/hndb-library/",
    "https://adtu.in/infrastructure/",
    "https://adtu.in/public-self-disclosure.html",
    "https://adtu.in/iqac/",
    "https://adtu.in/naac/",
    "https://adtu.in/international/",
    "https://adtu.in/disa/",
    "https://adtu.in/blog/",
    "https://adtu.in/news-and-events/",
    "https://adtu.in/blog/adtu-admission-2026-eligibility-fees-and-application-process-14-2-26",
  ],
  /** Only keep URLs whose path matches at least one of these (topical relevance). */
  include: [
    /\/programme\//i,
    /\/faculties?\//i,
    /admission|apply/i,
    /scholar|financial|freeship/i,
    /\bfee|fees\b/i,
    /\bexam|examination|result/i,
    /placement|career/i,
    /hostel|accommodation/i,
    /contact/i,
    /about|vision|mission|leadership|governance/i,
    /infrastructure|facilit/i,
    /library/i,
    /blog/i,
    /iqac|naac|nirf/i,
    /international/i,
    /\bphd\b|research|disa|incubat/i,
    /life-skill|clppd|swayam/i,
    /transport|sports|anti-ragging|grievance|committee/i,
  ],
  exclude: [
    /\.(png|jpe?g|gif|svg|webp|ico|css|js|mjs|map|xml|rss|json|woff2?|ttf|otf|eot|mp4|mp3|avi|mov|wmv|zip|rar|7z|gz|docx?|xlsx?|pptx?)(\?|$)/i,
    /\/wp-admin|\/wp-login|xmlrpc\.php|\/feed\/?(\?|$)/i,
    /facebook\.com|twitter\.com|x\.com|linkedin\.com|instagram\.com|youtube\.com|wa\.me|whatsapp\.com/i,
    /mailto:|^tel:/i,
    /^javascript:/i,
    // low-value flood sources - starve these so programme/admission pages get crawled
    /news-and-events\/(news-details|event-details)/i,
    // staff recruitment ads - irrelevant to student queries
    /\/careers?\//i,
  ],
  allowedHosts: ["adtu.in"],
  maxPages: 400,
  maxDepth: 6,
  concurrency: 5,
  delayMs: 250,
  timeoutMs: 15_000,
} as const;

export const CHUNK = {
  maxChars: 1200,
  overlapChars: 150,
  minChars: 80,
} as const;

export const EMBED = {
  provider: "local" as const,
  modelId: "Xenova/all-MiniLM-L6-v2",
  dimensions: 384,
  batchSize: 32,
} as const;

export const RETRIEVE = {
  vectorTopK: 24,
  keywordTopK: 24,
  rrfK: 60,
  finalTopN: 8,
} as const;
