"use client";

import { isPsaPokemonTcgCert } from "@/lib/psa/lookupFields";
import type { Grade } from "@/lib/domain/types";
import { formatGbp as gbp } from "@/lib/format/money";
import { CardImage, Metric } from "./UiBits";

type BuyFlowStep = {
  label: string;
  detail: string;
  state: string;
};

type PsaCertView = {
  found: boolean;
  certNumber: string;
  subject?: string;
  brand?: string;
  category?: string;
  year?: string;
  cardNumber?: string;
  variety?: string;
  gradeLabel?: string;
  grade: Grade | null;
  totalPopulation?: number;
  populationHigher?: number;
  isDualCert?: boolean;
  live: boolean;
  reason?: string;
};

type Channel = "EBAY" | "CARDMARKET" | "VINTED" | "IN_PERSON";
type AcquireListingState = "DRAFT" | "ACTIVE";

type LastStockedCard = {
  itemId: string;
  listingId: string | null;
  name: string;
  setName: string;
  number: string;
  grade: string;
  quantity: number;
  costPence: number;
  listPricePence: number;
  channel: Channel;
  listingState: string;
  imageUrl: string | null;
  queued?: boolean;
};

const channels: Channel[] = ["EBAY", "CARDMARKET", "VINTED", "IN_PERSON"];
const sourcePresets = ["Card fair", "Facebook", "eBay", "Cardmarket", "Vinted", "Whatnot", "Collection", "Trade-in"];
const locationPresets = ["Box A", "Box B", "Binder", "To list", "Slabs", "Singles"];
const conditionPresets = ["NM", "LP", "MP", "HP", "DMG"];

export function BuyFlowRail({ steps }: { steps: BuyFlowStep[] }) {
  return (
    <section className="buy-flow-rail" aria-label="Buy workflow">
      {steps.map((step, index) => (
        <div className={`buy-flow-step ${step.state}`} key={step.label}>
          <span>{index + 1}</span>
          <div>
            <strong>{step.label}</strong>
            <small>{step.detail || "ready"}</small>
          </div>
        </div>
      ))}
    </section>
  );
}

