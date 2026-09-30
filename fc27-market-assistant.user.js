// ==UserScript==
// @name         FC27 Market Assistant
// @namespace    mbsin0-fc27
// @version      0.3.0
// @description  Read-only FC27 Transfer Market listing scanner
// @match        https://www.ea.com/*
// @run-at       document-idle
// ==/UserScript==

(function () {
    "use strict";

    let panel = null;

    function isMarketPage() {
        const text = document.body?.innerText || "";

        return (
            /Search Results/i.test(text) &&
            /Buy Now/i.test(text)
        );
    }

    function createPanel() {

        if (panel || !isMarketPage()) {
            return;
        }

        panel = document.createElement("div");

        panel.id = "fc27-market-assistant";

        panel.style.cssText = `
            position:fixed;
            right:12px;
            bottom:120px;
            z-index:2147483647;
            width:280px;
            max-height:45vh;
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
            <div style="
                font-size:18px;
                font-weight:800;">
                FC27 Market Assistant
            </div>

            <div style="
                color:#9cff75;
                font-size:12px;
                margin-top:3px;">
                READ-ONLY TEST
            </div>

            <div id="fc27-status"
                style="
                margin-top:12px;
                color:#aaa;
                font-size:13px;">
                Transfer Market detected ✓
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
                max-height:220px;
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


        button.addEventListener("click", function () {

            const text =
                document.body.innerText || "";

            const matches =
                text.match(
                    /\b\d{1,3}(?:,\d{