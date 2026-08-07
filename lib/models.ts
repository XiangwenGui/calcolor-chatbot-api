// The single place the model provider is constructed.
//
// Everything else imports resolved model *instances* from here, never bare
// "provider/model" strings. That is load-bearing, not style: the AI SDK only
// falls back to its global (Vercel AI Gateway) provider when the `model`
// argument is a string. Passing instances is what actually takes the Gateway
// out of the request path — `@ai-sdk/gateway` remains in node_modules because
// `ai@6` pins it as a hard dependency, but it becomes dead code.
//
// This matters more than it looks: `@ai-sdk/gateway` authenticates via
// VERCEL_OIDC_TOKEN when no API key is present, and Vercel injects one into
// every deployment. A single leftover string model id would therefore keep
// working *and keep billing*, silently, with no error to notice.

import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { config } from './config.js';

// No apiKey argument: the provider reads OPENROUTER_API_KEY itself, and does so
// lazily — the key is loaded inside the per-request header closure, not at
// construction. Importing this module with no key set is therefore safe, which
// is what lets scripts/verify-offline.ts stay offline.
//
// compatibility: 'strict' because we talk to the real OpenRouter API. It adds
// stream_options: { include_usage: true }, so token usage arrives on the stream.
const openrouter = createOpenRouter({ compatibility: 'strict' });

// Pin routing to OpenAI's first-party endpoint for both models.
//
// `openai/gpt-5-mini` resolves to four endpoints (openai, openai/flex, azure,
// azure/swedencentral). The two Azure ones advertise `max_completion_tokens` but
// NOT `max_tokens` in supported_parameters, and the AI SDK provider sends
// `max_tokens` — so if OpenRouter does not normalize between them, an Azure route
// would silently drop MAX_OUTPUT_TOKENS. That is the headline per-request cost cap
// on a project that exists because of a $3k overrun, so it does not get to be
// "probably fine". Pinning also avoids openai/flex (half price, substantially
// slower — bad for a widget awaiting first token) and azure/swedencentral (EU
// hosting, a data-residency question that did not exist under the Gateway).
//
// `openai/text-embedding-3-small` likewise has two endpoints. The committed index
// was built against OpenAI's, and "same embedding space" is the premise the whole
// retrieval-score regression rests on — so the query side must not drift to Azure.
//
// require_parameters additionally drops any endpoint that cannot honour every
// parameter we send, which is the belt to allow_fallbacks: false's braces.
// A factory rather than a shared constant, so the two model instances cannot end
// up aliasing the same mutable `order` array. (Not `as const`: the provider types
// declare `order` as a mutable string[].)
const openaiOnly = () => ({
  order: ['openai'],
  allow_fallbacks: false,
  require_parameters: true,
});

// Reasoning effort is pinned on the model instance rather than repeated at each
// call site, so it cannot drift between api/chat.ts and scripts/ask.ts.
//
// Do NOT reintroduce `providerOptions: { openai: { reasoningEffort } }` at a call
// site. That is Vercel-Gateway-shaped: this provider reads only
// `providerOptions.openrouter` and drops an `openai` key with no warning and no
// type error. GPT-5 mini would fall back to default reasoning effort and burn the
// shared MAX_OUTPUT_TOKENS=800 budget on reasoning, returning empty answers —
// exactly the bug fixed in commit 78c7f63. Note the key renames too:
// `reasoningEffort` becomes `reasoning: { effort }`.
export const chatModel = openrouter.chat(config.chatModel, {
  reasoning: { effort: config.reasoningEffort },
  provider: openaiOnly(),
});

export const embeddingModel = openrouter.textEmbeddingModel(config.embedModel, {
  provider: openaiOnly(),
});
