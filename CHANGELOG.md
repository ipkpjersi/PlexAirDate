# Changelog

All notable changes to Plex Air Date are listed here, newest first. Each entry matches a version bump in both the Chrome and Firefox manifests. The notes for a version can be copy-pasted into the Firefox Add-ons release notes field.

## 0.4.1

- Added the MyAnimeList (MAL) score for anime on show, season, and episode pages. Since Plex already shows IMDb and TMDB scores but never a MAL score, the MAL score is shown right beside Plex's own IMDb and TMDB badges. On pages where Plex has no ratings badges to sit beside, the MAL score is shown on its own line instead. When MAL has no score for a title, the AniList score is shown in its place and labelled as such.

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
