(function attachSearchEngine(root) {
  "use strict";

  const SEARCH_TIMEOUT_MS = 15000;
  const PAGE_TIMEOUT_MS = 12000;

  function summarizeResultIdentity(listings) {
    const names = new Map();
    (listings || []).forEach((listing) => {
      const name = String(listing && listing.player || "").replace(/\s+/g, " ").trim();
      if (!name || /^unknown player$/i.test(name)) return;
      const key = name.toLocaleLowerCase();
      if (!names.has(key)) names.set(key, name);
    });
    if (names.size === 0) return "Could not identify player";
    if (names.size > 1) return "Multiple / Mixed Results";
    return names.values().next().value;
  }

  function listingIdentityForDedup(listing, index) {
    if (listing && listing.listingId) return `listing:${listing.listingId}`;
    if (listing && listing.tradeId) return `trade:${listing.tradeId}`;
    if (listing && listing.listingIdentity) return String(listing.listingIdentity);
    if (listing && listing.cardIdentity) return String(listing.cardIdentity);
    if (listing && listing.identity) return String(listing.identity);
    return [listing && listing.player, listing && listing.itemId, listing && listing.startPrice,
      listing && listing.bin, listing && (listing.currentBid ?? listing.bid), index].join("|");
  }

  function resultSignature(result) {
    if (result && typeof result.signature === "string") return result.signature;
    return (result && result.listings || []).map((listing, index) =>
      listing.cardIdentity || listing.listingIdentity || listing.identity || listingIdentityForDedup(listing, index)
    ).join("\n");
  }

  function logPageIdentity(pageNumber, page) {
    if (root.FC27_DEBUG_MARKET_SCAN !== true || !root.console || typeof root.console.debug !== "function") return;
    const listings = page && page.listings || [];
    const identities = page && page.listingIdentities || listings.map((listing, index) =>
      listing.cardIdentity || listing.listingIdentity || listing.identity || listingIdentityForDedup(listing, index)
    );
    root.console.debug("[FC27 Market Assistant] scanned page identity", {
      page: pageNumber,
      signature: resultSignature(page),
      firstListingIdentity: identities[0] || "",
      lastListingIdentity: identities[identities.length - 1] || ""
    });
  }

  function listingAuditIdentity(listing) {
    return listing && (listing.listingId || listing.tradeId) || "Not available";
  }

  function auditListing(listing) {
    return listing ? {
      player: listing.player || "Unknown player",
      bin: listing.bin == null ? "Not available" : listing.bin,
      stableId: listingAuditIdentity(listing)
    } : null;
  }

  function auditSnapshot(snapshot) {
    const listings = snapshot && snapshot.listings || [];
    return {
      first: auditListing(listings[0]),
      last: auditListing(listings[listings.length - 1]),
      signature: resultSignature(snapshot)
    };
  }

  function didResultDomChange(before, after) {
    return Boolean(after && (
      resultSignature(before) !== resultSignature(after) ||
      before.resultContainer !== after.resultContainer ||
      before.firstElement !== after.firstElement || before.lastElement !== after.lastElement ||
      before.paginationState !== after.paginationState
    ));
  }

  function createSearchEngine(adapter, options) {
    const onState = options && options.onState ? options.onState : () => {};
    const state = {
      running: false, status: "Ready", phase: "START", targetFilter: "Not configured in this session",
      targetPlayerName: "", currentResultsPlayer: "Not scanned", pagesScanned: 0, pagesConfirmed: 0, pagesRequested: 0, listingsScanned: 0,
      uniqueListingsScanned: 0, repeatedListingObservations: 0,
      metrics: null, findings: [], scannedListings: [], nextPageAvailable: false, pageAudit: []
    };
    let controller = null;
    let runId = 0;

    function publish() {
      onState({ ...state, findings: [...state.findings], metrics: state.metrics && { ...state.metrics },
        scannedListings: state.scannedListings.map(({ element: _element, ...listing }) => ({ ...listing })),
        pageAudit: state.pageAudit.map((entry) => ({ ...entry })) });
    }
    function finish(message) {
      state.running = false;
      state.phase = /^SCAN COMPLETE/.test(message) ? "SCAN_COMPLETE" : "STOPPED";
      state.status = message;
      controller = null;
      publish();
    }
    function remainingTime(startedAt, timeLimitMs) { return Math.max(0, timeLimitMs - (Date.now() - startedAt)); }

    async function start(settings) {
      if (state.running) return;
      const run = ++runId;
      controller = new AbortController();
      const signal = controller.signal;
      const startedAt = Date.now();
      const pagesToScan = Math.max(1, Math.min(50, Math.floor(Number(settings.pagesToScan ?? settings.searchesLimit) || 10)));
      const timeLimitMs = Math.max(1, Math.min(120, Math.floor(Number(settings.timeLimitMinutes) || 1))) * 60000;
      state.pagesRequested = pagesToScan;
      const criteria = {
        maxBin: Math.max(500, Math.floor(Number(settings.maxBin) || 500)),
        minimumProfit: Math.max(0, Math.floor(Number(settings.minimumProfit) || 0))
      };
      state.running = true;
      state.phase = "START";
      state.status = "Detecting the EA Transfer Market view…";
      state.pagesScanned = 0;
      state.pagesConfirmed = 0;
      state.listingsScanned = 0;
      state.uniqueListingsScanned = 0;
      state.scannedListings = [];
      state.repeatedListingObservations = 0;
      state.currentResultsPlayer = "Not scanned";
      state.metrics = null;
      state.findings = [];
      state.nextPageAvailable = false;
      state.pageAudit = [];
      publish();

      try {
        state.phase = "INITIAL_PAGE";
        publish();
        const initialSafety = adapter.getUnsafeReason();
        if (initialSafety) return finish(initialSafety);
        const view = adapter.detectView();
        let page;
        if (view === adapter.VIEW.RESULTS) {
          if (typeof adapter.getCapturedTargetPlayerName === "function") {
            const capturedTarget = adapter.getCapturedTargetPlayerName();
            if (capturedTarget) {
              state.targetPlayerName = capturedTarget;
              state.targetFilter = capturedTarget;
            }
          }
          state.status = "RESULTS VIEW DETECTED";
          publish();
          state.status = "READING RESULTS";
          publish();
          const remaining = remainingTime(startedAt, timeLimitMs);
          if (!remaining) return finish("TIME LIMIT REACHED");
          page = await adapter.waitForSettledResults({ signal, timeoutMs: Math.min(SEARCH_TIMEOUT_MS, remaining) });
        } else if (view === adapter.VIEW.SEARCH) {
          state.status = "SEARCH VIEW DETECTED";
          publish();
          const filters = adapter.readCurrentFilters();
          if (!filters.length) return finish("Search view detected, but selected EA filters are not readable. Search was not started.");
          const playerName = typeof adapter.readTargetPlayerName === "function" ? adapter.readTargetPlayerName() : "";
          state.targetPlayerName = playerName || "";
          state.targetFilter = playerName || "Player not selected";
          if (playerName && typeof adapter.rememberTargetPlayerName === "function") adapter.rememberTargetPlayerName(playerName);
          publish();
          state.status = playerName ? `TARGET: ${playerName}` : "TARGET: Player not selected";
          publish();
          const searchControl = adapter.findSearchControl();
          if (!searchControl) return finish("SEARCH CONTROL NOT FOUND");
          state.status = "SEARCH CONTROL FOUND";
          publish();
          const safety = adapter.getUnsafeReason();
          if (safety) return finish(safety);
          if (!adapter.triggerSearch(searchControl)) return finish("The normal EA Search control is no longer available. Search stopped.");
          state.status = "SEARCH TRIGGERED";
          publish();
          state.status = "WAITING FOR RESULTS";
          publish();
          const remaining = remainingTime(startedAt, timeLimitMs);
          if (!remaining) return finish("TIME LIMIT REACHED");
          page = await adapter.waitForFreshResults(null, { signal, timeoutMs: Math.min(SEARCH_TIMEOUT_MS, remaining) });
        } else {
          return finish("Could not determine whether the EA page is Search or Search Results. Scanner stopped safely.");
        }

        if (!state.running || signal.aborted || run !== runId) return;
        if (!remainingTime(startedAt, timeLimitMs)) return finish("TIME LIMIT REACHED");
        const initialPostWaitSafety = adapter.getUnsafeReason();
        if (initialPostWaitSafety) return finish(initialPostWaitSafety);
        if (page && page.error) return finish(page.error);
        if (!page || !Array.isArray(page.listings)) return finish("Search results were unreadable. Scanner stopped safely.");

        // The initially settled Search Results page is the only page that
        // may be confirmed without a preceding Next navigation.
        state.pagesConfirmed = 1;
        state.phase = "SCAN_PAGE";
        state.status = "PAGE 1 CONFIRMED";
        publish();

        const allListings = [];
        const seenListingIdentities = new Set();
        while (state.running && run === runId && !signal.aborted) {
          if (state.phase !== "SCAN_PAGE" || state.pagesConfirmed !== state.pagesScanned + 1) {
            return finish("SCAN STOPPED · REASON: PAGE WAS NOT CONFIRMED BY THE REQUIRED NAVIGATION FLOW");
          }
          if (!remainingTime(startedAt, timeLimitMs)) return finish("TIME LIMIT REACHED");
          const currentSafety = adapter.getUnsafeReason();
          if (currentSafety) return finish(currentSafety);
          if (!Array.isArray(page.listings)) return finish("Search results were unreadable. Scanner stopped safely.");

          state.status = `PAGE ${state.pagesScanned + 1} / ${pagesToScan} · SCANNING`;
          publish();

          page.listings.forEach((listing, index) => {
            const identity = listingIdentityForDedup(listing, index);
            if (seenListingIdentities.has(identity)) {
              state.repeatedListingObservations += 1;
              return;
            }
            seenListingIdentities.add(identity);
            allListings.push({ ...listing, listingIdentity: identity, pageNumber: state.pagesScanned + 1 });
          });
          state.pagesScanned += 1;
          state.listingsScanned += page.listings.length;
          state.uniqueListingsScanned = allListings.length;
          state.scannedListings = allListings;
          state.currentResultsPlayer = summarizeResultIdentity(allListings);
          const analysis = root.FC27PriceEngine.analyzeListings(allListings, criteria);
          state.metrics = analysis.summary;
          state.findings = analysis.findings;
          logPageIdentity(state.pagesScanned, page);
          state.status = `PAGE ${state.pagesScanned} SCANNED · ${allListings.length} unique · ${state.repeatedListingObservations} repeats ignored`;
          const auditEntry = {
            page: state.pagesScanned,
            pagesRequested: pagesToScan,
            listingsRead: page.listings.length,
            firstListing: auditListing(page.listings[0]),
            lastListing: auditListing(page.listings[page.listings.length - 1]),
            pageSignature: resultSignature(page),
            targetPlayer: state.targetPlayerName || "Not captured",
            resultPlayer: summarizeResultIdentity(page.listings),
            next: "NOT CHECKED",
            nextAction: "NOT ATTEMPTED",
            nextClick: "NOT SENT",
            resultDom: "NOT CHECKED",
            pageConfirmed: "CONFIRMED",
            nextPageConfirmed: "NOT ATTEMPTED",
            cumulative: {
              pagesConfirmed: state.pagesScanned,
              uniqueListings: state.uniqueListingsScanned,
              repeatedObservationsIgnored: state.repeatedListingObservations
            },
            before: null,
            after: null,
            transition: "PAGE CONFIRMED"
          };
          state.pageAudit.push(auditEntry);
          publish();

          state.phase = "CHECK_PAGE_LIMIT";
          state.status = `PAGE ${state.pagesScanned} SCANNED · ${allListings.length} unique · ${state.repeatedListingObservations} repeats ignored`;
          publish();
          if (state.pagesScanned >= pagesToScan) {
            auditEntry.next = "NOT CHECKED (PAGE LIMIT REACHED)";
            auditEntry.nextAction = "NOT NEEDED";
            return finish(scanCompleteMessage());
          }

          state.phase = "FIND_NEXT";
          state.status = "FINDING NEXT";
          publish();
          const nextControl = typeof adapter.findNextControl === "function" ? adapter.findNextControl() : null;
          state.nextPageAvailable = Boolean(nextControl);
          const nextStatus = typeof adapter.getNextControlStatus === "function"
            ? adapter.getNextControlStatus()
            : { found: Boolean(nextControl), disabled: false };
          auditEntry.next = nextControl ? "FOUND" : nextStatus.found ? "FOUND (DISABLED / UNSAFE)" : "NOT FOUND";
          publish();
          if (!nextControl) {
            auditEntry.nextAction = "NOT ATTEMPTED";
            auditEntry.nextClick = "NOT SENT";
            auditEntry.resultDom = "NOT CHECKED";
            auditEntry.nextPageConfirmed = "NOT CONFIRMED";
            publish();
            return finish("SCAN STOPPED · REASON: NEXT ACTION WAS NOT EXECUTED");
          }
          state.status = "NEXT FOUND";
          publish();

          const before = typeof adapter.captureResults === "function" ? adapter.captureResults() : page;
          const oldSignature = resultSignature(before);
          auditEntry.before = auditSnapshot(before);
          if (!oldSignature) return finish("Search results were unreadable. Scanner stopped safely.");
          if (root.FC27_DEBUG_MARKET_SCAN === true && root.console && typeof root.console.debug === "function") {
            root.console.debug("[FC27 Market Assistant] before Next", {
              page: state.pagesScanned,
              signature: oldSignature,
              firstListingIdentity: before.firstListingIdentity || before.listingIdentities && before.listingIdentities[0] || "",
              lastListingIdentity: before.lastListingIdentity || before.listingIdentities && before.listingIdentities[before.listingIdentities.length - 1] || ""
            });
          }
          if (!remainingTime(startedAt, timeLimitMs)) return finish("TIME LIMIT REACHED");
          state.phase = "CLICK_NEXT";
          state.status = "NEXT CLICK ATTEMPTED";
          auditEntry.nextAction = "ATTEMPTING";
          publish();
          if (typeof adapter.triggerNext !== "function" || !adapter.triggerNext(nextControl)) {
            auditEntry.nextAction = "NOT ATTEMPTED";
            auditEntry.nextClick = "FAILED";
            auditEntry.resultDom = "NOT CHANGED";
            auditEntry.nextPageConfirmed = "NOT CONFIRMED";
            auditEntry.transition = "SAME PAGE — NOT COUNTED";
            auditEntry.after = auditSnapshot(typeof adapter.captureResults === "function" ? adapter.captureResults() : before);
            publish();
            return finish("SCAN STOPPED · REASON: NEXT ACTION WAS NOT EXECUTED");
          }
          state.phase = "WAIT_FOR_RESULTS";
          auditEntry.nextAction = "ATTEMPTED";
          auditEntry.nextClick = "ATTEMPTED";
          auditEntry.resultDom = "WAITING FOR CHANGE";
          state.status = "WAITING FOR EA";
          publish();
          const remaining = remainingTime(startedAt, timeLimitMs);
          if (!remaining) return finish("TIME LIMIT REACHED");
          const nextPage = await adapter.waitForChangedResults(before, {
            signal,
            timeoutMs: Math.min(PAGE_TIMEOUT_MS, remaining)
          });
          if (!state.running || signal.aborted || run !== runId) return;
          state.phase = "VERIFY_NEW_PAGE";
          if (!remainingTime(startedAt, timeLimitMs)) return finish("TIME LIMIT REACHED");
          const pageSafety = adapter.getUnsafeReason();
          if (pageSafety) return finish(pageSafety);
          if (nextPage && nextPage.error) {
            const after = typeof adapter.captureResults === "function" ? adapter.captureResults() : before;
            auditEntry.after = auditSnapshot(after);
            auditEntry.resultDom = didResultDomChange(before, after) ? "CHANGED" : "NOT CHANGED";
            auditEntry.nextPageConfirmed = "NOT CONFIRMED";
            auditEntry.transition = resultSignature(after) === oldSignature ? "SAME PAGE — NOT COUNTED" : "PAGE NOT CONFIRMED — NOT COUNTED";
            publish();
            return finish(auditEntry.transition === "SAME PAGE — NOT COUNTED" ? "EA PAGE DID NOT CHANGE · SCAN STOPPED" : nextPage.error);
          }
          if (!nextPage || !Array.isArray(nextPage.listings) || nextPage.transitionConfirmed !== true || resultSignature(nextPage) === oldSignature) {
            const after = nextPage && Array.isArray(nextPage.listings) ? nextPage : typeof adapter.captureResults === "function" ? adapter.captureResults() : before;
            auditEntry.after = auditSnapshot(after);
            auditEntry.resultDom = didResultDomChange(before, after) ? "CHANGED" : "NOT CHANGED";
            auditEntry.nextPageConfirmed = "NOT CONFIRMED";
            auditEntry.transition = resultSignature(after) === oldSignature ? "SAME PAGE — NOT COUNTED" : "PAGE NOT CONFIRMED — NOT COUNTED";
            publish();
            return finish(auditEntry.transition === "SAME PAGE — NOT COUNTED" ? "EA PAGE DID NOT CHANGE · SCAN STOPPED" : "NEXT CLICK FAILED");
          }
          state.status = "RESULT SIGNATURE CHANGED";
          publish();
          auditEntry.after = auditSnapshot(nextPage);
          auditEntry.resultDom = "CHANGED";
          auditEntry.nextAction = "SENT";
          auditEntry.nextClick = "SENT";
          auditEntry.transition = "NEW PAGE CONFIRMED";
          auditEntry.nextPageConfirmed = "CONFIRMED";
          auditEntry.cumulative = {
            pagesConfirmed: state.pagesConfirmed + 1,
            uniqueListings: state.uniqueListingsScanned,
            repeatedObservationsIgnored: state.repeatedListingObservations
          };
          state.pagesConfirmed += 1;
          publish();
          page = nextPage;
          state.phase = "SCAN_PAGE";
          state.status = "NEXT PAGE CONFIRMED";
          publish();
          state.status = `PAGE ${state.pagesScanned + 1} CONFIRMED`;
          publish();
        }
      } catch (_error) {
        if (state.running && run === runId) finish("Unexpected page or extension state. Search stopped safely.");
      }
      if (state.running && run === runId) {
        state.running = false;
        controller = null;
        publish();
      }
    }

    function scanCompleteMessage(reason) {
      const suffix = reason ? ` · ${reason}` : "";
      return `SCAN COMPLETE${suffix} · Pages confirmed: ${state.pagesConfirmed} · Unique listings: ${state.uniqueListingsScanned} · Repeated observations ignored: ${state.repeatedListingObservations}`;
    }

    function stop() {
      if (controller) controller.abort();
      runId += 1;
      state.running = false;
      state.phase = "STOPPED";
      controller = null;
      state.status = "STOPPED";
      publish();
    }
    return Object.freeze({ start, stop, getState: () => ({ ...state }) });
  }

  root.FC27SearchEngine = Object.freeze({ createSearchEngine, summarizeResultIdentity, didResultDomChange, auditSnapshot });
})(globalThis);
