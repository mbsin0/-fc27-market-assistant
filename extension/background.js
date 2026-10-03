"use strict";

const SETTINGS_KEY = "fc27SessionSettings";
const DEFAULT_SETTINGS = Object.freeze({
  maxBin: 30000,
  minimumProfit: 500,
  pagesToScan: 10,
  timeLimitMinutes: 5,
  debugScan: false
});

function normalizeSettings(input) {
  const source = input && typeof input === "object" ? input : {};
  const integer = (value, fallback, min, max) => {
    const number = Number(value);
    return Number.isFinite(number)
      ? Math.min(max, Math.max(min, Math.floor(number)))
      : fallback;
  };

  return {
    maxBin: integer(source.maxBin, DEFAULT_SETTINGS.maxBin, 500, 15000000),
    minimumProfit: integer(source.minimumProfit, DEFAULT_SETTINGS.minimumProfit, 0, 15000000),
    pagesToScan: integer(source.pagesToScan ?? source.searchesLimit, DEFAULT_SETTINGS.pagesToScan, 1, 50),
    timeLimitMinutes: integer(source.timeLimitMinutes, DEFAULT_SETTINGS.timeLimitMinutes, 1, 120),
    debugScan: source.debugScan === true
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.type !== "string") return false;

  if (message.type === "FC27_GET_SETTINGS") {
    chrome.storage.session.get(SETTINGS_KEY).then((stored) => {
      sendResponse(normalizeSettings(stored[SETTINGS_KEY]));
    }).catch(() => sendResponse({ ...DEFAULT_SETTINGS }));
    return true;
  }

  if (message.type === "FC27_SAVE_SETTINGS") {
    const settings = normalizeSettings(message.settings);
    chrome.storage.session.set({ [SETTINGS_KEY]: settings }).then(() => {
      sendResponse({ ok: true, settings });
    }).catch(() => sendResponse({ ok: false, settings }));
    return true;
  }

  return false;
});
