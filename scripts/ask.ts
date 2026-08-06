// Local CLI to test the chatbot end-to-end WITHOUT deploying or running a server.
// Runs the real RAG pipeline (embed -> retrieve -> confidence gate -> GPT-5 mini)
// and prints the streamed answer, plus retrieval debug so you can see grounding.
//
// Prereqs (no push needed):
//   1. Put AI_GATEWAY_API_KEY in .env  (Vercel Dashboard -> AI Gateway -> API Keys)
//   2. npm run build:index            (creates data/vectors.json)
// Then:
//   npm run ask "How much is summer camp in Cupertino?"
//   npm run ask "Do you offer adult pottery classes?"   # should escalate

import { streamText } from 'ai';
import { config, escalationMessage } from '../lib/config.js';
import { systemPrompt, contextBlock } from '../lib/prompt.js';
import { retrieve } from '../lib/kb.js';

const question = process.argv.slice(2).join(' ').trim();

if (!question) {
  console.error('Usage: npm run ask "your question here"');
  process.exit(1);
}
if (!process.env.AI_GATEWAY_API_KEY) {
  console.error('Missing AI_GATEWAY_API_KEY. Add it to .env (see .env.example) and retry.');
  process.exit(1);
}

async function main() {
  console.log(`\nQ: ${question}\n`);

  const chunks = await retrieve(question);
  console.log(
    'retrieved:',
    chunks.map((c) => `${c.id}=${c.score.toFixed(3)}`).join(', '),
  );

  const top = chunks[0];
  if (!top || top.score < config.minScore) {
    console.log(`\n[escalated — top score ${top?.score.toFixed(3) ?? 'n/a'} < MIN_SCORE ${config.minScore}]`);
    console.log(`\nA: ${escalationMessage()}\n`);
    return;
  }

  const result = streamText({
    model: config.chatModel,
    system: systemPrompt(),
    maxOutputTokens: config.maxOutputTokens,
    providerOptions: { openai: { reasoningEffort: config.reasoningEffort } },
    messages: [
      {
        role: 'user',
        content: `Context (use only this to answer):\n\n${contextBlock(chunks)}\n\nQuestion: ${question}`,
      },
    ],
  });

  process.stdout.write('\nA: ');
  for await (const delta of result.textStream) {
    process.stdout.write(delta);
  }
  process.stdout.write('\n\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
