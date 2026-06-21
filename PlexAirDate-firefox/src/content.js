(() => {
  const ROW_ID = "plex-air-date-row";
  const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
  const cache = new Map();

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
    const line1Node = document.querySelector('[data-testid="metadata-line1"]');
    const line2Node = document.querySelector('[data-testid="metadata-line2"]');

    if (!titleNode || !line1Node || !line2Node) {
      return null;
    }

    const title = normalizeTitle(titleNode.textContent || "");
    const line1 = line1Node.textContent || "";
    const seasonMatch = line1.match(/Season\s+(\d+)/iu);
    const episodeMatch = line1.match(/Episode\s+(\d+)/iu);

    if (!title) {
      return null;
    }

    if (seasonMatch && episodeMatch) {
      return {
        title,
        type: "episode",
        season: Number.parseInt(seasonMatch[1], 10),
        episode: Number.parseInt(episodeMatch[1], 10),
        line2Node,
        pageKey: `${title}|episode|${seasonMatch[1]}|${episodeMatch[1]}|${location.href}`
      };
    }

    if (!isShowTitlePage(line1)) {
      return null;
    }

    return {
      title,
      type: "show",
      season: null,
      episode: null,
      line2Node,
      pageKey: `${title}|show|${location.href}`
    };
  }

  function isShowTitlePage(line1) {
    const hasShowYear = /^\s*(?:19|20)\d{2}\s*$/u.test(line1 || "");
    const hasSeasonsHub = Array.from(document.querySelectorAll('[data-testid="hubTitle"]')).some(
      (node) => (node.textContent || "").trim() === "Seasons"
    );

    return hasShowYear || hasSeasonsHub;
  }

  function getInsertionParent(line2Node) {
    return line2Node.closest("div")?.parentElement || null;
  }

  function removeRow() {
    document.getElementById(ROW_ID)?.remove();
  }

  function ensureRow(context) {
    const parent = getInsertionParent(context.line2Node);
    if (!parent) {
      return null;
    }

    let row = document.getElementById(ROW_ID);
    if (!row) {
      row = document.createElement("div");
      row.id = ROW_ID;
      row.className = "plex-air-date-row";
      row.dataset.state = "loading";

      const line2Wrapper = context.line2Node.closest("div");
      if (line2Wrapper) {
        line2Wrapper.insertAdjacentElement("afterend", row);
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

    if (data.aired) {
      const text = formatEpisode(data.aired, airVerb(data.aired.airDate));
      row.append(buildPill("Current episode", text, source));
      titleParts.push(`Current episode: ${text}`);
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
    const cacheKey = context.title.toLowerCase();
    const cached = getCached(cacheKey);
    if (cached?.hit) {
      return cached.value;
    }

    const result =
      (await fetchFromTvmaze(context).catch(() => null)) ||
      (await fetchFromAniList(context).catch(() => null));

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

    let airedEpisode;
    if (context.type === "episode" && context.season && context.episode) {
      // On an episode page, show the air date of the specific episode being viewed.
      airedEpisode = await fetchTvmazeEpisodeByNumber(show.id, context.season, context.episode).catch(() => null);
    } else {
      const previous = toTvmazeEpisode(embedded?.previousepisode);
      airedEpisode = previous && previous.airDate <= now ? previous : null;
    }

    if (!nextEpisode && !airedEpisode) {
      return null;
    }

    return {
      source: "TVmaze",
      aired: airedEpisode,
      next: nextEpisode
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

    let airedEpisode = null;
    if (media?.id) {
      if (context.type === "episode" && context.episode) {
        // On an episode page, show the air date of the specific episode being viewed.
        airedEpisode = await fetchAniListEpisode(media.id, context.episode).catch(() => null);
      } else {
        airedEpisode = await fetchAniListLastAired(media.id).catch(() => null);
      }
    }

    if (!nextEpisode && !airedEpisode) {
      return null;
    }

    return {
      source: "AniList",
      aired: airedEpisode,
      next: nextEpisode
    };
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
