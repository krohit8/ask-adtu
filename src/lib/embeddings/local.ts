import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

export const LOCAL_EMBED_MODEL = "Xenova/all-MiniLM-L6-v2";
export const EMBED_DIMS = 384;

let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!extractorPromise) {
    extractorPromise = pipeline("feature-extraction", LOCAL_EMBED_MODEL);
  }
  return extractorPromise;
}

/**
 * Local embeddings (mean pooling + L2 normalization). No API, no rate limits.
 * First call downloads ~25MB model weights, then runs fully offline on CPU.
 */
export async function embedLocal(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  const extractor = await getExtractor();
  const out = await extractor(texts, { pooling: "mean", normalize: true });
  const dims = out.dims as number[];
  const dim = dims[dims.length - 1];
  const data = out.data as Float32Array;
  const result: Float32Array[] = [];
  for (let i = 0; i < texts.length; i++) {
    result.push(data.slice(i * dim, (i + 1) * dim));
  }
  return result;
}
