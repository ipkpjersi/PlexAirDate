// Opens a link in a new BACKGROUND tab on behalf of the content script, which is the one thing the
// content script cannot do itself: it only has window.open, and that always focuses the new tab,
// whereas a middle-clicked link is expected to leave the current page in front. Only a background
// context can call tabs.create({ active: false }), so this worker exists purely to relay that one
// request. Chrome runs this file as a service worker and Firefox as an event page (see the
// background key in each browser's manifest); nothing below depends on which.
//
// No extra permission is needed: creating a tab at a given URL does not require the "tabs"
// permission, which only governs reading privileged tab fields such as the URL or title.
//
// The Jellyfin port of this plugin deliberately has no equivalent of this file. Jellyfin renders its own
// IMDb/TMDB links as real anchors (<a href target="_blank"> inside .itemExternalLinks), so the
// browser handles every mouse button on them natively and there is nothing to intercept. Only Plex
// needs any of this, because it draws its ratings as plain non-interactive markup that cannot be
// turned into an anchor without breaking React (see decorateNativeRatings in content.js).
const api = typeof browser !== "undefined" ? browser : chrome;
const OPEN_BACKGROUND_TAB = "plex-air-date:open-background-tab";

api.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== OPEN_BACKGROUND_TAB) {
    return;
  }

  // The URL is built by the content script from the page title, so validate rather than trust it:
  // only ordinary web pages are ever opened, never a javascript:, data:, or extension URL.
  let target;
  try {
    target = new URL(message.url);
  } catch (error) {
    return;
  }

  if (target.protocol !== "https:" && target.protocol !== "http:") {
    return;
  }

  // Put the tab directly after the one it came from and record that tab as its opener, which is
  // what the browser itself does for a middle-clicked link.
  api.tabs.create({
    url: target.href,
    active: false,
    index: typeof sender.tab?.index === "number" ? sender.tab.index + 1 : undefined,
    openerTabId: sender.tab?.id
  });
});
