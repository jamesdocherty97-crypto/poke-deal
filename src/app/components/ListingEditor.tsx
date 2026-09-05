"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type RefObject } from "react";
import { formatGbp } from "@/lib/format/money";
import { normalizeListingUrl } from "@/lib/dealer/listingUrl";
import "../styles/listing-editor.css";

type Channel = "EBAY" | "CARDMARKET" | "VINTED" | "IN_PERSON";

export type ListingEditorListing = {
  id: string;
  channel: Channel;
  state: "DRAFT" | "ACTIVE" | "SOLD" | "ENDED";
  title: string | null;
  titleCustomized?: boolean;
  description?: string | null;
  listPrice: number | null;
  suggestedPrice: number | null;
  externalUrl: string | null;
  ebayOfferId?: string | null;
  item?: {
    card: { name: string; setName?: string | null; number?: string | null };
    grade: string;
    condition?: string | null;
    quantity: number;
    status: string;
    costBasis: number;
    photos?: Array<{ origin?: string }>;
  };
};

export type ListingEditorPatch = Partial<{
  title: string | null;
  titleCustomized: boolean;
  description: string | null;
  listPricePence: number | null;
  channel: Channel;
  externalUrl: string | null;
}>;

type Props = {
  listing: ListingEditorListing;
  onSave: (patch: ListingEditorPatch) => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
  online: boolean;
  loadLiveDetails?: () => Promise<{ title: string; description: string; listPricePence: number }>;
};

const channelNames: Record<Channel, string> = {
  EBAY: "eBay", CARDMARKET: "Cardmarket", VINTED: "Vinted", IN_PERSON: "In person",
};

// Keep form entry as text, and convert whole pounds/fractional pence separately.
// This avoids float rounding and accepts the decimal keyboard's trailing dot.
function priceInPence(value: string): number | null | undefined {
  const text = value.trim();
  if (!text) return null;
  if (!/^\d+(?:\.\d{0,2})?$/.test(text)) return undefined;
  const [pounds, pennies = ""] = text.split(".");
  const pence = Number(pounds) * 100 + Number(pennies.padEnd(2, "0"));
  return Number.isSafeInteger(pence) && pence <= 2_147_483_647 ? pence : undefined;
}

function useModalViewport(dialog: RefObject<HTMLDialogElement>, heading: RefObject<HTMLHeadingElement>, trigger: HTMLElement | null) {
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    heading.current?.focus({ preventScroll: true });
    const viewport = window.visualViewport;
    const updateViewport = () => {
      if (!viewport || viewport.scale !== 1) return;
      element.style.setProperty("--listing-editor-viewport-height", `${viewport.height}px`);
      element.style.setProperty("--listing-editor-viewport-top", `${viewport.offsetTop}px`);
    };
    updateViewport();
    viewport?.addEventListener("resize", updateViewport);
    viewport?.addEventListener("scroll", updateViewport);
    return () => {
      viewport?.removeEventListener("resize", updateViewport);
      viewport?.removeEventListener("scroll", updateViewport);
      if (element.open) element.close();
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [dialog, heading, trigger]);
}

/** Mount with key={listing.id}; unsaved values deliberately survive parent refreshes. */
export function ListingEditor(props: Props) {
  const { listing, loadLiveDetails } = props;
  const trigger = useRef(typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null).current;
  const loader = useRef(loadLiveDetails).current;
  const needsLiveDetails = listing.channel === "EBAY" && listing.state === "ACTIVE" && Boolean(listing.ebayOfferId) && Boolean(loader);
  const [snapshot, setSnapshot] = useState<{ title: string; description: string; listPricePence: number } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!needsLiveDetails || !loader) return;
    let active = true;
    setLoadError(null);
    void loader().then((details) => {
      if (active) setSnapshot(details);
    }).catch((err: unknown) => {
      if (active) setLoadError(err instanceof TypeError
        ? "Couldn't reach eBay through Poke Deal. Check your connection, then retry."
        : err instanceof Error ? err.message : "Couldn't load the current eBay listing. Try again.");
    });
    return () => { active = false; };
  }, [needsLiveDetails, loader, attempt]);

  if (needsLiveDetails && !snapshot) return <LoadingListingEditor listing={listing} error={loadError} onRetry={() => { setLoadError(null); setAttempt((value) => value + 1); }} onClose={props.onClose} trigger={trigger} />;
  return <ReadyListingEditor {...props} listing={snapshot ? { ...listing, title: snapshot.title, description: snapshot.description, listPrice: snapshot.listPricePence } : listing} trigger={trigger} />;
}

