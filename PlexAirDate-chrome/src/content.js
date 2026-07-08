(() => {
  const ROW_ID = "plex-air-date-row";
  const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
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
      // Anime score (MAL, or AniList as a fallback), shown below the airing info. Plex
      // already displays IMDb/TMDB scores elsewhere, so we only add a rating for anime.
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
    // The anime score line: the MAL logo (or the source name for the AniList fallback)
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
    if (Date.now() - cached.createdAt > CACHE_TTL_MS) {
      cache.delete(key);
      return null;
    }

    return {
      hit: true,
      value: cached.value
    };
  }

  function setCached(key, value) {
    cache.set(key, {
      createdAt: Date.now(),
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
      fetchFromAniList(context).catch(() => null)
    ]);

    const result = tvmaze || anilist;
    if (result && anilist?.rating) {
      // An AniList match means the title is anime, so prefer its MAL score for the rating
      // even when the air dates themselves came from TVmaze.
      result.rating = anilist.rating;
    }
    if (result && anilist?.episodeRating) {
      result.episodeRating = anilist.episodeRating;
    }

    setCached(cacheKey, result);
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

    const response = await fetch("https://graphql.anilist.co/", {
      body: JSON.stringify({
        query,
        variables: {
          search: context.title
        }
      }),
      credentials: "omit",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      method: "POST"
    });

    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    const media = payload?.data?.Media;
    const titles = [
      media?.title?.english,
      media?.title?.romaji,
      media?.title?.native,
      ...(media?.synonyms || [])
    ].filter(Boolean);

    if (!titles.some((title) => isProbableTitleMatch(context.title, title))) {
      return null;
    }

    const now = new Date();

    const next = media?.nextAiringEpisode;
    const nextAirDate = next?.airingAt ? new Date(next.airingAt * 1000) : null;
    const nextEpisode =
      nextAirDate && nextAirDate > now ? { airDate: nextAirDate, episode: next.episode || null, season: null } : null;

    let currentEpisode = null;
    let latestEpisode = null;
    if (media?.id) {
      if (context.type === "episode" && context.episode) {
        // On an episode page, show the air date of the specific episode being viewed.
        currentEpisode = await fetchAniListEpisode(media.id, context.episode).catch(() => null);
      }
      // The most recently aired episode of the matched title, shown on every page type.
      latestEpisode = await fetchAniListLastAired(media.id).catch(() => null);
    }

    // Prefer the real MAL score (via Jikan); fall back to AniList's own averageScore.
    let rating = null;
    if (media?.idMal) {
      rating = await fetchMalScore(media.idMal).catch(() => null);
    }
    if (!rating && typeof media?.averageScore === "number") {
      rating = { score: media.averageScore / 10, max: 10, source: "AniList" };
    }

    // MAL per-episode poll score, on episode pages. Plex numbers episodes per season, but each
    // anime season is its own MAL entry numbered from episode 1, so resolve the entry for this
    // Plex season by walking the AniList sequel chain, then look up the episode within it.
    let episodeRating = null;
    if (media?.id && context.type === "episode" && context.episode) {
      const seasonMedia =
        context.season && context.season > 1
          ? await resolveSeasonMedia(media, context.season).catch(() => null)
          : { idMal: media.idMal, episodes: media.episodes };
      // Skip if the episode number does not fit the resolved entry (a sign the season chain
      // did not line up), so we do not show a mismatched score.
      const fitsEntry = !seasonMedia?.episodes || context.episode <= seasonMedia.episodes;
      if (seasonMedia?.idMal && fitsEntry) {
        episodeRating = await fetchMalEpisodeScore(seasonMedia.idMal, context.episode).catch(() => null);
      }
    }

    if (!nextEpisode && !latestEpisode && !currentEpisode && !rating && !episodeRating) {
      return null;
    }

    return {
      source: "AniList",
      rating,
      episodeRating,
      current: currentEpisode,
      latest: latestEpisode,
      next: nextEpisode,
      seasonAired: null
    };
  }

  async function fetchMalScore(idMal) {
    // Jikan is the unofficial MyAnimeList API; data.score is MAL's rating on a 0-10 scale.
    const response = await fetch(`https://api.jikan.moe/v4/anime/${idMal}`, {
      credentials: "omit"
    });
    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    const score = payload?.data?.score;
    // Jikan returns 0 (not null) for an anime with no score yet, so treat 0 as "no score"
    // and let the caller fall back to the AniList average.
    return typeof score === "number" && score > 0 ? { score, max: 10, source: "MAL" } : null;
  }

  async function fetchMalEpisodeScore(idMal, episode) {
    // Per-episode poll scores only exist in the episodes LIST endpoint (100 per page) as a
    // nullable 1.00-5.00 average, so fetch the page the episode falls on and match by number.
    const page = Math.floor((episode - 1) / 100) + 1;
    const params = new URLSearchParams({ page: String(page) });
    const response = await fetch(`https://api.jikan.moe/v4/anime/${idMal}/episodes?${params.toString()}`, {
      credentials: "omit"
    });
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
              }
            }
          }
        }
      }
    `;

    const response = await fetch("https://graphql.anilist.co/", {
      body: JSON.stringify({ query, variables: { id: mediaId } }),
      credentials: "omit",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      method: "POST"
    });

    if (!response.ok) {
      return { sequel: null, prequel: null };
    }

    const payload = await response.json();
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

    const response = await fetch("https://graphql.anilist.co/", {
      body: JSON.stringify({
        query,
        variables: {
          mediaId,
          episode: episodeNumber
        }
      }),
      credentials: "omit",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      method: "POST"
    });

    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
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

    const response = await fetch("https://graphql.anilist.co/", {
      body: JSON.stringify({
        query,
        variables: {
          mediaId
        }
      }),
      credentials: "omit",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      method: "POST"
    });

    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
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
