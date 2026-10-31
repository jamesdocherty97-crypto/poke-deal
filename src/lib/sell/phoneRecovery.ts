/**
 * Phone sell-flow recovery. Decides the copy and the exits after a scan
 * failure or a comp miss. The UI renders this; it does not invent a second
 * story. Server bodies never become copy.
 */

export type RecoveryActionId =
  | "retake"
  | "upload"
  | "type-card"
  | "retry-price"
  | "uk-solds"
  | "add-cost";

export type RecoveryAction = {
  id: RecoveryActionId;
  label: string;
  detail: string;
};

export type RecoveryKind =
  | "scan-unreadable"
  | "scan-down"
  | "scan-budget"
  | "scan-queued"
  | "scan-camera"
  | "comp-failed"
  | "comp-empty";

export type RecoveryCard = {
  kind: RecoveryKind;
  kicker: string;
  title: string;
  message: string;
  actions: RecoveryAction[];
};

export type ScanBlock =
  | { kind: "unreadable"; status: number }
  | { kind: "down" }
  | { kind: "budget" }
  | { kind: "queued" }
  | { kind: "camera"; cause: "missing" | "timeout" | "blocked" };

export type ScanSheetMode =
  | "idle"
  | "starting"
  | "camera"
  | "reading"
  | "identity"
  | "ambiguous"
  | "confirm-slab"
  | "manual"
  | "stocked";

export type CompPhase = "catalog" | "provisional" | "quorum" | "receipt" | null;

export type CompMissInput = {
  lookupFailed: boolean;
  compBusy: boolean;
  compPhase: CompPhase;
  sampleSize: number | null;
  medianPence: number | null;
  ambiguous: boolean;
  /** Where the card is shown. The page already has a Retry banner. */
  surface: "sheet" | "page";
  cardLabel?: string | null;
};

export type ScanSheetRecoveryInput = CompMissInput & {
  mode: ScanSheetMode;
  block: ScanBlock | null;
  /** Client-authored scan reason. Ignored when it looks like a server secret. */
  detail: string | null;
  identityReady: boolean;
  actionable: boolean;
};

const SECRET = /api[_-]?key|token|secret|password|gemini|bearer|stack trace/i;

export function scanBlockFromStatus(status: number): ScanBlock {
  if (status === 502 || status === 503) return { kind: "down" };
  if (status === 429) return { kind: "budget" };
  return { kind: "unreadable", status };
}

export function resolveCompMissRecovery(input: CompMissInput): RecoveryCard | null {
  if (input.ambiguous) return null;
  if (input.lookupFailed) return compFailed(input.surface);
  if (input.compBusy) return null;
  if (input.compPhase !== "receipt") return null;
  const sample = input.sampleSize ?? 0;
  const median = input.medianPence ?? 0;
  if (sample > 0 && median > 0) return null;
  return compEmpty(input.cardLabel);
}

export function resolveScanSheetRecovery(input: ScanSheetRecoveryInput): RecoveryCard | null {
  if (input.block?.kind === "down") return scanDown();
  if (input.block?.kind === "budget") return scanBudget();
  if (input.block?.kind === "queued") return scanQueued();
  if (input.block?.kind === "camera") return scanCamera(input.block.cause);
  if (input.block?.kind === "unreadable" || input.mode === "manual") {
    return scanUnreadable(input.detail);
  }
  if (input.actionable && (input.sampleSize ?? 0) > 0 && (input.medianPence ?? 0) > 0) return null;
  if (input.mode === "identity" && input.identityReady) {
    return resolveCompMissRecovery({ ...input, surface: "sheet" });
  }
  return null;
}

/** A partial scan can prefill the search. Say so only for our own short copy. */
export function scanPrefillNote(quickFill: string | null | undefined): string | null {
  const text = quickFill?.trim() ?? "";
  if (!text || text.length > 80 || SECRET.test(text)) return null;
  return "What was readable is already in the search box.";
}

function scanUnreadable(detail: string | null): RecoveryCard {
  return {
    kind: "scan-unreadable",
    kicker: "Scan",
    title: "Couldn't read that card",
    message: safeDetail(
      detail,
      "That photo didn't give a name and number. Retake it in better light, upload another photo, or type the card.",
    ),
    actions: [retake("Retake photo", "Use the camera again"), upload("Upload another photo", "Pick one from this phone"), typeCard("Type the card", "Name, set and number")],
  };
}

