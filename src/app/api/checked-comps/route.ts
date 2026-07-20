import { NextResponse } from "next/server";
import { z } from "zod";
import {
  catalogToCardRef,
  fixedCatalogSource,
  resolveCatalogCard,
} from "@/lib/comps/appCompLookup";
import { PokemonTcgApiCatalogSource } from "@/lib/catalog/pokemonTcgApi";
import { getPrisma } from "@/lib/db/prisma";
import { GRADE_VALUES, RAW_CONDITION_VALUES, type CardRef, type RawCondition } from "@/lib/domain/types";
import {
  CheckedCompEvidenceError,
  PrismaCheckedCompRepo,
  checkedCompEntriesFromAggregate,
  mapCheckedCompsToComp,
  type CheckedCompDb,
} from "@/lib/comps/sources/checkedComps";
import { normalizeRawCondition } from "@/lib/comps/pricing";
import { checkedCompConflictResponse } from "@/lib/comps/checkedCompHttp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const gradeSchema = z.enum(GRADE_VALUES);
const conditionSchema = z.enum(RAW_CONDITION_VALUES);
const platformSchema = z.enum(["ebay-uk", "cardmarket", "vinted", "other"]);
const priceBasisSchema = z.enum(["DISPLAYED_PRICE", "ITEM_PRICE", "BUYER_TOTAL", "BEST_OFFER_UNKNOWN"]);

const checkedCompPostSchema = z.object({
  card: z.object({
    id: z.string().min(1).optional(),
    name: z.string().min(1),
    setName: z.string().min(1).optional(),
    number: z.string().min(1).optional(),
    tcgApiId: z.string().min(1).optional(),
    tcgDexId: z.string().min(1).optional(),
    cardmarketId: z.string().min(1).optional(),
    language: z.enum(["EN", "JP"]).default("EN"),
    edition: z.enum(["UNLIMITED", "FIRST_EDITION", "SHADOWLESS", "STAFF", "PRERELEASE"]).optional(),
    finish: z.enum(["NORMAL", "HOLO", "REVERSE_HOLO"]).optional(),
  }),
  grade: gradeSchema.default("RAW"),
  pricePence: z.coerce.number().int().positive().max(100_000_000),
  soldDate: z.coerce.date().optional(),
  platform: platformSchema.default("ebay-uk"),
  priceBasis: priceBasisSchema,
  condition: conditionSchema.optional(),
  note: z.string().trim().min(1).max(500).optional(),
  sourceUrl: z.string().trim().url().max(2_048).optional(),
}).superRefine((data, ctx) => {
  if (data.grade === "RAW" && !data.condition) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["condition"], message: "RAW sold evidence needs NM, LP, MP, HP or DMG condition." });
  }
  if (data.grade !== "RAW" && data.condition) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["condition"], message: "RAW condition is not valid for a graded card." });
  }
});

