"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
require("../price-engine.js");
require("../search-engine.js");

const VIEW = { SEARCH: "TRANSFER_MARKET_SEARCH", RESULTS: "TRANSFER_MARKET_RESULTS", UNKNOWN: "UNKNOWN" };
const resultPage = (id, listings) => ({
  signature: id,
  listings: listings.map((listing, index) => ({ ...listing, identity: `${id}-${index}`, element: { page: id, index } }))
});

function makeAdapter({ view = VIEW.RESULTS, pages = [], filter = "Karim Adeyemi", noNext = false, staleNext = false, returnSamePage = false, unsafeNext = false } = {}) {
  let current = 0;
  const searchControl = { clicks: 0, click() { this.clicks += 1; } };
  const nextControl = { clicks: 0 };
  const adapter = {
    VIEW,
    getUnsafeReason: () => "",
    detectView: () => view,
    readCurrentFilters: () => [{ label: "Player", value: filter }],
    readTargetPlayerName: () => filter,
    findSearchControl: () => searchControl,
    triggerSearch: (control) => { if (control !== searchControl) return false; control.click(); return true; },
    waitForFreshResults: async () => pages[0],
    waitForSettledResults: async () => pages[0],
    findNextControl: () => noNext || current >= pages.length - 1 ? null : nextControl,
    getNextControlStatus: () => ({ found: unsafeNext, disabled: false, clickable: false }),
    triggerNext: (control) => {
      if (control !== nextControl || adapter.findNextControl() !== control) return false;
      nextControl.clicks += 1;
      if (!staleNext) current += 1;
      return true;
    },
    waitForChangedResults: async (before) => {
      if (staleNext) return returnSamePage ? { ...pages[current], transitionConfirmed: false } : { error: "NEXT CLICK FAILED" };
      const next = pages[current];
      return next && next.signature !== before.signature ? { ...next, transitionConfirmed: true } : { error: "NEXT CLICK FAILED" };
    },
    get currentPage() { return current; },
    nextControl,
    searchControl
  };
  return adapter;
}

function settings(overrides = {}) {
  return { maxBin: 15000000, minimumProfit: 0, pagesToScan: 10, timeLimitMinutes: 1, ...overrides };
}

test("target filter remains distinct from actual result-player identity", async () => {
  const adapter = makeAdapter({ view: VIEW.SEARCH, filter: "Karim Adeyemi", pages: [resultPage("haaland", [{ player: "Erling Haaland", bin: 120000 }])] });
  let state;
  await globalThis.FC27SearchEngine.createSearchEngine(adapter, { onState: (next) => { state = next; } }).start(settings({ pagesToScan: 1 }));
  assert.equal(state.targetPlayerName, "Karim Adeyemi");
  assert.equal(state.targetFilter, "Karim Adeyemi");
  assert.equal(state.currentResultsPlayer, "Erling Haaland");
  assert.equal(state.pageAudit[0].targetPlayer, "Karim Adeyemi");
  assert.equal(state.pageAudit[0].resultPlayer, "Erling Haaland");
  assert.equal(state.pageAudit[0].pagesRequested, 1);
  assert.equal(state.pageAudit[0].listingsRead, 1);
  assert.equal(state.pageAudit[0].pageConfirmed, "CONFIRMED");
});

test("target player is published before the normal EA Search action", async () => {
  const adapter = makeAdapter({ view: VIEW.SEARCH, filter: "Karim Adeyemi", pages: [resultPage("one", [{ player: "Karim Adeyemi", bin: 80000 }])] });
  const states = [];
  let engine;
  let targetAtSearchClick = "";
  adapter.triggerSearch = (control) => {
    targetAtSearchClick = engine.getState().targetPlayerName;
    return control === adapter.searchControl;
  };
  engine = globalThis.FC27SearchEngine.createSearchEngine(adapter, { onState: (state) => states.push(state) });
  await engine.start(settings({ pagesToScan: 1 }));
  assert.equal(targetAtSearchClick, "Karim Adeyemi");
  assert.ok(states.some((state) => state.status === "TARGET: Karim Adeyemi"));
});

test("empty player capture does not create or retain a false target name", async () => {
  const adapter = makeAdapter({ view: VIEW.SEARCH, filter: "Gold" , pages: [resultPage("page", [{ player: "Karim Adeyemi", bin: 80000 }])] });
  adapter.readTargetPlayerName = () => "";
  let state;
  await globalThis.FC27SearchEngine.createSearchEngine(adapter, { onState: (next) => { state = next; } }).start(settings({ pagesToScan: 1 }));
  assert.equal(state.targetPlayerName, "");
  assert.equal(state.targetFilter, "Player not selected");
  assert.equal(state.currentResultsPlayer, "Karim Adeyemi");
});

