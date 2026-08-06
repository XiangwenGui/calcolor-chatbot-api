#!/bin/bash
# Runs every question in Test Questions.md through the chatbot CLI (npm run ask equivalent),
# logs full output, and tallies answered vs escalated.
set -uo pipefail

cd "$(dirname "$0")"

QFILE="../knowledge base/Test Questions.md"
LOGFILE="test_run_log.txt"
SUMMARY="test_run_summary.txt"

> "$LOGFILE"

answered=0
escalated=0
errored=0
total=0

while IFS= read -r line; do
  q=$(echo "$line" | sed -E 's/^[0-9]+\.\s*//')
  total=$((total+1))
  echo "===== [$total/150] $q =====" | tee -a "$LOGFILE"
  out=$(node --env-file-if-exists=.env --import tsx scripts/ask.ts "$q" 2>&1)
  echo "$out" >> "$LOGFILE"
  echo "" >> "$LOGFILE"
  if echo "$out" | grep -q "\[escalated"; then
    escalated=$((escalated+1))
  elif echo "$out" | grep -qE "^A: "; then
    answered=$((answered+1))
  else
    errored=$((errored+1))
  fi
  echo "progress: answered=$answered escalated=$escalated errored=$errored / $total"
done < <(grep -E '^[0-9]+\.' "$QFILE")

{
  echo "Total questions: $total"
  echo "Answered: $answered"
  echo "Escalated: $escalated"
  echo "Errored/unparsed: $errored"
} | tee "$SUMMARY"
