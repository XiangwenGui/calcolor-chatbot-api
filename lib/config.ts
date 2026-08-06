// Central configuration for the CalColor chatbot API.
// Everything here is overridable via environment variables so the model,
// thresholds, and contact details can change without touching code.

export const config = {
  // Model IDs are Vercel AI Gateway strings ("provider/model"). Swappable via env
  // with no code change — e.g. bump CHAT_MODEL to a newer mini when available.
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
  reasoningEffort: process.env.REASONING_EFFORT ?? 'minimal',

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
