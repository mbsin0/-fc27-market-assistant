(function initializeAssistant() {
  "use strict";

  if (document.getElementById("fc27-market-assistant-page")) return;
  const DEFAULT_SETTINGS = { maxBin: 30000, minimumProfit: 500, pagesToScan: 10, timeLimitMinutes: 5, debugScan: false };
  const adapter = globalThis.FC27MarketAdapter;
  const ui = globalThis.FC27AssistantUI;
  const root = document.createElement("section");
  root.id = "fc27-market-assistant-page";
  root.className = "fc27-assistant-backdrop";
  root.hidden = true;
  root.setAttribute("aria-label", "FC27 Market Assistant");
  root.innerHTML = `
    <div class="fc27-assistant-shell" id="fc27-assistant-shell" role="dialog" aria-modal="true" aria-labelledby="fc27-title">
      <header class="fc27-page-header" id="fc27-drag-handle">
        <div><div class="fc27-page-kicker">READ-ONLY MARKET SCANNER</div><h1 id="fc27-title">FC27 MARKET ASSISTANT</h1></div>
        <div class="fc27-header-actions">
          <button class="fc27-button fc27-button-subtle" id="fc27-back-to-ea" type="button">BACK TO EA</button>
          <button class="fc27-icon-button" id="fc27-minimize" type="button" aria-label="Minimize assistant">−</button>
        </div>
      </header>
      <main class="fc27-page-main" id="fc27-main">
        <div class="fc27-topline">
          <div><span class="fc27-label">STATUS</span><strong id="fc27-status" role="status" aria-live="polite">Ready</strong></div>
          <button class="fc27-button fc27-debug-toggle" id="fc27-debug-toggle" type="button" aria-pressed="false">DEBUG MODE: OFF</button>
        </div>
        <section class="fc27-player-row" aria-label="Player detection">
          <div><span class="fc27-label">TARGET PLAYER</span><strong id="fc27-target-player">Unknown</strong></div>
          <div><span class="fc27-label">RESULT PLAYER</span><strong id="fc27-result-player">Unknown</strong></div>
        </section>
        <section class="fc27-lowest-section" aria-label="Lowest prices">
          <div class="fc27-section-heading"><div><span class="fc27-label">MARKET SNAPSHOT</span><h2>LOWEST 3 PRICES</h2></div>
            <button class="fc27-button fc27-button-subtle" id="fc27-lowest-toggle" type="button" aria-expanded="false">LOWEST PRICE</button></div>
          <div class="fc27-podium" id="fc27-podium"><div class="fc27-no-prices">NO PRICE DATA</div></div>
          <div class="fc27-lowest-expanded fc27-hidden" id="fc27-lowest-expanded" aria-label="Lowest price details"></div>
        </section>
        <section class="fc27-stats-grid" id="fc27-metrics" aria-label="Market snapshot statistics"></section>
        <section class="fc27-controls-panel" aria-label="Scan settings">
          <details><summary>Scan settings</summary><div class="fc27-settings-grid">
            <label><span>Max BIN</span><input id="fc27-max-bin" type="number" min="500" max="15000000" step="50" value="30000"></label>
            <label><span>Minimum Profit</span><input id="fc27-min-profit" type="number" min="0" max="15000000" step="50" value="500"></label>
            <label><span>Pages to Scan</span><input id="fc27-pages-limit" type="number" min="1" max="50" step="1" value="10"></label>
            <label><span>Time Limit (min)</span><input id="fc27-time-limit" type="number" min="1" max="120" step="1" value="5"></label>
          </div></details>
          <div class="fc27-action-row"><button class="fc27-button fc27-button-primary" id="fc27-refresh-price" type="button">REFRESH PRICE</button>
            <button class="fc27-button fc27-button-stop" id="fc27-stop" type="button" disabled>STOP</button></div>
        </section>
        <section class="fc27-found-section" aria-label="Qualifying listings"><span class="fc27-label">QUALIFYING LISTINGS</span><div id="fc27-found-list"><div class="fc27-empty">No qualifying listings yet.</div></div></section>
        <section class="fc27-debug-panel fc27-hidden" id="fc27-debug-panel" aria-label="Debug scan details">
          <div class="fc27-debug-header"><div><span class="fc27-label">DIAGNOSTICS</span><h2>DEBUG SCAN</h2></div>
            <button class="fc27-button fc27-button-subtle" id="fc27-copy-debug" type="button">COPY DEBUG REPORT</button></div>
          <pre id="fc27-scan-audit">No page audit recorded yet.</pre>
          <div class="fc27-copy-status" id="fc27-copy-status" role="status" aria-live="polite"></div>
        </section>
      </main>
      <section class="fc27-mini fc27-hidden" id="fc27-mini">
        <div class="fc27-mini-label">FC27 MARKET ASSISTANT</div><strong id="fc27-mini-status">Ready</strong>
        <div id="fc27-mini-summary">No market scan yet.</div>
        <div class="fc27-mini-actions"><button class="fc27-button fc27-button-secondary" id="fc27-expand" type="button">EXPAND</button>
          <button class="fc27-button fc27-button-subtle" id="fc27-mini-back" type="button">BACK TO EA</button></div>
      </section>
    </div>`;
  document.documentElement.appendChild(root);

  const byId = (id) => root.querySelector(`#${id}`);
  const shell = byId("fc27-assistant-shell");
  const controls = {
    maxBin: byId("fc27-max-bin"), minimumProfit: byId("fc27-min-profit"),
    pagesToScan: byId("fc27-pages-limit"), timeLimitMinutes: byId("fc27-time-limit")
  };
  let debugMode = ui.DEFAULT_DEBUG_MODE;
  let saveTimer = null;
  let navigationObserver = null;
  let drag = null;
  let lastTargetSent = "";
  const nextDiagnostics = { attempts: 0, failed: 0 };
  globalThis.FC27_DEBUG_MARKET_SCAN = debugMode;

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
      debugScan: debugMode
    };
  }
  function sendMessage(message, callback) {
    if (!chrome.runtime || !chrome.runtime.sendMessage) return;
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) return;
      if (callback) callback(response);
    });
  }
  function saveSettings() { sendMessage({ type: "FC27_SAVE_SETTINGS", settings: readSettings() }); }
  function loadSettings() {
    sendMessage({ type: "FC27_GET_SETTINGS" }, (saved) => {
      if (!saved) return;
      controls.maxBin.value = saved.maxBin ?? DEFAULT_SETTINGS.maxBin;
      controls.minimumProfit.value = saved.minimumProfit ?? DEFAULT_SETTINGS.minimumProfit;
      controls.pagesToScan.value = saved.pagesToScan ?? saved.searchesLimit ?? DEFAULT_SETTINGS.pagesToScan;
      controls.timeLimitMinutes.value = saved.timeLimitMinutes ?? DEFAULT_SETTINGS.timeLimitMinutes;
      setDebugMode(saved.debugScan === true, false);
    });
    sendMessage({ type: "FC27_GET_TARGET_PLAYER" }, (saved) => {
      if (saved && saved.targetPlayerName) adapter.rememberTargetPlayerName(saved.targetPlayerName);
    });
  }
  function rememberTarget(name) {
    const remembered = adapter.rememberTargetPlayerName(name);
    if (remembered && remembered !== lastTargetSent) {
      lastTargetSent = remembered;
      sendMessage({ type: "FC27_SAVE_TARGET_PLAYER", targetPlayerName: remembered });
    }
  }
  function captureSearchTarget(event) {
    if (adapter.detectView() !== adapter.VIEW.SEARCH) return;
    const player = adapter.readTargetPlayerName();
    if (!player) return;
    if (event && event.type === "click") {
      const search = adapter.findSearchControl();
      const path = typeof event.composedPath === "function" ? event.composedPath() : [];
      const clickedSearch = search && (path.includes(search) || search === event.target || search.contains && search.contains(event.target));
      if (!clickedSearch) return;
    }
    rememberTarget(player);
  }
  document.addEventListener("input", captureSearchTarget, true);
  document.addEventListener("change", captureSearchTarget, true);
  document.addEventListener("click", captureSearchTarget, true);
  document.addEventListener("submit", (event) => captureSearchTarget(event), true);

  const scannerAdapter = Object.create(adapter);
  scannerAdapter.triggerNext = (control) => {
    nextDiagnostics.attempts += 1;
    const sent = adapter.triggerNext(control);
    if (!sent) nextDiagnostics.failed += 1;
    return sent;
  };

  function renderPrices(listings) {
    const prices = ui.aggregateLowestPrices(listings);
    const podium = byId("fc27-podium");
    podium.replaceChildren();
    const expanded = byId("fc27-lowest-expanded");
    expanded.replaceChildren();
    if (!prices.length) {
      const empty = document.createElement("div");
      empty.className = "fc27-no-prices";
      empty.textContent = "NO PRICE DATA";
      podium.appendChild(empty);
      return;
    }
    prices.forEach(({ price, count }, index) => {
      const row = document.createElement("div");
      row.className = `fc27-price-row fc27-price-row-${index + 1}`;
      const rank = document.createElement("span");
      rank.className = "fc27-price-rank";
      rank.textContent = ["🥇", "🥈", "🥉"][index];
      const amount = document.createElement("strong");
      amount.textContent = formatCoins(price);
      const cards = document.createElement("span");
      cards.textContent = `${count} ${count === 1 ? "card" : "cards"}`;
      row.append(rank, amount, cards);
      podium.appendChild(row);
      expanded.appendChild(row.cloneNode(true));
    });
  }
  function renderMetrics(state) {
    const summary = state.metrics || {};
    const rows = [
      ["Pages scanned", state.pagesScanned || 0],
      ["Listings scanned", state.listingsScanned || 0],
      ["Unique listings", state.uniqueListingsScanned || 0],
      ["Repeated observations ignored", state.repeatedListingObservations || 0],
      ["Lowest BIN", summary.lowestBin], ["2nd BIN", summary.secondBin],
      ["3rd BIN", summary.thirdBin], ["Average BIN", summary.averageBin],
      ["Estimated EA tax", summary.estimatedTax]
    ];
    const container = byId("fc27-metrics");
    container.replaceChildren();
    rows.forEach(([label, value]) => {
      const item = document.createElement("div");
      item.className = "fc27-stat";
      const name = document.createElement("span"); name.textContent = label;
      const amount = document.createElement("strong");
      amount.textContent = /Pages scanned|Listings scanned|Unique listings|Repeated observations/.test(label)
        ? String(value ?? 0) : formatCoins(value);
      item.append(name, amount);
      container.appendChild(item);
    });
  }
  function createFindingCard(listing) {
    const card = document.createElement("article");
    card.className = "fc27-finding";
    const name = document.createElement("strong"); name.textContent = listing.player || "Unknown player";
    const details = document.createElement("span");
    details.textContent = `BIN ${formatCoins(listing.bin)} · Estimated profit ${formatCoins(listing.estimatedProfit)} · ${listing.listingFrequency} at this price`;
    const manual = document.createElement("button");
    manual.type = "button"; manual.className = "fc27-button fc27-button-subtle"; manual.textContent = "BUY NOW";
    manual.title = "Scroll to the EA listing. Complete any market action manually.";
    manual.addEventListener("click", () => {
      const ok = adapter.revealListing(listing);
      if (ok) closeAssistant();
      else byId("fc27-status").textContent = "Refresh Price to locate this result again";
    });
    card.append(name, details, manual);
    return card;
  }
  function auditText(entries) {
    return (entries || []).map((entry) => {
      const line = (listing) => listing ? `${listing.player} · BIN ${listing.bin} · ID ${listing.stableId}` : "none";
      return [
        `PAGE ${entry.page} / ${entry.pagesRequested} · ${entry.listingsRead} listings`,
        `Target: ${entry.targetPlayer} · Results: ${entry.resultPlayer}`,
        `First: ${line(entry.firstListing)} · Last: ${line(entry.lastListing)}`,
        `Signature: ${entry.pageSignature || "empty"}`,
        `Next: ${entry.next} · Action: ${entry.nextAction} · Click: ${entry.nextClick}`,
        `DOM: ${entry.resultDom} · Page: ${entry.pageConfirmed} · Transition: ${entry.transition}`,
        entry.before ? `Before signature: ${entry.before.signature || "empty"}` : "Before: not captured",
        entry.after ? `After signature: ${entry.after.signature || "empty"}` : "After: not captured"
      ].join("\n");
    }).join("\n\n") || "No page audit recorded yet.";
  }
  function render(state) {
    byId("fc27-status").textContent = ui.formatStatus(state);
    byId("fc27-mini-status").textContent = ui.formatStatus(state);
    byId("fc27-target-player").textContent = state.targetPlayerName || "Unknown";
    const resultPlayer = state.currentResultsPlayer;
    byId("fc27-result-player").textContent = !resultPlayer || /not scanned|could not identify player/i.test(resultPlayer) ? "Unknown" : resultPlayer;
    byId("fc27-stop").disabled = !state.running;
    byId("fc27-refresh-price").disabled = state.running;
    Object.values(controls).forEach((control) => { control.disabled = state.running; });
    renderMetrics(state);
    renderPrices(state.scannedListings);
    const found = byId("fc27-found-list");
    found.replaceChildren();
    if (!state.findings || !state.findings.length) {
      const empty = document.createElement("div");
      empty.className = "fc27-empty";
      empty.textContent = state.metrics ? "No listing met the current criteria." : "No qualifying listings yet.";
      found.appendChild(empty);
    } else state.findings.forEach((listing) => found.appendChild(createFindingCard(listing)));
    const summary = state.metrics ? `${state.pagesScanned} pages · ${state.uniqueListingsScanned} unique listings · Lowest ${formatCoins(state.metrics.lowestBin)}` : "No market scan yet.";
    byId("fc27-mini-summary").textContent = summary;
    byId("fc27-scan-audit").textContent = auditText(state.pageAudit);
    byId("fc27-debug-panel").classList.toggle("fc27-hidden", !debugMode);
    if (!state.running && state.status && /STOPPED|FAILED|ERROR|UNAVAILABLE|UNREADABLE|DID NOT CHANGE|TIME LIMIT|NOT EXECUTED/i.test(state.status)) {
      nextDiagnostics.failed = Math.max(nextDiagnostics.failed, nextDiagnostics.attempts - Math.max(0, state.pagesConfirmed - 1));
    }
  }

  const engine = globalThis.FC27SearchEngine.createSearchEngine(scannerAdapter, { onState: render });
  function startScan() {
    nextDiagnostics.attempts = 0;
    nextDiagnostics.failed = 0;
    byId("fc27-copy-status").textContent = "";
    engine.start(readSettings());
  }
  function setDebugMode(value, persist) {
    debugMode = Boolean(value);
    globalThis.FC27_DEBUG_MARKET_SCAN = debugMode;
    byId("fc27-debug-toggle").textContent = `DEBUG MODE: ${debugMode ? "ON" : "OFF"}`;
    byId("fc27-debug-toggle").setAttribute("aria-pressed", String(debugMode));
    byId("fc27-debug-panel").classList.toggle("fc27-hidden", !debugMode);
    if (debugMode) byId("fc27-scan-audit").textContent = auditText(engine.getState().pageAudit);
    if (persist) saveSettings();
  }
  function openAssistant() {
    if (adapter.detectView() === adapter.VIEW.SEARCH) {
      const currentTarget = adapter.readTargetPlayerName();
      if (currentTarget) rememberTarget(currentTarget);
    }
    root.hidden = false;
    shell.classList.remove("fc27-is-minimized");
    byId("fc27-main").classList.remove("fc27-hidden");
    byId("fc27-mini").classList.add("fc27-hidden");
  }
  function closeAssistant() { root.hidden = true; }
  function minimizeAssistant() {
    shell.classList.add("fc27-is-minimized");
    byId("fc27-main").classList.add("fc27-hidden");
    byId("fc27-mini").classList.remove("fc27-hidden");
  }
  function expandAssistant() {
    shell.classList.remove("fc27-is-minimized");
    byId("fc27-main").classList.remove("fc27-hidden");
    byId("fc27-mini").classList.add("fc27-hidden");
  }
  function copyDebugReport() {
    const report = ui.buildDebugReport(engine.getState(), {
      version: chrome.runtime.getManifest ? chrome.runtime.getManifest().version : "0.1.0",
      attempts: nextDiagnostics.attempts,
      successfulPageChanges: Math.max(0, engine.getState().pagesConfirmed - 1),
      failedClicks: nextDiagnostics.failed
    });
    const copied = navigator.clipboard && navigator.clipboard.writeText
      ? navigator.clipboard.writeText(report)
      : Promise.reject(new Error("Clipboard API unavailable"));
    copied.then(() => { byId("fc27-copy-status").textContent = "DEBUG REPORT COPIED"; })
      .catch(() => {
        const textarea = document.createElement("textarea");
        textarea.value = report;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed"; textarea.style.opacity = "0";
        root.appendChild(textarea); textarea.select();
        const ok = document.execCommand && document.execCommand("copy");
        textarea.remove();
        byId("fc27-copy-status").textContent = ok ? "DEBUG REPORT COPIED" : "Could not copy report";
      });
  }

  byId("fc27-refresh-price").addEventListener("click", startScan);
  byId("fc27-stop").addEventListener("click", () => engine.stop());
  byId("fc27-back-to-ea").addEventListener("click", closeAssistant);
  byId("fc27-mini-back").addEventListener("click", closeAssistant);
  byId("fc27-minimize").addEventListener("click", minimizeAssistant);
  byId("fc27-expand").addEventListener("click", expandAssistant);
  byId("fc27-debug-toggle").addEventListener("click", () => setDebugMode(!debugMode, true));
  byId("fc27-copy-debug").addEventListener("click", copyDebugReport);
  byId("fc27-lowest-toggle").addEventListener("click", () => {
    const panel = byId("fc27-lowest-expanded");
    const showing = panel.classList.contains("fc27-hidden");
    panel.classList.toggle("fc27-hidden", !showing);
    byId("fc27-lowest-toggle").setAttribute("aria-expanded", String(showing));
  });
  Object.values(controls).forEach((control) => {
    control.addEventListener("change", saveSettings);
    control.addEventListener("input", () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveSettings, 300); });
  });

  function installNavEntry() { ui.installNavigationEntry(document, openAssistant); }
  installNavEntry();
  if (typeof MutationObserver === "function" && document.body) {
    navigationObserver = new MutationObserver(installNavEntry);
    navigationObserver.observe(document.body, { childList: true, subtree: true });
  }
  const dragHandle = byId("fc27-drag-handle");
  dragHandle.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button")) return;
    const rect = shell.getBoundingClientRect();
    drag = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
    dragHandle.setPointerCapture(event.pointerId);
  });
  dragHandle.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const rect = shell.getBoundingClientRect();
    shell.style.left = `${Math.min(window.innerWidth - rect.width - 8, Math.max(8, drag.left + event.clientX - drag.x))}px`;
    shell.style.top = `${Math.min(window.innerHeight - rect.height - 8, Math.max(8, drag.top + event.clientY - drag.y))}px`;
    shell.style.transform = "none";
  });
  dragHandle.addEventListener("pointerup", () => { drag = null; });
  dragHandle.addEventListener("pointercancel", () => { drag = null; });

  loadSettings();
  render(engine.getState());
})();
