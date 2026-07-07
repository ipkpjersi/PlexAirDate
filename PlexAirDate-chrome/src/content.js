(() => {
  const ROW_ID = "plex-air-date-row";
  // The MAL score is shown as a badge beside Plex's own IMDb/TMDB badges when they exist;
  // ROW_RATING_ID is the fallback pill in our own row for pages without a ratings block.
  const MAL_BADGE_ID = "plex-air-date-mal";
  const ROW_RATING_ID = "plex-air-date-row-rating";
  const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
  const cache = new Map();

  let pendingRender = 0;
  let lastPageKey = "";
  let lastRating = null;

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

    // Episode and show pages expose line1/line2 metadata; the anchor is line2.
    if (line1Node && line2Node) {
      const line1 = line1Node.textContent || "";
      const seasonMatch = line1.match(/Season\s+(\d+)/iu);
      const episodeMatch = line1.match(/Episode\s+(\d+)/iu);

      if (seasonMatch && episodeMatch) {
        return {
          title,
          type: "episode",
          season: Number.parseInt(seasonMatch[1], 10),
          episode: Number.parseInt(episodeMatch[1], 10),
          anchorNode: line2Node,
          pageKey: `${title}|episode|${seasonMatch[1]}|${episodeMatch[1]}|${location.href}`
        };
      }

      if (isShowTitlePage(line1)) {
        return {
          title,
          type: "show",
          season: null,
          episode: null,
          anchorNode: line2Node,
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

  function isShowTitlePage(line1) {
    const hasShowYear = /^\s*(?:19|20)\d{2}\s*$/u.test(line1 || "");
    const hasSeasonsHub = Array.from(document.querySelectorAll('[data-testid="hubTitle"]')).some(
      (node) => (node.textContent || "").trim() === "Seasons"
    );

    return hasShowYear || hasSeasonsHub;
  }

  function getInsertionParent(anchorNode) {
    return anchorNode.closest("div")?.parentElement || null;
  }

  function removeRow() {
    document.getElementById(ROW_ID)?.remove();
  }

  function ensureRow(context) {
    const parent = getInsertionParent(context.anchorNode);
    if (!parent) {
      return null;
    }

    let row = document.getElementById(ROW_ID);
    if (!row) {
      row = document.createElement("div");
      row.id = ROW_ID;
      row.className = "plex-air-date-row";
      row.dataset.state = "loading";

      const anchorWrapper = context.anchorNode.closest("div");
      if (anchorWrapper) {
        anchorWrapper.insertAdjacentElement("afterend", row);
      } else {
        parent.append(row);
      }
    }

    return row;
  }

  function setRow(row, data, showRating) {
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

    if (showRating && data.rating) {
      // Fallback for pages with no Plex ratings block to sit beside: show the anime score
      // (MAL, or AniList as a fallback) on our own line instead.
      const text = formatRating(data.rating);
      row.append(buildRatingPill(data.rating));
      titleParts.push(`Rating: ${text} ${data.rating.source}`);
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

  // Plex renders its IMDb/TMDB scores as spans titled "<name> Rating ..." inside the
  // metadata-ratings block. Find that flex row so we can drop a matching MAL badge into it.
  function findRatingsSlot() {
    const ratingsNode = document.querySelector('[data-testid="metadata-ratings"]');
    if (!ratingsNode) {
      return null;
    }

    const template = ratingsNode.querySelector('span[title*="Rating"]');
    if (!template || !template.parentElement) {
      return null;
    }

    return { container: template.parentElement, template };
  }

  function buildMalBadge(rating, template) {
    // Reuse Plex's own class names (read from an existing IMDb/TMDB badge) so the MAL badge
    // inherits their typography and spacing and sits beside them looking native.
    const text = formatScore(rating);
    const badge = document.createElement("span");
    badge.id = MAL_BADGE_ID;
    badge.className = template.className;
    badge.title = `${rating.source} score ${text}`;

    const number = document.createElement("span");
    const numberTemplate = template.querySelector("span");
    number.className = numberTemplate ? numberTemplate.className : "";
    number.textContent = `${rating.source} ${text}`;

    badge.append(number);
    return badge;
  }

  function removeMalBadge() {
    document.getElementById(MAL_BADGE_ID)?.remove();
  }

  // Place the MAL score beside Plex's IMDb/TMDB badges. Returns true when it was placed
  // there, false when there is no ratings block to place it in (caller then uses our row).
  function placeMalBadge(rating) {
    removeMalBadge();
    if (!rating) {
      return false;
    }

    const slot = findRatingsSlot();
    if (!slot) {
      return false;
    }

    slot.container.append(buildMalBadge(rating, slot.template));
    return true;
  }

  // Keep the badge in sync when Plex re-renders its ratings row (which can drop our badge or
  // reveal the block late): (re)insert it when there is a slot, otherwise show it in our row.
  function reconcileRating(row) {
    if (!lastRating) {
      return;
    }

    const slot = findRatingsSlot();
    const rowPill = document.getElementById(ROW_RATING_ID);

    if (slot) {
      if (!document.getElementById(MAL_BADGE_ID)) {
        slot.container.append(buildMalBadge(lastRating, slot.template));
      }
      rowPill?.remove();
    } else {
      removeMalBadge();
      if (!rowPill && row) {
        row.append(buildRatingPill(lastRating));
      }
    }
  }

  function buildRatingPill(rating) {
    const pill = buildPill("Rating", formatRating(rating), ` ${rating.source}`);
    pill.id = ROW_RATING_ID;
    return pill;
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

    if (!nextEpisode && !latestEpisode && !currentEpisode && !rating) {
      return null;
    }

    return {
      source: "AniList",
      rating,
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
    return typeof score === "number" ? { score, max: 10, source: "MAL" } : null;
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

  function clearOutput() {
    removeRow();
    removeMalBadge();
    lastRating = null;
  }

  async function render() {
    pendingRender = 0;

    if (!isLikelyPlexPage()) {
      clearOutput();
      lastPageKey = "";
      return;
    }

    const context = getMetadataContext();
    if (!context) {
      clearOutput();
      lastPageKey = "";
      return;
    }

    if (context.pageKey === lastPageKey && document.getElementById(ROW_ID)) {
      // Same page and our row is still there: only reconcile the MAL badge, since Plex may
      // have re-rendered its ratings row underneath us.
      reconcileRating(document.getElementById(ROW_ID));
      return;
    }

    lastPageKey = context.pageKey;
    const row = ensureRow(context);
    if (!row) {
      return;
    }

    const airInfo = await fetchAirInfo(context);
    if (!airInfo) {
      clearOutput();
      return;
    }

    const latestContext = getMetadataContext();
    if (!latestContext || latestContext.pageKey !== context.pageKey) {
      return;
    }

    lastRating = airInfo.rating || null;
    // Prefer placing the MAL score beside Plex's IMDb/TMDB badges; only fall back to our own
    // row line when this page has no ratings block to place it in.
    const placedBeside = placeMalBadge(airInfo.rating);
    setRow(row, airInfo, Boolean(airInfo.rating) && !placedBeside);
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
