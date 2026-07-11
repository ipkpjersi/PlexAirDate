#!/usr/bin/env node
// Empirically probe the AniList and Jikan (MyAnimeList) rate limits that
// PlexAirDate relies on, so the extension's retry/backoff constants can be
// tuned from real numbers instead of guesses.
//
// For each API it runs two phases:
//   1. Burst   - fire the same request the extension makes, as fast as the
//                --gap allows, counting successes until the first 429. Records
//                how many requests / how long it took and any rate-limit headers.
//   2. Recovery- after the first 429, send a single probe every --poll seconds
//                until one succeeds, measuring how long the limit takes to reset.
//
// Usage:
//   node scripts/probe-rate-limits.mjs [--api anilist|jikan|both]
//                                      [--gap <ms>]      burst spacing (default 0 = full burst)
//                                      [--max <n>]       burst safety cap (default 200)
//                                      [--poll <s>]      recovery poll interval (default 10)
//                                      [--recovery <s>]  recovery timeout (default 180)
//
// Only hits public read endpoints; deliberately trips the limit, so run it
// sparingly and not while you actually need the APIs.

const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] !== undefined ? args[i + 1] : fallback;
}

const API = flag("api", "both");
const GAP_MS = Number(flag("gap", "0"));
const MAX_BURST = Number(flag("max", "200"));
const POLL_S = Number(flag("poll", "10"));
const RECOVERY_S = Number(flag("recovery", "180"));

// Send a real browser User-Agent: the extension runs in the browser, and Jikan
// sits behind Cloudflare which can 504/block a bare "node" UA - probing without
// this misreads a UA block as a rate limit.
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();
const secs = (ms) => (ms / 1000).toFixed(1);

// A spread of real titles so a search cache can't mask the limit.
const TITLES = [
  "Naruto", "Bleach", "One Piece", "Steins;Gate", "Death Note",
  "Attack on Titan", "Cowboy Bebop", "Fullmetal Alchemist", "Monster",
  "Vinland Saga", "Frieren", "Mushishi", "Hunter x Hunter", "Berserk",
  "Gintama", "Clannad", "Bakemonogatari", "Nichijou", "K-On!", "Umaru-chan"
];

// Rate-limit headers worth watching for each API.
const HEADER_KEYS = [
  "retry-after",
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
  "x-ratelimit-reset-after"
];

function pickHeaders(response) {
  const out = {};
  for (const key of HEADER_KEYS) {
    const value = response.headers.get(key);
    if (value !== null) {
      out[key] = value;
    }
  }
  return out;
}

// One request in the shape the extension actually sends.
async function anilistRequest(title) {
  const query = `
    query PlexAirDate($search: String) {
      Media(search: $search, type: ANIME) {
        id idMal averageScore synonyms
        title { english native romaji }
        nextAiringEpisode { airingAt episode }
      }
    }`;
  return fetch("https://graphql.anilist.co/", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": USER_AGENT
    },
    body: JSON.stringify({ query, variables: { search: title } })
  });
}

async function jikanRequest(title) {
  const params = new URLSearchParams({ q: title, limit: "5" });
  return fetch(`https://api.jikan.moe/v4/anime?${params.toString()}`, {
    headers: { "User-Agent": USER_AGENT }
  });
}

const APIS = {
  anilist: { label: "AniList (graphql.anilist.co)", request: anilistRequest },
  jikan: { label: "Jikan / MyAnimeList (api.jikan.moe)", request: jikanRequest }
};

