(function attachPriceEngine(root) {
  "use strict";

  const EA_TAX_RATE = 0.05;

  function estimateEaTax(salePrice) {
    const value = Number(salePrice);
    if (!Number.isFinite(value) || value <= 0) return 0;
    return Math.floor(value * EA_TAX_RATE);
  }

  function estimateProfit(referenceBin, purchaseBin) {
    const reference = Number(referenceBin);
    const purchase = Number(purchaseBin);
    if (!Number.isFinite(reference) || !Number.isFinite(purchase)) return null;
    return Math.floor(reference - estimateEaTax(reference) - purchase);
  }

  function summarizeListings(listings) {
    const bins = listings
      .map((listing) => Number(listing && listing.bin))
      .filter((bin) => Number.isFinite(bin) && bin > 0)
      .sort((a, b) => a - b);

    if (!bins.length) {
      return {
        listingCount: 0,
        lowestBin: null,
        secondBin: null,
        thirdBin: null,
        averageBin: null,
        referenceBin: null,
        estimatedTax: 0,
        samePriceBin: null,
        samePriceFrequency: 0
      };
    }

    // Keep duplicate prices: each card is a separate market listing.
    const referenceBin = bins[Math.min(2, bins.length - 1)];
    const priceCounts = new Map();
    bins.forEach((bin) => priceCounts.set(bin, (priceCounts.get(bin) || 0) + 1));
    const [samePriceBin, samePriceFrequency] = Array.from(priceCounts.entries())
      .sort((left, right) => right[1] - left[1] || left[0] - right[0])[0];
    return {
      listingCount: bins.length,
      lowestBin: bins[0],
      secondBin: bins[1] ?? null,
      thirdBin: bins[2] ?? null,
      averageBin: Math.round(bins.reduce((sum, bin) => sum + bin, 0) / bins.length),
      referenceBin,
      estimatedTax: estimateEaTax(referenceBin),
      samePriceBin: samePriceFrequency > 1 ? samePriceBin : null,
      samePriceFrequency: samePriceFrequency > 1 ? samePriceFrequency : 0
    };
  }

  function analyzeListings(listings, criteria) {
    const maxBin = Number(criteria && criteria.maxBin);
    const minimumProfit = Number(criteria && criteria.minimumProfit);
    const summary = summarizeListings(listings);
    const frequencies = new Map();

    listings.forEach((listing) => {
      const bin = Number(listing && listing.bin);
      if (Number.isFinite(bin) && bin > 0) {
        frequencies.set(bin, (frequencies.get(bin) || 0) + 1);
      }
    });

    const analyzed = listings.map((listing) => {
      const bin = Number(listing && listing.bin);
      const profit = estimateProfit(summary.referenceBin, bin);
      return {
        ...listing,
        estimatedProfit: profit,
        listingFrequency: frequencies.get(bin) || 0,
        qualifies: Number.isFinite(maxBin) &&
          Number.isFinite(minimumProfit) &&
          bin <= maxBin &&
          profit !== null &&
          profit >= minimumProfit
      };
    });

    return {
      summary,
      analyzed,
      findings: analyzed.filter((listing) => listing.qualifies)
    };
  }

  root.FC27PriceEngine = Object.freeze({
    estimateEaTax,
    estimateProfit,
    summarizeListings,
    analyzeListings
  });
})(globalThis);