export function PsaCertCard({
  result,
  onComp,
  busy = false,
}: {
  result: PsaCertView;
  onComp?: () => void;
  busy?: boolean;
}) {
  const canFeedPokemonComps = result.found && isPsaPokemonTcgCert(result);
  const detailRows = result.found
    ? [
        ["Subject", result.subject ? toTitleCase(result.subject) : null],
        ["Brand", result.brand ? toTitleCase(result.brand) : null],
        ["Category", result.category ? toTitleCase(result.category) : null],
        ["Year", result.year ?? null],
        ["Card #", result.cardNumber ?? null],
        ["Variety", result.variety ? toTitleCase(result.variety) : null],
        ["PSA grade", result.gradeLabel ?? null],
        ["App grade", result.grade?.replace(/_/g, " ") ?? null],
        ["Dual cert", result.isDualCert ? "Yes" : null],
        ["Lookup", result.live ? "Live PSA API" : "Demo fixture"],
      ].filter((row): row is [string, string] => Boolean(row[1]))
    : [];

  return (
    <div className={`psa-cert-card ${result.found ? "good" : "warn"}`}>
      {result.found ? (
        <>
          <div className="psa-cert-heading">
            <div>
              <span>PSA cert {result.certNumber}{result.live ? "" : " · demo"}</span>
              <strong>{toTitleCase(result.subject ?? "Unknown card")}</strong>
              <small>
                {[result.year, result.brand ? toTitleCase(result.brand) : null, result.cardNumber ? `#${result.cardNumber}` : null]
                  .filter(Boolean)
                  .join(" · ")}
                {result.variety ? ` · ${toTitleCase(result.variety)}` : ""}
              </small>
            </div>
            <span className="pill good">{result.gradeLabel ?? result.grade?.replace(/_/g, " ")}</span>
          </div>
          <div className="psa-cert-pop">
            <Metric label="Pop at grade" value={result.totalPopulation != null ? String(result.totalPopulation) : "-"} />
            <Metric label="Pop higher" value={result.populationHigher != null ? String(result.populationHigher) : "-"} />
          </div>
          {detailRows.length > 0 && (
            <div className="psa-cert-data" aria-label="PSA cert data">
              {detailRows.map(([label, value]) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
          )}
          <div className="psa-cert-actions">
            <p className="hint">
              {canFeedPokemonComps
                ? "Verified slab details can feed the comp lookup and listing cert."
                : "Verified cert, but this app only comps Pokémon TCG cards."}
            </p>
            {onComp && (
              <button type="button" onClick={onComp} disabled={busy}>
                {busy ? "Comping..." : "Comp from cert"}
              </button>
            )}
          </div>
        </>
      ) : (
        <p className="hint">{result.reason ?? "Cert not found."}</p>
      )}
    </div>
  );
}

export function IntakeSessionCard({
  source,
  location,
  condition,
  channel,
  listingState,
  keepBuying,
  onSourceChange,
  onLocationChange,
  onConditionChange,
  onChannelChange,
  onListingStateChange,
  onKeepBuyingChange,
}: {
  source: string;
  location: string;
  condition: string;
  channel: Channel;
  listingState: AcquireListingState;
  keepBuying: boolean;
  onSourceChange: (value: string) => void;
  onLocationChange: (value: string) => void;
  onConditionChange: (value: string) => void;
  onChannelChange: (value: Channel) => void;
  onListingStateChange: (value: AcquireListingState) => void;
  onKeepBuyingChange: (value: boolean) => void;
}) {
  return (
    <div className="intake-session-card" aria-label="Buy session defaults">
      <div className="intake-session-heading">
        <div>
          <span>Buy session</span>
          <strong>
            {source || "Source"} · {location || "Place"} · {condition || "Condition"}
          </strong>
        </div>
        <div className="intake-session-mode" role="group" aria-label="After stock">
          <button type="button" className={keepBuying ? "selected" : ""} onClick={() => onKeepBuyingChange(true)}>
            Next
          </button>
          <button type="button" className={!keepBuying ? "selected" : ""} onClick={() => onKeepBuyingChange(false)}>
            Done
          </button>
        </div>
      </div>
      <div className="intake-session-mode wide" role="group" aria-label="Listing defaults">
        {channels.map((option) => (
          <button
            key={option}
            type="button"
            className={channel === option ? "selected" : ""}
            onClick={() => onChannelChange(option)}
          >
            {channelLabel(option)}
          </button>
        ))}
        <button type="button" className={listingState === "DRAFT" ? "selected" : ""} onClick={() => onListingStateChange("DRAFT")}>
          Draft
        </button>
        <button type="button" className={listingState === "ACTIVE" ? "selected" : ""} onClick={() => onListingStateChange("ACTIVE")}>
          Active
        </button>
      </div>
      <div className="intake-session-presets" aria-label="Source presets">
        {sourcePresets.map((preset) => (
          <button key={preset} type="button" className={source === preset ? "selected" : ""} onClick={() => onSourceChange(preset)}>
            {preset}
          </button>
        ))}
      </div>
      <div className="intake-session-presets compact" aria-label="Location and condition presets">
        {locationPresets.map((preset) => (
          <button key={preset} type="button" className={location === preset ? "selected" : ""} onClick={() => onLocationChange(preset)}>
            {preset}
          </button>
        ))}
        {conditionPresets.map((preset) => (
          <button key={preset} type="button" className={condition === preset ? "selected" : ""} onClick={() => onConditionChange(preset)}>
            {preset}
          </button>
        ))}
      </div>
    </div>
  );
}

export function LastStockedPanel({
  card,
  onPack,
  onSell,
  onNext,
  onDismiss,
}: {
  card: LastStockedCard;
  onPack: () => void;
  onSell: () => void;
  onNext: () => void;
  onDismiss: () => void;
}) {
  return (
    <section
      className={`last-stocked-panel${card.queued ? " queued" : ""}`}
      aria-label={card.queued ? "Queued purchase" : "Last stocked card"}
      data-testid={card.queued ? "offline-purchase" : undefined}
    >
      <CardImage src={card.imageUrl} className="mini-card-art" fallbackClassName="mini-card-art blank" alt="" />
      <div className="last-stocked-copy">
        <span>{card.queued ? "Queued on this device" : "Last stocked"}</span>
        <strong>{card.name}</strong>
        <small>
          {card.setName}
          {card.number ? ` #${card.number}` : ""} · {card.grade.replace(/_/g, " ")}
        </small>
        <small>
          {card.quantity} @ {gbp(card.costPence)} ·{" "}
          {card.queued
            ? "not yet synced"
            : card.listingId
            ? `${channelLabel(card.channel)} ${card.listingState.toLowerCase()} ${gbp(card.listPricePence)}`
            : "not listed"}
        </small>
      </div>
      <div className="last-stocked-actions">
        <button type="button" onClick={onPack} disabled={card.queued || !card.listingId}>
          Pack
        </button>
        <button type="button" onClick={onSell} disabled={card.queued}>
          Sell
        </button>
        <button type="button" onClick={onNext}>
          Next
        </button>
        <button className="danger-button" type="button" onClick={onDismiss} aria-label={card.queued ? "Remove queued purchase" : "Dismiss last stocked card"}>
          x
        </button>
      </div>
    </section>
  );
}

function channelLabel(channel: Channel): string {
  if (channel === "EBAY") return "eBay";
  if (channel === "CARDMARKET") return "Cardmarket";
  if (channel === "VINTED") return "Vinted";
  return "In person";
}

function toTitleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
