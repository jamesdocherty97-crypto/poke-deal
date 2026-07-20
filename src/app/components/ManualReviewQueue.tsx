"use client";

import { useState } from "react";
import type { ManualCompReview } from "@/lib/comps/manualReview";
import { formatGbp as gbp } from "@/lib/format/money";
import { CardImage, EmptyState, MoneyInput } from "./UiBits";

export function ManualReviewQueue({
  reviews,
  busyId,
  onAccept,
  onAddCheckedComp,
}: {
  reviews: ManualCompReview[];
  busyId: string | null;
  onAccept: (review: ManualCompReview) => void;
  onAddCheckedComp: (review: ManualCompReview, input: { pricePence: number; soldDate: string; condition?: string; priceBasis: "DISPLAYED_PRICE" | "ITEM_PRICE" | "BUYER_TOTAL" | "BEST_OFFER_UNKNOWN"; sourceUrl: string; note?: string }) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [price, setPrice] = useState("");
  const [soldDate, setSoldDate] = useState(todayInputValue());
  const [note, setNote] = useState("");
  const [condition, setCondition] = useState("NM");
  const [sourceUrl, setSourceUrl] = useState("");
  const [priceBasis, setPriceBasis] = useState<"DISPLAYED_PRICE" | "ITEM_PRICE" | "BUYER_TOTAL" | "BEST_OFFER_UNKNOWN">("DISPLAYED_PRICE");

  if (reviews.length === 0) {
    return <EmptyState art="alerts" text="No manual checks waiting. Every cautious verdict has been reviewed." />;
  }

  return (
    <div className="manual-review-list" aria-label="Manual comp review queue">
      {reviews.map((review) => {
        const sources = reviewSources(review);
        const editing = editingId === review.id;
        return (
          <article className="manual-review-card" key={review.id}>
            <div className="manual-review-heading">
              <CardImage
                src={review.card.displayImageUrl ?? review.card.imageUrl}
                className="mini-card-art"
                fallbackClassName="mini-card-art blank"
                alt=""
              />
              <div>
                <span>{review.grade.replace(/_/g, " ")}{review.condition ? ` · ${review.condition}` : ""} · {review.confidence ?? "low"} confidence</span>
                <strong>{review.card.name}</strong>
                <small>{review.card.setName}{review.card.number ? ` #${review.card.number}` : ""}</small>
              </div>
              <div className="manual-review-headline">
                <span>Headline</span>
                <strong>{gbp(review.headlinePence)}</strong>
                <small>{review.sampleSize} sold / {review.windowDays}d</small>
              </div>
            </div>
            <div className="manual-review-reasons">
              <strong>Why it stopped</strong>
              <span>{review.reasons.map(reasonLabel).join(" · ") || "Source confidence needs a dealer check."}</span>
            </div>
            <div className="manual-review-sources" aria-label="Disagreeing comp sources">
              {sources.length > 0 ? sources.map((source) => (
                <div className={`manual-review-source source-${reviewSourceVisualKind(source.name)} freshness-${reviewFreshnessKind(source.asOf)}`} key={`${source.name}-${source.pricePence}`}>
                  <span>{source.name}</span>
                  <strong>{gbp(source.pricePence)}</strong>
                  <small>{source.sampleSize} sold · {ageLabel(source.asOf)}</small>
                </div>
              )) : (
                <div className={`manual-review-source source-${reviewSourceVisualKind(review.source)} freshness-${reviewFreshnessKind(review.asOf)}`}>
                  <span>{review.source}</span>
                  <strong>{gbp(review.headlinePence)}</strong>
                  <small>{review.sampleSize} sold · {ageLabel(review.asOf)}</small>
                </div>
              )}
            </div>
            {editing ? (
              <div className="manual-review-entry">
                <label>
                  Checked sold price
                  <MoneyInput value={price} onChange={setPrice} />
                </label>
                <label>
                  Sold date
                  <input type="date" value={soldDate} max={todayInputValue()} onChange={(event) => setSoldDate(event.target.value)} />
                </label>
                {review.grade === "RAW" && (
                  <label>
                    Condition
                    <select
                      value={review.condition ?? condition}
                      disabled={Boolean(review.condition)}
                      onChange={(event) => setCondition(event.target.value)}
                    >
                      {['NM', 'LP', 'MP', 'HP', 'DMG'].map((value) => <option key={value} value={value}>{value}</option>)}
                    </select>
                    {review.condition && <small>Locked to the condition that created this review.</small>}
                  </label>
                )}
                <label>
                  Individual eBay sold-item URL
                  <input type="url" inputMode="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://www.ebay.co.uk/itm/…" />
                </label>
                <label>
                  Price basis
                  <select value={priceBasis} onChange={(event) => setPriceBasis(event.target.value as typeof priceBasis)}>
                    <option value="DISPLAYED_PRICE">Displayed sold price · excludes delivery</option>
                    <option value="ITEM_PRICE">Seller item price · before Buyer Protection</option>
                    <option value="BUYER_TOTAL">Checkout total · includes delivery/fees</option>
                    <option value="BEST_OFFER_UNKNOWN">Best Offer · accepted price hidden</option>
                  </select>
                </label>
                <label>
                  Note
                  <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Exact UK sold; same grade" />
                </label>
                <div className="manual-review-actions">
                  <button type="button" className="ghost-button" onClick={() => setEditingId(null)}>Cancel</button>
                  <button
                    type="button"
                    className="primary-action"
                    disabled={busyId === review.id || poundsToPence(price) <= 0 || !sourceUrl.trim()}
                    onClick={() => onAddCheckedComp(review, {
                      pricePence: poundsToPence(price),
                      soldDate,
                      ...(review.grade === "RAW" ? { condition: review.condition ?? condition } : {}),
                      sourceUrl: sourceUrl.trim(),
                      priceBasis,
                      ...(note.trim() ? { note: note.trim() } : {}),
                    })}
                  >
                    {busyId === review.id ? "Saving…" : "Save checked comp"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="manual-review-actions">
                <button
                  type="button"
                  className="primary-action"
                  disabled={busyId === review.id}
                  onClick={() => onAccept(review)}
                >
                  {busyId === review.id ? "Resolving…" : `Accept ${gbp(review.headlinePence)}`}
                </button>
                <button type="button" disabled={busyId === review.id} onClick={() => {
                  setEditingId(review.id);
                  setPrice(penceToPounds(review.headlinePence));
                  setSoldDate(todayInputValue());
                  setNote("");
                  setCondition(review.condition ?? "NM");
                  setSourceUrl("");
                  setPriceBasis("DISPLAYED_PRICE");
                }}>
                  Add checked comp
                </button>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

function reviewSources(review: ManualCompReview): Array<{ name: string; pricePence: number; sampleSize: number; asOf: string }> {
  const receipt = review.receipt as { all?: unknown } | null;
  if (!Array.isArray(receipt?.all)) return [];
  return receipt.all
    .filter((row): row is { source: string; medianPence: number; sampleSize: number; asOf: string } => {
      if (!row || typeof row !== "object") return false;
      const value = row as Record<string, unknown>;
      return typeof value.source === "string" && typeof value.medianPence === "number" && value.medianPence > 0 && typeof value.sampleSize === "number" && typeof value.asOf === "string";
    })
    .map((row) => ({ name: sourceLabel(row.source), pricePence: row.medianPence, sampleSize: row.sampleSize, asOf: row.asOf }))
    .sort((left, right) => left.pricePence - right.pricePence)
    .slice(0, 4);
}

function sourceLabel(value: string): string {
  return value.replace(/^pokemon-/i, "").replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function reviewSourceVisualKind(source: string): "owned" | "checked" | "sold" | "market" | "cached" {
  const normalized = source.toLowerCase();
  if (normalized.includes("owned")) return "owned";
  if (normalized.includes("checked") || normalized.includes("manual")) return "checked";
  if (normalized.includes("cache") || normalized.includes("fallback")) return "cached";
  if (normalized.includes("ebay") || normalized.includes("price tracker") || normalized.includes("sold")) return "sold";
  return "market";
}

function reviewFreshnessKind(value: string): "live" | "recent" | "aging" | "stale" | "expired" {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "expired";
  const ageDays = Math.max(0, (Date.now() - timestamp) / (24 * 60 * 60 * 1_000));
  if (ageDays <= 1) return "live";
  if (ageDays <= 30) return "recent";
  if (ageDays <= 90) return "aging";
  if (ageDays <= 180) return "stale";
  return "expired";
}

function reasonLabel(value: string): string {
  return value.replace(/[-_:]/g, " ");
}

function poundsToPence(value: string): number {
  const amount = Number(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

function penceToPounds(value: number): string {
  return (value / 100).toFixed(2);
}

function todayInputValue(): string {
  return new Date().toISOString().slice(0, 10);
}

function ageLabel(value: string): string {
  const hours = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / (60 * 60 * 1_000)));
  return hours < 24 ? `${Math.max(1, hours)}h old` : `${Math.round(hours / 24)}d old`;
}