test("mixed result identities are not reduced to one player", () => {
  assert.equal(globalThis.FC27SearchEngine.summarizeResultIdentity([
    { player: "Erling Haaland" }, { player: "Erling Haaland" }, { player: "Karim Adeyemi" }
  ]), "Multiple / Mixed Results");
});

test("page one advances once to page two and snapshots accumulate duplicate BIN cards", async () => {
  const pages = [
    resultPage("page-1", [{ player: "Erling Haaland", bin: 80000 }, { player: "Erling Haaland", bin: 80000 }]),
    resultPage("page-2", [{ player: "Erling Haaland", bin: 90000 }, { player: "Erling Haaland", bin: 100000 }])
  ];
  const adapter = makeAdapter({ pages });
  let state;
  let engine;
  let confirmedBeforeNext = null;
  const waitForChangedResults = adapter.waitForChangedResults;
  adapter.waitForChangedResults = async (before, options) => {
    confirmedBeforeNext = engine.getState().pagesConfirmed;
    return waitForChangedResults(before, options);
  };
  const statuses = [];
  engine = globalThis.FC27SearchEngine.createSearchEngine(adapter, { onState: (next) => { state = next; statuses.push(next.status); } });
  await engine.start(settings({ pagesToScan: 2 }));
  assert.equal(adapter.nextControl.clicks, 1);
  assert.equal(adapter.currentPage, 1);
  assert.equal(state.pagesScanned, 2);
  assert.equal(confirmedBeforeNext, 1);
  assert.equal(state.pagesConfirmed, 2);
  assert.equal(state.listingsScanned, 4);
  assert.equal(state.metrics.listingCount, 4);
  assert.equal(state.metrics.lowestBin, 80000);
  assert.equal(state.metrics.secondBin, 80000);
  assert.equal(state.metrics.thirdBin, 90000);
  assert.equal(state.metrics.samePriceFrequency, 2);
  assert.equal(state.findings.length, 2);
  assert.deepEqual(state.findings.map((listing) => listing.pageNumber), [1, 1]);
  assert.equal(state.currentResultsPlayer, "Erling Haaland");
  for (const status of ["NEXT FOUND", "NEXT CLICK ATTEMPTED", "WAITING FOR EA", "RESULT SIGNATURE CHANGED", "NEXT PAGE CONFIRMED", "PAGE 2 CONFIRMED", "PAGE 2 / 2 · SCANNING"]) assert.ok(statuses.includes(status), `missing diagnostic status: ${status}`);
  assert.ok(statuses.includes("PAGE 2 SCANNED · 4 unique · 0 repeats ignored"));
});

test("visible but unsafe Next control stops with NEXT BUTTON FOUND BUT NOT CLICKABLE", async () => {
  const adapter = makeAdapter({ pages: [resultPage("only", [{ player: "Erling Haaland", bin: 120000 }])], unsafeNext: true });
  let state;
  await globalThis.FC27SearchEngine.createSearchEngine(adapter, { onState: (next) => { state = next; } }).start(settings());
  assert.equal(state.pagesScanned, 1);
  assert.equal(adapter.nextControl.clicks, 0);
  assert.match(state.status, /SCAN STOPPED · REASON: NEXT ACTION WAS NOT EXECUTED/);
  assert.equal(state.pagesConfirmed, 1);
});

test("page one is scannable without Next but a missing Next action stops the run", async () => {
  const adapter = makeAdapter({ pages: [resultPage("page-1", [{ player: "Erling Haaland", bin: 120000 }])], noNext: true });
  let state;
  await globalThis.FC27SearchEngine.createSearchEngine(adapter, { onState: (next) => { state = next; } }).start(settings({ pagesToScan: 3 }));
  assert.equal(state.pagesScanned, 1);
  assert.equal(state.pagesConfirmed, 1);
  assert.equal(state.pageAudit.length, 1);
  assert.equal(state.pageAudit[0].nextAction, "NOT ATTEMPTED");
  assert.equal(state.status, "SCAN STOPPED · REASON: NEXT ACTION WAS NOT EXECUTED");
});

test("a false Next trigger never confirms page two", async () => {
  const adapter = makeAdapter({ pages: [
    resultPage("page-1", [{ player: "Erling Haaland", bin: 80000 }]),
    resultPage("page-2", [{ player: "Erling Haaland", bin: 90000 }])
  ] });
  adapter.triggerNext = () => false;
  let state;
  await globalThis.FC27SearchEngine.createSearchEngine(adapter, { onState: (next) => { state = next; } }).start(settings({ pagesToScan: 3 }));
  assert.equal(state.pagesScanned, 1);
  assert.equal(state.pagesConfirmed, 1);
  assert.equal(state.pageAudit.length, 1);
  assert.equal(state.pageAudit[0].nextClick, "FAILED");
  assert.equal(state.status, "SCAN STOPPED · REASON: NEXT ACTION WAS NOT EXECUTED");
});

