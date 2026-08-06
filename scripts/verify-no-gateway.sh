#!/bin/bash
# Negative control: prove the Vercel AI Gateway is out of the request path.
#
#   ./scripts/verify-no-gateway.sh
#
# Why this exists. `@ai-sdk/gateway` does NOT leave the dependency tree — it is a
# hard, exact-pinned dependency of ai@6 and is imported at module scope. What
# removes it from the request path is passing resolved model *instances* instead
# of bare "provider/model" strings, because the AI SDK only consults its global
# (Gateway) provider when the model argument is a string.
#
# That distinction is invisible at runtime unless you look for it: the Gateway
# authenticates via VERCEL_OIDC_TOKEN when no API key is set, and Vercel injects
# one into every deployment. So a single leftover string model id would keep
# working, and keep billing, in production, with nothing in the logs.
#
# Checks are comment-stripped on purpose. lib/models.ts deliberately *discusses*
# the Gateway at length; a grep that flags its own explanation is a gate people
# learn to ignore.

set -uo pipefail
cd -- "$(cd -- "$(dirname -- "$0")" && pwd)/.." || exit 1

fail=0

# Match in the TypeScript sources under api/ lib/ scripts/, excluding whole-line
# comments. Restricted to *.ts so this script does not match its own text — the
# patterns it searches for necessarily appear in the checks themselves.
code_grep() {
  grep -rn --include='*.ts' "$1" api lib scripts 2>/dev/null \
    | grep -vE ':[0-9]+:[[:space:]]*(//|\*|/\*)'
}

check() {
  local label="$1" pattern="$2" want="$3"
  local out count
  out=$(code_grep "$pattern")
  count=$(printf '%s' "$out" | grep -c . )
  if [[ "$count" -eq "$want" ]]; then
    echo "PASS  $label ($count hit(s), expected $want)"
  else
    echo "FAIL  $label ($count hit(s), expected $want)"
    printf '%s\n' "$out" | sed 's/^/        /'
    fail=1
  fi
}

echo "Static checks (code only, comments excluded):"

# No Gateway env var or package referenced from code.
check "no AI_GATEWAY / @ai-sdk/gateway reference" 'AI_GATEWAY\|@ai-sdk/gateway' 0

# No Gateway prose left in code comments' worth of naming — this catches
# "AI Gateway" (space), which the underscore pattern above cannot match.
check "no 'AI Gateway' naming outside explanations" 'AI Gateway' 0

# No providerOptions anywhere. Reasoning effort is pinned on the model instance
# in lib/models.ts. `providerOptions: { openai: ... }` is Gateway-shaped and the
# OpenRouter provider drops it silently, with no error and no type error.
check "no providerOptions at any call site" 'providerOptions' 0

# Exactly ONE `model: config.` may survive: scripts/build-index.ts records
# config.embedModel as a provenance LABEL in the index metadata, which is still
# correct. Every other occurrence would be a bare string model id routing through
# the Gateway. This is an allowlist, not a zero — a gate that can never pass is
# as useless as one that can never fail.
check "exactly one 'model: config.' (build-index metadata label)" 'model: config\.' 1
if [[ "$(code_grep 'model: config\.' | grep -c 'scripts/build-index.ts')" -ne 1 ]]; then
  echo "FAIL  the surviving 'model: config.' is not the build-index label"
  fail=1
fi

echo
echo "Runtime check:"

# The real proof. With a live VERCEL_OIDC_TOKEN present and no OpenRouter key,
# retrieve() must THROW. If it returns embeddings, something still resolves
# through the Gateway via OIDC.
if [[ -f .env.local ]] && grep -q VERCEL_OIDC_TOKEN .env.local; then
  env -u OPENROUTER_API_KEY -u AI_GATEWAY_API_KEY \
    node --env-file=.env.local --import tsx -e "
import('./lib/kb.ts').then(async (kb) => {
  try {
    await kb.retrieve('What is the make-up class fee?');
    console.error('FAIL  retrieve() returned embeddings with no OpenRouter key —');
    console.error('      something still routes through the Gateway via OIDC.');
    process.exit(1);
  } catch (e) {
    if (e.name === 'AI_LoadAPIKeyError') {
      console.log('PASS  retrieve() fails closed:', e.name);
    } else {
      console.error('FAIL  unexpected error:', e.name, e.message);
      process.exit(1);
    }
  }
});
" 2>&1 | grep -vE '^\.env|^Loading'
  [[ "${PIPESTATUS[0]}" -ne 0 ]] && fail=1
else
  echo "SKIP  no VERCEL_OIDC_TOKEN in .env.local — run 'vercel link' to fetch one."
  echo "      The static checks above cannot detect an OIDC-authenticated fallback."
fi

echo
if [[ "$fail" -eq 0 ]]; then
  echo "OK: the AI Gateway is not in the request path."
else
  echo "FAILED — do not deploy until the above is resolved." >&2
fi
exit "$fail"
