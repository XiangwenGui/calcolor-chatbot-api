// Build the KB vector index: read every kb/*.md file, embed it with the
// configured embedding model, and write data/vectors.json (bundled with the
// deploy). Re-run this whenever the KB changes:  npm run build:index
//
// Requires AI_GATEWAY_API_KEY in the environment (see .env.example).

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { embedMany } from 'ai';
import { config } from '../lib/config.js';

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
    model: config.embedModel,
    values: docs.map((d) => d.text),
  });

  const index = {
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