export async function GET(request: Request) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ entries: [], aggregate: null });
  }

  const { searchParams } = new URL(request.url);
  const name = searchParams.get("name")?.trim() ?? "";
  if (!name) return NextResponse.json({ error: "Card name is required." }, { status: 400 });

  const gradeRaw = searchParams.get("grade")?.trim() || "RAW";
  const grade = GRADE_VALUES.includes(gradeRaw as (typeof GRADE_VALUES)[number])
    ? (gradeRaw as (typeof GRADE_VALUES)[number])
    : null;
  if (!grade) return NextResponse.json({ error: "Invalid grade." }, { status: 400 });
  const conditionValue = searchParams.get("condition")?.trim() || null;
  const condition = readCondition(conditionValue);
  if (conditionValue && !condition) {
    return NextResponse.json({ error: "Invalid RAW condition." }, { status: 400 });
  }
  if (grade !== "RAW" && condition) {
    return NextResponse.json({ error: "RAW condition is not valid for a graded card." }, { status: 400 });
  }

  const card: CardRef = {
    name,
    setName: searchParams.get("setName")?.trim() || undefined,
    number: searchParams.get("number")?.trim() || undefined,
    tcgApiId: searchParams.get("tcgApiId")?.trim() || undefined,
    tcgDexId: searchParams.get("tcgDexId")?.trim() || undefined,
    cardmarketId: searchParams.get("cardmarketId")?.trim() || undefined,
    edition: readEdition(searchParams.get("edition")),
    finish: readFinish(searchParams.get("finish")),
    game: "POKEMON",
    language: searchParams.get("language") === "JP" ? "JP" : "EN",
  };

  try {
    const catalogSource = new PokemonTcgApiCatalogSource();
    const catalog = await resolveCatalogCard(card, catalogSource, { timeoutMs: 2500 });
    const compCard = catalog ? catalogToCardRef(catalog, card) : card;
    const repo = new PrismaCheckedCompRepo(getPrisma() as unknown as CheckedCompDb);
    const rows = await repo.list(compCard, grade, 90, condition);
    const aggregate = mapCheckedCompsToComp(rows, { source: "checked-comps", card: compCard, grade, condition, windowDays: 90 });
    return NextResponse.json({
      entries: checkedCompEntriesFromAggregate(aggregate, rows),
      aggregate,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "checked comp lookup failed" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "Checked comps need a database connection." }, { status: 503 });
  }

  const body = await request.json().catch(() => null);
  const parsed = checkedCompPostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid checked comp request",
        issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      },
      { status: 400 },
    );
  }

  const data = parsed.data;
  const card: CardRef = { ...data.card, game: "POKEMON" };

  try {
    const catalogSource = new PokemonTcgApiCatalogSource();
    const catalog = await resolveCatalogCard(card, catalogSource, { timeoutMs: 2500 });
    const compCard = catalog ? catalogToCardRef(catalog, card) : card;
    const repo = new PrismaCheckedCompRepo(
      getPrisma() as unknown as CheckedCompDb,
      catalog ? fixedCatalogSource(catalogSource.live, catalog) : catalogSource,
    );
    const entry = await repo.create({
      card: compCard,
      grade: data.grade,
      pricePence: data.pricePence,
      soldDate: data.soldDate,
      platform: data.platform,
      priceBasis: data.priceBasis,
      condition: data.condition,
      note: data.note,
      sourceUrl: data.sourceUrl,
    });
    const condition = data.grade === "RAW" ? data.condition : undefined;
    const rows = await repo.list(compCard, data.grade, 90, condition);
    const aggregate = mapCheckedCompsToComp(rows, { source: "checked-comps", card: compCard, grade: data.grade, condition, windowDays: 90 });
    const entries = checkedCompEntriesFromAggregate(aggregate, rows);
    const createdEntry = entries.find((row) => {
      if (!row || typeof row !== "object" || !("id" in row)) return false;
      return (row as { id?: unknown }).id === entry.id;
    }) ?? null;

    return NextResponse.json({
      entry: createdEntry,
      entries,
      aggregate,
    }, { status: 201 });
  } catch (err) {
    if (err instanceof CheckedCompEvidenceError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 400 });
    }
    const conflict = checkedCompConflictResponse(err);
    if (conflict) {
      return NextResponse.json(conflict.body, { status: conflict.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "checked comp create failed" },
      { status: 500 },
    );
  }
}

function readCondition(value: string | null): RawCondition | undefined {
  return normalizeRawCondition(value) ?? undefined;
}

function readEdition(value: string | null): CardRef["edition"] {
  return ["UNLIMITED", "FIRST_EDITION", "SHADOWLESS", "STAFF", "PRERELEASE"].includes(value ?? "")
    ? value as CardRef["edition"]
    : undefined;
}

function readFinish(value: string | null): CardRef["finish"] {
  return ["NORMAL", "HOLO", "REVERSE_HOLO"].includes(value ?? "")
    ? value as CardRef["finish"]
    : undefined;
}
