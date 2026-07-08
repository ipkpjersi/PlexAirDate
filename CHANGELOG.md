# Changelog

All notable changes to Plex Air Date are listed here, newest first. Each entry matches a version bump in both the Chrome and Firefox manifests. The notes for a version can be copy-pasted into the Firefox Add-ons release notes field.

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
