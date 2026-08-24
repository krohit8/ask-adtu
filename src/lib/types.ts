export type ChunkKind = "page" | "pdf" | "faq";

export interface Source {
  n: number;
  url: string;
  title: string;
  kind: ChunkKind;
}

export interface RetrievedChunk {
  id: number;
  url: string;
  title: string;
  section: string;
  kind: ChunkKind;
  text: string;
  score: number;
}

export interface ChatMetadata {
  sources?: Source[];
  retrievedCount?: number;
}
