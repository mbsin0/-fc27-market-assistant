// ==UserScript==
// @name         FC27 Market Assistant
// @namespace    mbsin0-fc27
// @version      0.5.0
// @description  Read-only FC27 Transfer Market listing scanner
// @match        https://www.ea.com/*
// @run-at       document-idle
// ==/UserScript==

(function () {
    "use strict";

    let container = null;
    let minimized = true;
    let checkTimer = null;

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

    function getListingSignals() {
        if (!document.body) return [];

        const elements = Array.from(
            document.querySelectorAll("body *")
        );

        return elements.filter(function (el) {
            if (!isVisible(el)) return false;
            if (container && container.contains(el)) return false;

            const text = (el.innerText || "")
                .replace(/\s+/g, " ")
                .trim();

            return (
                /Buy Now\s*:?\s*[\d,]+/i.test(text) &&
                /Start Price\s*:?\s*[\d,]+/i.test(text)
            );
        });
    }

    function isMarketPage() {
        const signals = getListingSignals();

        return signals.length >= 2;
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

        container.innerHTML = `
            <div style="
                width:280px;
                max-height:45vh;
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

                <div id="fc27-status"
                    style="
                        margin-top:12px;
                        color:#aaa;
                        font-size:13px;
                    ">
                    Transfer Market detected ✓
                </div>

                <button
                    id="fc27-scan"
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
                    SCAN VISIBLE LISTINGS
                </button>

                <div id="fc27-count"
                    style="
                        margin-top:12px;
                        color:#9cff75;
                        font-size:14px;
                    ">
                </div>

                <pre id="fc27-output"
                    style="
                        white-space:pre-wrap;
                        word-break:break-word;
                        font-size:11px;
                        color:#baffaa;
                        max-height:220px;
                        overflow:auto;
                    ">
                </pre>
            </div>
        `;

        container
            .querySelector("#fc27-minimize")
            .addEventListener("click", function () {
                minimized = true;
                render();
            });

        container
            .querySelector("#fc27-scan")
            .addEventListener("click", scanListings);
    }

    function scanListings() {
        const signals = getListingSignals();
        const prices = [];

        signals.forEach(function (el) {
            const text = (el.innerText || "")
                .replace(/\s+/g, " ");

            const matches =
                text.match(/Buy Now\s*:?\s*[\d,]+/ig) || [];

            matches.forEach(function (match) {
                const number = match.match(/([\d,]+)\s*$/);

                if (!number) return;

                const price = Number(
                    number[1].replace(/,/g, "")
                );

                if (price >= 500 && price <= 15000000) {
                    prices.push(price);
                }
            });
        });

        const count = container.querySelector("#fc27-count");
        const output = container.querySelector("#fc27-output");

        count.textContent =
            "Buy Now prices detected: " + prices.length;

        if (!prices.length) {
            output.textContent =
                "No readable Buy Now prices found.";
            return;
        }

        output.textContent =
            prices.map(function (price, index) {
                return (
                    (index + 1) +
                    ". " +
                    price.toLocaleString("en-IN")
                );
            }).join("\n");
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
        }, 250);
    }

    const observer = new MutationObserver(scheduleCheck);

    observer.observe(document.documentElement, {
        childList: true,
        subtree: true
    });

    setInterval(checkPage, 1000);

    checkPage();

})();