import assert from "node:assert/strict";
import test from "node:test";
import { appendScanCorrection, type ScanCorrectionDb } from "./scanCorrection.js";

test("scan corrections append linked evidence and replay idempotently", async () => {
  const original = {
    id: "scan_1",
    correctionOfId: null,
    correctionKey: null,
    source: "gemini-scan",
    status: "READABLE",
    name: "Wrong name",
    setName: null,
    setCode: null,
    number: "1/1",
    language: "EN" as const,
    edition: null,
    finish: null,
    tcgApiId: null,
    tcgDexId: null,
    cardmarketId: null,
    grade: "RAW" as const,
    condition: null,
    createdAt: new Date("2026-07-11T09:00:00.000Z"),
  };
  const rows = [original];
  const db: ScanCorrectionDb = {
    scanEvent: {
      async findUnique(args: any) {
        return rows.find((row) => args.where.id ? row.id === args.where.id : row.correctionKey === args.where.correctionKey) ?? null;
      },
      async create(args: any) {
        const row = {
          id: "scan_2",
          correctionOfId: args.data.correctionOfId,
          correctionKey: args.data.correctionKey,
          source: args.data.source,
          status: args.data.status,
          name: args.data.name ?? null,
          setName: args.data.setName ?? null,
          setCode: args.data.setCode ?? null,
          number: args.data.number ?? null,
          language: args.data.language ?? null,
          edition: args.data.edition ?? null,
          finish: args.data.finish ?? null,
          tcgApiId: args.data.tcgApiId ?? null,
          tcgDexId: args.data.tcgDexId ?? null,
          cardmarketId: args.data.cardmarketId ?? null,
          grade: args.data.grade ?? null,
          condition: args.data.condition ?? null,
          createdAt: new Date("2026-07-11T10:00:00.000Z"),
        };
        rows.push(row as typeof original);
        return row;
      },
    },
  };
  const input = {
    scanEventId: "scan_1",
    correctionKey: "correction:12345678",
    name: "Gengar",
    number: "TG06/TG30",
    grade: "RAW" as const,
    edition: "FIRST_EDITION" as const,
    finish: "HOLO" as const,
    tcgApiId: "neo1-5",
  };
  const created = await appendScanCorrection(db, input);
  assert.equal(created.kind, "created");
  if (created.kind === "created") {
    assert.equal(created.correction.identity.name, "Gengar");
    assert.equal(created.correction.identity.edition, "FIRST_EDITION");
    assert.equal(created.correction.identity.finish, "HOLO");
    assert.equal(created.correction.identity.tcgApiId, "neo1-5");
  }
  assert.equal(original.name, "Wrong name", "original observation must remain immutable");
  assert.equal((await appendScanCorrection(db, input)).kind, "idempotent");
});
