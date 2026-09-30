// ==UserScript==
// @name         FC27 Market Assistant
// @namespace    mbsin0-fc27
// @version      0.1.0
// @description  Read-only FC27 Transfer Market listing scanner
// @match        https://www.ea.com/*
// @run-at       document-idle
// ==/UserScript==

(function () {
    "use strict";

    if (window.__FC27_MARKET_ASSISTANT__) return;
    window.__FC27_MARKET_ASSISTANT__ = true;

    const panel = document.createElement("div");

    panel.style.cssText = `
        position:fixed;
        right:12px;
top:60%;
        z-index:2147483647;
        width:300px;
        max-height:65vh;
        overflow:auto;
        background:#111b14;
        color:#fff;
        border:2px solid #39ff00;
        border-radius:14px;
        padding:14px;
        font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
        box-shadow:0 8px 30px rgba(0,0,0,.6);
    `;

    panel.innerHTML = `
        <div style="font-size:18px;font-weight:800">
            FC27 Market Assistant
        </div>

        <div style="
            color:#9cff75;
            font-size:12px;
            margin-top:3px">
            READ-ONLY TEST
        </div>

        <div id="fc27-status"
             style="
             margin-top:12px;
             color:#aaa;
             font-size:13px">
            Ready
        </div>

        <button id="fc27-scan"
            style="
            width:100%;
            margin-top:12px;
            padding:11px;
            border:0;
            border-radius:9px;
            background:#39ff00;
            color:#001000;
            font-weight:800;">
            SCAN VISIBLE LISTINGS
        </button>

        <div id="fc27-count"
             style="
             margin-top:12px;
             color:#9cff75;
             font-size:14px;">
        </div>

        <pre id="fc27-output"
             style="
             white-space:pre-wrap;
             word-break:break-word;
             font-size:11px;
             color:#baffaa;
             max-height:250px;
             overflow:auto;">
        </pre>
    `;

    document.body.appendChild(panel);

    const status =
        panel.querySelector("#fc27-status");

    const count =
        panel.querySelector("#fc27-count");

    const output =
        panel.querySelector("#fc27-output");

    const button =
        panel.querySelector("#fc27-scan");


    function scanPage() {

        const text =
            document.body.innerText || "";

        const marketPage =
            /Transfer Market/i.test(text) ||
            /Buy Now/i.test(text) ||
            /Search the Transfer Market/i.test(text);

        if (!marketPage) {

            status.textContent =
                "Transfer Market not detected.";

            count.textContent = "";

            output.textContent =
                "Open EA FC 27 → Transfers → Transfer Market.";

            return;
        }


        status.textContent =
            "Transfer Market detected ✓";


        /*
         * Read visible numbers only.
         * No clicks, bids, purchases or EA
         * market requests are performed.
         */

        const matches =
            text.match(
                /\b\d{1,3}(?:,\d{3})+\b|\b\d{4,6}\b/g
            ) || [];


        const prices =
            matches
                .map(value =>
                    Number(
                        value.replace(/,/g, "")
                    )
                )
                .filter(value =>
                    value >= 500 &&
                    value <= 15000000
                );


        count.textContent =
            "Numbers detected: " +
            prices.length;


        if (!prices.length) {

            output.textContent =
                "No readable prices found.";

            return;
        }


        output.textContent =
            prices
                .map(
                    (price, i) =>
                        (i + 1) +
                        ". " +
                        price.toLocaleString("en-IN")
                )
                .join("\n");
    }


    button.addEventListener(
        "click",
        scanPage
    );

})();