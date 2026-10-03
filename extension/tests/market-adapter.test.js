"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
require("../market-adapter.js");

const adapter = globalThis.FC27MarketAdapter;

test("detects the separate search and results views", () => {
  assert.equal(adapter.detectViewFromText("Search the Transfer Market Player Search"), adapter.VIEW.SEARCH);
  assert.equal(adapter.detectViewFromText("Search Results Next >", true), adapter.VIEW.RESULTS);
  assert.equal(adapter.detectViewFromText("Transfer Market", false), adapter.VIEW.UNKNOWN);
});

function installTargetPlayerFixture({ value = "", label = "Player", placeholder = "", option = "", contenteditable = false } = {}) {
  const oldDocument = globalThis.document;
  const oldGetComputedStyle = globalThis.getComputedStyle;
  const input = {
    tagName: contenteditable ? "DIV" : "INPUT", type: "text", value: contenteditable ? undefined : value,
    innerText: contenteditable ? value : "", textContent: contenteditable ? value : "", name: "player", isConnected: true,
    getAttribute: (name) => ({ "aria-label": label, placeholder, contenteditable: contenteditable ? "true" : null }[name] || null),
    closest: () => null, getBoundingClientRect: () => ({ width: 180, height: 32 }), querySelectorAll: () => []
  };
  const selectedOption = option ? {
    tagName: "DIV", innerText: option, textContent: option, isConnected: true,
    getAttribute: (name) => name === "role" ? "option" : name === "aria-selected" ? "true" : null,
    closest: () => null, getBoundingClientRect: () => ({ width: 180, height: 32 })
  } : null;
  const fieldWrapper = {
    innerText: option, textContent: option,
    querySelectorAll: (selector) => selector.includes("role='option'") && selectedOption ? [selectedOption] : []
  };
  input.parentElement = fieldWrapper;
  input.closest = (selector) => selector.includes("#fc27-chrome-assistant") ? null : fieldWrapper;
  if (selectedOption) selectedOption.parentElement = fieldWrapper;
  globalThis.document = {
    body: { innerText: "Search the Transfer Market", querySelectorAll: () => [] },
    documentElement: { contains: () => true },
    querySelectorAll: (selector) => selector.includes("role='option'") ? [] : selector.includes("input:not") || selector.includes("contenteditable") ? [input] : [],
    querySelector: () => null,
    getElementById: () => null
  };
  globalThis.getComputedStyle = () => ({ display: "block", visibility: "visible", opacity: "1" });
  return { restore() { globalThis.document = oldDocument; globalThis.getComputedStyle = oldGetComputedStyle; } };
}

test("captures target player from the selected player search input value", () => {
  const fixture = installTargetPlayerFixture({ value: "Karim Adeyemi", label: "Player" });
  try { assert.equal(adapter.readTargetPlayerName(), "Karim Adeyemi"); }
  finally { fixture.restore(); }
});

test("selected autocomplete player takes precedence over the input value", () => {
  const fixture = installTargetPlayerFixture({ value: "Kari", label: "Search Player", placeholder: "Search Player", option: "Karim Adeyemi" });
  try { assert.equal(adapter.readTargetPlayerName(), "Karim Adeyemi"); }
  finally { fixture.restore(); }
});

test("empty player search does not return its placeholder or generic field label", () => {
  const fixture = installTargetPlayerFixture({ value: "", label: "Player", placeholder: "Search Player" });
  try { assert.equal(adapter.readTargetPlayerName(), ""); }
  finally { fixture.restore(); }
});

test("captures player text from a contenteditable search control", () => {
  const fixture = installTargetPlayerFixture({ value: "Karim Adeyemi", label: "Player", contenteditable: true });
  try { assert.equal(adapter.readTargetPlayerName(), "Karim Adeyemi"); }
  finally { fixture.restore(); }
});

