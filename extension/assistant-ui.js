(function attachAssistantUi(root) {
  "use strict";

  const NEXT_SELECTOR = "button.flat.pagination.next";
  const DEFAULT_DEBUG_MODE = false;

  function clean(value) { return String(value == null ? "" : value).replace(/\s+/g, " ").trim(); }
  function formatStatus(state) {
    const status = clean(state && state.status).toLocaleUpperCase();
    if (!state || status === "READY" || !status) return "Ready";
    if (state.running) return "Scanning";
    if (/^SCAN COMPLETE/.test(status)) return "Complete";
    if (status === "STOPPED") return "Stopped";
    if (/STOPPED|FAILED|ERROR|UNAVAILABLE|UNREADABLE|DID NOT CHANGE|DID NOT LOAD|TIME LIMIT|NOT EXECUTED|SIGN-IN|DIALOGUE|SECURITY CHECK/.test(status)) return "Error";
    return status === "DETECTING THE EA TRANSFER MARKET VIEW…" ? "Ready" : "Error";
  }

  function aggregateLowestPrices(listings) {
    const counts = new Map();
    (Array.isArray(listings) ? listings : []).forEach((listing) => {
      const price = Number(listing && listing.bin);
      if (!Number.isFinite(price) || price <= 0) return;
      counts.set(price, (counts.get(price) || 0) + 1);
    });
    return Array.from(counts, ([price, count]) => ({ price, count }))
      .sort((left, right) => left.price - right.price).slice(0, 3);
  }

  function safeReportValue(value, fallback) {
    const text = clean(value) || fallback;
    return text.replace(/[\r\n]+/g, " ").slice(0, 180);
  }

  function buildDebugReport(state, diagnostics) {
    const snapshot = state || {};
    const info = diagnostics || {};
    const audit = Array.isArray(snapshot.pageAudit) ? snapshot.pageAudit : [];
    const lastAudit = audit[audit.length - 1] || {};
    const actionEntries = audit.filter((entry) => entry.nextAction && entry.nextAction !== "NOT ATTEMPTED" && entry.nextAction !== "NOT NEEDED");
    const attempts = Number.isFinite(info.attempts) ? info.attempts : actionEntries.length + (info.pendingAttempt ? 1 : 0);
    const successfulChanges = Number.isFinite(info.successfulPageChanges)
      ? info.successfulPageChanges : Math.max(0, Number(snapshot.pagesConfirmed || 0) - 1);
    const failedClicks = Number.isFinite(info.failedClicks)
      ? info.failedClicks : actionEntries.filter((entry) => entry.nextClick === "FAILED").length;
    const prices = aggregateLowestPrices(snapshot.scannedListings);
    const summary = snapshot.metrics || {};
    const target = safeReportValue(snapshot.targetPlayerName || snapshot.targetFilter, "Unknown");
    const resultPlayer = safeReportValue(snapshot.currentResultsPlayer, "Unknown");
    const status = safeReportValue(snapshot.status, "Ready");
    const error = /STOPPED|FAILED|ERROR|UNAVAILABLE|UNREADABLE|DID NOT CHANGE|TIME LIMIT|NOT EXECUTED/i.test(status) ? status : "NONE";
    const clickResult = failedClicks ? "FAILED" : attempts > successfulChanges ? "ATTEMPTED" : attempts ? "SUCCESS" : "NONE";
    const changed = successfulChanges > 0 ? "YES" : attempts ? "NO" : "NO";
    const money = (value) => Number.isFinite(Number(value)) ? String(Math.round(Number(value))) : "N/A";
    const lowestRows = prices.length ? prices.map((entry) => `${entry.price} = ${entry.count} cards`).join("\n") : "NO PRICE DATA";
    return [
      "FC27 MARKET ASSISTANT — DEBUG REPORT",
      `Version: ${safeReportValue(info.version, "0.1.0")}`,
      "",
      "SESSION",
      `Status: ${formatStatus(snapshot).toUpperCase()}`,
      `Target Player: ${target}`,
      `Result Player: ${resultPlayer}`,
      `Pages Requested: ${Number(snapshot.pagesRequested || 0)}`,
      `Pages Confirmed: ${Number(snapshot.pagesConfirmed || 0)}`,
      "",
      "PAGINATION",
      `Current Page: ${Number(snapshot.pagesScanned || 0)}`,
      `Next Found: ${lastAudit.next === "FOUND" ? "YES" : "NO"}`,
      `Next Selector: ${NEXT_SELECTOR}`,
      `Next Click Attempts: ${attempts}`,
      `Successful Page Changes: ${successfulChanges}`,
      `Failed Clicks: ${failedClicks}`,
      `Last Pagination Action: ${attempts ? "NEXT" : "NONE"}`,
      "",
      "RESULTS",
      `Listings Scanned: ${Number(snapshot.listingsScanned || 0)}`,
      `Unique Listings: ${Number(snapshot.uniqueListingsScanned || 0)}`,
      `Repeated Observations Ignored: ${Number(snapshot.repeatedListingObservations || 0)}`,
      "",
      "PRICES",
      `Lowest BIN: ${money(summary.lowestBin)}`,
      `2nd BIN: ${money(summary.secondBin)}`,
      `3rd BIN: ${money(summary.thirdBin)}`,
      `Average BIN: ${money(summary.averageBin)}`,
      `Estimated EA Tax: ${money(summary.estimatedTax)}`,
      "",
      "LOWEST 3",
      lowestRows,
      "",
      "PLAYER DETECTION",
      `Target: ${target}`,
      `Result Player: ${resultPlayer}`,
      `Mixed Results: ${resultPlayer === "Multiple / Mixed Results" ? "YES" : "NO"}`,
      `Detection Source: ${target !== "Unknown" ? "EA_FILTER" : "OTHER"}${resultPlayer !== "Unknown" ? " / RESULT_CARDS" : ""}`,
      "",
      "LAST ACTION",
      `Action: ${attempts ? "NEXT" : "NONE"}`,
      `Element: ${NEXT_SELECTOR}`,
      `Visible: ${lastAudit.next === "FOUND" ? "YES" : "UNKNOWN"}`,
      `Disabled: ${lastAudit.next === "FOUND (DISABLED / UNSAFE)" ? "YES" : "NO"}`,
      `Click Result: ${clickResult}`,
      `Result Changed: ${changed}`,
      "",
      "ERRORS",
      `Current Error: ${error}`,
      `Last Error: ${error}`,
      `Scan Stop Reason: ${error === "NONE" ? "NONE" : status}`,
      "",
      "RECOVERY",
      "Initialization: OK",
      "Last Recovery: NONE",
      "",
      "END DEBUG REPORT"
    ].join("\n");
  }

  function visible(element) {
    if (!element) return false;
    if (typeof element.getBoundingClientRect !== "function") return true;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function findTransfersNavigationItem(doc) {
    const navigationScopes = Array.from(doc.querySelectorAll("nav, [role='navigation']"));
    for (const scope of navigationScopes) {
      const candidates = Array.from(scope.querySelectorAll("a, button, [role='button'], [tabindex]"));
      const match = candidates.find((item) => clean(item.innerText || item.textContent).toLocaleLowerCase() === "transfers" && visible(item));
      if (match) return match;
      const textMatches = Array.from(scope.querySelectorAll("*"))
        .filter((item) => clean(item.innerText || item.textContent).toLocaleLowerCase() === "transfers" && visible(item));
      if (textMatches.length) return textMatches[textMatches.length - 1];
    }
    return null;
  }

  function installNavigationEntry(doc, onOpen) {
    const existing = doc.getElementById("fc27-market-assistant-nav-entry");
    if (existing) return { entry: existing, button: existing.querySelector("button") };
    const transfers = findTransfersNavigationItem(doc);
    if (!transfers || !transfers.parentElement) return null;
    const row = transfers.tagName === "LI" ? transfers : transfers.parentElement.tagName === "LI" ? transfers.parentElement : transfers;
    const parent = row.parentElement;
    if (!parent || typeof parent.insertBefore !== "function") return null;
    const entry = doc.createElement(row.tagName === "LI" ? "li" : "div");
    entry.id = "fc27-market-assistant-nav-entry";
    entry.className = "fc27-nav-entry";
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "fc27-nav-button";
    button.textContent = "Market Assistant";
    button.setAttribute("aria-label", "Open Market Assistant");
    button.addEventListener("click", onOpen);
    entry.appendChild(button);
    parent.insertBefore(entry, row.nextSibling || null);
    return { entry, button };
  }

  root.FC27AssistantUI = Object.freeze({
    DEFAULT_DEBUG_MODE, aggregateLowestPrices, buildDebugReport, formatStatus,
    findTransfersNavigationItem, installNavigationEntry
  });
})(globalThis);