async function probe(key) {
  const { label, request } = APIS[key];
  console.log(`\n=== ${label} ===`);
  console.log(`burst gap: ${GAP_MS}ms | cap: ${MAX_BURST} | poll: ${POLL_S}s | recovery timeout: ${RECOVERY_S}s`);

  // --- Burst phase ---
  const startedAt = now();
  let successes = 0;
  let firstLimitAt = 0;
  let limitHeaders = null;
  let lastHeaders = null;

  for (let i = 0; i < MAX_BURST; i++) {
    const title = TITLES[i % TITLES.length];
    let response;
    try {
      response = await request(title);
    } catch (error) {
      console.log(`  req ${i + 1}: network error (${error.message})`);
      if (GAP_MS > 0) await sleep(GAP_MS);
      continue;
    }

    const headers = pickHeaders(response);
    lastHeaders = headers;

    if (response.status === 429) {
      firstLimitAt = now();
      limitHeaders = headers;
      console.log(
        `  req ${i + 1}: 429 RATE LIMITED after ${successes} ok in ${secs(firstLimitAt - startedAt)}s`
      );
      console.log(`  limit headers: ${JSON.stringify(headers)}`);
      break;
    }

    // Drain the body so the socket frees up; ignore the parsed value.
    await response.text().catch(() => {});

    if (response.ok) {
      successes++;
      const remaining = headers["x-ratelimit-remaining"];
      const suffix = remaining !== undefined ? ` (remaining: ${remaining})` : "";
      if (i < 3 || remaining !== undefined) {
        console.log(`  req ${i + 1}: ${response.status} ok${suffix}`);
      }
    } else {
      console.log(`  req ${i + 1}: ${response.status} (headers: ${JSON.stringify(headers)})`);
    }

    if (GAP_MS > 0) await sleep(GAP_MS);
  }

  if (!firstLimitAt) {
    console.log(
      `  no 429 in ${MAX_BURST} requests (${successes} ok in ${secs(now() - startedAt)}s).` +
        ` Last headers: ${JSON.stringify(lastHeaders)}`
    );
    console.log("  -> raise --max or lower --gap to actually reach the limit.");
    return { key, label, limited: false, successes };
  }

  const retryAfter = Number(limitHeaders["retry-after"]);
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    console.log(`  server says Retry-After: ${retryAfter}s`);
  }

  // --- Recovery phase: poll until a request actually succeeds (2xx) again.
  // Only a 2xx counts as recovered; 429 means still limited and 5xx is a
  // transient gateway hiccup (Jikan does this under load) - both keep polling.
  console.log(`  recovering: probing every ${POLL_S}s (only a 2xx counts)...`);
  const recoverStart = now();
  let recovered = 0;
  let lastStatus = 429;
  while (now() - recoverStart < RECOVERY_S * 1000) {
    await sleep(POLL_S * 1000);
    const elapsed = secs(now() - recoverStart);
    let response;
    try {
      response = await request(TITLES[0]);
    } catch (error) {
      console.log(`  +${elapsed}s: network error (${error.message})`);
      continue;
    }
    await response.text().catch(() => {});
    lastStatus = response.status;
    if (response.ok) {
      recovered = now() - recoverStart;
      console.log(`  +${elapsed}s: ${response.status} ok -> recovered`);
      break;
    }
    const kind = response.status === 429 ? "still 429" : `${response.status} (transient, still waiting)`;
    console.log(`  +${elapsed}s: ${kind}`);
  }

  if (!recovered) {
    console.log(
      `  did NOT recover within ${RECOVERY_S}s (last status ${lastStatus}) -> reset window is longer than that.`
    );
  }

  return {
    key,
    label,
    limited: true,
    successes,
    burstMs: firstLimitAt - startedAt,
    retryAfter: Number.isFinite(retryAfter) ? retryAfter : null,
    recoveryMs: recovered || null
  };
}

async function main() {
  const keys = API === "both" ? ["anilist", "jikan"] : [API];
  for (const key of keys) {
    if (!APIS[key]) {
      console.error(`unknown api "${key}" (expected anilist, jikan, or both)`);
      process.exit(1);
    }
  }

  const results = [];
  for (const key of keys) {
    results.push(await probe(key));
  }

  console.log("\n=== SUMMARY ===");
  for (const r of results) {
    if (!r.limited) {
      console.log(`${r.label}: no limit hit in ${r.successes} requests.`);
      continue;
    }
    const rate = (r.successes / (r.burstMs / 1000)).toFixed(1);
    const parts = [
      `${r.successes} ok before 429 (~${rate} req/s over ${secs(r.burstMs)}s)`,
      r.retryAfter !== null ? `Retry-After ${r.retryAfter}s` : "no Retry-After header",
      r.recoveryMs ? `recovered after ~${secs(r.recoveryMs)}s` : `no recovery in ${RECOVERY_S}s`
    ];
    console.log(`${r.label}:\n  ${parts.join("\n  ")}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