test("parses multiple result cards with duplicate BIN prices retained", () => {
  const listings = adapter.parseListingTexts([
    "Karim Adeyemi\nStart Price 45,000\nBuy Now 49,000\nBid 46,000\nTime 12 Mins",
    "Karim Adeyemi\nStart Price 45,000\nBuy Now 49,000\nBid 47,000\nTime 11 Mins",
    "Karim Adeyemi\nStart Price 44,000\nBuy Now 51,000\nBid 44,000\nTime 10 Mins"
  ]);
  assert.equal(listings.length, 3);
  assert.deepEqual(listings.map((listing) => listing.bin), [49000, 49000, 51000]);
  assert.notEqual(listings[0].cardIdentity, listings[1].cardIdentity);
  assert.equal(listings[0].player, "Karim Adeyemi");
  assert.equal(listings[0].startPrice, 45000);
  assert.equal(listings[0].currentBid, 46000);
  assert.equal(listings[0].timeRemaining, "12 Mins");
});

test("missing bid/time fields remain null while card data is preserved", () => {
  const [listing] = adapter.parseListingTexts(["Erling Haaland\nStart Price 100,000\nBuy Now 125,000"]);
  assert.equal(listing.player, "Erling Haaland");
  assert.equal(listing.currentBid, null);
  assert.equal(listing.bid, null);
  assert.equal(listing.timeRemaining, null);
  assert.equal(listing.status, null);
});

test("stable card identity ignores a changing countdown timer", () => {
  const before = adapter.parseListingText("Erling Haaland\nStart Price 100,000\nBuy Now 120,000\nTime 3 Mins", 0, []);
  const after = adapter.parseListingText("Erling Haaland\nStart Price 100,000\nBuy Now 120,000\nTime 2 Mins", 0, []);
  assert.equal(before.identity, after.identity);
});

function installListingResultsFixture(initialText) {
  const oldDocument = globalThis.document;
  const oldGetComputedStyle = globalThis.getComputedStyle;
  let cards = [makeListingCard(initialText)];
  const body = {
    get innerText() { return "Search Results " + cards.map((card) => card.innerText).join(" "); },
    querySelectorAll: (selector) => selector === "*" ? cards : []
  };
  globalThis.document = {
    body,
    documentElement: { contains: () => true },
    querySelectorAll: () => [],
    querySelector: () => null,
    getElementById: () => null
  };
  globalThis.getComputedStyle = () => ({ display: "block", visibility: "visible", opacity: "1" });
  return {
    setCard(text) { cards = [makeListingCard(text)]; },
    restore() { globalThis.document = oldDocument; globalThis.getComputedStyle = oldGetComputedStyle; }
  };
}

function makeListingCard(text) {
  return {
    innerText: text, textContent: text, isConnected: true, children: [], attributes: [],
    closest: () => null, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ width: 180, height: 120 })
  };
}

test("waitForChangedResults requires a different complete card signature", async () => {
  const fixture = installListingResultsFixture("Erling Haaland\nStart Price 100,000\nBuy Now 120,000\nTime 3 Mins");
  try {
    const before = adapter.captureResults();
    assert.equal(before.listings.length, 1);
    fixture.setCard("Erling Haaland\nStart Price 101,000\nBuy Now 121,000\nTime 3 Mins");
    const changed = await adapter.waitForChangedResults(before, { timeoutMs: 3500 });
    assert.equal(changed.listings.length, 1);
    assert.notEqual(changed.signature, before.signature);
    assert.notEqual(changed.firstListingIdentity, before.firstListingIdentity);
  } finally { fixture.restore(); }
});

test("waitForChangedResults accepts a stable card re-render with the same listing signature", async () => {
  const text = "Erling Haaland\nStart Price 100,000\nBuy Now 120,000\nTime 3 Mins";
  const fixture = installListingResultsFixture(text);
  try {
    const before = adapter.captureResults();
    fixture.setCard(text);
    const rerendered = await adapter.waitForChangedResults(before, { timeoutMs: 3500 });
    assert.equal(rerendered.transitionConfirmed, true);
    assert.equal(rerendered.signature, before.signature);
    assert.notEqual(rerendered.firstElement, before.firstElement);
  } finally { fixture.restore(); }
});

