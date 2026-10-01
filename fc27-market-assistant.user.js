// ==UserScript==
// @name         FC27 Market Assistant
// @namespace    mbsin0-fc27
// @version      0.6.7
// @description  Read-only FC27 Transfer Market scanner with 10-page limit and draggable floating button
// @match        https://www.ea.com/*
// @run-at       document-idle
// ==/UserScript==

(function () {
    "use strict";

    // =========================================================
    // CONFIGURATION
    // =========================================================

    const MAX_PAGES = 10;
    const MAX_LISTINGS = 200;

    // =========================================================
    // GLOBAL STATE
    // =========================================================

    let container = null;
    let minimized = true;
    let checkTimer = null;

    let floatingPosition = {
        left: null,
        top: null
    };

    let dragState = {
        active: false,
        moved: false,
        startX: 0,
        startY: 0,
        startLeft: 0,
        startTop: 0
    };

    const scanState = {
        running: false,
        pages: 0,
        listings: [],
        status: "Ready"
    };

    // =========================================================
    // BASIC HELPERS
    // =========================================================

    function isVisible(el) {
        if (!el || !document.documentElement.contains(el)) {
            return false;
        }

        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();

        return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            Number(style.opacity || 1) > 0 &&
            rect.width > 0 &&
            rect.height > 0
        );
    }

    function cleanText(text) {
        return (text || "")
            .replace(/\s+/g, " ")
            .trim();
    }

    function pageText() {
        return cleanText(
            document.body
                ? document.body.innerText
                : ""
        );
    }

    // =========================================================
    // SEARCH RESULTS DETECTION
    // =========================================================

    function isSearchResultsPage() {
        const text = pageText();

        return (
            /Search Results/i.test(text) &&
            /Start Price\s*:?\s*[\d,]+/i.test(text) &&
            /Buy Now\s*:?\s*[\d,]+/i.test(text)
        );
    }

    function hasListingData(text) {
        return (
            /Start Price\s*:?\s*[\d,]+/i.test(text) &&
            /Buy Now\s*:?\s*[\d,]+/i.test(text)
        );
    }

    // =========================================================
    // FIND LISTING CARDS
    // =========================================================

    function getListingCandidates() {
        if (!document.body) {
            return [];
        }

        const elements = Array.from(
            document.querySelectorAll("body *")
        );

        const candidates = [];

        elements.forEach(function (el) {
            if (!isVisible(el)) {
                return;
            }

            if (container && container.contains(el)) {
                return;
            }

            const text = cleanText(el.innerText);

            if (!hasListingData(text)) {
                return;
            }

            const childContainsListing =
                Array.from(el.children).some(function (child) {
                    if (!isVisible(child)) {
                        return false;
                    }

                    return hasListingData(
                        cleanText(child.innerText)
                    );
                });

            if (!childContainsListing) {
                candidates.push(el);
            }
        });

        return candidates;
    }

    // =========================================================
    // NUMBER EXTRACTION
    // =========================================================

    function extractNumber(text, label) {
        const regex = new RegExp(
            label + "\\s*:?\\s*([\\d,]+)",
            "i"
        );

        const match = text.match(regex);

        if (!match) {
            return null;
        }

        return Number(
            match[1].replace(/,/g, "")
        );
    }

    // =========================================================
    // TIME EXTRACTION
    // =========================================================

    function extractTime(text) {
        const match = text.match(
            /Time\s+(.+?)(?=\s+(?:Start Price|Bid|Buy Now)|$)/i
        );

        return match
            ? match[1].trim()
            : "";
    }

    // =========================================================
    // LISTING EXTRACTION
    // =========================================================

    function extractListing(el) {
        const text = cleanText(el.innerText);

        return {
            startPrice: extractNumber(
                text,
                "Start Price"
            ),

            bid: extractNumber(
                text,
                "Bid"
            ),

            buyNow: extractNumber(
                text,
                "Buy Now"
            ),

            time: extractTime(text),

            raw: text
        };
    }

    function getCurrentListings() {
        return getListingCandidates()
            .map(extractListing)
            .filter(function (listing) {
                return (
                    Number.isFinite(listing.buyNow) &&
                    listing.buyNow >= 500 &&
                    listing.buyNow <= 15000000
                );
            });
    }

    // =========================================================
    // PAGE SIGNATURE
    // =========================================================

    function listingIdentity(node, listing) {
        const identityAttributes = Array.from(node.attributes || [])
            .filter(function (attribute) {
                return /^(?:id|data-[\w-]*(?:id|asset|item|trade|auction)[\w-]*)$/i
                    .test(attribute.name);
            })
            .map(function (attribute) {
                return attribute.name + "=" + attribute.value;
            });

        const stableText = cleanText(listing.raw)
            .replace(/\bTime\s+.*?(?=\s+(?:Start Price|Bid|Buy Now)\b|$)/i, "")
            .replace(/\s+/g, " ")
            .trim();

        return identityAttributes.join("|") + "::" + stableText;
    }

    // =========================================================
    // PAGE IDENTITY
    // =========================================================

    function getPageIdentity() {
        const nodes = getListingCandidates();

        if (!nodes.length) {
            return null;
        }

        const entries = nodes
            .map(function (node) {
                return { node, listing: extractListing(node) };
            })
            .filter(function (listing) {
                return Number.isFinite(listing.listing.buyNow) &&
                    listing.listing.buyNow >= 500 &&
                    listing.listing.buyNow <= 15000000;
            });

        return {
            signature: entries
                .map(function (entry) {
                    return listingIdentity(entry.node, entry.listing);
                })
                .join("\n"),
            count: entries.length
        };
    }

    // =========================================================
    // PAGE CHANGE DETECTION
    // =========================================================

    function pageChanged(before) {
        if (!before) {
            return true;
        }

        const now = getPageIdentity();

        if (!now) {
            return false;
        }

        return Boolean(
            now.signature &&
            now.signature !== before.signature &&
            now.count > 0
        );
    }

    // =========================================================
    // FIND NEXT BUTTON
    // =========================================================

    function findNextButton() {
        const elements = Array.from(
            document.querySelectorAll("body *")
        );

        const next = elements.find(function (el) {
            if (!isVisible(el)) {
                return false;
            }

            if (
                container &&
                container.contains(el)
            ) {
                return false;
            }

            const text = cleanText(
                el.innerText
            );

            return /^Next$/i.test(text);
        });

        if (!next) {
            return null;
        }

        let control = next;

        while (
            control.parentElement &&
            control !== document.body
        ) {
            const role =
                control.getAttribute("role");

            const tag =
                control.tagName.toLowerCase();

            if (
                tag === "button" ||
                tag === "a" ||
                role === "button" ||
                typeof control.onclick === "function"
            ) {
                break;
            }

            control = control.parentElement;
        }

        return control;
    }

    // =========================================================
    // DISABLED CHECK
    // =========================================================

    function isDisabled(el) {
        if (!el) {
            return true;
        }

        return (
            el.disabled === true ||
            el.getAttribute("aria-disabled") === "true" ||
            /disabled/i.test(el.className || "")
        );
    }

    // =========================================================
    // WAIT
    // =========================================================

    function wait(ms) {
        return new Promise(function (resolve) {
            setTimeout(resolve, ms);
        });
    }

    // =========================================================
    // WAIT FOR LISTINGS
    // =========================================================

    async function waitForListings(timeout = 7000) {
        const started = Date.now();

        while (
            Date.now() - started <
            timeout
        ) {
            const listings =
                getCurrentListings();

            if (listings.length > 0) {
                return listings;
            }

            await wait(250);
        }

        return [];
    }

    // =========================================================
    // WAIT FOR NEW PAGE
    // =========================================================

    async function waitForNewPage(
        beforePage,
        timeout = 9000
    ) {
        const started = Date.now();

        let candidateSignature = "";
        let candidateRepeats = 0;

        while (
            Date.now() - started <
            timeout
        ) {
            await wait(250);

            const currentNodes =
                getListingCandidates();

            if (!currentNodes.length) {
                candidateSignature = "";
                candidateRepeats = 0;
                continue;
            }

            const currentPage = getPageIdentity();
            if (!currentPage || !pageChanged(beforePage)) {
                candidateSignature = "";
                candidateRepeats = 0;
                continue;
            }

            if (currentPage.signature === candidateSignature) {
                candidateRepeats += 1;
            } else {
                candidateSignature = currentPage.signature;
                candidateRepeats = 1;
            }

            if (candidateRepeats >= 2) {
                return getCurrentListings();
            }
        }

        return [];
    }

    // =========================================================
    // TIME PARSING
    // =========================================================

    function parseSeconds(timeText) {
        const text =
            (timeText || "").toLowerCase();

        if (text.includes("expired")) {
            return 0;
        }

        const seconds =
            text.match(/(\d+)\s*second/);

        if (seconds) {
            return Number(seconds[1]);
        }

        const minutes =
            text.match(/(\d+)\s*minute/);

        if (minutes) {
            return Number(minutes[1]) * 60;
        }

        const hours =
            text.match(/(\d+)\s*hour/);

        if (hours) {
            return Number(hours[1]) * 3600;
        }

        return null;
    }

    // =========================================================
    // TIMER LABEL
    // =========================================================

    function timerLabel(timeText) {
        const seconds =
            parseSeconds(timeText);

        if (seconds === null) {
            return "";
        }

        if (seconds <= 10) {
            return "🔥 ENDING NOW";
        }

        if (seconds <= 30) {
            return "⚡ UNDER 30 SEC";
        }

        if (seconds <= 60) {
            return "⏱ UNDER 1 MIN";
        }

        if (seconds <= 300) {
            return "WATCH";
        }

        return "NORMAL";
    }

    // =========================================================
    // OUTPUT
    // =========================================================

    function buildOutput() {
        if (!scanState.listings.length) {
            return "No listings scanned yet.";
        }

        return scanState.listings
            .map(function (x, index) {
                const timer =
                    timerLabel(x.time);

                const start =
                    x.startPrice !== null
                        ? x.startPrice.toLocaleString(
                            "en-IN"
                        )
                        : "-";

                const bid =
                    x.bid !== null
                        ? x.bid.toLocaleString(
                            "en-IN"
                        )
                        : "-";

                return (
                    (index + 1) +
                    ". BIN " +
                    x.buyNow.toLocaleString(
                        "en-IN"
                    ) +
                    " | Start " +
                    start +
                    " | Bid " +
                    bid +
                    " | " +
                    (x.time || "-") +
                    (timer
                        ? " | " + timer
                        : "")
                );
            })
            .join("\n");
    }

    // =========================================================
    // FLOATING POSITION
    // =========================================================

    function applyFloatingPosition() {
        if (
            floatingPosition.left !== null &&
            floatingPosition.top !== null
        ) {
            container.style.left =
                floatingPosition.left + "px";

            container.style.top =
                floatingPosition.top + "px";

            container.style.right = "auto";
            container.style.bottom = "auto";
        }
    }

    // =========================================================
    // DRAGGING
    // =========================================================

    function setupDragging(button) {
        button.addEventListener(
            "pointerdown",
            function (event) {
                dragState.active = true;
                dragState.moved = false;

                dragState.startX =
                    event.clientX;

                dragState.startY =
                    event.clientY;

                const rect =
                    container.getBoundingClientRect();

                dragState.startLeft =
                    rect.left;

                dragState.startTop =
                    rect.top;

                if (button.setPointerCapture) {
                    try {
                        button.setPointerCapture(
                            event.pointerId
                        );
                    } catch (_) {}
                }
            }
        );

        button.addEventListener(
            "pointermove",
            function (event) {
                if (!dragState.active) {
                    return;
                }

                const dx =
                    event.clientX -
                    dragState.startX;

                const dy =
                    event.clientY -
                    dragState.startY;

                if (
                    Math.abs(dx) > 5 ||
                    Math.abs(dy) > 5
                ) {
                    dragState.moved = true;
                }

                if (!dragState.moved) {
                    return;
                }

                const margin = 6;
                const size = 58;

                const maxLeft =
                    Math.max(
                        margin,
                        window.innerWidth -
                            size -
                            margin
                    );

                const maxTop =
                    Math.max(
                        margin,
                        window.innerHeight -
                            size -
                            margin
                    );

                const left =
                    Math.min(
                        maxLeft,
                        Math.max(
                            margin,
                            dragState.startLeft + dx
                        )
                    );

                const top =
                    Math.min(
                        maxTop,
                        Math.max(
                            margin,
                            dragState.startTop + dy
                        )
                    );

                floatingPosition.left = left;
                floatingPosition.top = top;

                container.style.left =
                    left + "px";

                container.style.top =
                    top + "px";

                container.style.right = "auto";
                container.style.bottom = "auto";
            }
        );

        button.addEventListener(
            "pointerup",
            function (event) {
                if (button.releasePointerCapture) {
                    try {
                        button.releasePointerCapture(
                            event.pointerId
                        );
                    } catch (_) {}
                }

                const wasMoved =
                    dragState.moved;

                dragState.active = false;

                if (!wasMoved) {
                    minimized = false;
                    render();
                }
            }
        );

        button.addEventListener(
            "pointercancel",
            function () {
                dragState.active = false;
            }
        );
    }

    // =========================================================
    // EXPANDED PANEL POSITION
    // =========================================================

    function positionExpandedPanel() {
        if (!container) {
            return;
        }

        const viewportWidth =
            window.innerWidth;

        const viewportHeight =
            window.innerHeight;

        const panelWidth = 300;
        const margin = 8;

        const buttonRect =
            container.getBoundingClientRect();

        let left = buttonRect.left;
        let top = buttonRect.top;

        if (
            left + panelWidth >
            viewportWidth - margin
        ) {
            left =
                viewportWidth -
                panelWidth -
                margin;
        }

        if (left < margin) {
            left = margin;
        }

        const maxPanelHeight =
            Math.floor(
                viewportHeight * 0.55
            );

        if (
            top + maxPanelHeight >
            viewportHeight - margin
        ) {
            top =
                viewportHeight -
                maxPanelHeight -
                margin;
        }

        if (top < margin) {
            top = margin;
        }

        container.style.left =
            left + "px";

        container.style.top =
            top + "px";

        container.style.right = "auto";
        container.style.bottom = "auto";
    }

    // =========================================================
    // RENDER
    // =========================================================

    function render() {
        if (!container) {
            return;
        }

        // -----------------------------------------------------
        // MINIMIZED
        // -----------------------------------------------------

        if (minimized) {
            container.innerHTML = `
                <button
                    id="fc27-mini-button"
                    aria-label="Open FC27 Market Assistant"
                    style="
                        width:58px;
                        height:58px;
                        border-radius:50%;
                        border:2px solid #39ff00;
                        background:#111b14;
                        color:#39ff00;
                        font-size:12px;
                        font-weight:900;
                        box-shadow:0 4px 18px rgba(0,0,0,.55);
                        touch-action:none;
                        user-select:none;
                        -webkit-user-select:none;
                    "
                >
                    FC27
                </button>
            `;

            applyFloatingPosition();

            const button =
                container.querySelector(
                    "#fc27-mini-button"
                );

            setupDragging(button);

            return;
        }

        // -----------------------------------------------------
        // SHORT TIMER COUNT
        // -----------------------------------------------------

        const shortTimers =
            scanState.listings.filter(
                function (x) {
                    const seconds =
                        parseSeconds(x.time);

                    return (
                        seconds !== null &&
                        seconds <= 60 &&
                        seconds > 0
                    );
                }
            ).length;

        // -----------------------------------------------------
        // EXPANDED PANEL
        // -----------------------------------------------------

        container.innerHTML = `
            <div
                id="fc27-expanded-panel"
                style="
                    width:300px;
                    max-width:calc(100vw - 16px);
                    max-height:55vh;
                    overflow:auto;
                    box-sizing:border-box;
                    background:#111b14;
                    color:#fff;
                    border:2px solid #39ff00;
                    border-radius:14px;
                    padding:14px;
                    box-shadow:0 8px 30px rgba(0,0,0,.6);
                "
            >

                <div
                    style="
                        display:flex;
                        justify-content:space-between;
                        align-items:center;
                    "
                >
                    <div>

                        <div
                            style="
                                font-size:18px;
                                font-weight:800;
                            "
                        >
                            FC27 Market Assistant
                        </div>

                        <div
                            style="
                                color:#9cff75;
                                font-size:11px;
                                margin-top:3px;
                            "
                        >
                            READ-ONLY
                        </div>

                    </div>

                    <button
                        id="fc27-minimize"
                        style="
                            width:34px;
                            height:34px;
                            border:0;
                            border-radius:50%;
                            background:#26352a;
                            color:white;
                            font-size:18px;
                            font-weight:bold;
                        "
                    >
                        −
                    </button>

                </div>

                <div
                    style="
                        margin-top:12px;
                        color:#aaa;
                        font-size:13px;
                    "
                >
                    ${scanState.status}
                </div>

                <button
                    id="fc27-scan"
                    ${scanState.running ? "disabled" : ""}
                    style="
                        width:100%;
                        margin-top:12px;
                        padding:11px;
                        border:0;
                        border-radius:9px;
                        background:#39ff00;
                        color:#001000;
                        font-weight:800;
                    "
                >
                    ${
                        scanState.running
                            ? "SCANNING..."
                            : "SCAN ALL PAGES"
                    }
                </button>

                <div
                    style="
                        margin-top:12px;
                        color:#9cff75;
                        font-size:14px;
                    "
                >
                    Pages:
                    ${scanState.pages}
                    /
                    ${MAX_PAGES}

                    <br>

                    Listings:
                    ${scanState.listings.length}
                    /
                    ${MAX_LISTINGS}

                    <br>

                    Ending within 1 min:
                    ${shortTimers}
                </div>

                <pre
                    id="fc27-output"
                    style="
                        white-space:pre-wrap;
                        word-break:break-word;
                        font-size:11px;
                        color:#baffaa;
                        max-height:300px;
                        overflow:auto;
                        margin-top:10px;
                    "
                >${buildOutput()}</pre>

            </div>
        `;

        positionExpandedPanel();

        // -----------------------------------------------------
        // MINIMIZE BUTTON
        // -----------------------------------------------------

        const minimizeButton =
            container.querySelector(
                "#fc27-minimize"
            );

        minimizeButton.addEventListener(
            "click",
            function () {
                minimized = true;
                render();
            }
        );

        // -----------------------------------------------------
        // SCAN BUTTON
        // -----------------------------------------------------

        const scanButton =
            container.querySelector(
                "#fc27-scan"
            );

        if (
            scanButton &&
            !scanState.running
        ) {
            scanButton.addEventListener(
                "click",
                scanAllPages
            );
        }
    }

    // =========================================================
    // SCAN ALL PAGES
    // =========================================================

    async function scanAllPages() {
        if (scanState.running) {
            return;
        }

        scanState.running = true;
        scanState.pages = 0;
        scanState.listings = [];
        const seenPages = new Set();
        scanState.status =
            "Starting scanner...";

        render();

        // =====================================================
        // HARD 10-PAGE LIMIT
        // =====================================================

        while (
            scanState.pages <
            MAX_PAGES
        ) {
            const listings =
                await waitForListings();

            if (!listings.length) {
                scanState.status =
                    "No readable listings found.";
                break;
            }

            const page = getPageIdentity();
            if (!page || seenPages.has(page.signature)) {
                scanState.status =
                    "Finished — repeated result page detected.";
                break;
            }
            seenPages.add(page.signature);

            // -------------------------------------------------
            // ADD CURRENT PAGE
            // -------------------------------------------------

            scanState.pages += 1;

            scanState.listings.push(
                ...listings
            );

            // -------------------------------------------------
            // HARD 200-LISTING LIMIT
            // -------------------------------------------------

            if (
                scanState.listings.length >
                MAX_LISTINGS
            ) {
                scanState.listings =
                    scanState.listings.slice(
                        0,
                        MAX_LISTINGS
                    );
            }

            scanState.status =
                "Page " +
                scanState.pages +
                " scanned (" +
                listings.length +
                " listings).";

            render();

            // -------------------------------------------------
            // PAGE 10 = STOP
            // -------------------------------------------------

            if (
                scanState.pages >=
                MAX_PAGES
            ) {
                scanState.status =
                    "Finished — 10-page limit reached.";
                break;
            }

            // -------------------------------------------------
            // FIND NEXT
            // -------------------------------------------------

            const nextButton =
                findNextButton();

            if (
                !nextButton ||
                isDisabled(nextButton)
            ) {
                scanState.status =
                    "Finished — last page reached.";
                break;
            }

            // -------------------------------------------------
            // SAVE CURRENT PAGE IDENTITY
            // -------------------------------------------------

            const beforePage =
                getPageIdentity();

            scanState.status =
                "Page " +
                scanState.pages +
                " complete. Loading next page...";

            render();

            // -------------------------------------------------
            // CLICK NEXT
            // -------------------------------------------------

            nextButton.dispatchEvent(
                new MouseEvent(
                    "click",
                    {
                        bubbles: true,
                        cancelable: true,
                        view: window
                    }
                )
            );

            // -------------------------------------------------
            // WAIT FOR NEXT PAGE
            // -------------------------------------------------

            const nextListings =
                await waitForNewPage(
                    beforePage
                );

            if (!nextListings.length) {
                scanState.status =
                    "Finished — no new page detected.";
                break;
            }

            await wait(500);
        }

        // =====================================================
        // SCAN FINISHED
        // =====================================================

        scanState.running = false;

        render();
    }

    // =========================================================
    // CREATE ASSISTANT
    // =========================================================

    function createAssistant() {
        if (
            container ||
            !isSearchResultsPage()
        ) {
            return;
        }

        container =
            document.createElement("div");

        container.id =
            "fc27-market-assistant";

        container.style.cssText = `
            position:fixed;
            right:10px;
            bottom:135px;
            z-index:2147483647;
            font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
            box-sizing:border-box;
        `;

        document.body.appendChild(
            container
        );

        minimized = true;

        render();
    }

    // =========================================================
    // REMOVE ASSISTANT
    // =========================================================

    function removeAssistant() {
        if (container) {
            container.remove();
            container = null;
        }

        minimized = true;
    }

    // =========================================================
    // PAGE CHECK
    // =========================================================

    function checkPage() {
        if (isSearchResultsPage()) {
            if (!container) {
                createAssistant();
            }
        } else {
            removeAssistant();
        }
    }

    // =========================================================
    // SCHEDULE CHECK
    // =========================================================

    function scheduleCheck() {
        if (checkTimer) {
            return;
        }

        checkTimer =
            setTimeout(
                function () {
                    checkTimer = null;
                    checkPage();
                },
                300
            );
    }

    // =========================================================
    // MUTATION OBSERVER
    // =========================================================

    const observer =
        new MutationObserver(
            scheduleCheck
        );

    observer.observe(
        document.documentElement,
        {
            childList: true,
            subtree: true
        }
    );

    // =========================================================
    // PERIODIC CHECK
    // =========================================================

    setInterval(
        checkPage,
        1000
    );

    // =========================================================
    // INITIAL CHECK
    // =========================================================

    checkPage();

})();
