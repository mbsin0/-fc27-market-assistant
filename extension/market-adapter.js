(function attachMarketAdapter(root) {
  "use strict";

  const PRICE_LIMIT = 15000000;
  const VIEW = Object.freeze({ SEARCH: "TRANSFER_MARKET_SEARCH", RESULTS: "TRANSFER_MARKET_RESULTS", UNKNOWN: "UNKNOWN" });
  const EA_NEXT_SELECTOR = "button.flat.pagination.next";
  const LISTING_LABELS = /Start Price\s*:?\s*[\d,]+[\s\S]*Buy Now\s*:?\s*[\d,]+|Buy Now\s*:?\s*[\d,]+[\s\S]*Start Price\s*:?\s*[\d,]+/i;
  const ID_ATTRIBUTE = /(?:auction|trade|listing|item|asset|player|card).*id|^data-id$|^id$/i;
  let capturedTargetPlayerName = "";

  function cleanText(value) { return String(value || "").replace(/\s+/g, " ").trim(); }
  function detectViewFromText(text, hasListings) {
    const normalized = cleanText(text);
    if (/search results/i.test(normalized) || hasListings) return VIEW.RESULTS;
    if (/search the transfer market/i.test(normalized)) return VIEW.SEARCH;
    return VIEW.UNKNOWN;
  }
  function isVisible(element) {
    if (!element || !element.isConnected || !document.documentElement.contains(element)) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0 && rect.width > 0 && rect.height > 0;
  }
  function getVisiblePageText() { return cleanText(document.body && document.body.innerText); }
  function outsideAssistant(element) { return !element.closest("#fc27-chrome-assistant"); }
  function getControlLabel(control) {
    const labelledBy = (control.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean).map((id) => document.getElementById(id)).filter(Boolean).map((el) => el.innerText || el.textContent || "").join(" ");
    const explicitLabel = control.labels ? Array.from(control.labels).map((el) => el.innerText || el.textContent || "").join(" ") : "";
    return cleanText(control.getAttribute("aria-label") || labelledBy || explicitLabel || control.getAttribute("placeholder") || control.getAttribute("title") || control.name || "");
  }
  function getControlValue(control) {
    const type = String(control.type || "").toLowerCase();
    if (["password", "email", "file"].includes(type)) return "";
    if ((type === "checkbox" || type === "radio") && !control.checked) return "";
    if (control.tagName === "SELECT") return Array.from(control.selectedOptions || []).map((o) => cleanText(o.textContent)).join(", ");
    if (type === "checkbox" || type === "radio") return control.value || "selected";
    if (control.getAttribute("contenteditable") === "true" || control.isContentEditable) return cleanText(control.innerText || control.textContent);
    if ("value" in control) return cleanText(control.value);
    return cleanText(control.innerText || control.textContent);
  }
  function isMeaningfulPlayerName(value) {
    const name = cleanText(value).replace(/\s+(?:remove|clear|selected)$/i, "").trim();
    return Boolean(name && /[a-z]/i.test(name) && !/^(?:player|search|select player|search player|player name|search by player)$/i.test(name));
  }
  function getPlayerFieldDescription(control) {
    const labelledBy = (control.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean)
      .map((id) => document.getElementById(id)).filter(Boolean).map((el) => el.innerText || el.textContent || "").join(" ");
    const labels = control.labels ? Array.from(control.labels).map((el) => el.innerText || el.textContent || "").join(" ") : "";
    return cleanText([
      control.getAttribute("aria-label"), labelledBy, labels, control.name,
      control.getAttribute("title"), control.getAttribute("placeholder")
    ].filter(Boolean).join(" "));
  }
  function readTargetPlayerName(scope) {
    const rootElement = scope || document;
    const playerControls = Array.from(rootElement.querySelectorAll("input:not([type='hidden']), textarea, [role='combobox'], [contenteditable='true']"))
      .filter((control) => outsideAssistant(control) && isVisible(control))
      .filter((control) => /player|footballer|athlete|player name/i.test(getPlayerFieldDescription(control)));
    for (const control of playerControls) {
      let ancestor = control;
      for (let depth = 0; ancestor && depth < 4; depth += 1, ancestor = ancestor.parentElement) {
        const selectedWithin = Array.from(ancestor.querySelectorAll ? ancestor.querySelectorAll("[role='option'][aria-selected='true'], [role='option'][data-selected='true']") : [])
          .filter((option) => outsideAssistant(option) && isVisible(option))
          .map((option) => option.innerText || option.textContent || option.getAttribute("aria-label"))
          .map(cleanText).find(isMeaningfulPlayerName);
        if (selectedWithin) return selectedWithin;
      }
      const type = String(control.type || "").toLowerCase();
      const contenteditable = control.getAttribute("contenteditable") === "true" || control.isContentEditable;
      const controlValue = !contenteditable && "value" in control && !["password", "email", "file"].includes(type)
        ? cleanText(control.value)
        : "";
      const value = controlValue || cleanText(control.innerText || control.textContent);
      if (isMeaningfulPlayerName(value)) return value;
      const selectedWithinControl = Array.from(control.querySelectorAll ? control.querySelectorAll("[role='option'][aria-selected='true'], [role='option'][data-selected='true']") : [])
        .filter((option) => isVisible(option)).map((option) => cleanText(option.innerText || option.textContent)).find(isMeaningfulPlayerName);
      if (selectedWithinControl) return selectedWithinControl;
    }
    return "";
  }
  function rememberTargetPlayerName(value) {
    const name = cleanText(value).replace(/\s+(?:remove|clear|selected)$/i, "").trim();
    if (isMeaningfulPlayerName(name)) capturedTargetPlayerName = name;
    return capturedTargetPlayerName;
  }
  function getCapturedTargetPlayerName() { return capturedTargetPlayerName; }
  function readCurrentFilters(scope) {
    const rootElement = scope || document;
    return Array.from(rootElement.querySelectorAll("input:not([type='hidden']), select, textarea, [role='combobox'], [role='checkbox'], [role='radio'], [contenteditable='true']"))
      .filter((control) => outsideAssistant(control) && isVisible(control))
      .map((control) => ({ label: getControlLabel(control), value: getControlValue(control) }))
      .filter((entry) => entry.label && entry.value).slice(0, 16);
  }
  function searchControlLabel(control) {
    const labelledBy = (control.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean)
      .map((id) => document.getElementById(id)).filter(Boolean).map((el) => el.innerText || el.textContent || "").join(" ");
    return [
      control.getAttribute("aria-label"), labelledBy, control.innerText, control.textContent,
      control.tagName === "INPUT" ? control.value : "", control.getAttribute("title")
    ].map(cleanText).find(Boolean) || "";
  }
  function isDisabledControl(control) { return control.disabled === true || control.getAttribute("aria-disabled") === "true" || control.getAttribute("data-disabled") === "true"; }
  function isNormalSearchName(control) { return /^(?:search|search market|search the transfer market)$/i.test(searchControlLabel(control)); }
  function findSearchControl(scope) {
    const candidates = Array.from((scope || document).querySelectorAll("button, input[type='submit'], [role='button']"))
      .filter((control) => outsideAssistant(control) && isVisible(control) && !isDisabledControl(control) && isNormalSearchName(control));
    if (!candidates.length || !readCurrentFilters(scope || document).length) return null;
    const pageText = getVisiblePageText();
    const searchViewContext = /search the transfer market/i.test(pageText);
    const related = candidates.filter((control) => {
      const container = control.closest("form, [role='search'], [role='group'], fieldset, section, main");
      if (!container) return false;
      const contextText = cleanText(container.innerText || container.textContent);
      const hasFilterControls = readCurrentFilters(container).length > 0;
      return /search the transfer market/i.test(contextText) ||
        (searchViewContext && (hasFilterControls || /form|search/i.test(String(container.tagName || "") + " " + (container.getAttribute("role") || ""))));
    });
    if (related.length === 1) return related[0];
    // EA may render the title, filters, and Search action in separate layout
    // containers. A unique exact Search control on that explicit view, with
    // readable selected filters, remains safely attributable to the form.
    return related.length === 0 && searchViewContext && candidates.length === 1 ? candidates[0] : null;
  }
  function triggerSearch(control) {
    if (!control || findSearchControl() !== control || !control.isConnected || !outsideAssistant(control) || !isVisible(control) || isDisabledControl(control) || !isNormalSearchName(control)) return false;
    control.click();
    return true;
  }
  function hasReadableFilterForm(scope) { return readCurrentFilters(scope).length > 0 && Boolean(findSearchControl(scope)); }
  function isLoginVisible() {
    const text = getVisiblePageText();
    return /sign in to your EA account|log in to your EA account|enter your email and password/i.test(text) || Boolean(document.querySelector("input[type='password']") && /sign in|log in/i.test(text));
  }
  function extractNumber(text, label) {
    const match = String(text || "").match(new RegExp(label + "\\s*:?\\s*([\\d,]+)", "i"));
    if (!match) return null;
    const number = Number(match[1].replace(/,/g, ""));
    return Number.isFinite(number) ? number : null;
  }
  function parseListingText(text, index, identifiers) {
    const raw = String(text || "").trim();
    const bin = extractNumber(raw, "Buy Now");
    if (!LISTING_LABELS.test(raw) || !Number.isFinite(bin) || bin < 500 || bin > PRICE_LIMIT) return null;
    const lines = raw.split(/[\r\n]+/).map(cleanText).filter(Boolean);
    const name = lines.find((line) => /[A-Za-z]/.test(line) && !/^\d{2,3}\s+[A-Z]{1,4}\b/i.test(line) && !/^(?:PAC|SHO|PAS|DRI|DEF|PHY)\b/i.test(line) && !/^(?:Start Price|Buy Now|Bid|Current Bid|Sold For|Time|Expires?|\d)/i.test(line));
    const bid = extractNumber(raw, "(?:Current\\s+)?Bid");
    const timeMatch = raw.match(/\b(?:Time|Expires?)\s*:?\s*([^\r\n]+?)(?=\s+(?:Start Price|Bid|Current Bid|Buy Now|Sold For)\b|$)/i);
    const idEntries = Array.isArray(identifiers) ? identifiers : [];
    const attributeName = (entry) => String(entry).split("=")[0].toLowerCase();
    const attributeValue = (entry) => String(entry).slice(String(entry).indexOf("=") + 1);
    const auction = idEntries.find((entry) => /(?:auction|trade|listing)[-_]?id/.test(attributeName(entry))) || "";
    const genericListingId = idEntries.find((entry) => attributeName(entry) === "data-id" && /^(?:\d{6,}|[0-9a-f]{8}-[0-9a-f-]{27,})$/i.test(attributeValue(entry))) || "";
    const item = idEntries.find((entry) => /(?:item|asset|player|card)[-_]?id/.test(attributeName(entry))) || "";
    const listingId = auction ? attributeValue(auction) : genericListingId ? attributeValue(genericListingId) : "";
    const itemId = item ? attributeValue(item) : "";
    const stableStatus = timeMatch && !/^\d+(?::\d+)?\s*(?:s|sec|secs|seconds?|m|min|mins|minutes?)\b/i.test(cleanText(timeMatch[1]))
      ? cleanText(timeMatch[1]).toLocaleLowerCase()
      : "";
    const playerIdentity = cleanText(name || "Unknown player").toLocaleLowerCase();
    const position = Number(index) + 1;
    const listingIdentity = listingId
      ? `listing:${listingId}`
      : `card:${playerIdentity}|${itemId}|${extractNumber(raw, "Start Price") ?? ""}|${bin}|${bid ?? ""}|${stableStatus}|${position}`;
    const cardIdentity = [
      listingIdentity, playerIdentity, itemId, extractNumber(raw, "Start Price") ?? "",
      bin, bid ?? "", stableStatus, `position:${position}`
    ].join("|");
    return {
      player: name || "Unknown player", bin, startPrice: extractNumber(raw, "Start Price"),
      currentBid: bid, bid, timeRemaining: timeMatch ? cleanText(timeMatch[1]) : null,
      status: timeMatch ? cleanText(timeMatch[1]) : null,
      tradeId: auction && /trade/.test(attributeName(auction)) ? attributeValue(auction) : "",
      itemId,
      listingId,
      listingIdentity,
      cardIdentity,
      identity: cardIdentity,
      token: "fc27-row-" + index, raw
    };
  }
  function parseListingTexts(texts) { return (texts || []).map((text, index) => parseListingText(text, index, [])).filter(Boolean); }
  function collectListingIds(element) {
    const nodes = [element, ...Array.from(element.querySelectorAll("*"))];
    const ids = [];
    nodes.forEach((node) => Array.from(node.attributes || []).forEach((attribute) => {
      if (!ID_ATTRIBUTE.test(attribute.name) || !attribute.value) return;
      if (attribute.name.toLowerCase() === "id" && !/(?:auction|trade|listing|item|player|card)/i.test(attribute.value)) return;
      ids.push(attribute.name + "=" + attribute.value);
    }));
    return Array.from(new Set(ids));
  }
  function isListingElement(element) {
    const text = cleanText(element.innerText);
    if (!LISTING_LABELS.test(text) || !outsideAssistant(element) || !isVisible(element)) return false;
    return !Array.from(element.children).some((child) => isVisible(child) && LISTING_LABELS.test(cleanText(child.innerText)));
  }
  function readVisibleListings() {
    if (!document.body) return [];
    const rootElement = document.querySelector("main") || document.body;
    const elements = Array.from(rootElement.querySelectorAll("*"));
    const cards = elements.filter(isListingElement);
    return cards.map((element, index) => {
      const listing = parseListingText(element.innerText || "", index, collectListingIds(element));
      if (listing) listing.element = element;
      return listing;
    }).filter(Boolean);
  }
  function detectView() {
    const text = getVisiblePageText();
    const listings = readVisibleListings().length > 0;
    if (listings || /search results/i.test(text)) return VIEW.RESULTS;
    if (/search the transfer market/i.test(text)) return VIEW.SEARCH;
    return findSearchControl() ? VIEW.SEARCH : VIEW.UNKNOWN;
  }
  function getUnsafeReason() {
    const text = getVisiblePageText();
    if (isLoginVisible()) return "EA sign-in is visible. Sign in manually; the scanner stopped.";
    if (/captcha|robot verification|verify that you(?:'| a)m human|security challenge/i.test(text)) return "A CAPTCHA or security check is visible. The scanner stopped without interacting with it.";
    if (/too many (?:requests|searches)|rate.?limit|try again later|please wait before/i.test(text)) return "EA indicates a search cooldown or rate limit. Search stopped; wait and restart manually.";
    if (/Transfer Market.{0,60}(?:unavailable|not available|maintenance|temporarily disabled)/i.test(text)) return "The Transfer Market appears unavailable. The scanner stopped.";
    if (/are you sure|confirm (?:purchase|buy|bid|listing)|purchase confirmation/i.test(text)) return "A confirmation or purchase dialogue appeared. The scanner stopped without interacting with it.";
    const dialogs = Array.from(document.querySelectorAll("dialog[open], [role='dialog'], [role='alertdialog']")).filter((dialog) => outsideAssistant(dialog) && isVisible(dialog));
    if (dialogs.some((dialog) => !hasReadableFilterForm(dialog) && !/search results/i.test(cleanText(dialog.innerText)))) return "An unexpected EA dialogue is open. The scanner stopped without interacting with it.";
    return "";
  }
  function captureResults() {
    const listings = readVisibleListings();
    const identities = listings.map((listing) => listing.cardIdentity || listing.listingIdentity || listing.identity);
    const container = document.querySelector("main") || document.body;
    return {
      listings,
      listingIdentities: identities,
      firstListingIdentity: identities[0] || "",
      lastListingIdentity: identities[identities.length - 1] || "",
      signature: identities.join("\n"),
      resultContainer: container,
      firstElement: listings[0] && listings[0].element || null,
      lastElement: listings[listings.length - 1] && listings[listings.length - 1].element || null,
      paginationState: container ? Array.from(container.querySelectorAll("button, a, [role='button']"))
        .filter((control) => outsideAssistant(control) && isVisible(control))
        .map((control) => `${cleanText(control.innerText || control.textContent)}:${isDisabledControl(control)}`)
        .filter((value) => /^(?:next|previous|prev)(?:\s*[<>›»])?:/i.test(value)).join("|") : ""
    };
  }
  function isSearchBusy() {
    if (Array.from(document.querySelectorAll("[aria-busy='true']")).some((el) => outsideAssistant(el) && isVisible(el))) return true;
    return Array.from(document.querySelectorAll("button, [role='button'], [role='status']")).some((el) => outsideAssistant(el) && isVisible(el) && (/^(?:searching|loading results)\b/i.test(searchControlLabel(el)) || (el.disabled && /^(?:search|search market|search transfer market|apply filters)$/i.test(searchControlLabel(el)))));
  }
  function sameElements(left, right) { return left.length === right.length && left.every((listing, index) => listing.element === right[index].element); }
  function hasExplicitEmptyResults() { return /no (?:transfer market )?(?:results|items|players) found/i.test(getVisiblePageText()); }
  function delay(ms, signal) { return new Promise((resolve) => { const timer = setTimeout(resolve, ms); if (signal) signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true }); }); }
  async function waitForSettledResults(options) {
    const signal = options && options.signal;
    const timeoutMs = options && options.timeoutMs || 12000;
    const started = Date.now();
    let previous = null;
    let repeat = 0;
    while (Date.now() - started < timeoutMs) {
      if (signal && signal.aborted) return { stopped: true };
      const safety = getUnsafeReason();
      if (safety) return { error: safety };
      if (detectView() !== VIEW.RESULTS || isSearchBusy()) { previous = null; repeat = 0; await delay(300, signal); continue; }
      const snapshot = captureResults();
      if (previous && snapshot.signature === previous.signature && sameElements(snapshot.listings, previous.listings)) repeat += 1;
      else { previous = snapshot; repeat = 1; }
      if (repeat >= 4 && (snapshot.listings.length || hasExplicitEmptyResults())) return snapshot;
      await delay(350, signal);
    }
    if (detectView() === VIEW.RESULTS && !isSearchBusy() && !readVisibleListings().length && hasExplicitEmptyResults()) return { listings: [], signature: "" };
    return { error: "EA results did not settle before the scanner timeout. Search stopped." };
  }
  async function waitForFreshResults(before, options) {
    const signal = options && options.signal;
    const started = Date.now();
    while (Date.now() - started < (options.timeoutMs || 15000)) {
      if (signal && signal.aborted) return { stopped: true };
      const safety = getUnsafeReason();
      if (safety) return { error: safety };
      if (detectView() === VIEW.RESULTS) {
        const result = await waitForSettledResults({ signal, timeoutMs: Math.max(1000, options.timeoutMs - (Date.now() - started)) });
        if (result.error || result.stopped) return result;
        if (result.listings.length || detectView() === VIEW.RESULTS) return result;
      }
      await delay(350, signal);
    }
    return { error: "EA did not navigate to a settled Search Results view. Search stopped." };
  }
  async function waitForChangedResults(before, options) {
    const signal = options && options.signal;
    const timeoutMs = options && options.timeoutMs || 12000;
    const started = Date.now();
    let candidate = null;
    let repeats = 0;
    let loadingSeen = false;
    while (Date.now() - started < timeoutMs) {
      if (signal && signal.aborted) return { stopped: true };
      const safety = getUnsafeReason();
      if (safety) return { error: safety };
      if (detectView() !== VIEW.RESULTS || isSearchBusy()) {
        if (isSearchBusy()) loadingSeen = true;
        candidate = null;
        repeats = 0;
        await delay(300, signal);
        continue;
      }
      const snapshot = captureResults();
      const explicitlyEmpty = hasExplicitEmptyResults();
      if (!snapshot.listings.length && !explicitlyEmpty) {
        candidate = null;
        repeats = 0;
        await delay(350, signal);
        continue;
      }
      if (candidate && snapshot.signature === candidate.signature && sameElements(snapshot.listings, candidate.listings) && snapshot.paginationState === candidate.paginationState) repeats += 1;
      else { candidate = snapshot; repeats = 1; }
      const refreshed = snapshot.signature !== before.signature || snapshot.resultContainer !== before.resultContainer ||
        snapshot.firstElement !== before.firstElement || snapshot.lastElement !== before.lastElement ||
        snapshot.paginationState !== before.paginationState || loadingSeen;
      if (repeats >= 4 && refreshed) return { ...captureResults(), transitionConfirmed: true };
      await delay(350, signal);
    }
    return { error: "NEXT CLICK FAILED" };
  }
  function nextTextMatches(value) { return /^next(?:\s*>|\s*›|\s*»)?$/i.test(cleanText(value)); }
  function isClickableNextAncestor(element) {
    return element && (["BUTTON", "A"].includes(element.tagName) || element.getAttribute("role") === "button");
  }
  function inspectNextControl() {
    if (detectView() !== VIEW.RESULTS) return { found: false, disabled: false, control: null };
    const resultsArea = document.querySelector("main") || document.body;
    const listings = readVisibleListings();
    if (!resultsArea || !listings.length) return { found: false, disabled: false, control: null };

    // EA's current result view exposes pagination as this specific button.
    // Prefer that known control and filter hidden/disabled duplicates before
    // deciding whether it is safe to activate.
    const eaNextButtons = Array.from(resultsArea.querySelectorAll(EA_NEXT_SELECTOR))
      .filter((control) => outsideAssistant(control) && isVisible(control) && nextTextMatches(control.innerText || control.textContent));
    if (eaNextButtons.length) {
      const enabledEaButtons = eaNextButtons.filter((control) => !isDisabledControl(control));
      return {
        found: true,
        disabled: enabledEaButtons.length === 0,
        control: enabledEaButtons.length === 1 ? enabledEaButtons[0] : null,
        selector: EA_NEXT_SELECTOR
      };
    }

    const matches = new Set();
    let visibleNextText = false;
    const addClickableAncestors = (start) => {
      let current = start;
      while (current && current !== resultsArea.parentElement) {
        if (isVisible(current) && nextTextMatches(current.innerText || current.textContent)) {
          visibleNextText = true;
          if (isClickableNextAncestor(current)) matches.add(current);
        }
        if (current === resultsArea) break;
        current = current.parentElement;
      }
    };

    const controls = Array.from(resultsArea.querySelectorAll("button, a, [role='button']"));
    controls.forEach((control) => {
      if (!outsideAssistant(control) || !isVisible(control)) return;
      const displayedText = cleanText(control.innerText || control.textContent);
      if (nextTextMatches(displayedText)) {
        visibleNextText = true;
        matches.add(control);
      }
    });

    if (typeof document.createTreeWalker === "function") {
      const walker = document.createTreeWalker(resultsArea, 4);
      let textNode;
      while ((textNode = walker.nextNode())) {
        if (!/\bnext\b/i.test(String(textNode.nodeValue || ""))) continue;
        const parent = textNode.parentElement;
        if (parent && outsideAssistant(parent) && isVisible(parent)) addClickableAncestors(parent);
      }
    }

    const inResultsArea = Array.from(matches).filter((control) => outsideAssistant(control) && isVisible(control));
    const enabled = inResultsArea.filter((control) => !isDisabledControl(control));
    const allDisabled = inResultsArea.length > 0 && enabled.length === 0;
    return {
      found: visibleNextText || inResultsArea.length > 0,
      disabled: allDisabled,
      control: enabled.length === 1 ? enabled[0] : null
    };
  }
  function findNextControl() { return inspectNextControl().control; }
  function getNextControlStatus() {
    const status = inspectNextControl();
    return { found: status.found, disabled: status.disabled, clickable: Boolean(status.control) };
  }
  function triggerNext(control) {
    if (!control || findNextControl() !== control || !control.isConnected || !outsideAssistant(control) || !isVisible(control) || isDisabledControl(control)) return false;
    try {
      const rect = control.getBoundingClientRect();
      const style = getComputedStyle(control);
      if (root.FC27_DEBUG_MARKET_SCAN === true && control.matches && control.matches(EA_NEXT_SELECTOR) && root.console && typeof root.console.debug === "function") {
        root.console.debug("[FC27 Market Assistant] EA Next control diagnostic", {
          selector: EA_NEXT_SELECTOR,
          outerHTML: control.outerHTML,
          text: cleanText(control.innerText || control.textContent),
          disabled: isDisabledControl(control),
          hidden: !isVisible(control),
          display: style.display,
          visibility: style.visibility,
          opacity: style.opacity,
          boundingRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        });
      }
      if (typeof control.scrollIntoView === "function") control.scrollIntoView({ block: "nearest" });
      if (typeof control.focus === "function") {
        try { control.focus({ preventScroll: true }); } catch (_error) { control.focus(); }
      }
      // Send the ordinary pointer/mouse down and up sequence to the same EA
      // button, then perform one native click activation (never a second click).
      if (typeof control.dispatchEvent === "function" && typeof root.MouseEvent === "function") {
        if (typeof root.PointerEvent === "function") {
          control.dispatchEvent(new root.PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerType: "mouse", button: 0, buttons: 1 }));
        }
        control.dispatchEvent(new root.MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, buttons: 1 }));
        if (typeof root.PointerEvent === "function") {
          control.dispatchEvent(new root.PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerType: "mouse", button: 0, buttons: 0 }));
        }
        control.dispatchEvent(new root.MouseEvent("mouseup", { bubbles: true, cancelable: true, button: 0, buttons: 0 }));
      }
      control.click();
      return true;
    } catch (_error) {
      return false;
    }
  }
  function revealListing(listing) {
    if (!listing || !listing.element || !listing.element.isConnected) return false;
    listing.element.scrollIntoView({ behavior: "smooth", block: "center" });
    listing.element.setAttribute("data-fc27-highlight", "true");
    setTimeout(() => listing.element && listing.element.removeAttribute("data-fc27-highlight"), 3500);
    return true;
  }
  root.FC27MarketAdapter = Object.freeze({
    VIEW, cleanText, detectViewFromText, detectView, parseListingText, parseListingTexts, readTargetPlayerName,
    rememberTargetPlayerName, getCapturedTargetPlayerName,
    readCurrentFilters, findSearchControl, triggerSearch, hasReadableFilterForm, isLoginVisible,
    getUnsafeReason, readVisibleListings, captureResults, isSearchBusy, waitForFreshResults,
    waitForSettledResults, waitForChangedResults, findNextControl, getNextControlStatus,
    triggerNext, revealListing, getVisiblePageText
  });
})(globalThis);
