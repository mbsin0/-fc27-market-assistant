"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
require("../price-engine.js");

const engine = globalThis.FC27PriceEngine;

test("price summary retains duplicate BIN listings", () => {
  const listings = [
    { player: "Isak", bin: 1000 },
    { player: "Isak", bin: 1000 },
    { player: "Isak", bin: 1200 },
    { player: "Isak", bin: 2000 }
  ];
  const summary = engine.summarizeListings(listings);
  assert.equal(summary.listingCount, 4);
  assert.equal(summary.lowestBin, 1000);
  assert.equal(summary.secondBin, 1000);
  assert.equal(summary.thirdBin, 1200);
  assert.equal(summary.averageBin, 1300);
  assert.equal(summary.referenceBin, 1200);
  assert.equal(summary.estimatedTax, 60);
  assert.equal(summary.samePriceBin, 1000);
  assert.equal(summary.samePriceFrequency, 2);
});

test("tax is isolated and profit uses the reference sale BIN", () => {
  assert.equal(engine.estimateEaTax(1200), 60);
  assert.equal(engine.estimateProfit(1200, 1000), 140);
});

test("qualifying analysis preserves same-price cards and reports frequency", () => {
  const listings = [
    { player: "Isak", bin: 1000, token: "one" },
    { player: "Isak", bin: 1000, token: "two" },
    { player: "Isak", bin: 1200, token: "three" }
  ];
  const result = engine.analyzeListings(listings, { maxBin: 1100, minimumProfit: 100 });
  assert.equal(result.analyzed.length, 3);
  assert.equal(result.findings.length, 2);
  assert.deepEqual(result.findings.map((listing) => listing.token), ["one", "two"]);
  assert.equal(result.findings[0].listingFrequency, 2);
  assert.equal(result.findings[1].listingFrequency, 2);
});
