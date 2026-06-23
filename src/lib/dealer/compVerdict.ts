export type DealerCompTone = "good" | "warn" | "danger";

export type DealerCompSignal = {
  source: string;
  grade?: string;
  medianPence: number;
  sampleSize: number;
  raw?: unknown;
};

export type DealerCompInput = {
  headline: DealerCompSignal;
  all: DealerCompSignal[];
  sourcesDisagree: boolean;
};

export type DealerCompVerdict = {
  tone: DealerCompTone;
  label: string;
  title: string;
  detail: string;
  pricedSignalCount: number;
  totalSignalCount: number;
  spreadPct: number | null;
};

export function buildDealerCompVerdict(comp: DealerCompInput): DealerCompVerdict {
  const priced = pricedSignals(comp.all);
  const spreadPct = signalSpreadPct(priced);
  const totalSignalCount = comp.all.length;
  const base = {
    pricedSignalCount: priced.length,
    totalSignalCount,
    spreadPct,
  };

  if (comp.headline.medianPence <= 0 || comp.headline.sampleSize <= 0) {
    return {
      ...base,
      tone: "danger",
      label: "No comp",
      title: "Stock manually",
      detail: "No priced signal came back. Save the buy and price it after a manual check.",
    };
  }

  if (comp.sourcesDisagree) {
    const extremeSpread = spreadPct != null && spreadPct >= 50;
    return {
      ...base,
      tone: extremeSpread ? "danger" : "warn",
      label: extremeSpread ? "Manual check" : "Cross-check",
      title: extremeSpread
        ? "Do not trust one number"
        : isMarketBaseline(comp.headline)
          ? "Cautious buy ceiling"
          : "Check before buying",
      detail:
        spreadPct == null
          ? "Priced sources disagree. Treat the headline as a guardrail, not a final list price."
          : extremeSpread
            ? `${priced.length} priced signals are ${spreadPct}% apart. Open the manual checks and enter a checked comp before relying on this price.`
            : `${priced.length} priced signals are ${spreadPct}% apart. Use the headline as a buy ceiling and inspect the receipt before listing.`,
    };
  }

  if (isMarketBaseline(comp.headline) && priced.length < 2) {
    return {
      ...base,
      tone: "warn",
      label: "Catalog only",
      title: "Manual sold check",
      detail: "This is a TCGPlayer/Cardmarket market signal, not a cleaned sold-comps sample. Good for context, but check sold listings before a bigger buy.",
    };
  }

  if (comp.headline.sampleSize < 3) {
    return {
      ...base,
      tone: "warn",
      label: "Thin",
      title: "Guide price only",
      detail: "The price is based on a thin signal. Use it for a rough buy decision and re-check before listing.",
    };
  }

  if (priced.length < 2 && isGradedSignal(comp.headline)) {
    return {
      ...base,
      tone: "warn",
      label: "Single graded",
      title: "Manual check needed",
      detail: "This slab price has no live cross-check. Treat it as indicative until PokeTrace, owned sales, or a manual eBay check confirms it.",
    };
  }

  if (priced.length < 2) {
    return {
      ...base,
      tone: "warn",
      label: "Single source",
      title: "Usable with care",
      detail: "One priced source is available. Good enough to move fast, but worth a second check on larger buys.",
    };
  }

  return {
    ...base,
    tone: "good",
    label: "Usable",
    title: "Good daily comp",
    detail: "Priced sources are aligned enough for normal buying and repricing decisions.",
  };
}

function pricedSignals(signals: DealerCompSignal[]): DealerCompSignal[] {
  return signals.filter((signal) => signal.medianPence > 0 && signal.sampleSize > 0);
}

function signalSpreadPct(signals: DealerCompSignal[]): number | null {
  const medians = signals.map((signal) => signal.medianPence).filter((median) => median > 0);
  if (medians.length < 2) return null;
  const min = Math.min(...medians);
  const max = Math.max(...medians);
  return Math.round(((max - min) / min) * 100);
}

function isMarketBaseline(signal: DealerCompSignal): boolean {
  if (!signal.raw || typeof signal.raw !== "object") return false;
  const kind = (signal.raw as { kind?: unknown }).kind;
  return kind === "catalog-market-baseline" || kind === "market-baseline";
}

function isGradedSignal(signal: DealerCompSignal): boolean {
  return signal.grade != null && signal.grade !== "RAW";
}