test("same listing ID is ignored while a different listing at the same BIN is retained", async () => {
  const same = { player: "Erling Haaland", bin: 49000, startPrice: 45000, listingId: "auction-001", listingIdentity: "listing:auction-001" };
  const different = { player: "Erling Haaland", bin: 49000, startPrice: 45000, listingId: "auction-002", listingIdentity: "listing:auction-002" };
  const adapter = makeAdapter({ pages: [
    resultPage("page-1", [same]),
    resultPage("page-2", [same, different])
  ] });
  let state;
  await globalThis.FC27SearchEngine.createSearchEngine(adapter, { onState: (next) => { state = next; } }).start(settings({ pagesToScan: 2 }));
  assert.equal(state.pagesScanned, 2);
  assert.equal(state.uniqueListingsScanned, 2);
  assert.equal(state.repeatedListingObservations, 1);
  assert.equal(state.metrics.listingCount, 2);
  assert.equal(state.metrics.lowestBin, 49000);
  assert.equal(state.metrics.secondBin, 49000);
});

test("stale result identity stops after one Next click", async () => {
  const page = resultPage("same-page", [{ player: "Erling Haaland", bin: 120000 }]);
  const adapter = makeAdapter({ pages: [page, page], staleNext: true });
  let state;
  await globalThis.FC27SearchEngine.createSearchEngine(adapter, { onState: (next) => { state = next; } }).start(settings());
  assert.equal(adapter.nextControl.clicks, 1);
  assert.equal(state.pagesScanned, 1);
  assert.equal(state.status, "EA PAGE DID NOT CHANGE · SCAN STOPPED");
});

test("same result signature returned after Next is never counted as a new page", async () => {
  const page = resultPage("unchanged", [{ player: "Erling Haaland", bin: 120000 }]);
  const adapter = makeAdapter({ view: VIEW.SEARCH, pages: [page, page], staleNext: true, returnSamePage: true });
  let state;
  await globalThis.FC27SearchEngine.createSearchEngine(adapter, { onState: (next) => { state = next; } }).start(settings({ pagesToScan: 10 }));
  assert.equal(adapter.nextControl.clicks, 1);
  assert.equal(state.pagesScanned, 1);
  assert.equal(state.uniqueListingsScanned, 1);
  assert.equal(state.status, "EA PAGE DID NOT CHANGE · SCAN STOPPED");
  assert.equal(state.pageAudit.length, 1);
  assert.equal(state.pageAudit[0].transition, "SAME PAGE — NOT COUNTED");
  assert.equal(state.pageAudit[0].pageConfirmed, "CONFIRMED");
  assert.equal(state.pageAudit[0].nextPageConfirmed, "NOT CONFIRMED");
  assert.equal(state.pageAudit[0].targetPlayer, "Karim Adeyemi");
  assert.equal(state.pageAudit[0].resultPlayer, "Erling Haaland");
  assert.equal(state.pageAudit[0].before.signature, state.pageAudit[0].after.signature);
});

test("page counter advances only after a confirmed transition", async () => {
  const page = resultPage("same", [{ player: "Erling Haaland", bin: 120000 }]);
  const adapter = makeAdapter({ pages: [page, page], staleNext: true, returnSamePage: true });
  let state;
  await globalThis.FC27SearchEngine.createSearchEngine(adapter, { onState: (next) => { state = next; } }).start(settings({ pagesToScan: 3 }));
  assert.equal(state.pagesScanned, 1);
  assert.equal(state.status, "EA PAGE DID NOT CHANGE · SCAN STOPPED");
});

test("same listing signature is not confirmed as a new page even after a DOM re-render", async () => {
  const page1 = resultPage("same", [{ player: "Erling Haaland", bin: 120000 }]);
  const page2 = resultPage("same", [{ player: "Erling Haaland", bin: 120000 }]);
  const adapter = makeAdapter({ pages: [page1, page2] });
  adapter.waitForChangedResults = async () => ({ ...page2, transitionConfirmed: true });
  let state;
  await globalThis.FC27SearchEngine.createSearchEngine(adapter, { onState: (next) => { state = next; } }).start(settings({ pagesToScan: 2 }));
  assert.equal(state.pagesScanned, 1);
  assert.equal(state.pagesConfirmed, 1);
  assert.equal(state.uniqueListingsScanned, 1);
  assert.equal(state.repeatedListingObservations, 0);
  assert.equal(state.pageAudit[0].transition, "SAME PAGE — NOT COUNTED");
});

