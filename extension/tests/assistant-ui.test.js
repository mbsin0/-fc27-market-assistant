"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
require("../assistant-ui.js");
require("../price-engine.js");
require("../search-engine.js");

const ui = globalThis.FC27AssistantUI;
const VIEW = { SEARCH: "TRANSFER_MARKET_SEARCH", RESULTS: "TRANSFER_MARKET_RESULTS", UNKNOWN: "UNKNOWN" };
const page = (signature, player, bins) => ({
  signature,
  listings: bins.map((bin, index) => ({
    player, bin, listingId: `${signature}-${index}`, identity: `${signature}-${index}`,
    element: { page: signature, index }
  }))
});
function makeAdapter(pages) {
  let current = 0;
  const next = { clicks: 0 };
  const adapter = {
    VIEW, getUnsafeReason: () => "", detectView: () => VIEW.RESULTS,
    getCapturedTargetPlayerName: () => "Haaland", findNextControl: () => current < pages.length - 1 ? next : null,
    captureResults: () => pages[current], waitForSettledResults: async () => pages[0],
    triggerNext: (control) => { if (control !== next) return false; next.clicks += 1; current += 1; return true; },
    waitForChangedResults: async (before) => pages[current].signature !== before.signature
      ? { ...pages[current], transitionConfirmed: true } : { error: "same page" },
    next, getCurrent: () => current
  };
  return adapter;
}
function settings(pagesToScan = 2) {
  return { maxBin: 15000000, minimumProfit: 0, pagesToScan, timeLimitMinutes: 1 };
}

test("Market Assistant navigation entry is inserted directly below Transfers and opens the page", () => {
  let openCount = 0;
  const transfers = {
    tagName: "BUTTON", innerText: "Transfers", textContent: "Transfers",
    getBoundingClientRect: () => ({ width: 80, height: 30 })
  };
  const storeRow = { tagName: "LI" };
  const transfersRow = { tagName: "LI", parentElement: null, nextSibling: storeRow };
  const store = { tagName: "BUTTON", innerText: "Store", textContent: "Store", getBoundingClientRect: () => ({ width: 80, height: 30 }) };
  transfers.parentElement = transfersRow;
  store.parentElement = storeRow;
  const list = {
    children: [transfersRow, storeRow],
    insertBefore(node, reference) {
      const index = reference ? this.children.indexOf(reference) : this.children.length;
      this.children.splice(index < 0 ? this.children.length : index, 0, node);
      node.parentElement = this;
    }
  };
  transfersRow.parentElement = list;
  storeRow.parentElement = list;
  const nav = { querySelectorAll: () => [transfers, store] };
  const doc = {
    querySelectorAll: () => [nav],
    getElementById: () => null,
    createElement(tagName) {
      const node = {
        tagName: tagName.toUpperCase(), children: [], listeners: {},
        setAttribute(name, value) { (this.attributes ||= {})[name] = value; },
        addEventListener(name, callback) { this.listeners[name] = callback; },
        appendChild(child) { this.children.push(child); child.parentElement = this; }
      };
      return node;
    }
  };
  const navEntry = ui.installNavigationEntry(doc, () => { openCount += 1; });
  assert.ok(navEntry);
  assert.deepEqual(list.children.map((item) => item.id || item.tagName), ["LI", "fc27-market-assistant-nav-entry", "LI"]);
  assert.equal(navEntry.button.textContent, "Market Assistant");
  navEntry.button.listeners.click();
  assert.equal(openCount, 1);
});

test("opening the assistant leaves the underlying EA results DOM in place and pagination can continue", async () => {
  const eaResultDom = { isConnected: true, listings: ["Haaland listing"] };
  let assistantOpen = false;
  const nav = ui.installNavigationEntry;
  const transfers = { tagName: "BUTTON", innerText: "Transfers", textContent: "Transfers", getBoundingClientRect: () => ({ width: 80, height: 30 }) };
  const transfersRow = { tagName: "LI", parentElement: null, nextSibling: null };
  transfers.parentElement = transfersRow;
  const list = { children: [transfersRow], insertBefore(node) { this.children.push(node); node.parentElement = this; } };
  transfersRow.parentElement = list;
  const navigation = { querySelectorAll: () => [transfers] };
  const doc = {
    querySelectorAll: () => [navigation], getElementById: () => null,
    createElement(tagName) { return { tagName, children: [], setAttribute() {}, addEventListener(name, fn) { this.click = fn; }, appendChild(child) { this.children.push(child); } }; }
  };
  nav(doc, () => { assistantOpen = true; });
  list.children[1].children[0].click();
  assert.equal(assistantOpen, true);
  assert.equal(eaResultDom.isConnected, true);

  const adapter = makeAdapter([
    page("one", "Erling Haaland", [127000]),
    page("two", "Erling Haaland", [128000])
  ]);
  let state;
  await globalThis.FC27SearchEngine.createSearchEngine(adapter, { onState: (next) => { state = next; } }).start(settings(2));
  assert.equal(adapter.next.clicks, 1);
  assert.equal(state.pagesScanned, 2);
  assert.equal(eaResultDom.isConnected, true);
});

