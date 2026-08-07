import { embed, cosineSimilarity } from 'ai';
import { config } from './config.js';
import { embeddingModel } from './models.js';

export type KbChunk = {
  id: string;
  title: string;
  text: string;
  embedding: number[];
};

export type KbIndex = {
  model: string;
  dims: number;
  chunks: KbChunk[];
};

export type Retrieved = {
  id: string;
  title: string;
  text: string;
  score: number;
};

// Load the pre-built vector index once at cold start. It's imported (not read from
// disk) so the bundler inlines data/vectors.json into the deployed function — no
// file-tracing surprises and no database call at request time. The dynamic import
// keeps this lazy, so callers that only use rankChunks (e.g. the offline test)
// never require the index file to exist.
let indexCache: KbIndex | null = null;

export async function loadIndex(): Promise<KbIndex> {
  if (indexCache) return indexCache;
  const mod = await import('../data/vectors.json', { with: { type: 'json' } });
  indexCache = ((mod as { default?: KbIndex }).default ?? mod) as KbIndex;
  return indexCache;
}

// Pure ranking: score every chunk against a query embedding and return the
// top-k by cosine similarity. Separated out so it can be tested without network.
export function rankChunks(
  queryEmbedding: number[],
  chunks: KbChunk[],
  topK: number,
): Retrieved[] {
  const scored = chunks.map((c) => ({
    id: c.id,
    title: c.title,
    text: c.text,
    score: cosineSimilarity(queryEmbedding, c.embedding),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

// Embed the question and return the top-k most similar chunks by cosine similarity.
export async function retrieve(question: string): Promise<Retrieved[]> {
  const index = await loadIndex();
  const { embedding } = await embed({
    model: embeddingModel,
    value: question,
  });
  return rankChunks(embedding, index.chunks, config.topK);
}