function LoadingListingEditor({ listing, error, onRetry, onClose, trigger }: {
  listing: ListingEditorListing; error: string | null; onRetry: () => void; onClose: () => void; trigger: HTMLElement | null;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useModalViewport(dialog, heading, trigger);
  return <dialog ref={dialog} className="listing-editor" aria-labelledby={`${id}-heading`} onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <div className="listing-editor-form">
      <header className="listing-editor-header"><div><span className="listing-editor-kicker"><span className="listing-editor-pokeball" aria-hidden="true" />eBay · Live listing</span><h2 id={`${id}-heading`} ref={heading} tabIndex={-1}>Edit listing</h2></div><button type="button" className="listing-editor-close" aria-label="Close listing editor" onClick={onClose}>×</button></header>
      <div className="listing-editor-scroll">
        <p className="listing-editor-card-name">{listing.item?.card.name ?? listing.title ?? "eBay listing"}</p>
        {error ? <div className="listing-editor-notice"><p role="alert">{error}</p><p>Load the current listing before editing so your changes start with what buyers see.</p><a href={normalizeListingUrl(listing.externalUrl) ?? "https://www.ebay.co.uk/sh/lst/active"} target="_blank" rel="noreferrer">Open listing on eBay</a></div> : <p className="listing-editor-context" role="status">Loading current eBay listing…</p>}
      </div>
      <footer className="listing-editor-footer"><div className="listing-editor-actions"><button type="button" onClick={onClose}>Close</button>{error && <button type="button" className="listing-editor-save" onClick={onRetry}>Retry</button>}</div></footer>
    </div>
  </dialog>;
}

function ReadyListingEditor({ listing, onSave, onClose, online, trigger }: Props & { trigger: HTMLElement | null }) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const discardHeading = useRef<HTMLParagraphElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const lastField = useRef<HTMLElement | null>(null);
  const initial = useRef(listing).current;
  const [price, setPrice] = useState(() => initial.listPrice == null ? "" : (initial.listPrice / 100).toFixed(2));
  const [title, setTitle] = useState(initial.title ?? "");
  const [description, setDescription] = useState(initial.description ?? "");
  const [channel, setChannel] = useState(initial.channel);
  const [externalUrl, setExternalUrl] = useState(initial.externalUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const saveInFlight = useRef(false);

  const active = initial.state === "ACTIVE";
  const liveEbay = active && initial.channel === "EBAY";
  const manualEbay = liveEbay && !initial.ebayOfferId;
  const readOnly = manualEbay || initial.state === "SOLD";
  const pence = priceInPence(price);
  const titleChanged = title.trim() !== (initial.title ?? "").trim();
  const descriptionChanged = description.trim() !== (initial.description ?? "").trim();
  const priceChanged = pence !== initial.listPrice;
  const channelChanged = !active && channel !== initial.channel;
  const urlChanged = !active && externalUrl.trim() !== (initial.externalUrl ?? "");
  const dirty = titleChanged || descriptionChanged || priceChanged || channelChanged || urlChanged;
  const changes = [priceChanged && "price", titleChanged && "title", descriptionChanged && "description", channelChanged && "channel", urlChanged && "listing link"].filter(Boolean);
  const titleLimit = channel === "EBAY" ? 80 : 200;
  const priceError = pence === undefined
    ? "Enter a price in pounds with up to two decimal places."
    : channel === "EBAY" && pence != null && pence < 99
      ? "eBay's minimum list price is £0.99."
      : active && (pence == null || pence <= 0)
        ? "A live listing needs a price greater than £0.00."
        : null;
  const titleError = title.trim().length > titleLimit
    ? `Keep the title within ${titleLimit} characters.`
    : titleChanged && !title.trim() && liveEbay
      ? "Add a title for the live eBay listing."
      : null;
  const descriptionError = description.length > 50_000
    ? "Keep the description within 50,000 characters."
    : liveEbay && !readOnly && !description.trim()
      ? "Add a description so you can review exactly what buyers will see."
      : null;
  const normalizedUrl = normalizeListingUrl(externalUrl);
  const urlError = !active && externalUrl.trim() && !normalizedUrl ? "Enter a valid listing URL." : null;
  const validationError = priceError ?? titleError ?? descriptionError ?? urlError;
  const safeExternalUrl = normalizeListingUrl(initial.externalUrl);
  const photoCount = initial.item?.photos?.length ?? 0;
  const catalogPhotoCount = initial.item?.photos?.filter((photo) => photo.origin === "CATALOG").length ?? 0;

  useModalViewport(dialog, heading, trigger);

  useEffect(() => {
    if (!dirty) return;
    const preventLoss = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, [dirty]);

  useEffect(() => {
    if (confirmDiscard) discardHeading.current?.focus({ preventScroll: true });
  }, [confirmDiscard]);

  useEffect(() => {
    if (error) errorRef.current?.focus({ preventScroll: true });
  }, [error]);

  function requestClose() {
    if (saveInFlight.current) return;
    if (dirty && !readOnly) setConfirmDiscard(true);
    else onClose();
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saveInFlight.current || readOnly || !dirty) return;
    if (validationError) { setError(validationError); return; }
    if (!online) { setError("Reconnect to save. Your changes stay here while this editor is open."); return; }
    const patch: ListingEditorPatch = {};
    if (priceChanged) patch.listPricePence = pence ?? null;
    if (titleChanged) {
      patch.title = title.trim() || null;
      if (Boolean(title.trim()) !== (initial.titleCustomized ?? false)) patch.titleCustomized = Boolean(title.trim());
    }
    if (descriptionChanged) patch.description = description.trim() || null;
    if (channelChanged) patch.channel = channel;
    if (urlChanged) patch.externalUrl = normalizedUrl;
    saveInFlight.current = true;
    setSaving(true);
    setError(null);
    try {
      const result = await onSave(patch);
      if (result.ok) onClose();
      else setError(result.error || "Couldn't save this listing. Your changes are still here; try again.");
    } catch {
      setError("Couldn't confirm the save. Your changes are still here; check your connection and try again.");
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  }

  return (
    <dialog ref={dialog} className="listing-editor" aria-labelledby={`${id}-heading`} onCancel={(event) => { event.preventDefault(); requestClose(); }}>
      <form className="listing-editor-form" onSubmit={save} noValidate aria-busy={saving} onFocusCapture={(event) => { if (event.target.matches("input, textarea, select")) lastField.current = event.target; }}>
        <header className="listing-editor-header">
          <div>
            <span className="listing-editor-kicker"><span className="listing-editor-pokeball" aria-hidden="true" />{channelNames[initial.channel]} · {active ? "Live listing" : initial.state.toLowerCase()}</span>
            <h2 id={`${id}-heading`} ref={heading} tabIndex={-1}>Edit listing</h2>
          </div>
          <button type="button" className="listing-editor-close" aria-label="Close listing editor" onClick={requestClose} disabled={saving}>×</button>
        </header>

        <div className="listing-editor-scroll">
          <p className="listing-editor-card-name">{initial.item?.card.name ?? initial.title ?? "Untitled listing"}{initial.item?.card.number ? ` · ${initial.item.card.number}` : ""}</p>
          {manualEbay ? (
            <div className="listing-editor-notice">
              <strong>This listing needs editing on eBay</strong>
              <p>It has no linked editable eBay offer. Edit it on eBay; changing a saved copy here would not update what buyers see.</p>
              <a href={safeExternalUrl ?? "https://www.ebay.co.uk/sh/lst/active"} target="_blank" rel="noreferrer">{safeExternalUrl ? "Open listing on eBay" : "Open eBay seller listings"}</a>
            </div>
          ) : liveEbay ? (
            <p className="listing-editor-context">Saving sends your changed price, title or description to the live eBay listing.</p>
          ) : active && initial.channel !== "IN_PERSON" ? (
            <p className="listing-editor-notice">This saves your record in Poke Deal. Update the live {channelNames[initial.channel]} listing separately.</p>
          ) : (
            <p className="listing-editor-context">Save your listing details here. Publishing and ending a listing are separate actions.</p>
          )}

          <fieldset disabled={saving || readOnly} className="listing-editor-fields">
            <section className="listing-editor-price-section" aria-label="Listing price">
              <label htmlFor={`${id}-price`}>Your list price (£)</label>
              <span className="listing-editor-money"><span aria-hidden="true">£</span><input id={`${id}-price`} name="listing-price" inputMode="decimal" autoComplete="off" enterKeyHint="next" value={price} onChange={(event) => setPrice(event.target.value)} aria-describedby={`${id}-price-context${priceError ? ` ${id}-price-error` : ""}`} aria-invalid={Boolean(priceError)} /></span>
              {priceError && <p className="listing-editor-field-error" id={`${id}-price-error`}>{priceError}</p>}
              <div className="listing-editor-price-context" id={`${id}-price-context`}>
                <span>Current <strong>{initial.listPrice == null ? "Not chosen" : formatGbp(initial.listPrice)}</strong></span>
                {initial.item && <span>Paid per card <strong>{formatGbp(initial.item.costBasis)}</strong></span>}
                {initial.suggestedPrice != null && <span>Suggested <strong>{formatGbp(initial.suggestedPrice)}</strong> · guidance only</span>}
              </div>
            </section>

            <div className="listing-editor-field">
              <div className="listing-editor-label-row"><label htmlFor={`${id}-title`}>Listing title</label><span id={`${id}-title-count`}>{title.length}/{titleLimit}</span></div>
              <textarea id={`${id}-title`} name="listing-title" className="listing-editor-title-input" rows={2} maxLength={titleLimit} value={title} onChange={(event) => setTitle(event.target.value)} aria-describedby={`${id}-title-count${titleError ? ` ${id}-title-error` : ""}`} aria-invalid={Boolean(titleError)} placeholder="Card, set, number and condition" />
              {titleError && <p className="listing-editor-field-error" id={`${id}-title-error`}>{titleError}</p>}
            </div>

            <div className="listing-editor-field">
              <label htmlFor={`${id}-description`}>Description</label>
              <textarea id={`${id}-description`} name="listing-description" rows={7} maxLength={50_000} value={description} onChange={(event) => setDescription(event.target.value)} aria-describedby={`${id}-description-help${descriptionError ? ` ${id}-description-error` : ""}`} aria-invalid={Boolean(descriptionError)} placeholder="Describe this card's condition and what the buyer receives." />
              <p className="listing-editor-help" id={`${id}-description-help`}>{/<\/?[a-z][\s\S]*>/i.test(description) ? "This saved description contains HTML. Edit its source here; it is not rendered as a preview." : liveEbay ? "Write the description buyers will see. Check the card's condition and what is included." : "Plain text or existing HTML source. Leave blank to use the generated listing description."}</p>
              {descriptionError && <p id={`${id}-description-error`} className="listing-editor-field-error">{descriptionError}</p>}
            </div>

            {!active && (
              <details className="listing-editor-destination">
                <summary>Channel & listing link</summary>
                <div className="listing-editor-field"><label htmlFor={`${id}-channel`}>Channel</label><select id={`${id}-channel`} name="listing-channel" value={channel} onChange={(event) => setChannel(event.target.value as Channel)}>{Object.entries(channelNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
                <div className="listing-editor-field"><label htmlFor={`${id}-url`}>Listing URL</label><input id={`${id}-url`} name="listing-url" type="url" inputMode="url" autoCapitalize="none" autoComplete="off" spellCheck={false} value={externalUrl} onChange={(event) => setExternalUrl(event.target.value)} placeholder="https://…" aria-invalid={Boolean(urlError)} aria-describedby={urlError ? `${id}-url-error` : undefined} />{urlError && <p id={`${id}-url-error`} className="listing-editor-field-error">{urlError}</p>}</div>
              </details>
            )}
          </fieldset>

          <details className="listing-editor-stock">
            <summary>Stock, condition & photos</summary>
            {initial.item ? <>
              <dl>
                <div><dt>Grade / condition</dt><dd>{initial.item.grade.replace(/_/g, " ")}{initial.item.condition ? ` · ${initial.item.condition}` : ""}</dd></div>
                <div><dt>In your stock record</dt><dd>{initial.item.quantity} {initial.item.quantity === 1 ? "copy" : "copies"} · {initial.item.status.toLowerCase().replace(/_/g, " ")}</dd></div>
                <div><dt>Saved photos</dt><dd>{photoCount} {catalogPhotoCount ? `(${catalogPhotoCount} catalog)` : ""}</dd></div>
              </dl>
              <p>These come from Stock and cannot be changed in this editor. Saved stock and photos are not a live eBay quantity or photo check.</p>
            </> : <p>No stock record is attached to this listing.</p>}
            {active && <p>Delivery, returns and other marketplace settings stay on {channelNames[initial.channel]}.</p>}
            {safeExternalUrl && !manualEbay && <a href={safeExternalUrl} target="_blank" rel="noreferrer">View marketplace listing</a>}
          </details>
        </div>

        <footer className="listing-editor-footer">
          {confirmDiscard ? <>
            <p className="listing-editor-discard-heading" ref={discardHeading} tabIndex={-1}>Discard your unsaved changes?</p>
            <div className="listing-editor-actions"><button type="button" onClick={() => { setConfirmDiscard(false); (lastField.current ?? heading.current)?.focus({ preventScroll: true }); }}>Keep editing</button><button type="button" className="listing-editor-discard" onClick={onClose}>Discard changes</button></div>
          </> : <>
            {error && <p ref={errorRef} className="listing-editor-error" role="alert" tabIndex={-1}>{error}</p>}
            {error && liveEbay && <a className="listing-editor-check-live" href={safeExternalUrl ?? "https://www.ebay.co.uk/sh/lst/active"} target="_blank" rel="noreferrer">Check live listing on eBay</a>}
            {!online && !readOnly && <p className="listing-editor-offline" role="status">Offline — reconnect to save. Keep this editor open to retain your changes.</p>}
            {!readOnly && <div className="listing-editor-change-summary" aria-live="polite">
              {dirty ? <><strong>{liveEbay ? "Update live:" : "Changes:"} {changes.join(", ")}</strong>{priceChanged && pence !== undefined && <span>{initial.listPrice == null ? "No chosen price" : formatGbp(initial.listPrice)} → {pence == null ? "No chosen price" : formatGbp(pence)}</span>}</> : <span>No changes yet</span>}
            </div>}
            <div className="listing-editor-actions"><button type="button" onClick={requestClose} disabled={saving}>{readOnly ? "Close" : "Cancel"}</button>{!readOnly && <button type="submit" className="listing-editor-save" disabled={saving || !online || !dirty || Boolean(validationError)}>{saving ? liveEbay ? "Updating eBay…" : "Saving…" : liveEbay ? "Update live eBay listing" : "Save listing"}</button>}</div>
          </>}
        </footer>
      </form>
    </dialog>
  );
}