test("waitForChangedResults rejects the same page even after waiting", async () => {
  const fixture = installListingResultsFixture("Karim Adeyemi\nStart Price 45,000\nBuy Now 49,000\nTime 3 Mins");
  try {
    const before = adapter.captureResults();
    const unchanged = await adapter.waitForChangedResults(before, { timeoutMs: 900 });
    assert.equal(unchanged.error, "NEXT CLICK FAILED");
  } finally { fixture.restore(); }
});

test("empty or incomplete result cards are not parsed", () => {
  assert.deepEqual(adapter.parseListingTexts([]), []);
  assert.deepEqual(adapter.parseListingTexts(["No results found", "Player\nBuy Now 900"]), []);
});

function installSearchPageFixture() {
  const attributes = (values) => ({ getAttribute: (name) => values[name] || null });
  const filter = {
    ...attributes({ "aria-label": "Player" }), tagName: "INPUT", type: "text", value: "Karim Adeyemi", isConnected: true,
    closest: () => null, getBoundingClientRect: () => ({ width: 160, height: 30 })
  };
  const form = {
    tagName: "FORM", innerText: "Search the Transfer Market Player Karim Adeyemi", textContent: "Search the Transfer Market Player Karim Adeyemi",
    querySelectorAll: (selector) => selector.startsWith("input:not") ? [filter] : []
  };
  let searchClicks = 0;
  let transactionClicks = 0;
  const search = {
    ...attributes({}), tagName: "BUTTON", innerText: "Search", textContent: "Search", isConnected: true, disabled: false,
    closest: (selector) => selector.includes("#fc27-chrome-assistant") ? null : form, getBoundingClientRect: () => ({ width: 100, height: 36 }), click: () => { searchClicks += 1; }
  };
  const buyNow = {
    ...attributes({ "aria-label": "Buy Now" }), tagName: "BUTTON", innerText: "Buy Now", textContent: "Buy Now", isConnected: true,
    closest: (selector) => selector.includes("#fc27-chrome-assistant") ? null : form, getBoundingClientRect: () => ({ width: 100, height: 36 }), click: () => { transactionClicks += 1; }
  };
  form.querySelectorAll = (selector) => selector.startsWith("input:not") ? [filter] : selector.includes("button") ? [search, buyNow] : [];
  const oldDocument = globalThis.document;
  const oldGetComputedStyle = globalThis.getComputedStyle;
  globalThis.document = {
    body: { innerText: "Search the Transfer Market", querySelectorAll: () => [] },
    documentElement: { contains: () => true },
    querySelectorAll: (selector) => selector.startsWith("input:not") ? [filter] : selector.includes("button") ? [search, buyNow] : [],
    querySelector: () => null,
    getElementById: () => null
  };
  globalThis.getComputedStyle = () => ({ display: "block", visibility: "visible", opacity: "1" });
  return {
    search, get searchClicks() { return searchClicks; }, get transactionClicks() { return transactionClicks; },
    restore() { globalThis.document = oldDocument; globalThis.getComputedStyle = oldGetComputedStyle; }
  };
}

test("finds the visible Search button in the Transfer Market form, never a transaction control", () => {
  const fixture = installSearchPageFixture();
  try {
    assert.equal(adapter.detectView(), adapter.VIEW.SEARCH);
    assert.equal(adapter.findSearchControl(), fixture.search);
    assert.equal(adapter.triggerSearch(fixture.search), true);
    assert.equal(fixture.searchClicks, 1);
    assert.equal(fixture.transactionClicks, 0);
  } finally {
    fixture.restore();
  }
});

