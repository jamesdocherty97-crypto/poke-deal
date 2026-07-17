import type { CardFinish, Grade, Language, PrintEdition } from "../domain/types.js";

export type ScanCorrectionInput = {
  scanEventId: string;
  correctionKey: string;
  name?: string;
  setName?: string;
  setCode?: string;
  number?: string;
  language?: Language;
  edition?: PrintEdition;
  finish?: CardFinish;
  tcgApiId?: string;
  tcgDexId?: string;
  cardmarketId?: string;
  grade?: Grade;
  condition?: string;
  note?: string;
};

type CorrectionRow = {
  id: string;
  correctionOfId: string | null;
  correctionKey: string | null;
  source: string;
  status: string;
  name: string | null;
  setName: string | null;
  setCode: string | null;
  number: string | null;
  language: Language | null;
  edition: string | null;
  finish: string | null;
  tcgApiId: string | null;
  tcgDexId: string | null;
  cardmarketId: string | null;
  grade: Grade | null;
  condition: string | null;
  createdAt: Date;
};

export type ScanCorrectionDb = {
  scanEvent: {
    findUnique(args: unknown): Promise<CorrectionRow | null>;
    create(args: unknown): Promise<CorrectionRow>;
  };
};

export async function appendScanCorrection(
  db: ScanCorrectionDb,
  input: ScanCorrectionInput,
): Promise<{ kind: "created" | "idempotent"; correction: ReturnType<typeof serializeCorrection> } | { kind: "not-found" }> {
  const replay = await db.scanEvent.findUnique({ where: { correctionKey: input.correctionKey } });
  if (replay) return { kind: "idempotent", correction: serializeCorrection(replay) };
  const original = await db.scanEvent.findUnique({ where: { id: input.scanEventId } });
  if (!original || original.correctionOfId) return { kind: "not-found" };
  let correction: CorrectionRow;
  try {
    correction = await db.scanEvent.create({
      data: {
        source: "dealer-correction",
        status: "CORRECTED",
        correctionOfId: original.id,
        correctionKey: input.correctionKey,
        name: clean(input.name),
        setName: clean(input.setName),
        setCode: clean(input.setCode),
        number: clean(input.number),
        language: input.language,
        edition: input.edition,
        finish: input.finish,
        tcgApiId: clean(input.tcgApiId),
        tcgDexId: clean(input.tcgDexId),
        cardmarketId: clean(input.cardmarketId),
        grade: input.grade,
        condition: clean(input.condition),
        inputKind: "correction",
        raw: { note: clean(input.note) ?? null },
      },
    });
  } catch (error) {
    if (typeof error !== "object" || !error || !("code" in error) || error.code !== "P2002") throw error;
    const concurrent = await db.scanEvent.findUnique({ where: { correctionKey: input.correctionKey } });
    if (!concurrent) throw error;
    return { kind: "idempotent", correction: serializeCorrection(concurrent) };
  }
  return { kind: "created", correction: serializeCorrection(correction) };
}

function serializeCorrection(row: CorrectionRow) {
  return {
    id: row.id,
    correctionOfId: row.correctionOfId,
    correctionKey: row.correctionKey,
    source: row.source,
    status: row.status,
    identity: {
      name: row.name,
      setName: row.setName,
      setCode: row.setCode,
      number: row.number,
      language: row.language,
      edition: row.edition,
      finish: row.finish,
      tcgApiId: row.tcgApiId,
      tcgDexId: row.tcgDexId,
      cardmarketId: row.cardmarketId,
      grade: row.grade,
      condition: row.condition,
    },
    createdAt: row.createdAt.toISOString(),
  };
}

function clean(value: string | undefined): string | undefined {
  return value?.trim().slice(0, 500) || undefined;
}
