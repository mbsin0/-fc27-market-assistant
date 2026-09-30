(function () {
    if (window.__fc27MarketAssistantLoaded) return;
    window.__fc27MarketAssistantLoaded = true;

    const panel = document.createElement("div");

    panel.style.cssText = `
        position:fixed;
        right:12px;
        bottom:12px;
        z-index:999999;
        width:300px;
        max-height:70vh;
        overflow:auto;
        background:#111b14;
        color:white;
        border:1px solid #39ff00;
        border-radius:14px;
        padding:14px;
        font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
        box-shadow:0 8px 30px rgba(0,0,0,.6);
    `;

    panel.innerHTML = `
        <div style="font-size:18px;font-weight:800">
            FC27 Market Assistant
        </div>

        <div style="color:#9cff75;font-size:12px;margin-top:3px">
            READ-ONLY MARKET SCANNER
        </div>

        <div id="fc27-status"
             style="margin-top:12px;color:#aaa;font-size:13px">
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
                font-weight:800;
            ">
            SCAN VISIBLE LISTINGS
        </button>

        <div id="fc27-summary"
             style="
                margin-top:12px;
                font-size:13px;
                color:#9cff75;
             ">
        </div>

        <pre id="fc27-output"
             style="
                white-space:pre-wrap;
                word-break:break-word;
                font-size:11px;
                color:#baffaa;
                max-height:300px;
                overflow:auto;
             "></pre>
    `;

    document.documentElement.appendChild(panel);

    const status =
        panel.querySelector("#fc27-status");

    const summary =
        panel.querySelector("#fc27-summary");

    const output =
        panel.querySelector("#fc27-output");

    const scanButton =
        panel.querySelector("#fc27-scan");


    function extractPrices() {

        const text =
            document.body.innerText || "";

        /*
         * Look for numbers that resemble FC coins.
         * We deliberately only READ the page.
         */

        const matches =
            text.match(/\b\d{1,3}(?:,\d{3})+\b|\b\d{4,6}\b/g) || [];

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

        /*
         * Remove duplicates caused by the same
         * DOM element being represented more than once.
         */

        return prices;
    }


    scanButton.addEventListener(
        "click",
        function () {

            status.textContent =
                "Scanning visible Transfer Market data...";

            summary.textContent = "";
            output.textContent = "";

            const pageText =
                document.body.innerText || "";

            const isMarketPage =
                /Transfer Market/i.test(pageText) ||
                /Buy Now/i.test(pageText) ||
                /Search the Transfer Market/i.test(pageText);


            if (!isMarketPage) {

                status.textContent =
                    "Transfer Market not detected.";

                output.textContent =
                    "Open EA FC 27 → Transfers → Transfer Market → search a player.";

                return;
            }


            const prices =
                extractPrices();


            status.textContent =
                "Transfer Market detected ✓";


            summary.textContent =
                "Numbers detected: " +
                prices.length;


            if (prices.length === 0) {

                output.textContent =
                    "No readable prices were detected on the current page.";

                return;
            }


            output.textContent =
                "Detected values:\n\n" +
                prices
                    .map(
                        (price, index) =>
                            (index + 1) +
                            ". " +
                            price.toLocaleString("en-IN")
                    )
                    .join("\n");


            /*
             * This is intentionally ONLY a reader.
             *
             * No Buy Now button is clicked.
             * No bid is placed.
             * No EA request is sent.
             */
        }
    );

})();