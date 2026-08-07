// Central configuration for the CalColor chatbot API.
// Everything here is overridable via environment variables so the model,
// thresholds, and contact details can change without touching code.

// Reasoning effort levels OpenRouter accepts. Narrowed to a literal union so a
// typo'd REASONING_EFFORT falls back to 'minimal' here instead of being rejected
// by the API mid-request — and so lib/models.ts can pass it straight through.
const REASONING_EFFORTS = ['xhigh', 'high', 'medium', 'low', 'minimal', 'none'] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

function parseReasoningEffort(raw: string | undefined): ReasoningEffort {
  return (REASONING_EFFORTS as readonly string[]).includes(raw ?? '')
    ? (raw as ReasoningEffort)
    : 'minimal';
}

// NOTE: keep this file dependency-free (nothing imported beyond node builtins).
// lib/models.ts imports it to construct the provider, so anything imported here
// would be pulled in ahead of that — and this file needs to stay readable without
// the SDK. It does NOT keep the provider package out of scripts/verify-offline.ts:
// that imports lib/kb.ts, which imports lib/models.ts. What keeps the offline test
// offline is that createOpenRouter loads OPENROUTER_API_KEY lazily, per request.
export const config = {
  // Model IDs are OpenRouter strings ("provider/model"). Swappable via env with no
  // code change — e.g. bump CHAT_MODEL to a newer mini when available.
  //
  // OpenRouter's model namespace is NOT the Vercel AI Gateway's catalogue, and is
  // not a superset of it. Look any replacement CHAT_MODEL up at
  // https://openrouter.ai/models — and if you keep REASONING_EFFORT set, check its
  // model page lists `reasoning` / `reasoning_effort` under supported parameters,
  // or the setting is silently ignored.
  //
  // EMBED_MODEL is the awkward one: `openai/text-embedding-3-small` does not
  // appear in that browsable catalog at all. It resolves only via the endpoints
  // API (/api/v1/models/{id}/endpoints). Don't conclude it is unsupported just
  // because searching openrouter.ai/models comes up empty.
  chatModel: process.env.CHAT_MODEL ?? 'openai/gpt-5-mini',
  embedModel: process.env.EMBED_MODEL ?? 'openai/text-embedding-3-small',

  // Retrieval
  topK: Number(process.env.TOP_K ?? 4),
  // Cosine-similarity floor. If the best-matching chunk scores below this, we do
  // NOT call the LLM — we escalate to the front desk instead. Tune during eval.
  minScore: Number(process.env.MIN_SCORE ?? 0.3),

  // Generation cap — bounds any single query's output cost. Note: for reasoning
  // models (like GPT-5 mini) this budget is shared with reasoning tokens, so keep
  // it well above the visible-answer length.
  maxOutputTokens: Number(process.env.MAX_OUTPUT_TOKENS ?? 800),

  // Reasoning effort for reasoning models (GPT-5 family). A grounded FAQ bot needs
  // little reasoning; 'minimal' keeps answers fast, cheap, and prevents reasoning
  // tokens from eating the whole output budget. Ignored by non-reasoning models.
  // Applied in lib/models.ts as `reasoning: { effort }` on the model instance.
  reasoningEffort: parseReasoningEffort(process.env.REASONING_EFFORT),

  // CORS allowlist — only these origins may call the API. Comma-separated env.
  // Example: "https://calcolor.com,https://www.calcolor.com,https://calcolor.vercel.app"
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // Front-desk contact used in the escalation message.
  contact: {
    phone: process.env.FRONT_DESK_PHONE ?? '(408) 818-8818',
    email: process.env.FRONT_DESK_EMAIL ?? 'cu@calcolor.com',
    trialUrl: process.env.TRIAL_URL ?? 'https://calcolor.com/trial.html',
  },
} as const;

// The message shown whenever the bot can't confidently answer from the KB.
export function escalationMessage(): string {
  const { phone, email, trialUrl } = config.contact;
  return (
    "I'm not sure about that one, and I don't want to give you the wrong information. " +
    `Please reach our front desk at ${phone} or ${email} and the team will be happy to help. ` +
    `You can also book a free trial class here: ${trialUrl}`
  );
}