function installResultsPageFixture(nextControls) {
  const oldDocument = globalThis.document;
  const oldGetComputedStyle = globalThis.getComputedStyle;
  const cards = [makeListingCard("Erling Haaland\nStart Price 100,000\nBuy Now 120,000")];
  nextControls.forEach((control) => {
    control.isConnected = true;
    control.getAttribute = control.getAttribute || ((name) => name === "aria-label" ? "Next >" : null);
    control.closest = (selector) => selector.includes("#fc27-chrome-assistant") ? null : selector.includes("nav") ? {} : null;
    control.getBoundingClientRect = () => ({ x: 12, y: 34, width: 64, height: 32 });
    control.matches = (selector) => selector === "button.flat.pagination.next" && control.tagName === "BUTTON" && /(?:^|\s)flat(?:\s|$)/.test(control.className || "") && /(?:^|\s)pagination(?:\s|$)/.test(control.className || "") && /(?:^|\s)next(?:\s|$)/.test(control.className || "");
  });
  const main = {
    get innerText() { return "Search Results " + cards.map((card) => card.innerText).join(" ") + " " + nextControls.map((control) => control.innerText).join(" "); },
    querySelectorAll: (selector) => selector === "*" ? [...cards, ...nextControls] : selector === "button.flat.pagination.next"
      ? nextControls.filter((control) => control.matches(selector))
      : nextControls.filter((control) => ["BUTTON", "A"].includes(control.tagName) || control.getAttribute("role") === "button")
  };
  globalThis.document = {
    body: { get innerText() { return main.innerText; }, querySelectorAll: () => cards },
    documentElement: { contains: () => true },
    querySelectorAll: (selector) => selector.includes("button") || selector.includes("[role='button']") || selector.includes(", a") ? nextControls : [],
    querySelector: (selector) => selector === "main" ? main : null,
    getElementById: () => null
  };
  globalThis.getComputedStyle = (element) => element.__style || ({ display: "block", visibility: "visible", opacity: "1" });
  return () => { globalThis.document = oldDocument; globalThis.getComputedStyle = oldGetComputedStyle; };
}

test("Next pagination is detected, scrolled to, focused, and normally clicked", () => {
  const interactions = [];
  const next = {
    tagName: "BUTTON", innerText: "Next >", textContent: "Next >", disabled: false,
    scrollIntoView: () => interactions.push("scroll"), focus: () => interactions.push("focus"), click: () => interactions.push("click")
  };
  const restore = installResultsPageFixture([next]);
  try {
    assert.equal(adapter.findNextControl(), next);
    assert.equal(adapter.triggerNext(next), true);
    assert.deepEqual(interactions, ["scroll", "focus", "click"]);
  } finally { restore(); }
});

test("confirmed EA Next selector chooses the visible enabled button and sends one ordinary activation", () => {
  const interactions = [];
  const oldMouseEvent = globalThis.MouseEvent;
  const oldPointerEvent = globalThis.PointerEvent;
  const oldConsole = globalThis.console;
  const diagnostic = [];
  class EventMock { constructor(type) { this.type = type; } }
  globalThis.MouseEvent = EventMock;
  globalThis.PointerEvent = EventMock;
  globalThis.console = { debug: (...args) => diagnostic.push(args) };
  const hiddenDuplicate = {
    tagName: "BUTTON", className: "flat pagination next", innerText: "Next", textContent: "Next", disabled: false,
    __style: { display: "none", visibility: "hidden", opacity: "0" },
    dispatchEvent: (event) => interactions.push(event.type), click: () => interactions.push("click-hidden")
  };
  const visibleButton = {
    tagName: "BUTTON", className: "flat pagination next", innerText: "Next", textContent: "Next", disabled: false,
    outerHTML: '<button class="flat pagination next">Next</button>',
    scrollIntoView: () => interactions.push("scroll"), focus: () => interactions.push("focus"),
    dispatchEvent: (event) => interactions.push(event.type), click: () => interactions.push("click")
  };
  const restore = installResultsPageFixture([hiddenDuplicate, visibleButton]);
  try {
    assert.equal(adapter.findNextControl(), visibleButton);
    assert.equal(adapter.triggerNext(visibleButton), true);
    assert.deepEqual(interactions, ["scroll", "focus", "pointerdown", "mousedown", "pointerup", "mouseup", "click"]);
    assert.equal(diagnostic.length, 1);
    assert.equal(diagnostic[0][0], "[FC27 Market Assistant] EA Next control diagnostic");
    assert.equal(diagnostic[0][1].selector, "button.flat.pagination.next");
    assert.equal(diagnostic[0][1].outerHTML, visibleButton.outerHTML);
    assert.equal(diagnostic[0][1].text, "Next");
    assert.equal(diagnostic[0][1].disabled, false);
    assert.equal(diagnostic[0][1].hidden, false);
    assert.deepEqual(diagnostic[0][1].boundingRect, { x: 12, y: 34, width: 64, height: 32 });
  } finally {
    globalThis.MouseEvent = oldMouseEvent;
    globalThis.PointerEvent = oldPointerEvent;
    globalThis.console = oldConsole;
    restore();
  }
});

