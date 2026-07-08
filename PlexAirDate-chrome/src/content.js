(() => {
  const ROW_ID = "plex-air-date-row";
  const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
  // A lookup whose AniList/MAL half hit a rate limit or transport error is cached only this
  // long (not the full TTL) so a transient failure does not hide scores for hours; the next
  // page view retries it.
  const NEGATIVE_CACHE_TTL_MS = 2 * 60 * 1000;
  const cache = new Map();
  // Resolved AniList "season N -> MAL entry" lookups (each anime season is its own MAL entry).
  const seasonEntryCache = new Map();

  let pendingRender = 0;
  let lastPageKey = "";

  const monthDayYearFormatter = new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric"
  });

  const timeFormatter = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit"
  });

  function isLikelyPlexPage() {
    return Boolean(
      document.querySelector('[data-testid="metadata"]') ||
        document.querySelector('[data-testid="metadata-title"]') ||
        document.querySelector('[data-testid="preplay-play"]')
    );
  }

  function normalizeTitle(title) {
    return title
      .replace(/\s*\([^)]*\)\s*$/u, "")
      .replace(/\s+/gu, " ")
      .trim();
  }

  function canonicalTitle(title) {
    return normalizeTitle(title)
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/gu, "")
      .replace(/&/gu, " and ")
      .replace(/[^a-z0-9]+/gu, " ")
      .replace(/\bthe\b/gu, "")
      .replace(/\s+/gu, " ")
      .trim();
  }

  function isProbableTitleMatch(sourceTitle, candidateTitle, score = 1) {
    const source = canonicalTitle(sourceTitle);
    const candidate = canonicalTitle(candidateTitle);

    if (!source || !candidate) {
      return false;
    }

    return (
      source === candidate ||
      (score >= 0.7 && (source.includes(candidate) || candidate.includes(source)))
    );
  }

  function getMetadataContext() {
    const titleNode = document.querySelector('[data-testid="metadata-title"]');
    if (!titleNode) {
      return null;
    }

    const title = normalizeTitle(titleNode.textContent || "");
    if (!title) {
      return null;
    }

    const line1Node = document.querySelector('[data-testid="metadata-line1"]');
    const line2Node = document.querySelector('[data-testid="metadata-line2"]');

    if (line1Node) {
      const line1 = line1Node.textContent || "";
      const seasonMatch = line1.match(/Season\s+(\d+)/iu);
      const episodeMatch = line1.match(/Episode\s+(\d+)/iu);

      // Episode pages put "Season X ... Episode Y" in line1 and expose line2 as the anchor.
      if (seasonMatch && episodeMatch && line2Node) {
        return {
          title,
          type: "episode",
          season: Number.parseInt(seasonMatch[1], 10),
          episode: Number.parseInt(episodeMatch[1], 10),
          anchorNode: line2Node,
          pageKey: `${title}|episode|${seasonMatch[1]}|${episodeMatch[1]}|${location.href}`
        };
      }

      // Show pages no longer have a line2, and line1 now holds the content rating, year, and
      // genres rather than a lone year. Detect them by their Seasons/Episodes hub or a TV-show
      // genre link, and append our row below the whole metadata block (there is no line2 to
      // anchor after).
      if (!seasonMatch && isShowTitlePage(line1Node)) {
        return {
          title,
          type: "show",
          season: null,
          episode: null,
          anchorNode: line1Node,
          appendParent: titleNode.closest("div")?.parentElement || null,
          pageKey: `${title}|show|${location.href}`
        };
      }
    }

    // Season pages have no line1/line2; the season number lives in the subtitle.
    const subtitleNode = document.querySelector('[data-testid="metadata-subtitle"]');
    if (subtitleNode) {
      const seasonMatch = (subtitleNode.textContent || "").match(/Season\s+(\d+)/iu);
      if (seasonMatch) {
        return {
          title,
          type: "season",
          season: Number.parseInt(seasonMatch[1], 10),
          episode: null,
          anchorNode: subtitleNode,
          pageKey: `${title}|season|${seasonMatch[1]}|${location.href}`
        };
      }
    }

    return null;
  }

  function isShowTitlePage(line1Node) {
    // A Seasons/Episodes hub, or a genre link carrying the library type "2" (a TV show; movies
    // are type 1), marks a show page. Both distinguish a show from a movie, which a bare year
    // in line1 cannot.
    const hasSeasonsHub = Array.from(document.querySelectorAll('[data-testid="hubTitle"]')).some(
      (node) => /^(?:Seasons|Episodes)$/u.test((node.textContent || "").trim())
    );
    const hasShowTypeLink = Boolean(
      line1Node?.querySelector('a[href*="type%3D2"], a[href*="type=2"]')
    );

    return hasSeasonsHub || hasShowTypeLink;
  }

  function getInsertionParent(anchorNode) {
    return anchorNode.closest("div")?.parentElement || null;
  }

  function removeRow() {
    document.getElementById(ROW_ID)?.remove();
  }

  function ensureRow(context) {
    const parent = getInsertionParent(context.anchorNode);
    if (!parent && !context.appendParent) {
      return null;
    }

    let row = document.getElementById(ROW_ID);
    if (!row) {
      row = document.createElement("div");
      row.id = ROW_ID;
      row.className = "plex-air-date-row";
      row.dataset.state = "loading";

      const anchorWrapper = context.anchorNode.closest("div");
      if (context.appendParent) {
        // Show pages have no line2 to anchor after, so append below the metadata block.
        context.appendParent.append(row);
      } else if (anchorWrapper) {
        anchorWrapper.insertAdjacentElement("afterend", row);
      } else {
        parent.append(row);
      }
    }

    return row;
  }

  function setRow(row, data) {
    const source = data.source ? ` ${data.source}` : "";
    row.dataset.state = "ready";
    row.innerHTML = "";

    const titleParts = [];

    if (data.seasonAired) {
      // On a season page, the first line is just the year the season aired.
      const yearText = String(data.seasonAired.airDate.getFullYear());
      const yearNode = document.createElement("span");
      yearNode.className = "plex-air-date-text";
      yearNode.textContent = yearText;
      row.append(yearNode);
      titleParts.push(yearText);
    }

    if (data.current) {
      const text = formatEpisode(data.current, airVerb(data.current.airDate));
      row.append(buildPill("Current episode", text, source));
      titleParts.push(`Current episode: ${text}`);
    }

    if (data.latest) {
      const text = formatEpisode(data.latest, airVerb(data.latest.airDate));
      row.append(buildPill("Latest episode", text, source));
      titleParts.push(`Latest episode: ${text}`);
    }

    if (data.next) {
      const text = formatEpisode(data.next, "airs");
      row.append(buildPill("Next episode", text, source));
      titleParts.push(`Next episode: ${text}`);
    }

    if (data.rating) {
      // Anime score (MAL, with AniList and then TVmaze as fallbacks), shown below the airing
      // info. Plex already displays IMDb/TMDB scores elsewhere, so we only add a rating for anime.
      row.append(buildRatingLine(data.rating));
      titleParts.push(`${data.rating.source}: ${formatRating(data.rating)}`);
    }

    if (data.episodeRating) {
      // MAL per-episode poll score (converted to /10), tagged "EP" to set it apart from the
      // series score above.
      row.append(buildRatingLine(data.episodeRating, "EP"));
      titleParts.push(`${data.episodeRating.source} episode: ${formatRating(data.episodeRating)}`);
    }

    row.title = `${titleParts.join(" | ")}${source}`;
  }

  function buildPill(labelText, valueText, source) {
    const pill = document.createElement("span");
    pill.className = "plex-air-date-pill";

    const label = document.createElement("span");
    label.className = "plex-air-date-label";
    label.textContent = labelText;

    const text = document.createElement("span");
    text.className = "plex-air-date-text";
    text.textContent = valueText;

    const sourceNode = document.createElement("span");
    sourceNode.className = "plex-air-date-source";
    sourceNode.textContent = source;

    pill.append(label, text, sourceNode);
    return pill;
  }

  function buildRatingLine(rating, tag) {
    // The anime score line: the MAL logo (or the source name for the AniList/TVmaze fallbacks)
    // followed by the score, all in white so it reads as its own distinct line. An optional
    // tag (e.g. "EP") distinguishes the per-episode score from the series score.
    const line = document.createElement("span");
    line.className = "plex-air-date-rating";
    line.title = `${rating.source}${tag ? " episode" : ""} score ${formatRating(rating)}`;

    if (rating.source === "MAL") {
      const icon = document.createElement("span");
      icon.className = "plex-air-date-rating-icon";
      icon.setAttribute("aria-hidden", "true");
      line.append(icon);
    } else {
      const name = document.createElement("span");
      name.className = "plex-air-date-rating-name";
      name.textContent = rating.source;
      line.append(name);
    }

    if (tag) {
      const tagNode = document.createElement("span");
      tagNode.className = "plex-air-date-rating-tag";
      tagNode.textContent = tag;
      line.append(tagNode);
    }

    const score = document.createElement("span");
    score.className = "plex-air-date-rating-score";
    score.textContent = formatScore(rating);
    line.append(score);

    return line;
  }

  function airVerb(date) {
    return date > new Date() ? "airs" : "aired";
  }

  function formatEpisode(episode, verb) {
    const parts = [];
    if (episode.season && episode.episode) {
      parts.push(`S${episode.season} E${episode.episode}`);
    } else if (episode.episode) {
      parts.push(`Episode ${episode.episode}`);
    }

    parts.push(`${verb} ${formatAirDate(episode.airDate)}`);
    return parts.join(" ");
  }

  function formatScore(rating) {
    return rating.score.toFixed(2);
  }

  function formatRating(rating) {
    return `${formatScore(rating)} / ${rating.max}`;
  }

  function formatAirDate(date) {
    const dateText = monthDayYearFormatter.format(date);

    if (date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0) {
      return dateText;
    }

    return `${dateText} at ${timeFormatter.format(date)}`;
  }

  function getCached(key) {
    if (!cache.has(key)) {
      return null;
    }

    const cached = cache.get(key);
    if (Date.now() - cached.createdAt > cached.ttl) {
      cache.delete(key);
      return null;
    }

    return {
      hit: true,
      value: cached.value
    };
  }

  function setCached(key, value, ttl = CACHE_TTL_MS) {
    cache.set(key, {
      createdAt: Date.now(),
      ttl,
      value
    });
  }

  async function fetchAirInfo(context) {
    const cacheKey = `${context.title.toLowerCase()}|${context.type}|${context.season ?? ""}|${context.episode ?? ""}`;
    const cached = getCached(cacheKey);
    if (cached?.hit) {
      return cached.value;
    }

    // Query both sources together: TVmaze has the better season/episode air-date structure,
    // while AniList both detects anime (it only lists anime) and carries the MAL score.
    const [tvmaze, anilist] = await Promise.all([
      fetchFromTvmaze(context).catch(() => null),
      fetchFromAniList(context).catch(() => ({ failed: true }))
    ]);

    // AniList may return only a { failed: true } marker (a rate-limited search that produced no
    // data); treat that as "no AniList result" when merging, but remember it for the TTL below.
    const anilistData = anilist?.source ? anilist : null;
    const result = tvmaze || anilistData;

    // Resolve the anime score with independent fallbacks so no single API is a point of failure:
    //   1. AniList lookup (MAL score via its idMal, or AniList's own averageScore) - the best
    //      source because it resolves the exact per-season entry.
    //   2. A direct MAL/Jikan lookup by title - independent of AniList, so it still yields a real
    //      MAL score when AniList is rate limited (AniList otherwise supplies the MAL id).
    //   3. TVmaze's own rating.average (already on the result) as a last resort.
    let failed = Boolean(anilist?.failed);
    if (result) {
      if (anilist?.rating) {
        // An AniList match means the title is anime, so prefer its MAL score (or AniList's own
        // averageScore) even when the air dates themselves came from TVmaze.
        result.rating = anilist.rating;
      } else if (anilist === null) {
        // AniList responded and the title is not anime, so drop TVmaze's general rating and stay
        // anime-only (Plex already shows IMDb/TMDB scores for non-anime).
        result.rating = null;
      } else {
        // AniList matched the title as anime but had no score, or AniList was unavailable (rate
        // limited, so we never got the idMal or averageScore). Try MAL directly by title before
        // settling for the TVmaze rating already on the result.
        const direct = await fetchMalByTitle(context).catch(() => null);
        if (direct?.rating) {
          result.rating = direct.rating;
          failed = false;
        } else if (direct?.failed) {
          failed = true;
        }
        if (!result.episodeRating && direct?.episodeRating) {
          result.episodeRating = direct.episodeRating;
        }
      }
    }
    if (result && anilist?.episodeRating) {
      result.episodeRating = anilist.episodeRating;
    }

    // Cache a lookup whose score sources all hit a rate limit only briefly, so a transient failure
    // does not hide the score for the full TTL; a lookup that produced a real score (or positively
    // ruled out anime) caches for the full TTL.
    setCached(cacheKey, result, failed ? NEGATIVE_CACHE_TTL_MS : CACHE_TTL_MS);
    return result;
  }

  async function fetchFromTvmaze(context) {
    const params = new URLSearchParams({ q: context.title });
    const response = await fetch(`https://api.tvmaze.com/search/shows?${params.toString()}`, {
      credentials: "omit"
    });

    if (!response.ok) {
      return null;
    }

    const matches = await response.json();
    const match = matches.find((item) => isProbableTitleMatch(context.title, item?.show?.name || "", item?.score || 0));
    const show = match?.show;
    if (!show?.id) {
      return null;
    }

    const detailResponse = await fetch(
      `https://api.tvmaze.com/shows/${show.id}?embed[]=nextepisode&embed[]=previousepisode`,
      {
        credentials: "omit"
      }
    );
    if (!detailResponse.ok) {
      return null;
    }

    const showWithEpisodes = await detailResponse.json();
    const embedded = showWithEpisodes?._embedded;
    const now = new Date();

    // TVmaze's own average rating (already on a 0-10 scale) is kept as a last-resort score,
    // used only when the anime's MAL/AniList score is unavailable (see fetchAirInfo). null
    // means the show has no rating yet.
    const tvmazeAverage = showWithEpisodes?.rating?.average;
    const rating =
      typeof tvmazeAverage === "number" && tvmazeAverage > 0
        ? { score: tvmazeAverage, max: 10, source: "TVmaze" }
        : null;

    const next = toTvmazeEpisode(embedded?.nextepisode);
    const nextEpisode = next && next.airDate > now ? next : null;

    // The most recently aired episode of the whole show, shown on every page type.
    const previous = toTvmazeEpisode(embedded?.previousepisode);
    const latestEpisode = previous && previous.airDate <= now ? previous : null;

    let currentEpisode = null;
    if (context.type === "episode" && context.season && context.episode) {
      // On an episode page, show the air date of the specific episode being viewed.
      currentEpisode = await fetchTvmazeEpisodeByNumber(show.id, context.season, context.episode).catch(() => null);
    }

    let seasonAired = null;
    if (context.type === "season" && context.season) {
      // On a season page, show when that season premiered.
      seasonAired = await fetchTvmazeSeasonPremiere(show.id, context.season).catch(() => null);
    }

    if (!nextEpisode && !latestEpisode && !currentEpisode && !seasonAired) {
      return null;
    }

    return {
      source: "TVmaze",
      rating,
      current: currentEpisode,
      latest: latestEpisode,
      next: nextEpisode,
      seasonAired
    };
  }

  async function fetchTvmazeSeasonPremiere(showId, season) {
    const response = await fetch(`https://api.tvmaze.com/shows/${showId}/seasons`, {
      credentials: "omit"
    });
    if (!response.ok) {
      return null;
    }

    const seasons = await response.json();
    const match = Array.isArray(seasons) ? seasons.find((item) => item?.number === season) : null;
    const airDate = parseDateOnly(match?.premiereDate);
    if (!airDate) {
      return null;
    }

    return {
      airDate,
      season,
      episode: null
    };
  }

  async function fetchTvmazeEpisodeByNumber(showId, season, episode) {
    const params = new URLSearchParams({ season: String(season), number: String(episode) });
    const response = await fetch(`https://api.tvmaze.com/shows/${showId}/episodebynumber?${params.toString()}`, {
      credentials: "omit"
    });
    if (!response.ok) {
      return null;
    }

    return toTvmazeEpisode(await response.json());
  }

  function toTvmazeEpisode(episode) {
    if (!episode) {
      return null;
    }

    const airDate = episode.airstamp ? parseAirDate(episode.airstamp) : parseDateOnly(episode.airdate);
    if (!airDate) {
      return null;
    }

    return {
      airDate,
      episode: episode.number || null,
      season: episode.season || null
    };
  }

  async function fetchFromAniList(context) {
    const query = `
      query PlexAirDate($search: String) {
        Media(search: $search, type: ANIME) {
          id
          idMal
          averageScore
          synonyms
          title {
            english
            native
            romaji
          }
          nextAiringEpisode {
            airingAt
            episode
          }
        }
      }
    `;

    // Any AniList/MAL request that throws (a rate limit or transport error, via the guard below)
    // flips this flag, so the caller can cache the lookup only briefly and retry it soon.
    const state = { failed: false };
    const guard = (promise) =>
      promise.catch(() => {
        state.failed = true;
        return null;
      });

    let payload;
    try {
      payload = await postAniList(query, { search: context.title });
    } catch (error) {
      // A rate-limited/failed search means we could not detect anime or read a score at all;
      // signal the failure so this lookup is cached only briefly rather than as "no score".
      return { failed: true };
    }

    const media = payload?.data?.Media;
    const titles = [
      media?.title?.english,
      media?.title?.romaji,
      media?.title?.native,
      ...(media?.synonyms || [])
    ].filter(Boolean);

    if (!media || !titles.some((title) => isProbableTitleMatch(context.title, title))) {
      return null;
    }

    // Resolve the MAL entry for the Plex season being viewed. Plex numbers episodes per season,
    // but each anime season is its own MAL entry numbered from episode 1, so season and episode
    // pages past season 1 walk the AniList sequel chain to the right entry and use it for both
    // the series score and the per-episode score; show pages and season 1 use the searched entry.
    let seasonMedia = media;
    if (
      media.id &&
      context.season &&
      context.season > 1 &&
      (context.type === "episode" || context.type === "season")
    ) {
      const resolved = await guard(resolveSeasonMedia(media, context.season));
      if (resolved) {
        seasonMedia = resolved;
      }
    }

    const now = new Date();

    const next = media?.nextAiringEpisode;
    const nextAirDate = next?.airingAt ? new Date(next.airingAt * 1000) : null;
    const nextEpisode =
      nextAirDate && nextAirDate > now ? { airDate: nextAirDate, episode: next.episode || null, season: null } : null;

    let currentEpisode = null;
    let latestEpisode = null;
    if (seasonMedia?.id) {
      if (context.type === "episode" && context.episode) {
        // On an episode page, show the air date of the specific episode being viewed.
        currentEpisode = await guard(fetchAniListEpisode(seasonMedia.id, context.episode));
      }
      // The most recently aired episode of the resolved season, shown on every page type.
      latestEpisode = await guard(fetchAniListLastAired(seasonMedia.id));
    }

    // Prefer the real MAL score (via Jikan) for the resolved season; fall back to AniList's own
    // averageScore for that same season.
    let rating = null;
    if (seasonMedia?.idMal) {
      rating = await guard(fetchMalScore(seasonMedia.idMal));
    }
    if (!rating && typeof seasonMedia?.averageScore === "number") {
      rating = { score: seasonMedia.averageScore / 10, max: 10, source: "AniList" };
    }

    // MAL per-episode poll score, on episode pages, from the resolved season entry.
    let episodeRating = null;
    if (context.type === "episode" && context.episode && seasonMedia?.idMal) {
      // Skip if the episode number does not fit the resolved entry (a sign the season chain
      // did not line up), so we do not show a mismatched score.
      const fitsEntry = !seasonMedia?.episodes || context.episode <= seasonMedia.episodes;
      if (fitsEntry) {
        episodeRating = await guard(fetchMalEpisodeScore(seasonMedia.idMal, context.episode));
      }
    }

    if (!nextEpisode && !latestEpisode && !currentEpisode && !rating && !episodeRating) {
      return state.failed ? { failed: true } : null;
    }

    return {
      source: "AniList",
      rating,
      episodeRating,
      current: currentEpisode,
      latest: latestEpisode,
      next: nextEpisode,
      seasonAired: null,
      failed: state.failed
    };
  }

  // Jikan (the unofficial MyAnimeList API) rate-limits aggressively (about 3 requests/second
  // and 60/minute) and intermittently returns 429/5xx. Serialize its requests behind a shared
  // queue spaced at least JIKAN_MIN_GAP_MS apart so back-to-back calls do not trip the limit,
  // and retry transient failures so a single hiccup does not silently demote a real MAL score
  // to the AniList fallback. The 3/second limit is a ~333ms floor, so 350ms keeps us just under
  // it while adding as little first-render latency as possible; the retry/backoff covers the
  // occasional 429 that still slips through.
  const JIKAN_MIN_GAP_MS = 350;
  const JIKAN_MAX_ATTEMPTS = 3;
  const JIKAN_RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
  let jikanQueue = Promise.resolve();
  let jikanLastRequestAt = 0;

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function fetchJikan(url) {
    // Chain onto the previous call so only one Jikan request is in flight at a time.
    const run = jikanQueue.then(async () => {
      for (let attempt = 1; attempt <= JIKAN_MAX_ATTEMPTS; attempt++) {
        const wait = jikanLastRequestAt + JIKAN_MIN_GAP_MS - Date.now();
        if (wait > 0) {
          await sleep(wait);
        }

        let response;
        try {
          response = await fetch(url, { credentials: "omit" });
        } catch (error) {
          // Network error: retry with a growing backoff unless this was the last attempt.
          jikanLastRequestAt = Date.now();
          if (attempt === JIKAN_MAX_ATTEMPTS) {
            throw error;
          }
          await sleep(JIKAN_MIN_GAP_MS * attempt);
          continue;
        }
        jikanLastRequestAt = Date.now();

        // Retry rate-limit and transient server errors; return anything else as-is (e.g. a
        // 404, or a success) for the caller to handle.
        if (response.ok || !JIKAN_RETRY_STATUSES.has(response.status) || attempt === JIKAN_MAX_ATTEMPTS) {
          return response;
        }

        // Honour a Retry-After header when present, otherwise back off by the attempt count.
        const retryAfter = Number.parseFloat(response.headers.get("Retry-After") || "");
        const backoff =
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : JIKAN_MIN_GAP_MS * attempt;
        await sleep(backoff);
      }

      // The loop always returns or throws above; this satisfies the return-a-Response contract.
      return fetch(url, { credentials: "omit" });
    });

    // Keep the queue chain alive even if this request rejects, so later calls still run.
    jikanQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  async function fetchMalScore(idMal) {
    // Jikan is the unofficial MyAnimeList API; data.score is MAL's rating on a 0-10 scale.
    const response = await fetchJikan(`https://api.jikan.moe/v4/anime/${idMal}`);
    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    const score = payload?.data?.score;
    // Jikan returns 0 (not null) for an anime with no score yet, so treat 0 as "no score"
    // and let the caller fall back to the AniList average.
    return typeof score === "number" && score > 0 ? { score, max: 10, source: "MAL" } : null;
  }

  async function fetchMalByTitle(context) {
    // A direct MAL lookup by title via Jikan, independent of AniList. AniList normally supplies the
    // MAL id (and the score routes through it), so an AniList rate limit takes out the MAL score
    // too; this path restores a real MAL score without touching AniList. Jikan lists only anime, so
    // a confident title match also confirms the title is anime. It resolves only the searched (base)
    // entry, which is the right one for show pages and first seasons; later seasons need MAL's
    // per-season entries and are left to the AniList season walk (with the TVmaze rating beneath).
    if (context.season && context.season > 1 && context.type !== "show") {
      return null;
    }

    const params = new URLSearchParams({ q: context.title, limit: "8" });
    let response;
    try {
      response = await fetchJikan(`https://api.jikan.moe/v4/anime?${params.toString()}`);
    } catch (error) {
      // A network error after retries: signal a transient failure so the caller caches briefly.
      return { failed: true };
    }
    if (!response.ok) {
      // A rate-limit/server error (429/5xx) is transient; a plain miss (e.g. 404) is not.
      return JIKAN_RETRY_STATUSES.has(response.status) ? { failed: true } : null;
    }

    const payload = await response.json();
    const list = Array.isArray(payload?.data) ? payload.data : [];
    const match = list.find((item) => {
      const titles = [
        item?.title,
        item?.title_english,
        item?.title_japanese,
        ...(item?.titles || []).map((entry) => entry?.title)
      ].filter(Boolean);
      return titles.some((title) => isProbableTitleMatch(context.title, title));
    });
    if (!match?.mal_id) {
      return null;
    }

    // Jikan returns 0 (not null) for an anime with no score yet, so treat 0 as "no score".
    const rating =
      typeof match.score === "number" && match.score > 0 ? { score: match.score, max: 10, source: "MAL" } : null;

    let episodeRating = null;
    if (context.type === "episode" && context.episode) {
      // Skip if the episode number does not fit the entry, so we do not show a mismatched score.
      const fitsEntry = !match.episodes || context.episode <= match.episodes;
      if (fitsEntry) {
        episodeRating = await fetchMalEpisodeScore(match.mal_id, context.episode).catch(() => null);
      }
    }

    if (!rating && !episodeRating) {
      return null;
    }

    return { rating, episodeRating };
  }

  async function fetchMalEpisodeScore(idMal, episode) {
    // Per-episode poll scores only exist in the episodes LIST endpoint (100 per page) as a
    // nullable 1.00-5.00 average, so fetch the page the episode falls on and match by number.
    const page = Math.floor((episode - 1) / 100) + 1;
    const params = new URLSearchParams({ page: String(page) });
    const response = await fetchJikan(`https://api.jikan.moe/v4/anime/${idMal}/episodes?${params.toString()}`);
    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    const list = Array.isArray(payload?.data) ? payload.data : [];
    const score = list.find((item) => item?.mal_id === episode)?.score;
    // Convert the 1-5 poll average to a /10 score (score / 5 * 10); null/0 means no votes.
    return typeof score === "number" && score > 0
      ? { score: (score / 5) * 10, max: 10, source: "MAL", perEpisode: true }
      : null;
  }

  // AniList's GraphQL API rate-limits (currently about 30 requests/minute, returning 429 with a
  // Retry-After). Serialize requests through a shared queue so navigating quickly does not fire a
  // burst, and retry a transient 429/5xx once with a bounded backoff. Unlike Jikan there is no
  // base gap: a single page's AniList calls are already awaited in sequence, so adding a gap would
  // only slow the first render without meaningfully helping the per-minute budget.
  const ANILIST_MAX_ATTEMPTS = 2;
  const ANILIST_MAX_BACKOFF_MS = 1500;
  const ANILIST_RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
  let aniListQueue = Promise.resolve();

  function aniListFetch(url, options) {
    // Chain onto the previous call so only one AniList request is in flight at a time.
    const run = aniListQueue.then(async () => {
      for (let attempt = 1; attempt <= ANILIST_MAX_ATTEMPTS; attempt++) {
        let response;
        try {
          response = await fetch(url, options);
        } catch (error) {
          // Network error: retry once with a backoff unless this was the last attempt.
          if (attempt === ANILIST_MAX_ATTEMPTS) {
            throw error;
          }
          await sleep(ANILIST_MAX_BACKOFF_MS);
          continue;
        }

        // Retry rate-limit and transient server errors; return anything else as-is for the
        // caller to handle.
        if (response.ok || !ANILIST_RETRY_STATUSES.has(response.status) || attempt === ANILIST_MAX_ATTEMPTS) {
          return response;
        }

        // Honour a Retry-After header when present, otherwise back off; cap the wait so a
        // rate-limited page fails fast and recovers via the short negative cache instead of
        // blocking the render for the full reset window.
        const retryAfter = Number.parseFloat(response.headers.get("Retry-After") || "");
        const backoff =
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : ANILIST_MAX_BACKOFF_MS;
        await sleep(Math.min(backoff, ANILIST_MAX_BACKOFF_MS));
      }

      // The loop always returns or throws above; this satisfies the return-a-Response contract.
      return fetch(url, options);
    });

    // Keep the queue chain alive even if this request rejects, so later calls still run.
    aniListQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  async function postAniList(query, variables) {
    const response = await aniListFetch("https://graphql.anilist.co/", {
      body: JSON.stringify({ query, variables }),
      credentials: "omit",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      method: "POST"
    });

    // Treat a rate-limit/server error (after the retries above) as a transport failure so callers
    // can flag it and cache the lookup only briefly; a non-retryable non-2xx just yields no data.
    if (ANILIST_RETRY_STATUSES.has(response.status)) {
      throw new Error(`AniList request failed with status ${response.status}`);
    }
    if (!response.ok) {
      return null;
    }

    return response.json();
  }

  async function fetchAniListNeighbors(mediaId) {
    // The immediate TV prequel/sequel of an AniList entry, used to walk a franchise's seasons.
    const query = `
      query PlexAirDateRelations($id: Int) {
        Media(id: $id) {
          relations {
            edges {
              relationType
              node {
                id
                idMal
                format
                episodes
                averageScore
              }
            }
          }
        }
      }
    `;

    const payload = await postAniList(query, { id: mediaId });
    const edges = payload?.data?.Media?.relations?.edges || [];
    // Follow the main-line seasons only: TV or ONA (newer seasons often stream as ONAs), never
    // movies/OVAs/specials, which are not numbered like a continuing season.
    const isSeason = (format) => format === "TV" || format === "ONA";
    const pick = (relationType) =>
      edges.find((edge) => edge?.relationType === relationType && isSeason(edge?.node?.format))?.node || null;

    return { sequel: pick("SEQUEL"), prequel: pick("PREQUEL") };
  }

  async function resolveSeasonMedia(media, targetSeason) {
    const cacheKey = `${media.id}|${targetSeason}`;
    if (seasonEntryCache.has(cacheKey)) {
      return seasonEntryCache.get(cacheKey);
    }

    // Follow prequels back to the franchise's first season, then walk sequels forward to the
    // wanted Plex season. The `seen` set guards against relation cycles. hop caps bound work.
    let node = { id: media.id, idMal: media.idMal, episodes: media.episodes };
    const seen = new Set([node.id]);

    for (let hop = 0; hop < 24; hop++) {
      const { prequel } = await fetchAniListNeighbors(node.id);
      if (!prequel || seen.has(prequel.id)) {
        break;
      }
      node = prequel;
      seen.add(node.id);
    }

    let result = node;
    for (let season = 1; season < targetSeason; season++) {
      const { sequel } = await fetchAniListNeighbors(result.id);
      if (!sequel || seen.has(sequel.id)) {
        result = null;
        break;
      }
      result = sequel;
      seen.add(sequel.id);
    }

    seasonEntryCache.set(cacheKey, result);
    return result;
  }

  async function fetchAniListEpisode(mediaId, episodeNumber) {
    const query = `
      query PlexAirDateEpisode($mediaId: Int, $episode: Int) {
        Page(perPage: 1) {
          airingSchedules(mediaId: $mediaId, episode: $episode) {
            airingAt
            episode
          }
        }
      }
    `;

    const payload = await postAniList(query, { mediaId, episode: episodeNumber });
    const schedule = payload?.data?.Page?.airingSchedules?.[0];
    if (!schedule?.airingAt) {
      return null;
    }

    return {
      airDate: new Date(schedule.airingAt * 1000),
      episode: schedule.episode || episodeNumber,
      season: null
    };
  }

  async function fetchAniListLastAired(mediaId) {
    const query = `
      query PlexAirDateLastAired($mediaId: Int) {
        Page(perPage: 1) {
          airingSchedules(mediaId: $mediaId, notYetAired: false, sort: TIME_DESC) {
            airingAt
            episode
          }
        }
      }
    `;

    const payload = await postAniList(query, { mediaId });
    const schedule = payload?.data?.Page?.airingSchedules?.[0];
    if (!schedule?.airingAt) {
      return null;
    }

    return {
      airDate: new Date(schedule.airingAt * 1000),
      episode: schedule.episode || null,
      season: null
    };
  }

  function parseAirDate(value) {
    if (!value) {
      return null;
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function parseDateOnly(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value || "");
    if (!match) {
      return parseAirDate(value);
    }

    return new Date(
      Number.parseInt(match[1], 10),
      Number.parseInt(match[2], 10) - 1,
      Number.parseInt(match[3], 10)
    );
  }

  async function render() {
    pendingRender = 0;

    if (!isLikelyPlexPage()) {
      removeRow();
      lastPageKey = "";
      return;
    }

    const context = getMetadataContext();
    if (!context) {
      removeRow();
      lastPageKey = "";
      return;
    }

    if (context.pageKey === lastPageKey && document.getElementById(ROW_ID)) {
      return;
    }

    lastPageKey = context.pageKey;
    const row = ensureRow(context);
    if (!row) {
      return;
    }

    const airInfo = await fetchAirInfo(context);
    if (!airInfo) {
      removeRow();
      return;
    }

    const latestContext = getMetadataContext();
    if (!latestContext || latestContext.pageKey !== context.pageKey) {
      return;
    }

    setRow(row, airInfo);
  }

  function scheduleRender() {
    if (pendingRender) {
      return;
    }

    pendingRender = window.setTimeout(render, 250);
  }

  const observer = new MutationObserver(scheduleRender);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  window.addEventListener("hashchange", scheduleRender);
  window.addEventListener("popstate", scheduleRender);
  scheduleRender();
})();
