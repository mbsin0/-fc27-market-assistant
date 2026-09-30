// ==UserScript==
// @name         FC27 Market Assistant
// @namespace    mbsin0-fc27
// @version      0.6.0
// @description  Read-only FC27 Transfer Market scanner
// @match        https://www.ea.com/*
// @run-at       document-idle
// ==/UserScript==

(function () {
    "use strict";

    let container = null;
    let minimized = true;
    let checkTimer = null;

    const scanState = {
        running: false,
        pages: 0,
        listings: [],
        status: "Ready",
        lastPageSignature: "",
        seenPages: new Set()
    };

    function isVisible(el) {
        if (!el || !document.documentElement.contains(el)) return false;

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

    function hasListingData(text) {
        return (
            /Start Price\s*:?\s*[\d,]+/i.test(text) &&
            /Buy Now\s*:?\s*[\d,]+/i.test(text)
        );
    }

    function getListingCandidates() {
        if (!document.body) return [];

        return Array.from(
            document.querySelectorAll("body *")
        ).filter(function (el) {
            if (!isVisible(el)) return false;
            if (container && container.contains(el)) return false;

            const text = cleanText(el.innerText);

            if (!hasListingData(text)) return false;

            /*
             * Prefer the smallest element that contains
             * one complete listing rather than every
             * parent container above it.
             */
            const childMatch = Array.from(el.children).some(function (child) {
                if (!isVisible(child)) return false;

                const childText = cleanText(child.innerText);

                return hasListingData(childText);
            });

            return !childMatch;
        });
    }

    function extractNumber(text, label) {
        const regex = new RegExp(
            label + "\\s*:?\\s*([\\d,]+)",
            "i"
        );

        const match = text.match(regex);

        if (!match) return null;

        return Number(
            match[1].replace(/,/g, "")
        );
    }

    function extractTime(text) {
        const match = text.match(
            /Time\s+(.+?)(?=\s+(?:Start Price|Bid|Buy Now)|$)/i
        );

        return match ? match[1].trim() : "";
    }

    function extractListing(el) {
        const text = cleanText(el.innerText);

        const startPrice = extractNumber(text, "Start Price");
        const buyNow = extractNumber(text, "Buy Now");
        const bid = extractNumber(text, "Bid");
        const time = extractTime(text);

        return {
            startPrice,
            bid,
            buyNow,
            time,
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

    function pageSignature(listings) {
        return listings
            .map(function (x) {
                return [
                    x.startPrice,
                    x.bid,
                    x.buyNow,
                    x.time
                ].join("|");
            })
            .join(";");
    }

    function findNextButton() {
        const elements = Array.from(
            document.querySelectorAll(
                "button, [role='button'], a"
            )
        );

        return elements.find(function (el) {
            if (!isVisible(el)) return false;
            if (container && container.contains(el)) return false;

            const text = cleanText(el.innerText);

            return /^Next$/i.test(text);
        }) || null;
    }

    function isDisabled(el) {
        if (!el) return true;

        return (
            el.disabled === true ||
            el.getAttribute("aria-disabled") === "true" ||
            /disabled/i.test(el.className || "")
        );
    }

    function wait(ms) {
        return new Promise(function (resolve) {
            setTimeout(resolve, ms);
        });
    }

    async function waitForListings(timeout = 5000) {
        const started = Date.now();

        while (Date.now() - started < timeout) {
            const listings = getCurrentListings();

            if (listings.length > 0) {
                return listings;
            }

            await wait(250);
        }

        return [];
    }

    async function waitForNewPage(oldSignature, timeout = 6000) {
        const started = Date.now();

        while (Date.now() - started < timeout) {
            await wait(300);

            const listings = getCurrentListings();

            if (!listings.length) continue;

            const signature = pageSignature(listings);

            if (signature && signature !== oldSignature) {
                return listings;
            }
        }

        return [];
    }

    function parseSeconds(timeText) {
        const text = (timeText || "").toLowerCase();

        if (text.includes("expired")) return 0;

        const seconds = text.match(/(\d+)\s*second/);
        if (seconds) return Number(seconds[1]);

        const minutes = text.match(/(\d+)\s*minute/);
        if (minutes) return Number(minutes[1]) * 60;

        const hours = text.match(/(\d+)\s*hour/);
        if (hours) return Number(hours[1]) * 3600;

        return null;
    }

    function timerLabel(timeText) {
        const seconds = parseSeconds(timeText);

        if (seconds === null) return "";

        if (seconds <= 10) return "🔥 ENDING NOW";
        if (seconds <= 30) return "⚡ UNDER 30 SEC";
        if (seconds <= 60) return "⏱ UNDER 1 MIN";
        if (seconds <= 300) return "WATCH";

        return "NORMAL";
    }

    function render() {
        if (!container) return;

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
                    ">
                    FC27
                </button>
            `;

            container
                .querySelector("#fc27-mini-button")
                .addEventListener("click", function () {
                    minimized = false;
                    render();
                });

            return;
        }

        const shortTimers = scanState.listings.filter(function (x) {
            const seconds = parseSeconds(x.time);
            return seconds !== null && seconds <= 60 && seconds > 0;
        }).length;

        container.innerHTML = `
            <div style="
                width:300px;
                max-height:55vh;
                overflow:auto;
                background:#111b14;
                color:#fff;
                border:2px solid #39ff00;
                border-radius:14px;
                padding:14px;
                box-shadow:0 8px 30px rgba(0,0,0,.6);
            ">

                <div style="
                    display:flex;
                    justify-content:space-between;
                    align-items:center;
                ">
                    <div>
                        <div style="
                            font-size:18px;
                            font-weight:800;
                        ">
                            FC27 Market Assistant
                        </div>

                        <div style="
                            color:#9cff75;
                            font-size:11px;
                            margin-top:3px;
                        ">
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
                        ">
                        −
                    </button>
                </div>

                <div style="
                    margin-top:12px;
                    color:#aaa;
                    font-size:13px;
                ">
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
                    ">
                    ${scanState.running ? "SCANNING..." : "SCAN ALL PAGES"}
                </button>

                <div style="
                    margin-top:12px;
                    color:#9cff75;
                    font-size:14px;
                ">
                    Pages: ${scanState.pages}
                    <br>
                    Listings: ${scanState.listings.length}
                    <br>
                    Ending within 1 min: ${shortTimers}
                </div>

                <pre id="fc27-output"
                    style="
                        white-space:pre-wrap;
                        word-break:break-word;
                        font-size:11px;
                        color:#baffaa;
                        max-height:300px;
                        overflow:auto;
                        margin-top:10px;
                    ">${buildOutput()}</pre>
            </div>
        `;

        container
            .querySelector("#fc27-minimize")
            .addEventListener("click", function () {
                minimized = true;
                render();
            });

        const scanButton = container.querySelector("#fc27-scan");

        if (scanButton && !scanState.running) {
            scanButton.addEventListener(
                "click",
                scanAllPages
            );
        }
    }

    function buildOutput() {
        if (!scanState.listings.length) {
            return "No listings scanned yet.";
        }

        return scanState.listings
            .map(function (x, index) {
                const timer = timerLabel(x.time);

                return (
                    (index + 1) +
                    ". BIN " +
                    x.buyNow.toLocaleString("en-IN") +
                    " | Start " +
                    (x.startPrice ?? "-").toLocaleString("en-IN") +
                    " | Bid " +
                    (x.bid ?? "-") +
                    " | " +
                    (x.time || "-") +
                    (timer ? " | " + timer : "")
                );
            })
            .join("\n");
    }

    async function scanAllPages() {
        if (scanState.running) return;

        scanState.running = true;
        scanState.pages = 0;
        scanState.listings = [];
        scanState.seenPages = new Set();
        scanState.status = "Starting scanner...";

        render();

        while (true) {
            const listings = await waitForListings();

            if (!listings.length) {
                scanState.status =
                    "No readable listings found.";
                break;
            }

            const signature = pageSignature(listings);

            if (scanState.seenPages.has(signature)) {
                scanState.status =
                    "Page repeated. Scan finished.";
                break;
            }

            scanState.seenPages.add(signature);

            scanState.pages += 1;

            /*
             * IMPORTANT:
             * We intentionally do NOT remove repeated prices.
             * Every card is treated as a separate listing.
             */
            scanState.listings.push(...listings);

            scanState.status =
                "Page " +
                scanState.pages +
                " scanned (" +
                listings.length +
                " listings).";

            render();

            const nextButton = findNextButton();

            if (!nextButton || isDisabled(nextButton)) {
                scanState.status =
                    "Finished — last page reached.";
                break;
            }

            const oldSignature = signature;

            scanState.status =
                "Page " +
                scanState.pages +
                " complete. Loading next page...";

            render();

            nextButton.click();

            const nextListings =
                await waitForNewPage(oldSignature);

            if (!nextListings.length) {
                scanState.status =
                    "Finished — no new page detected.";
                break;
            }

            await wait(400);
        }

        scanState.running = false;

        render();
    }

    function isMarketPage() {
        return getCurrentListings().length >= 2;
    }

    function createAssistant() {
        if (container || !isMarketPage()) return;

        container = document.createElement("div");

        container.id = "fc27-market-assistant";

        container.style.cssText = `
            position:fixed;
            right:10px;
            bottom:135px;
            z-index:2147483647;
            font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
        `;

        document.body.appendChild(container);

        minimized = true;
        render();
    }

    function removeAssistant() {
        if (container) {
            container.remove();
            container = null;
        }

        minimized = true;
    }

    function checkPage() {
        if (isMarketPage()) {
            if (!container) {
                createAssistant();
            }
        } else {
            removeAssistant();
        }
    }

    function scheduleCheck() {
        if (checkTimer) return;

        checkTimer = setTimeout(function () {
            checkTimer = null;
            checkPage();
        }, 300);
    }

    const observer = new MutationObserver(scheduleCheck);

    observer.observe(document.documentElement, {
        childList: true,
        subtree: true
    });

    setInterval(checkPage, 1000);

    checkPage();

})();