test("Next text node resolves to its visible button ancestor", () => {
  let clicks = 0;
  const button = { tagName: "BUTTON", innerText: "Next >", textContent: "Next >", disabled: false, isConnected: true, getAttribute: () => null, closest: () => null, click: () => { clicks += 1; } };
  const span = { tagName: "SPAN", innerText: "Next >", textContent: "Next >", isConnected: true, parentElement: button, getAttribute: () => null, closest: () => null };
  button.parentElement = null;
  button.getBoundingClientRect = () => ({ width: 64, height: 32 });
  span.getBoundingClientRect = () => ({ width: 64, height: 32 });
  const restore = installResultsPageFixture([]);
  const originalWalker = globalThis.document.createTreeWalker;
  globalThis.document.createTreeWalker = () => {
    let emitted = false;
    return { nextNode: () => emitted ? null : (emitted = true, { nodeValue: "Next", parentElement: span }) };
  };
  try {
    assert.equal(adapter.findNextControl(), button);
    assert.equal(adapter.triggerNext(button), true);
    assert.equal(clicks, 1);
  } finally {
    globalThis.document.createTreeWalker = originalWalker;
    restore();
  }
});

test("visible Next text without a unique clickable control is reported safely", () => {
  const next = { tagName: "DIV", innerText: "Next >", textContent: "Next >", isConnected: true, getAttribute: () => null, getBoundingClientRect: () => ({ width: 64, height: 32 }) };
  const restore = installResultsPageFixture([next]);
  globalThis.document.createTreeWalker = () => {
    let emitted = false;
    return { nextNode: () => emitted ? null : (emitted = true, { nodeValue: "Next", parentElement: next }) };
  };
  try {
    assert.equal(adapter.findNextControl(), null);
    assert.deepEqual(adapter.getNextControlStatus(), { found: true, disabled: false, clickable: false });
  } finally { restore(); }
});

test("missing and disabled Next pagination controls are not clickable", () => {
  const restoreMissing = installResultsPageFixture([]);
  try { assert.equal(adapter.findNextControl(), null); }
  finally { restoreMissing(); }

  const disabled = { tagName: "BUTTON", innerText: "Next >", textContent: "Next >", disabled: true, click() { throw new Error("disabled Next must not be clicked"); } };
  const restoreDisabled = installResultsPageFixture([disabled]);
  try {
    assert.equal(adapter.findNextControl(), null);
    assert.equal(adapter.triggerNext(disabled), false);
  } finally { restoreDisabled(); }
});

test("an unrelated Next-labeled control outside pagination is rejected", () => {
  const next = { tagName: "BUTTON", innerText: "Next >", textContent: "Next >", disabled: false, click() {} };
  const restore = installResultsPageFixture([next]);
  next.closest = (selector) => selector.includes("#fc27-chrome-assistant") ? {} : null;
  try { assert.equal(adapter.findNextControl(), null); }
  finally { restore(); }
});

test("ambiguous multiple pagination Next controls are rejected", () => {
  const nextOne = { tagName: "BUTTON", innerText: "Next >", textContent: "Next >", disabled: false, click() {} };
  const nextTwo = { tagName: "BUTTON", innerText: "Next", textContent: "Next", disabled: false, click() {} };
  const restore = installResultsPageFixture([nextOne, nextTwo]);
  try { assert.equal(adapter.findNextControl(), null); }
  finally { restore(); }
});
