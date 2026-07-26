# PlexAirDate

Firefox and Chrome Manifest V3 extension that adds the next airing episode date to Plex
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

## Build the distributable zips

The packaged zips in `PlexAirDate-chrome/dist/` and `PlexAirDate-firefox/dist/` are what gets
uploaded to the Chrome Web Store and addons.mozilla.org.

```sh
scripts/build.sh            # both browsers
scripts/build.sh chrome     # one browser
scripts/build.sh firefox
```

Each run writes `dist/plex-air-date-<browser>-<version>.zip`, taking `<version>` from that
browser's own `manifest.json`, so releasing is:

1. Bump `"version"` in **both** `PlexAirDate-chrome/manifest.json` and
   `PlexAirDate-firefox/manifest.json` (they are always released together).
2. Add the matching entry at the top of `CHANGELOG.md` (its wording is written to be pasted
   straight into the Firefox Add-ons release notes field).
3. Run `scripts/build.sh`.

`manifest.json` and `src/` must sit at the archive root rather than inside a wrapper folder, which
is what the script produces; the two `src/` directories are kept byte-identical and only the
manifests differ (Firefox adds the `browser_specific_settings` block).

## Scripts

- `scripts/build.sh` - packages the distributable zips (see above).
- `scripts/probe-rate-limits.mjs` - measures the AniList and MyAnimeList rate limits the extension
  has to live within. It bursts the same requests the extension makes until the API returns 429,
  then polls until it recovers, reporting how many got through, how long the burst lasted, and how
  long the reset window is - use it to re-tune the retry/backoff constants in `content.js` from real
  numbers instead of guesses. Run it as
  `node scripts/probe-rate-limits.mjs --api anilist|jikan|both`. It deliberately trips the limits,
  so run it sparingly and not while you are browsing.
- `scripts/probe-jikan-curl.sh` - the same burst/recovery probe for MyAnimeList, via curl. Node's
  `fetch` is 504'd by MyAnimeList's Cloudflare on a TLS fingerprint check before the rate limiter is
  even reached, so it cannot measure that limit; curl's fingerprint passes, like a real browser. Run
  it as `scripts/probe-jikan-curl.sh [max_burst] [poll_seconds] [recovery_seconds]`.

## Notes

- No API key is required.
- The extension only shows a row when a future next episode is found.
- The content script is matched broadly so local Plex servers and
  `*.plex.direct` hosts work, but it exits unless the page has Plex metadata
  elements.
