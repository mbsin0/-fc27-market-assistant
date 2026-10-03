(function initializeAssistant() {
  "use strict";

  if (document.getElementById("fc27-chrome-assistant")) return;
  const DEFAULT_SETTINGS = { maxBin: 30000, minimumProfit: 500, pagesToScan: 10, timeLimitMinutes: 5 };

  const root = document.createElement("aside");
  root.id = "fc27-chrome-assistant";
  root.setAttribute("aria-label", "FC27 Market Assistant read-only scanner");
  root.innerHTML = `
    <header class="fc27-header" id="fc27-drag-handle">
      <div><div class="fc27-title">FC27 MARKET ASSISTANT</div><div class="fc27-subtitle">READ-ONLY · EA FILTERS STAY IN CONTROL</div></div>
      <button class="fc27-icon-button" id="fc27-minimize" type="button" aria-label="Minimize overlay">−</button>
    </header>
    <div class="fc27-mini fc27-hidden" id="fc27-mini">
      <div class="fc27-mini-status" id="fc27-mini-status">Ready</div>
      <div class="fc27-mini-found" id="fc27-mini-found">No qualifying listing yet.</div>
      <div class="fc27-mini-metrics" id="fc27-mini-metrics">No results scanned.</div>
      <div class="fc27-mini-actions"><button class="fc27-button fc27-button-stop" id="fc27-stop-mini" type="button" disabled>STOP</button><button class="fc27-button fc27-button-secondary" id="fc27-expand" type="button">EXPAND</button></div>
    </div>
    <div class="fc27-main" id="fc27-main">
      <div class="fc27-status" id="fc27-status" role="status" aria-live="polite">Ready</div>
      <label class="fc27-field"><span>TARGET FILTER</span><input id="fc27-filter-summary" type="text" value="Not configured in this session" readonly></label>
      <label class="fc27-field fc27-current-results"><span>CURRENT RESULTS (from EA cards)</span><input id="fc27-current-results" type="text" value="Not scanned" readonly></label>
      <label class="fc27-debug-toggle"><input id="fc27-debug-scan" type="checkbox"><span>DEBUG SCAN</span></label>
      <pre class="fc27-audit fc27-hidden" id="fc27-scan-audit" aria-label="Scan audit"></pre>
      <div class="fc27-grid">
        <label class="fc27-field"><span>Max BIN</span><input id="fc27-max-bin" type="number" min="500" max="15000000" step="50" value="30000"></label>
        <label class="fc27-field"><span>Minimum Profit</span><input id="fc27-min-profit" type="number" min="0" max="15000000" step="50" value="500"></label>
        <label class="fc27-field"><span>Pages to Scan</span><input id="fc27-pages-limit" type="number" min="1" max="50" step="1" value="10"></label>
        <label class="fc27-field"><span>Time Limit (min)</span><input id="fc27-time-limit" type="number" min="1" max="120" step="1" value="5"></label>
      </div>
      <div class="fc27-actions"><button class="fc27-button fc27-button-primary" id="fc27-get-it" type="button">GET IT</button><button class="fc27-button fc27-button-stop" id="fc27-stop" type="button" disabled>STOP</button></div>
      <section class="fc27-results" aria-label="Market results">
        <div class="fc27-section-title">MARKET SNAPSHOT</div>
        <div class="fc27-metrics" id="fc27-metrics"></div>
        <div class="fc27-section-title fc27-found-title">FOUND</div>
        <div class="fc27-found-list" id="fc27-found-list"><div class="fc27-empty">No qualifying listing yet.</div></div>
        <div class="fc27-note">Profit estimate uses the 3rd-lowest visible BIN (or the highest available when fewer than 3 listings exist) and an isolated 5% estimated tax. BUY NOW only scrolls to/highlights the EA listing; no EA transaction control is clicked.</div>
      </section>
    </div>`;
  document.documentElement.appendChild(root);

  const byId = (id) => root.querySelector(`#${id}`);
  const controls = {
    filter: byId("fc27-filter-summary"),
    maxBin: byId("fc27-max-bin"),
    minimumProfit: byId("fc27-min-profit"),
    pagesToScan: byId("fc27-pages-limit"),
    timeLimitMinutes: byId("fc27-time-limit")
  };
  const status = byId("fc27-status");
  const miniStatus = byId("fc27-mini-status");
  const foundList = byId("fc27-found-list");
  const metrics = byId("fc27-metrics");
  const miniFound = byId("fc27-mini-found");
  const miniMetrics = byId("fc27-mini-metrics");
  const mainPanel = byId("fc27-main");
  const miniPanel = byId("fc27-mini");
  const debugToggle = byId("fc27-debug-scan");
  const auditPanel = byId("fc27-scan-audit");
  let minimized = false;
  let saveTimer = null;

  function formatCoins(value) {
    return Number.isFinite(Number(value)) ? Math.round(Number(value)).toLocaleString("en-US") : "—";
  }

  function readSettings() {
    const integer = (input, fallback, min, max) => {
      const value = Number(input.value);
      return Math.min(max, Math.max(min, Math.floor(Number.isFinite(value) ? value : fallback)));
    };
    return {
      maxBin: integer(controls.maxBin, DEFAULT_SETTINGS.maxBin, 500, 15000000),
      minimumProfit: integer(controls.minimumProfit, DEFAULT_SETTINGS.minimumProfit, 0, 15000000),
      pagesToScan: integer(controls.pagesToScan, DEFAULT_SETTINGS.pagesToScan, 1, 50),
      timeLimitMinutes: integer(controls.timeLimitMinutes, DEFAULT_SETTINGS.timeLimitMinutes, 1, 120),
      debugScan: debugToggle.checked
    };
  }

  function saveSettings() {
    if (chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ type: "FC27_SAVE_SETTINGS", settings: readSettings() }, () => void chrome.runtime.lastError);
    }
  }

  function loadSettings() {
    if (!chrome.runtime || !chrome.runtime.sendMessage) return;
    chrome.runtime.sendMessage({ type: "FC27_GET_SETTINGS" }, (saved) => {
      if (chrome.runtime.lastError || !saved) return;
      controls.maxBin.value = saved.maxBin;
      controls.minimumProfit.value = saved.minimumProfit;
      controls.pagesToScan.value = saved.pagesToScan ?? saved.searchesLimit ?? DEFAULT_SETTINGS.pagesToScan;
      controls.timeLimitMinutes.value = saved.timeLimitMinutes;
      debugToggle.checked = Boolean(saved.debugScan);
    });
  }

  function renderMetrics(summary, nextState) {
    const rows = [
      ["Pages confirmed", nextState.pagesScanned || 0],
      ["Unique listings scanned", nextState.uniqueListingsScanned || 0],
      ["Repeated observations ignored", nextState.repeatedListingObservations || 0],
      ["Lowest BIN", summary && summary.lowestBin],
      ["2nd BIN", summary && summary.secondBin],
      ["3rd BIN", summary && summary.thirdBin],
      ["Average BIN", summary && summary.averageBin],
      ["Same-price frequency", summary && summary.samePriceFrequency ? `${summary.samePriceFrequency} at ${formatCoins(summary.samePriceBin)}` : "No repeats"],
      ["Estimated EA Tax", summary && summary.estimatedTax],
    ];
    metrics.replaceChildren();
    rows.forEach(([label, value]) => {
      const row = document.createElement("div");
      row.className = "fc27-metric";
      const name = document.createElement("span");
      name.textContent = label;
      const amount = document.createElement("strong");
      amount.textContent = ["Pages confirmed", "Unique listings scanned", "Repeated observations ignored", "Same-price frequency"].includes(label)
        ? String(value ?? 0)
        : formatCoins(value);
      row.append(name, amount);
      metrics.appendChild(row);
    });
    miniMetrics.textContent = summary && summary.listingCount
      ? `${nextState.pagesScanned || 0} page(s) · ${nextState.uniqueListingsScanned || 0} unique · ${nextState.repeatedListingObservations || 0} repeats ignored · Lowest ${formatCoins(summary.lowestBin)}`
      : "No results scanned.";
  }

  function createFindingCard(listing) {
    const card = document.createElement("article");
    card.className = "fc27-finding";
    const heading = document.createElement("div");
    heading.className = "fc27-finding-heading";
    heading.textContent = listing.player || "Unknown player";
    const details = document.createElement("div");
    details.className = "fc27-finding-details";
    const bid = listing.currentBid == null ? "Bid —" : `Bid ${formatCoins(listing.currentBid)}`;
    const time = listing.timeRemaining || listing.status || "Time/status —";
    details.textContent = `BIN ${formatCoins(listing.bin)} · ${bid} · ${time} · Est. profit ${formatCoins(listing.estimatedProfit)} · ${listing.listingFrequency} at this BIN`;
    const manual = document.createElement("button");
    manual.className = "fc27-button fc27-button-manual";
    manual.type = "button";
    manual.textContent = "BUY NOW";
    manual.title = "Scroll to and highlight this EA listing. Complete any purchase manually in EA.";
    manual.addEventListener("click", () => {
      const ok = globalThis.FC27MarketAdapter.revealListing(listing);
      const message = ok
        ? "Listing highlighted in EA results. Complete any action manually in EA."
        : "This listing is no longer on screen. Run GET IT again to refresh it.";
      status.textContent = message;
      miniStatus.textContent = message;
    });
    card.append(heading, details, manual);
    return card;
  }

  function formatAuditListing(listing) {
    if (!listing) return "none";
    return `${listing.player} | BIN ${listing.bin} | stable ID ${listing.stableId}`;
  }

  function renderAudit(entries) {
    auditPanel.classList.toggle("fc27-hidden", !debugToggle.checked);
    if (!debugToggle.checked) return;
    auditPanel.textContent = (entries || []).map((entry) => [
      `Page: ${entry.page} / ${entry.pagesRequested}`,
      `Pages requested: ${entry.pagesRequested}`,
      `Listings read: ${entry.listingsRead}`,
      `FIRST LISTING: ${formatAuditListing(entry.firstListing)}`,
      `LAST LISTING: ${formatAuditListing(entry.lastListing)}`,
      `Page signature: ${entry.pageSignature || "empty"}`,
      `TARGET PLAYER: ${entry.targetPlayer}`,
      `RESULT PLAYER: ${entry.resultPlayer}`,
      `NEXT: ${entry.next}`,
      `Next action: ${entry.nextAction}`,
      `NEXT CLICK: ${entry.nextClick}`,
      `RESULT DOM: ${entry.resultDom}`,
      `PAGE: ${entry.pageConfirmed}`,
      `NEXT PAGE: ${entry.nextPageConfirmed}`,
      `Cumulative: ${entry.cumulative.pagesConfirmed} pages confirmed · ${entry.cumulative.uniqueListings} unique listings · ${entry.cumulative.repeatedObservationsIgnored} repeated observations ignored`,
      `BEFORE: ${entry.before ? `first ${formatAuditListing(entry.before.first)}; last ${formatAuditListing(entry.before.last)}; signature ${entry.before.signature || "empty"}` : "not attempted"}`,
      `AFTER: ${entry.after ? `first ${formatAuditListing(entry.after.first)}; last ${formatAuditListing(entry.after.last)}; signature ${entry.after.signature || "empty"}` : "not attempted"}`,
      entry.transition
    ].join("\n")).join("\n\n") || "No page audit recorded yet.";
  }

  const engine = globalThis.FC27SearchEngine.createSearchEngine(globalThis.FC27MarketAdapter, {
    onState(nextState) {
      status.textContent = nextState.status;
      miniStatus.textContent = nextState.status;
      controls.filter.value = nextState.targetPlayerName || nextState.targetFilter;
      byId("fc27-current-results").value = nextState.currentResultsPlayer;
      byId("fc27-get-it").disabled = nextState.running;
      byId("fc27-stop").disabled = !nextState.running;
      byId("fc27-stop-mini").disabled = !nextState.running;
      Object.values(controls).forEach((control) => {
        if (control !== controls.filter) control.disabled = nextState.running;
      });
      renderMetrics(nextState.metrics, nextState);
      renderAudit(nextState.pageAudit);
      foundList.replaceChildren();
      if (!nextState.findings.length) {
        const empty = document.createElement("div");
        empty.className = "fc27-empty";
        empty.textContent = nextState.metrics ? "No listing met your criteria in the latest results." : "No qualifying listing yet.";
        foundList.appendChild(empty);
        miniFound.textContent = empty.textContent;
      } else {
        nextState.findings.forEach((listing) => foundList.appendChild(createFindingCard(listing)));
        const first = nextState.findings[0];
        miniFound.textContent = `FOUND · ${first.player} · BIN ${formatCoins(first.bin)} · Profit ${formatCoins(first.estimatedProfit)}`;
      }
    }
  });

  function toggleMinimize(value) {
    minimized = value;
    mainPanel.classList.toggle("fc27-hidden", minimized);
    miniPanel.classList.toggle("fc27-hidden", !minimized);
    byId("fc27-minimize").textContent = minimized ? "+" : "−";
    byId("fc27-minimize").setAttribute("aria-label", minimized ? "Expand overlay" : "Minimize overlay");
    root.classList.toggle("fc27-is-minimized", minimized);
  }

  byId("fc27-get-it").addEventListener("click", () => engine.start(readSettings()));
  byId("fc27-stop").addEventListener("click", () => engine.stop());
  byId("fc27-stop-mini").addEventListener("click", () => engine.stop());
  byId("fc27-minimize").addEventListener("click", () => toggleMinimize(!minimized));
  byId("fc27-expand").addEventListener("click", () => toggleMinimize(false));
  debugToggle.addEventListener("change", () => {
    renderAudit(engine.getState().pageAudit);
    saveSettings();
  });

  Object.values(controls).forEach((control) => {
    if (control === controls.filter) return;
    control.addEventListener("change", saveSettings);
    control.addEventListener("input", () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(saveSettings, 300);
    });
  });

  const dragHandle = byId("fc27-drag-handle");
  let drag = null;
  dragHandle.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button")) return;
    const rect = root.getBoundingClientRect();
    drag = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
    dragHandle.setPointerCapture(event.pointerId);
  });
  dragHandle.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const rect = root.getBoundingClientRect();
    const margin = 6;
    const left = Math.min(window.innerWidth - rect.width - margin, Math.max(margin, drag.left + event.clientX - drag.x));
    const top = Math.min(window.innerHeight - rect.height - margin, Math.max(margin, drag.top + event.clientY - drag.y));
    root.style.left = `${left}px`;
    root.style.top = `${top}px`;
    root.style.right = "auto";
    root.style.bottom = "auto";
  });
  const endDrag = () => { drag = null; };
  dragHandle.addEventListener("pointerup", endDrag);
  dragHandle.addEventListener("pointercancel", endDrag);

  loadSettings();
})();
