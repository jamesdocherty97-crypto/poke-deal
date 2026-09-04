"use client";

import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { parseConfirmedPounds } from "@/lib/dealer/saleLedger";
import { formatGbp as gbp } from "@/lib/format/money";
import { MoneyInput } from "./UiBits";

export type SaleLedgerSummary = {
  id: string;
  itemId: string;
  name: string;
  grade: string;
  channel: "EBAY" | "CARDMARKET" | "VINTED" | "IN_PERSON";
  salePricePence: number;
  feesPence: number;
  postagePence: number;
  costBasisPence: number;
  profitPence: number;
  marginPct: number | null;
  soldAt: string;
  costBasisEstimated?: boolean;
  costsEstimated?: boolean;
  itemRevenuePence?: number | null;
  amountRevisionCount?: number;
  undoable?: boolean;
};

export function SaleLedgerRow({ sale, busy, onSaleCorrected, onUndo }: {
  sale: SaleLedgerSummary;
  busy: boolean;
  onSaleCorrected: () => Promise<void>;
  onUndo?: (sale: SaleLedgerSummary) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fees, setFees] = useState("");
  const [postage, setPostage] = useState("");
  const [cost, setCost] = useState("");
  const [itemRevenue, setItemRevenue] = useState("");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const firstInput = useRef<HTMLInputElement>(null);
  const editorId = useId();
  const provisional = sale.costsEstimated !== false || sale.costBasisEstimated === true;
  useEffect(() => { if (editing) firstInput.current?.focus(); }, [editing]);

  function beginEditing() {
    setFees(pounds(sale.feesPence));
    setPostage(pounds(sale.postagePence));
    setCost(sale.costBasisEstimated ? "" : pounds(sale.costBasisPence));
    setItemRevenue(sale.itemRevenuePence == null ? "" : pounds(sale.itemRevenuePence));
    setReason("");
    setConfirmed(false);
    setMessage(null);
    setEditing(true);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setMessage(null);
    try {
      if (!confirmed) throw new Error("Confirm that you checked the actual amounts for this copy.");
      const data = {
        feesPence: parseConfirmedPounds(fees, "Fees"),
        postagePence: parseConfirmedPounds(postage, "Seller postage"),
        costBasisPence: parseConfirmedPounds(cost, "Acquisition cost per copy"),
        itemRevenuePence: itemRevenue.trim() === "" ? null : parseConfirmedPounds(itemRevenue, "Item-only revenue"),
        reason: reason.trim(),
      };
      if (data.itemRevenuePence != null && data.itemRevenuePence > sale.salePricePence) throw new Error("Item-only revenue cannot exceed the recorded buyer payment.");
      if (data.reason.length < 3 || data.reason.length > 500) throw new Error("Add a reason between 3 and 500 characters so the correction can be traced.");
      setSaving(true);
      const response = await fetch(`/api/sales/${encodeURIComponent(sale.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? "Could not confirm sale costs. Your entries have been kept.");
      setEditing(false);
      setMessage("Amounts confirmed. Previous values and your reason are retained in the sales export.");
      await onSaleCorrected().catch(() => setMessage("Amounts saved. Refresh Profit to load the updated totals."));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not confirm sale costs. Your entries have been kept.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <article>
      <div className="mini-row sale-mini-row">
        <div>
          <strong>{sale.name} {sale.grade.replace(/_/g, " ")}</strong>
          <span>{new Date(sale.soldAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} · {channelLabel(sale.channel)} · buyer paid {gbp(sale.salePricePence)}</span>
          <small>Per copy · fees {gbp(sale.feesPence)} · postage {gbp(sale.postagePence)} · cost {gbp(sale.costBasisPence)}</small>
          <span className={`pill ${provisional ? "warn" : "good"}`}>{provisional ? "Provisional profit" : "Costs confirmed"}</span>
          {sale.costBasisEstimated && <small>Historical acquisition cost needs confirmation.</small>}
          {(sale.amountRevisionCount ?? 0) > 0 && <small>{sale.amountRevisionCount} saved correction{sale.amountRevisionCount === 1 ? "" : "s"} · history in Sales CSV</small>}
        </div>
        <div className="sale-result">
          <strong>{gbp(sale.profitPence)}</strong>
          <span>{sale.marginPct == null ? "n/a" : `${sale.marginPct}%`}</span>
          <button className="ghost-button" type="button" aria-expanded={editing} aria-controls={editorId} onClick={() => editing ? setEditing(false) : beginEditing()} disabled={saving || busy}>
            {editing ? "Close cost editor" : provisional ? "Confirm actual costs" : "Correct amounts"}
          </button>
          {sale.undoable === true && onUndo && (
            <button className="ghost-button sale-undo-button" type="button" onClick={() => onUndo(sale)} disabled={saving || busy}>
              {busy ? "Undoing…" : "Undo recording mistake"}
            </button>
          )}
        </div>
      </div>
      {editing && (
        <form id={editorId} className="expense-form" onSubmit={(event) => void save(event)} aria-label={`Confirm costs for ${sale.name}`}>
          <p className="hint">Use amounts for this one copy. For a multi-copy order, allocate the actual fees and postage between copies so the total matches the order.</p>
          <div className="form-grid">
            <label>Actual fees (£)<MoneyInput ref={firstInput} value={fees} onChange={setFees} disabled={saving} /></label>
            <label>Actual seller postage and packing (£)<MoneyInput value={postage} onChange={setPostage} disabled={saving} /></label>
          </div>
          <div className="form-grid">
            <label>Acquisition cost per copy (£)<MoneyInput value={cost} onChange={setCost} disabled={saving} placeholder={sale.costBasisEstimated ? "Enter the historical cost" : undefined} /></label>
            <label>Item-only revenue (£, optional)<MoneyInput value={itemRevenue} onChange={setItemRevenue} disabled={saving} placeholder="Leave blank if unknown" /></label>
          </div>
          {sale.costBasisEstimated && <p className="hint">The current stock cost, {gbp(sale.costBasisPence)}, is only a provisional basis in the totals. Enter the acquisition cost for the copy sold from your records.</p>}
          <p className="hint">Item-only revenue excludes postage paid by the buyer. Leaving it unknown keeps this sale out of owned-price comps. The recorded buyer payment stays {gbp(sale.salePricePence)}.</p>
          <label>Reason or receipt checked<textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} minLength={3} required disabled={saving} rows={2} placeholder="For example: checked eBay order fees and postage receipt" /></label>
          <div className="settings-toggle-row"><label><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} required disabled={saving} />I checked the actual fees, seller postage and acquisition cost for this copy.</label></div>
          <div className="export-actions">
            <button className="primary-action" type="submit" disabled={saving}>{saving ? "Saving amounts…" : "Save confirmed costs"}</button>
            <button className="ghost-button" type="button" disabled={saving} onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </form>
      )}
      {message && <p className="hint" role="status">{message}</p>}
    </article>
  );
}

function pounds(pence: number): string { return (pence / 100).toFixed(2); }
function channelLabel(channel: SaleLedgerSummary["channel"]): string {
  return { EBAY: "eBay", CARDMARKET: "Cardmarket", VINTED: "Vinted", IN_PERSON: "In person" }[channel];
}
