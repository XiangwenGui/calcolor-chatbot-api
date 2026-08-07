import type { IncomingMessage, ServerResponse } from 'node:http';
import { streamText } from 'ai';
import { config, escalationMessage } from '../lib/config.js';
import { systemPrompt, contextBlock } from '../lib/prompt.js';
import { retrieve } from '../lib/kb.js';
import { chatModel } from '../lib/models.js';

// Standalone Vercel Function (Node.js / Fluid Compute). Vercel invokes /api
// functions with the Node.js (req, res) signature, so we read from `req` and
// stream the answer by writing to `res`.
//
// Pipeline: CORS -> validate -> retrieve (in-memory cosine) -> confidence gate
// -> GPT-5 mini via OpenRouter with a strict grounding prompt -> stream.

// @vercel/node populates `req.body` (parsed JSON when the content-type is JSON).
type Req = IncomingMessage & { body?: unknown };
type Res = ServerResponse;

const MAX_MESSAGE_CHARS = 1000;
const MAX_HISTORY = 6;

type Turn = { role: 'user' | 'assistant'; content: string };

function setCors(res: Res, origin: string | null): void {
  const list = config.allowedOrigins;
  // No allowlist configured => allow all (local dev). In production ALLOWED_ORIGINS
  // is set so only the site can call this.
  const allow = list.length === 0 ? origin ?? '*' : origin && list.includes(origin) ? origin : '';
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
  if (allow) res.setHeader('Access-Control-Allow-Origin', allow);
}

function originAllowed(origin: string | null): boolean {
  const list = config.allowedOrigins;
  if (list.length === 0) return true; // dev mode
  return !!origin && list.includes(origin);
}

function send(res: Res, status: number, body: string, extra?: Record<string, string>): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  if (extra) for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
  res.end(body);
}

export default async function handler(req: Req, res: Res): Promise<void> {
  const originHeader = req.headers.origin;
  const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader ?? null;
  setCors(res, origin);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== 'POST') {
    send(res, 405, 'Method not allowed');
    return;
  }
  if (!originAllowed(origin)) {
    send(res, 403, 'Origin not allowed');
    return;
  }

  // Parse and validate input. @vercel/node gives us req.body (object or string).
  let message = '';
  let history: Turn[] = [];
  try {
    const raw = req.body;
    const body = (typeof raw === 'string' ? JSON.parse(raw) : raw ?? {}) as {
      message?: unknown;
      history?: unknown;
    };
    message = typeof body.message === 'string' ? body.message.trim() : '';
    if (Array.isArray(body.history)) {
      history = (body.history as Turn[])
        .filter((t) => t && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string')
        .slice(-MAX_HISTORY);
    }
  } catch {
    send(res, 400, 'Invalid request body');
    return;
  }

  if (!message) {
    send(res, 400, 'Please include a "message".');
    return;
  }
  if (message.length > MAX_MESSAGE_CHARS) message = message.slice(0, MAX_MESSAGE_CHARS);

  // Retrieve, then apply the confidence gate. If nothing matches well, escalate
  // WITHOUT calling the LLM — the cheapest and safest fallback.
  let chunks;
  try {
    chunks = await retrieve(message);
  } catch (err) {
    console.error('retrieval_error', err);
    send(res, 200, escalationMessage(), { 'X-Escalated': 'error' });
    return;
  }

  const top = chunks[0];
  if (!top || top.score < config.minScore) {
    console.log('escalate_low_confidence', { message, topScore: top?.score ?? null });
    send(res, 200, escalationMessage(), { 'X-Escalated': 'low-confidence' });
    return;
  }

  console.log('chat', {
    message,
    topScore: Number(top.score.toFixed(3)),
    retrieved: chunks.map((c) => `${c.id}:${c.score.toFixed(2)}`),
  });

  // Reasoning effort is pinned on the model instance in lib/models.ts — do not add
  // a providerOptions block here. See the warning there before you are tempted.
  const result = streamText({
    model: chatModel,
    system: systemPrompt(),
    maxOutputTokens: config.maxOutputTokens,
    messages: [
      ...history.map((t) => ({ role: t.role, content: t.content })),
      {
        role: 'user' as const,
        content: `Context (use only this to answer):\n\n${contextBlock(chunks)}\n\nQuestion: ${message}`,
      },
    ],
    onError: ({ error }) => console.error('generation_error', error),
  });

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  try {
    for await (const delta of result.textStream) {
      res.write(delta);
    }
  } catch (err) {
    console.error('stream_error', err);
  }
  res.end();
}