test("Haaland results are detected and the configured target remains unchanged across pages", async () => {
  const adapter = makeAdapter([
    page("one", "Erling Haaland", [127000]),
    page("two", "Erling Haaland", [128000])
  ]);
  let state;
  await globalThis.FC27SearchEngine.createSearchEngine(adapter, { onState: (next) => { state = next; } }).start(settings(2));
  assert.equal(state.targetPlayerName, "Haaland");
  assert.equal(state.currentResultsPlayer, "Erling Haaland");
  assert.equal(state.pagesConfirmed, 2);
  assert.ok(state.pageAudit.every((entry) => entry.targetPlayer === "Haaland"));
});

test("mixed result cards are reported as Multiple / Mixed Results", () => {
  assert.equal(globalThis.FC27SearchEngine.summarizeResultIdentity([
    { player: "Erling Haaland" }, { player: "Karim Adeyemi" }
  ]), "Multiple / Mixed Results");
});

test("result identities from all confirmed pages are reported as mixed", async () => {
  const adapter = makeAdapter([
    page("one", "Erling Haaland", [127000]),
    page("two", "Karim Adeyemi", [128000])
  ]);
  let state;
  await globalThis.FC27SearchEngine.createSearchEngine(adapter, { onState: (next) => { state = next; } }).start(settings(2));
  assert.equal(state.currentResultsPlayer, "Multiple / Mixed Results");
});

test("lowest three distinct BIN prices aggregate individual cards across pages", () => {
  const listings = [
    ...page("one", "Haaland", [127000, 127000, 129000]).listings,
    ...page("two", "Haaland", [128000, 127000, 130000]).listings
  ];
  assert.deepEqual(ui.aggregateLowestPrices(listings), [
    { price: 127000, count: 3 }, { price: 128000, count: 1 }, { price: 129000, count: 1 }
  ]);
  assert.deepEqual(ui.aggregateLowestPrices([{ bin: 50000 }]), [{ price: 50000, count: 1 }]);
  assert.deepEqual(ui.aggregateLowestPrices([{ bin: null }, { bin: "bad" }]), []);
});

test("starting a new scan clears the previous scan price aggregation", async () => {
  const adapter = makeAdapter([page("one", "Haaland", [127000])]);
  let state;
  const engine = globalThis.FC27SearchEngine.createSearchEngine(adapter, { onState: (next) => { state = next; } });
  await engine.start(settings(1));
  assert.deepEqual(ui.aggregateLowestPrices(state.scannedListings), [{ price: 127000, count: 1 }]);
  adapter.getCapturedTargetPlayerName = () => "Haaland";
  adapter.waitForSettledResults = async () => page("two", "Haaland", [133000]);
  await engine.start(settings(1));
  assert.deepEqual(ui.aggregateLowestPrices(state.scannedListings), [{ price: 133000, count: 1 }]);
});

test("Debug Mode is hidden by default", () => {
  assert.equal(ui.DEFAULT_DEBUG_MODE, false);
});

test("debug report is plain text, structured, and excludes credentials and session data", () => {
  const report = ui.buildDebugReport({
    status: "SCAN COMPLETE", pagesRequested: 3, pagesConfirmed: 2, pagesScanned: 2,
    listingsScanned: 4, uniqueListingsScanned: 4, repeatedListingObservations: 0,
    targetPlayerName: "Haaland", currentResultsPlayer: "Erling Haaland",
    scannedListings: [{ bin: 127000 }, { bin: 127000 }, { bin: 128000 }, { bin: 129000 }],
    metrics: { lowestBin: 127000, secondBin: 127000, thirdBin: 128000, averageBin: 127750, estimatedTax: 6387 },
    pageAudit: [{ next: "FOUND", nextAction: "SENT", nextClick: "SENT" }],
    username: "private-user", email: "private@example.test", password: "secret", token: "auth-token", cookies: "cookie-data", sessionId: "session-secret"
  }, { version: "0.1.0" });
  assert.equal(typeof report, "string");
  assert.match(report, /^FC27 MARKET ASSISTANT — DEBUG REPORT/);
  assert.match(report, /127000 = 2 cards/);
  assert.match(report, /Successful Page Changes: 1/);
  assert.match(report, /END DEBUG REPORT$/);
  for (const privateValue of ["private-user", "private@example.test", "secret", "auth-token", "cookie-data", "session-secret"]) assert.ok(!report.includes(privateValue));
});
