import { NextResponse } from "next/server";
import { z } from "zod";
import {
  catalogToCardRef,
  fixedCatalogSource,
  resolveCatalogCard,
} from "@/lib/comps/appCompLookup";
import { PokemonTcgApiCatalogSource } from "@/lib/catalog/pokemonTcgApi";
import { getPrisma } from "@/lib/db/prisma";
import { GRADE_VALUES, type CardRef } from "@/lib/domain/types";
import {
  PrismaCheckedCompRepo,
  checkedCompRowForRaw,
  mapCheckedCompsToComp,
  type CheckedCompDb,
} from "@/lib/comps/sources/checkedComps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const gradeSchema = z.enum(GRADE_VALUES);
const platformSchema = z.enum(["ebay-uk", "cardmarket", "vinted", "other"]);

const checkedCompPostSchema = z.object({
  card: z.object({
    id: z.string().min(1).optional(),
    name: z.string().min(1),
    setName: z.string().min(1).optional(),
    number: z.string().min(1).optional(),
    tcgApiId: z.string().min(1).optional(),
    tcgDexId: z.string().min(1).optional(),
  }),
  grade: gradeSchema.default("RAW"),
  pricePence: z.coerce.number().int().positive(),
  soldDate: z.coerce.date().optional(),
  platform: platformSchema.default("ebay-uk"),
  note: z.string().trim().min(1).optional(),
  sourceUrl: z.string().trim().url().optional(),
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

  const card: CardRef = {
    name,
    setName: searchParams.get("setName")?.trim() || undefined,
    number: searchParams.get("number")?.trim() || undefined,
    tcgApiId: searchParams.get("tcgApiId")?.trim() || undefined,
    tcgDexId: searchParams.get("tcgDexId")?.trim() || undefined,
    game: "POKEMON",
    language: "EN",
  };

  try {
    const catalogSource = new PokemonTcgApiCatalogSource();
    const catalog = await resolveCatalogCard(card, catalogSource, { timeoutMs: 2500 });
    const compCard = catalog ? catalogToCardRef(catalog, card) : card;
    const repo = new PrismaCheckedCompRepo(getPrisma() as unknown as CheckedCompDb);
    const rows = await repo.list(compCard, grade, 90);
    const aggregate = mapCheckedCompsToComp(rows, { source: "checked-comps", card: compCard, grade, windowDays: 90 });
    return NextResponse.json({
      entries: rows.map(checkedCompRowForRaw),
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
  const card: CardRef = { ...data.card, game: "POKEMON", language: "EN" };

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
      note: data.note,
      sourceUrl: data.sourceUrl,
    });
    const rows = await repo.list(compCard, data.grade, 90);
    const aggregate = mapCheckedCompsToComp(rows, { source: "checked-comps", card: compCard, grade: data.grade, windowDays: 90 });

    return NextResponse.json({
      entry: checkedCompRowForRaw(entry),
      entries: rows.map(checkedCompRowForRaw),
      aggregate,
    }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "checked comp create failed" },
      { status: 500 },
    );
  }
}
