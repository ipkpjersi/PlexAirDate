#!/usr/bin/env bash
# Probe Jikan's rate limit via curl. Node's fetch (undici) gets 504'd by
# Jikan's Cloudflare on a TLS/HTTP2 fingerprint check before the rate limiter
# is even reached, so it cannot measure the limit; curl's fingerprint passes,
# same as a real browser. Bursts until the first 429, then polls recovery.
#
# Usage: scripts/probe-jikan-curl.sh [max_burst] [poll_seconds] [recovery_seconds]

set -u
MAX=${1:-100}
POLL=${2:-3}
RECOVERY=${3:-90}
TITLES=(naruto bleach "one piece" steins gate "death note" berserk frieren monster gintama)
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36"

req() {
  # Prints the HTTP status code for one search request.
  local q="$1"
  curl -s -o /dev/null -w "%{http_code}" -A "$UA" \
    --get "https://api.jikan.moe/v4/anime" --data-urlencode "q=${q}" --data-urlencode "limit=5"
}

echo "=== Jikan via curl (burst up to ${MAX}, poll ${POLL}s, recovery ${RECOVERY}s) ==="
start=$(date +%s.%N)
ok=0
limited=0
for ((i=1; i<=MAX; i++)); do
  code=$(req "${TITLES[$((i % ${#TITLES[@]}))]}")
  if [[ "$code" == "429" ]]; then
    elapsed=$(echo "$(date +%s.%N) - $start" | bc)
    printf "  req %d: 429 RATE LIMITED after %d ok in %.1fs\n" "$i" "$ok" "$elapsed"
    limited=1
    break
  fi
  if [[ "$code" == "200" ]]; then
    ok=$((ok+1))
  else
    echo "  req $i: HTTP $code"
  fi
done

if [[ "$limited" == "0" ]]; then
  elapsed=$(echo "$(date +%s.%N) - $start" | bc)
  printf "  no 429 in %d requests (%d ok in %.1fs) -> raise max to reach the limit\n" "$MAX" "$ok" "$elapsed"
  exit 0
fi

echo "  recovering: probing every ${POLL}s (only a 200 counts)..."
rstart=$(date +%s.%N)
while :; do
  now=$(echo "$(date +%s.%N) - $rstart" | bc)
  done=$(echo "$now > $RECOVERY" | bc)
  [[ "$done" == "1" ]] && { echo "  did NOT recover within ${RECOVERY}s"; break; }
  sleep "$POLL"
  code=$(req "${TITLES[0]}")
  el=$(echo "$(date +%s.%N) - $rstart" | bc)
  if [[ "$code" == "200" ]]; then
    printf "  +%.1fs: 200 -> recovered\n" "$el"
    break
  fi
  printf "  +%.1fs: HTTP %s\n" "$el" "$code"
done
