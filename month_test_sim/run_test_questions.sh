#!/bin/bash
# Eval harness: run every question in questions.md through the chatbot CLI
# (scripts/ask.ts, i.e. the same pipeline as `npm run ask`), log the full output,
# and tally answered vs escalated vs errored.
#
#   ./month_test_sim/run_test_questions.sh
#
# Everything below resolves from the REPO ROOT, not from this directory: the CLI
# loads .env from the repo root and scripts/ask.ts is a root-relative path. The
# script cd's to the root itself so it works no matter where you invoke it from.
#
# Outputs (both gitignored — they are rewritten on every run):
#   month_test_sim/test_run_log.txt      full transcript
#   month_test_sim/test_run_summary.txt  the tally
#
# The committed baseline it should be compared against is:
#   month_test_sim/baseline-2026-08-03.log  (150 / 149 answered / 1 escalated)
# Diff ONLY the `^retrieved:` lines — answer prose varies run-to-run at default
# temperature regardless of provider, so diffing prose is pure noise:
#   grep '^retrieved:' month_test_sim/test_run_log.txt        > /tmp/new.txt
#   grep '^retrieved:' month_test_sim/baseline-2026-08-03.log > /tmp/old.txt
#   diff /tmp/old.txt /tmp/new.txt
#
# NOTE: this costs real money (~$0.12 for 150 questions on gpt-5-mini).

set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
ROOT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

QFILE="$SCRIPT_DIR/questions.md"
LOGFILE="$SCRIPT_DIR/test_run_log.txt"
SUMMARY="$SCRIPT_DIR/test_run_summary.txt"

# Seconds to wait between questions. Rate limiting shows up as a 429, which the
# CLI surfaces as an error — without a pause those land silently in the `errored`
# bucket and look like model failures.
SLEEP_SECONDS="${SLEEP_SECONDS:-1}"

if [[ ! -f "$QFILE" ]]; then
  echo "Missing question file: $QFILE" >&2
  exit 1
fi

# Compute the count rather than hardcoding it, so adding questions doesn't make
# the progress counter lie.
expected=$(grep -cE '^[0-9]+\.' "$QFILE")
if [[ "$expected" -eq 0 ]]; then
  echo "No numbered questions found in $QFILE" >&2
  exit 1
fi
echo "Running $expected questions (sleep ${SLEEP_SECONDS}s between calls)..."

> "$LOGFILE"

answered=0
escalated=0
errored=0
empty=0
rate_limited=0
total=0

while IFS= read -r line; do
  q=$(echo "$line" | sed -E 's/^[0-9]+\.[[:space:]]*//')
  total=$((total+1))
  echo "===== [$total/$expected] $q =====" | tee -a "$LOGFILE"
  out=$(node --env-file-if-exists=.env --import tsx scripts/ask.ts "$q" 2>&1)
  echo "$out" >> "$LOGFILE"
  echo "" >> "$LOGFILE"

  # Count rate limits separately so a throttled run is obvious instead of being
  # indistinguishable from a broken model.
  #
  # Skip the "retrieved:" line and require non-numeric context around 429. A bare
  # /429/ matches cosine scores — "open-house=0.429" — and a clean run reported
  # three phantom rate limits, which then invalidated an otherwise perfect tally.
  # A false alarm on the trustworthiness check is as bad as missing a real 429.
  if echo "$out" | grep -v '^retrieved:' \
       | grep -qiE '(^|[^0-9.])429([^0-9]|$)|rate.?limit|too many requests'; then
    rate_limited=$((rate_limited+1))
  fi

  # Order matters: the escalation path also prints an "A: " line.
  #
  # The `[^ ]` on the answered branch is load-bearing. ask.ts writes "\nA: " and
  # then streams; if the model returns nothing, the log still contains a bare
  # "A: " line, and a plain `^A: ` test would score the single failure this
  # migration is most exposed to — reasoning effort not reaching the wire, so the
  # whole MAX_OUTPUT_TOKENS budget goes to reasoning — as a clean pass. The
  # baseline run has 150 non-empty "A: " lines and 0 bare ones, so this bucket
  # reproduces 149/1 exactly and only ever fires on a real regression.
  if echo "$out" | grep -q "\[escalated"; then
    escalated=$((escalated+1))
  elif echo "$out" | grep -qE "^A: +[^ ]"; then
    answered=$((answered+1))
  elif echo "$out" | grep -qE "^A: *$"; then
    empty=$((empty+1))
  else
    errored=$((errored+1))
  fi
  echo "progress: answered=$answered escalated=$escalated empty=$empty errored=$errored rate_limited=$rate_limited / $total"

  if [[ "$total" -lt "$expected" ]]; then
    sleep "$SLEEP_SECONDS"
  fi
done < <(grep -E '^[0-9]+\.' "$QFILE")

{
  echo "Total questions: $total"
  echo "Answered: $answered"
  echo "Escalated: $escalated"
  echo "Empty answers: $empty"
  echo "Errored/unparsed: $errored"
  echo "Rate-limited (429) responses seen: $rate_limited"
} | tee "$SUMMARY"

if [[ "$empty" -gt 0 ]]; then
  echo "WARNING: $empty empty answer(s). That is the signature of reasoning effort not" >&2
  echo "reaching the wire — check lib/models.ts before trusting anything else here." >&2
fi

if [[ "$rate_limited" -gt 0 ]]; then
  echo "WARNING: $rate_limited response(s) mention a rate limit — the tally above is not trustworthy." >&2
  echo "Re-run with a larger SLEEP_SECONDS before comparing against the baseline." >&2
fi
