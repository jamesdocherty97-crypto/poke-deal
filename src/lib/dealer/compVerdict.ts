export type DealerCompTone = "good" | "warn" | "danger";

export type DealerCompSignal = {
  source: string;
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
    return {
      ...base,
      tone: "warn",
      label: "Cross-check",
      title: isMarketBaseline(comp.headline) ? "Cautious buy ceiling" : "Check before buying",
      detail:
        spreadPct == null
          ? "Priced sources disagree. Treat the headline as a guardrail, not a final list price."
          : `${priced.length} priced signals are ${spreadPct}% apart. Use the headline as a buy ceiling and inspect the receipt before listing.`,
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
