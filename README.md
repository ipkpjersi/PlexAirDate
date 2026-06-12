# PlexAirDate

Firefox Manifest V3 extension that adds the next airing episode date to Plex
show and episode detail pages when the show is still airing.

The content script reads Plex's stable `data-testid` metadata fields, searches
TVmaze first, falls back to AniList for anime, and inserts a compact row below
Plex's existing release date/runtime line.

## Load in Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Click `Load Temporary Add-on...`.
3. Select `PlexAirDate-firefox/manifest.json`.
4. Open or refresh a Plex show or episode page.

## Load in Chrome

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select the `PlexAirDate-chrome` folder.
5. Open or refresh a Plex show or episode page.

## Notes

- No API key is required.
- The extension only shows a row when a future next episode is found.
- The content script is matched broadly so local Plex servers and
  `*.plex.direct` hosts work, but it exits unless the page has Plex metadata
  elements.
