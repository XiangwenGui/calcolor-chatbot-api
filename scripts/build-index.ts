// Build the KB vector index: read every kb/*.md file, embed it with the
// configured embedding model, and write data/vectors.json (bundled with the
// deploy). Re-run this whenever the KB changes:  npm run build:index
//
// Requires OPENROUTER_API_KEY in the environment (see .env.example).
//
// WARNING — this overwrites the retrieval baseline. data/vectors.json currently
// holds float16-quantized vectors returned by the old Vercel AI Gateway; rebuilding
// through OpenRouter writes full-precision ones. The score shift is tiny (~1e-5)
// and harmless in itself, but month_test_sim/baseline-2026-08-03.log stops being a
// like-for-like comparison the moment you do it. If you rebuild, re-run the eval
// and re-baseline.
//
// Also note the AI SDK issues ONE request for all values below: the OpenRouter
// provider reports maxEmbeddingsPerCall as undefined, so there is no automatic
// chunking. A KB grown past the endpoint's per-request input limit will fail hard
// rather than batch — split the call yourself if that day comes.

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { embedMany } from 'ai';
import { config } from '../lib/config.js';
import { embeddingModel } from '../lib/models.js';

const kbDir = fileURLToPath(new URL('../kb', import.meta.url));
const outPath = fileURLToPath(new URL('../data/vectors.json', import.meta.url));

function titleFromMarkdown(md: string, fallback: string): string {
  const h1 = md.split('\n').find((l) => l.startsWith('# '));
  return h1 ? h1.replace(/^#\s+/, '').trim() : fallback;
}

async function main() {
  const files = readdirSync(kbDir)
    .filter((f) => f.endsWith('.md'))
    .sort();

  if (files.length === 0) {
    throw new Error(`No .md files found in ${kbDir}`);
  }

  const docs = files.map((file) => {
    const text = readFileSync(new URL(`../kb/${file}`, import.meta.url), 'utf8').trim();
    return {
      id: file.replace(/\.md$/, ''),
      title: titleFromMarkdown(text, file),
      text,
    };
  });

  console.log(`Embedding ${docs.length} chunks with ${config.embedModel}...`);
  const { embeddings } = await embedMany({
    model: embeddingModel,
    values: docs.map((d) => d.text),
  });

  const index = {
    // A provenance LABEL recorded in the index file, not a model argument — this
    // is the one legitimate `model: config.` in the codebase. The negative control
    // that proves no bare string model ids survive allowlists exactly this line.
    model: config.embedModel,
    dims: embeddings[0]?.length ?? 0,
    chunks: docs.map((d, i) => ({ ...d, embedding: embeddings[i] })),
  };

  mkdirSync(fileURLToPath(new URL('../data', import.meta.url)), { recursive: true });
  writeFileSync(outPath, JSON.stringify(index));
  console.log(`Wrote ${index.chunks.length} chunks (${index.dims} dims) to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
