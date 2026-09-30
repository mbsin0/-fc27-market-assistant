// ==UserScript==
// @name         FC27 Market Assistant
// @namespace    mbsin0-fc27
// @version      0.6.6
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
    // EA SEARCH RESULTS DETECTION
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
    // LISTING DETECTION
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

            if (
                container &&
                container.contains(el)
            ) {
                return;
            }

            const text = cleanText(
                el.innerText
            );

            if (!hasListingData(text)) {
                return;
            }

            const childContainsListing =
                Array.from(el.children).some(
                    function (child) {

                        if (!isVisible(child)) {
                            return false;
                        }

                        return hasListingData(
                            cleanText(
                                child.innerText
                            )
                        );
                    }
                );

            if (!childContainsListing) {
                candidates