test("successful page audit includes before/after snapshots and explicit confirmation", async () => {
  const adapter = makeAdapter({ pages: [
    resultPage("page-1", [{ player: "Erling Haaland", bin: 80000 }]),
    resultPage("page-2", [{ player: "Erling Haaland", bin: 90000 }])
  ] });
  let state;
  await globalThis.FC27SearchEngine.createSearchEngine(adapter, { onState: (next) => { state = next; } }).start(settings({ pagesToScan: 2 }));
  const firstAudit = state.pageAudit[0];
  assert.equal(firstAudit.next, "FOUND");
  assert.equal(firstAudit.nextClick, "SENT");
  assert.equal(firstAudit.nextAction, "SENT");
  assert.equal(firstAudit.resultDom, "CHANGED");
  assert.equal(firstAudit.transition, "NEW PAGE CONFIRMED");
  assert.equal(firstAudit.before.signature, "page-1");
  assert.equal(firstAudit.after.signature, "page-2");
});

test("three genuinely different pages produce exactly three page scans", async () => {
  const adapter = makeAdapter({ pages: [
    resultPage("page-1", [{ player: "Erling Haaland", bin: 80000 }]),
    resultPage("page-2", [{ player: "Erling Haaland", bin: 90000 }]),
    resultPage("page-3", [{ player: "Erling Haaland", bin: 100000 }])
  ] });
  let state;
  const scanCheckpoints = [];
  await globalThis.FC27SearchEngine.createSearchEngine(adapter, { onState: (next) => {
    state = next;
    if (/^PAGE \d+ \/ \d+ · SCANNING$/.test(next.status)) {
      scanCheckpoints.push({ pagesScanned: next.pagesScanned, pagesConfirmed: next.pagesConfirmed, nextClicks: adapter.nextControl.clicks });
    }
  } }).start(settings({ pagesToScan: 3 }));
  assert.equal(state.pagesScanned, 3);
  assert.equal(state.pagesConfirmed, 3);
  assert.equal(state.listingsScanned, 3);
  assert.equal(adapter.nextControl.clicks, 2);
  assert.deepEqual(scanCheckpoints, [
    { pagesScanned: 0, pagesConfirmed: 1, nextClicks: 0 },
    { pagesScanned: 1, pagesConfirmed: 2, nextClicks: 1 },
    { pagesScanned: 2, pagesConfirmed: 3, nextClicks: 2 }
  ]);
  assert.match(state.status, /^SCAN COMPLETE/);
});

test("missing or disabled Next stops without confirming another page", async (t) => {
  for (const kind of ["missing", "disabled"]) {
    await t.test(kind, async () => {
      const adapter = makeAdapter({ pages: [resultPage("only", [{ player: "Erling Haaland", bin: 120000 }])], noNext: true });
      let state;
      await globalThis.FC27SearchEngine.createSearchEngine(adapter, { onState: (next) => { state = next; } }).start(settings());
      assert.equal(adapter.nextControl.clicks, 0);
      assert.equal(state.status, "SCAN STOPPED · REASON: NEXT ACTION WAS NOT EXECUTED");
      assert.equal(state.pagesScanned, 1);
      assert.equal(state.pagesConfirmed, 1);
    });
  }
});

test("page limit stops before clicking Next", async () => {
  const adapter = makeAdapter({ pages: [
    resultPage("page-1", [{ player: "Erling Haaland", bin: 120000 }]),
    resultPage("page-2", [{ player: "Erling Haaland", bin: 130000 }])
  ] });
  let state;
  await globalThis.FC27SearchEngine.createSearchEngine(adapter, { onState: (next) => { state = next; } }).start(settings({ pagesToScan: 1 }));
  assert.equal(state.pagesScanned, 1);
  assert.equal(adapter.nextControl.clicks, 0);
  assert.match(state.status, /^SCAN COMPLETE/);
});

test("results-page scanning does not overwrite the prior configured target", async () => {
  const adapter = makeAdapter({ view: VIEW.SEARCH, filter: "Karim Adeyemi", pages: [resultPage("one", [{ player: "Karim Adeyemi", bin: 80000 }])] });
  const engine = globalThis.FC27SearchEngine.createSearchEngine(adapter);
  await engine.start(settings({ pagesToScan: 1 }));
  adapter.detectView = () => VIEW.RESULTS;
  adapter.readCurrentFilters = () => [{ label: "Player", value: "Haaland" }];
  adapter.waitForSettledResults = async () => resultPage("two", [{ player: "Erling Haaland", bin: 120000 }]);
  await engine.start(settings({ pagesToScan: 1 }));
  assert.equal(engine.getState().targetFilter, "Karim Adeyemi");
  assert.equal(engine.getState().targetPlayerName, "Karim Adeyemi");
  assert.equal(engine.getState().currentResultsPlayer, "Erling Haaland");
});
