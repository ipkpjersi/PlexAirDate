# Changelog

All notable changes to Plex Air Date are listed here, newest first. Each entry matches a version bump in both the Chrome and Firefox manifests. The notes for a version can be copy-pasted into the Firefox Add-ons release notes field.

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
