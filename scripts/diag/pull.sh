#!/usr/bin/env bash
# Pull device diagnostics from the stories bucket and summarize them.
#
#   scripts/diag/pull.sh                      today and yesterday (UTC), every session
#   scripts/diag/pull.sh 2026-11-12           one UTC date
#   scripts/diag/pull.sh 2026-11-12 k3x9qm2p7a  one session (spaces in the id are fine: "k3x9q m2p7a")
#
# Dates are UTC (the server files by UTC date): a Central-time evening session
# lands on the next day, which is why the default looks at two days.
# The server writes each session's file at most every 15 s; wait that long after
# taking the headset off. Files are copied to .data/diag-pull/ (not committed).
set -euo pipefail
cd "$(dirname "$0")/../.."

PROJECT=quick-catcher-470218-b0
BUCKET=gs://$PROJECT-shadowplay-stories
OUT=.data/diag-pull

if [[ $# -ge 1 ]]; then
  dates=("$1")
else
  dates=("$(date -u +%Y-%m-%d)" "$(date -u -v-1d +%Y-%m-%d 2>/dev/null || date -u -d yesterday +%Y-%m-%d)")
fi
session="${2:-}"
session="${session// /}"

files=()
for d in "${dates[@]}"; do
  mkdir -p "$OUT/$d"
  pattern="$BUCKET/diag/$d/${session:-*}.jsonl"
  if gcloud storage ls "$pattern" --project "$PROJECT" >/dev/null 2>&1; then
    gcloud storage cp "$pattern" "$OUT/$d/" --project "$PROJECT" --quiet >/dev/null 2>&1
    while IFS= read -r f; do files+=("$f"); done < <(ls "$OUT/$d/"${session:-*}.jsonl 2>/dev/null)
  fi
done

if [[ ${#files[@]} -eq 0 ]]; then
  echo "No diagnostics for ${session:-any session} on ${dates[*]} (UTC). Was the page opened with ?diag, and was it 15 s ago?" >&2
  exit 1
fi
echo "${#files[@]} session file(s) in $OUT"
node scripts/diag/summarize.mjs "${files[@]}"
