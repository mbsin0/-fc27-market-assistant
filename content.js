(function () {
  if (window.__fc27MarketAssistantLoaded) return;
  window.__fc27MarketAssistantLoaded = true;

  const panel = document.createElement("div");

  panel.style.cssText = `
    position:fixed;
    right:12px;
    bottom:12px;
    z-index:999999;
    width:280px;
    background:#111b14;
    color:white;
    border:1px solid #39ff00;
    border-radius:14px;
    padding:14px;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
    box-shadow:0 8px 30px rgba(0,0,0,.5);
  `;

  panel.innerHTML = `
    <div style="font-size:18px;font-weight:800">
      FC27 Market Assistant
    </div>

    <div style="color:#9cff75;font-size:12px;margin-top:3px">
      READ-ONLY DATA TEST
    </div>

    <div id="fc27-status"
         style="margin-top:12px;color:#aaa;font-size:13px">
      Waiting for Transfer Market...
    </div>

    <button id="fc27-test"
      style="
        width:100%;
        margin-top:12px;
        padding:10px;
        border:0;
        border-radius:9px;
        background:#39ff00;
        color:#001000;
        font-weight:800;
      ">
      TEST MARKET DATA
    </button>

    <pre id="fc27-output"
      style="
        white-space:pre-wrap;
        word-break:break-word;
        font-size:11px;
        color:#baffaa;
        max-height:250px;
        overflow:auto;
      "></pre>
  `;

  document.documentElement.appendChild(panel);

  const status = panel.querySelector("#fc27-status");
  const output = panel.querySelector("#fc27-output");
  const button = panel.querySelector("#fc27-test");

  button.addEventListener("click", function () {
    status.textContent = "Scanning current Web App page...";

    const text = document.body.innerText || "";

    const looksLikeMarket =
      /Transfer Market/i.test(text) ||
      /Buy Now/i.test(text) ||
      /Search the Transfer Market/i.test(text);

    if (looksLikeMarket) {
      status.textContent = "Transfer Market page detected ✓";

      output.textContent =
        "Page detected successfully.\\n\\n" +
        "Next test: connect the collector to the Web App's market data.";
    } else {
      status.textContent = "Transfer Market not detected";

      output.textContent =
        "Go to EA FC 27 → Transfers → Transfer Market → search a player.";
    }
  });
})();