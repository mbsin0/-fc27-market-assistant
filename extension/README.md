# FC27 Market Assistant Chrome Extension

This Manifest V3 extension adds a draggable dark overlay to the EA FC Web App. It reads currently visible Transfer Market listings and performs price analysis only.

## Read-only behavior and limits

- The MARKET ADAPTER uses visible page text, accessible control labels, and listing attributes when available. It does not call an undocumented EA API.
- GET IT scans the visible Search Results page immediately, or starts one normal EA Search from the Search view when readable filters and the clearly labelled Search control are visible.
- After analyzing a page, the scanner may click only the visible, enabled Next pagination control. It compares the full ordered listing signature before and after the click, then waits for a genuinely different settled result set before scanning the next page. An unchanged result set stops with `NEXT PAGE DID NOT CHANGE`; a missing or disabled Next control stops with `NO MORE PAGES`.
- Market snapshots accumulate unique listing/card identities across pages. Repeated observations of a known listing ID/card are ignored and counted separately; identical BIN prices on distinct cards remain separate listings.
- For page-identity diagnostics, set `globalThis.FC27_DEBUG_MARKET_SCAN = true` in the extension content-script DevTools context. The console logs each page signature and its first/last listing identities.
- The overlay separates the configured **Target Filter** from **Current Results**, which is derived from visible listing cards and can report `Multiple / Mixed Results`.
- A login challenge, CAPTCHA/security check, unavailable market, unexpected dialogue, or unreadable results stops the scan.
- Prices are retained per listing, including duplicate BINs. Listing frequency is the number of visible listings at that same BIN.
- Profit is estimated against the third-lowest visible BIN (or the highest available BIN when fewer than three listings exist), after the isolated 5% EA tax estimate. This is informational and can be inaccurate when visible results are not representative.
- The extension's BUY NOW control only scrolls to and highlights the matching EA result. It never clicks an EA transaction control. It does not buy, bid, list, handle/bypass CAPTCHAs, evade rate limits, or bypass EA protections.
- Settings are stored with `chrome.storage.session` and reset with the browser session.

## Load unpacked in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Select **Load unpacked**.
4. Choose this repository's `extension` directory.
5. Open the EA FC Web App, sign in yourself if needed, and go to Transfer Market.
6. Set the normal market filters in EA. Keep their labelled controls and normal Search control visible.
7. Use GET IT in the overlay and configure Max BIN, Minimum Profit, Pages to Scan, and Time Limit.

## Manual test checklist

1. Confirm the overlay shows **Ready**. Check **Target Filter** and **Current Results** separately after GET IT.
2. Use visible results with repeated BIN prices and distinct listing identities; confirm both cards remain, and check the unique/repeated observation counters across pages.
3. Test thresholds that match and do not match visible prices; qualifying listings should be highlighted in the overlay.
4. Press STOP while the scanner is waiting for a page transition and confirm scanning ends promptly.
5. Set Pages to Scan to 1 and confirm only the current page is scanned; set it to 2 and confirm the visible Next control advances exactly once after page 1 is processed.
6. Minimize the overlay and confirm its last finding and snapshot remain visible; drag it to another corner.
7. Press BUY NOW on a finding and confirm the page only scrolls to/highlights the EA listing. Do not complete a market transaction during this test.
8. If EA changes its markup or hides filters/Search controls, confirm the scanner stops with a clear status instead of guessing.
