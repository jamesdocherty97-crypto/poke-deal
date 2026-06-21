// Offline sample data so the full spine (lookup → clean → price → inventory)
// runs with no API keys. Dates are generated relative to `now` so fixtures always
// land inside the lookback window. Intentionally messy: mixed currencies, a lot
// listing, a wrong-grade entry, and a couple of outliers — to exercise cleaning.

import type { RawSale } from "../../domain/types.js";

function daysAgo(now: Date, n: number): string {
  return new Date(now.getTime() - n * 24 * 60 * 60 * 1000).toISOString();
}

/** Raw sales for "Charizard ex 199/165 (SV151)" — a chunky, liquid card. */
export function sampleRawSales(now: Date = new Date()): RawSale[] {
  return [
    // ── RAW singles (the clean signal) ──
    { amount: 28.0, currency: "GBP", soldAt: daysAgo(now, 3), title: "Charizard ex 199/165 SV151 NM", gradeLabel: "Ungraded" },
    { amount: 26.5, currency: "GBP", soldAt: daysAgo(now, 8), title: "Charizard ex 199/165 151 Near Mint", gradeLabel: "Raw" },
    { amount: 31.0, currency: "EUR", soldAt: daysAgo(now, 12), title: "Charizard ex 199/165 SV151", gradeLabel: "Ungraded" },
    { amount: 27.0, currency: "GBP", soldAt: daysAgo(now, 20), title: "Charizard ex 199/165", gradeLabel: undefined },
    { amount: 35.0, currency: "USD", soldAt: daysAgo(now, 25), title: "Charizard ex 199/165 SV151 pack fresh", gradeLabel: "Ungraded" },
    { amount: 29.5, currency: "GBP", soldAt: daysAgo(now, 33), title: "Charizard ex 199 165 NM", gradeLabel: "Ungraded" },
    { amount: 30.0, currency: "GBP", soldAt: daysAgo(now, 41), title: "Charizard ex SV151 199/165", gradeLabel: "Ungraded" },
    { amount: 28.5, currency: "GBP", soldAt: daysAgo(now, 55), title: "Charizard ex 199/165 raw", gradeLabel: "Ungraded" },
    // outlier (mispriced steal) — should be stripped:
    { amount: 8.0, currency: "GBP", soldAt: daysAgo(now, 18), title: "Charizard ex 199/165 NM", gradeLabel: "Ungraded" },
    // outlier (overpriced impulse) — should be stripped:
    { amount: 95.0, currency: "GBP", soldAt: daysAgo(now, 10), title: "Charizard ex 199/165", gradeLabel: "Ungraded" },
    // lot — must be dropped by isLotTitle:
    { amount: 120.0, currency: "GBP", soldAt: daysAgo(now, 5), title: "Charizard ex 199/165 x5 bundle joblot", gradeLabel: "Ungraded" },
    // wrong grade for a RAW query — dropped when grade=RAW, kept when grade=PSA_10:
    { amount: 150.0, currency: "GBP", soldAt: daysAgo(now, 7), title: "Charizard ex 199/165 PSA 10 GEM MINT", gradeLabel: "PSA 10" },

    // ── PSA 10 slabs ──
    { amount: 145.0, currency: "GBP", soldAt: daysAgo(now, 6), title: "Charizard ex 199/165 PSA 10", gradeLabel: "PSA 10" },
    { amount: 160.0, currency: "EUR", soldAt: daysAgo(now, 14), title: "Charizard ex 199/165 PSA 10 Gem Mint", gradeLabel: "PSA10" },
    { amount: 138.0, currency: "GBP", soldAt: daysAgo(now, 28), title: "Charizard ex 199/165 PSA 10", gradeLabel: "PSA 10" },
    { amount: 155.0, currency: "GBP", soldAt: daysAgo(now, 47), title: "Charizard ex SV151 PSA 10", gradeLabel: "PSA 10" },
    { amount: 149.0, currency: "USD", soldAt: daysAgo(now, 60), title: "Charizard ex 199/165 PSA 10", gradeLabel: "PSA 10" },

    // ── PSA 9 ──
    { amount: 62.0, currency: "GBP", soldAt: daysAgo(now, 9), title: "Charizard ex 199/165 PSA 9", gradeLabel: "PSA 9" },
    { amount: 58.0, currency: "GBP", soldAt: daysAgo(now, 30), title: "Charizard ex 199/165 PSA 9 Mint", gradeLabel: "PSA 9" },
  ];
}