function scanDown(): RecoveryCard {
  return {
    kind: "scan-down",
    kicker: "Scan",
    title: "Card scan is down",
    message: "Scanning is unavailable right now. Type the card, or try a photo again in a moment.",
    actions: [typeCard("Type the card", "Comps still work from text"), retake("Try a photo again", "Take another shot"), upload("Upload a photo", "Use a picture you already have")],
  };
}

function scanBudget(): RecoveryCard {
  return {
    kind: "scan-budget",
    kicker: "Scan",
    title: "Daily scan limit reached",
    message: "Scanning pauses until about 8am UK. A typed card can still be priced.",
    actions: [typeCard("Type the card", "Search by name, set and number")],
  };
}

function scanQueued(): RecoveryCard {
  return {
    kind: "scan-queued",
    kicker: "Scan",
    title: "Photo saved on this phone",
    message: "It will be read when the signal returns. Type the card now if you want a price.",
    actions: [typeCard("Type the card", "Don't wait on the photo")],
  };
}

function scanCamera(cause: "missing" | "timeout" | "blocked"): RecoveryCard {
  if (cause === "missing") {
    return {
      kind: "scan-camera",
      kicker: "Camera",
      title: "This phone has no camera",
      message: "Upload a photo of the card, or type the name, set and number.",
      actions: [upload("Upload a photo", "Use a picture you already have"), typeCard("Type the card", "Name, set and number")],
    };
  }
  if (cause === "timeout") {
    return {
      kind: "scan-camera",
      kicker: "Camera",
      title: "Camera didn't open",
      message: "It didn't start within 8 seconds. Upload a photo, type the card, or try the camera again.",
      actions: [upload("Upload a photo", "Use a picture you already have"), typeCard("Type the card", "Name, set and number"), retake("Try the camera again", "Ask for the camera once more")],
    };
  }
  return {
    kind: "scan-camera",
    kicker: "Camera",
    title: "Camera permission is blocked",
    message: "Allow the camera for this site, upload a photo, or type the card.",
    actions: [upload("Upload a photo", "Use a picture you already have"), typeCard("Type the card", "Name, set and number"), retake("Try the camera again", "Ask for the camera once more")],
  };
}

function compFailed(surface: "sheet" | "page"): RecoveryCard {
  const exits: RecoveryAction[] = [
    ukSolds(),
    typeCard("Type a different card", "Clear this and search again"),
    addCost(),
  ];
  return {
    kind: "comp-failed",
    kicker: "Price check",
    title: surface === "sheet" ? "Price check didn't finish" : "What you can do next",
    message: surface === "sheet"
      ? "Couldn't check this price. Check your signal and try again, look up UK solds, or stock it from what you paid."
      : "You can look up UK solds, type a different card, or stock this one from what you paid.",
    actions: surface === "sheet" ? [retryPrice(), ...exits] : exits,
  };
}

function compEmpty(cardLabel: string | null | undefined): RecoveryCard {
  const label = safeLabel(cardLabel);
  return {
    kind: "comp-empty",
    kicker: "Comps",
    title: "No sold comps for this card",
    message: label
      ? `No sold comps for ${label} in this window. Check UK solds, try another printing, or stock it from what you paid.`
      : "Nothing matched in the sold window. Check UK solds, try another printing, or stock it from what you paid.",
    actions: [retryPrice(), ukSolds(), typeCard("Type a different card", "Clear this and search again"), addCost()],
  };
}

function retake(label: string, detail: string): RecoveryAction {
  return { id: "retake", label, detail };
}

function upload(label: string, detail: string): RecoveryAction {
  return { id: "upload", label, detail };
}

function typeCard(label: string, detail: string): RecoveryAction {
  return { id: "type-card", label, detail };
}

function retryPrice(): RecoveryAction {
  return { id: "retry-price", label: "Try the price again", detail: "Run the same card once more" };
}

function ukSolds(): RecoveryAction {
  return { id: "uk-solds", label: "Check UK solds", detail: "Open eBay sold listings and log what you saw" };
}

function addCost(): RecoveryAction {
  return { id: "add-cost", label: "Add what you paid", detail: "Stock it without a comp" };
}

function safeDetail(detail: string | null, fallback: string): string {
  const text = detail?.trim() ?? "";
  if (!text || text.length > 180 || SECRET.test(text)) return fallback;
  return text;
}

function safeLabel(label: string | null | undefined): string | null {
  const text = label?.replace(/\s+/g, " ").trim() ?? "";
  if (!text || text.length > 60 || SECRET.test(text)) return null;
  return text;
}
