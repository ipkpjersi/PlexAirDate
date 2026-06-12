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

    const pill = document.createElement("span");
    pill.className = "plex-air-date-pill";

    const label = document.createElement("span");
    label.className = "plex-air-date-label";
    label.textContent = "Next episode";

    const text = document.createElement("span");
    text.className = "plex-air-date-text";
    text.textContent = formatNextEpisode(data);

    const sourceNode = document.createElement("span");
    sourceNode.className = "plex-air-date-source";
    sourceNode.textContent = source;

    pill.append(label, text, sourceNode);
    row.append(pill);
    row.title = `${label.textContent}: ${text.textContent}${source}`;
  }

  function formatNextEpisode(data) {
    const parts = [];
    if (data.season && data.episode) {
      parts.push(`S${data.season} E${data.episode}`);
    } else if (data.episode) {
      parts.push(`Episode ${data.episode}`);
    }

    parts.push(`airs ${formatAirDate(data.airDate)}`);
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

  async function fetchNextEpisode(context) {
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

    const nextResponse = await fetch(`https://api.tvmaze.com/shows/${show.id}?embed=nextepisode`, {
      credentials: "omit"
    });
    if (!nextResponse.ok) {
      return null;
    }

    const showWithNextEpisode = await nextResponse.json();
    const next = showWithNextEpisode?._embedded?.nextepisode;
    if (!next) {
      return null;
    }

    const airDate = next.airstamp ? parseAirDate(next.airstamp) : parseDateOnly(next.airdate);
    if (!airDate || airDate <= new Date()) {
      return null;
    }

    return {
      airDate,
      episode: next.number || null,
      season: next.season || null,
      source: "TVmaze"
    };
  }

  async function fetchFromAniList(context) {
    const query = `
      query PlexAirDate($search: String) {
        Media(search: $search, type: ANIME) {
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

    const next = media?.nextAiringEpisode;
    if (!next?.airingAt) {
      return null;
    }

    const airDate = new Date(next.airingAt * 1000);
    if (airDate <= new Date()) {
      return null;
    }

    return {
      airDate,
      episode: next.episode || null,
      season: null,
      source: "AniList"
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

    const nextEpisode = await fetchNextEpisode(context);
    if (!nextEpisode) {
      removeRow();
      return;
    }

    const latestContext = getMetadataContext();
    if (!latestContext || latestContext.pageKey !== context.pageKey) {
      return;
    }

    setRow(row, nextEpisode);
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
