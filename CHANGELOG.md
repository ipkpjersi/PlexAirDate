# Changelog

All notable changes to Plex Air Date are listed here, newest first. Each entry matches a version bump in both the Chrome and Firefox manifests. The notes for a version can be copy-pasted into the Firefox Add-ons release notes field.

## 0.8.1

- Added detailed diagnostic logging to the browser console (each line prefixed with "[PlexAirDate]") that traces exactly what the extension does on each page: which sources it queries, the status of every MyAnimeList and AniList request and any retries, cache and stored-id hits, and the final score it shows. This is a troubleshooting aid only and does not change what the extension displays; it can be turned off by setting DEBUG to false in the code.

## 0.8.0

- Scores now recover far more reliably when MyAnimeList or AniList is briefly rate-limited. Previously the extension retried the same rate-limited service with a short delay that was never long enough to outlast the limit, then gave up and left the score blank. It now falls back immediately: if MyAnimeList is rate-limited it uses AniList's own score, and if that is unavailable too it uses the TVmaze rating, so a score appears in most cases instead of a blank note.
- Greatly reduced the number of requests made while browsing quickly through a season, which is what triggered the rate limit in the first place. The MyAnimeList title match and per-episode score pages are now reused instead of refetched on every page, and the matched MyAnimeList entry for each show and season is remembered across sessions (a MyAnimeList id never changes), so revisiting a show later skips the lookup entirely. This uses a small amount of local extension storage (the new "storage" permission).
- When MyAnimeList is rate-limited, the extension no longer makes extra MyAnimeList requests through the AniList fallback that were guaranteed to fail and only made the rate limit worse.
- Brief MyAnimeList gateway errors (the 504s it returns intermittently, which are not rate limits) are now retried briefly so they recover and keep showing the MyAnimeList score, while a genuine rate limit (429) still falls back immediately instead of retrying pointlessly.
- The orange note shown when no score is available no longer promises a retry that did not happen; it now simply states the score is temporarily unavailable.

## 0.7.0

- When an anime score cannot be shown, the extension now displays a short orange note explaining why (for example that MyAnimeList or AniList was briefly rate-limited and will be retried, or that the title could not be matched) instead of leaving the score line blank with no explanation. This makes it much easier to tell a temporary hiccup apart from a title that genuinely has no score.
- Fixed the score sometimes staying blank on episode pages when both MyAnimeList and AniList were briefly rate-limited at the same time (seen while browsing quickly through an episode list). Those cases are now correctly treated as temporary and retried on the next view, and are labelled with the orange note above rather than showing nothing.

## 0.6.0

- Made the MyAnimeList (MAL) score more reliable when AniList is rate-limited. The extension now asks MyAnimeList directly for the score first, instead of going through AniList to reach it, so a brief AniList rate limit no longer causes the score to drop down to the TVmaze rating. AniList is now only consulted when MyAnimeList cannot find the title or has no score, or when the air dates are missing, so on the usual anime page the score comes straight from MyAnimeList and does not depend on AniList at all. If MyAnimeList cannot supply a score, it still falls back to AniList and then to the TVmaze rating as before.

## 0.5.0

- Fixed the anime score sometimes disappearing entirely, leaving only the episode air dates. This happened because the MyAnimeList (MAL) score was only reachable through AniList, so whenever AniList was briefly rate-limited, or simply had no rating for that title, both the MAL score and the AniList score vanished together. The score now has independent fallbacks: if the usual lookup comes up empty, the extension asks MyAnimeList directly for the score (finding the correct entry for the season being viewed, so later seasons still show their own score), and if that is also unavailable it shows the TVmaze rating as a last resort, so a score reliably appears instead of none.

## 0.4.7

- Fixed anime scores disappearing on later-season episodes (for example Himouto! Umaru-chan season 2 from episode 2 onward). When browsing through many episodes quickly, AniList would briefly rate-limit the extension, and that failed lookup was then remembered for hours, so those episodes showed the air dates but no MyAnimeList or AniList score. The extension now spaces out and retries AniList requests the same way it already does for MyAnimeList, and no longer caches a rate-limited lookup for long, so the score comes back on the next view instead of staying blank.
- Fixed the series score on season pages past the first showing the first season's score. Each anime season is its own entry, so a second-season page now shows the second season's own MyAnimeList score rather than season one's.

## 0.4.6

- Anime scores now load faster on the first view of an episode. The short spacing added between MyAnimeList requests in the previous version has been reduced, so the score and per-episode score appear more quickly while still avoiding rate limits.

## 0.4.5

- Fixed the anime series score sometimes showing the AniList score instead of the MyAnimeList (MAL) score, even when MAL had a score. This happened when MyAnimeList briefly rate-limited the extension while it was also fetching the per-episode score. The extension now spaces out and retries those requests, so the correct MAL score shows reliably.

## 0.4.4

- Anime per-episode MAL scores now work across all seasons, not just the first. Each anime season is a separate entry on MyAnimeList (including newer seasons released as web/streaming ONAs), and the extension now finds the right entry automatically, so the per-episode score also shows on later-season episodes.

## 0.4.3

- Anime episode pages now also show the MyAnimeList per-episode score, taken from MAL's episode polls and converted to a score out of 10, tagged "EP" so it is not confused with the overall series score. It only appears when MAL has votes for that episode, and for now only on first-season episodes, where the episode numbers line up with MAL.
- Fixed the MAL score and the episode air dates not showing on show pages after a recent Plex layout change.

## 0.4.2

- Added the MyAnimeList (MAL) score for anime on show, season, and episode pages, shown on its own line below the episode air dates as the MAL logo followed by the score. Plex already shows IMDb and TMDB scores but never a MAL score, so this fills that gap. When MAL has no score for a title, the AniList score is shown in its place and labelled as such.

## 0.3.1

- Season pages now show just the year as the first line, instead of a "Season aired" line.

## 0.3.0

- Added a "Latest episode" line, shown between "Current episode" and "Next episode", with the air date of the most recently aired episode of the show.
- Added support for Plex season pages: they now show the latest and next episode air dates.
- Added a "Season aired" line on season pages showing when that season aired (premiere date), since Plex leaves that information empty.

## 0.2.0

- Added the "Current episode" air date. On an episode page it shows when the episode being viewed aired; on a show page it shows when the most recently aired episode aired.

## 0.1.0

- Initial release. Adds the next episode air date to Plex show and episode pages, using TVmaze with an AniList fallback for anime.
