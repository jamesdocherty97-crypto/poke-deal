import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { Prisma, PrismaClient } from "@prisma/client";

import {
  groupDuplicateCardIdentities,
  hasPrintedCollectorTotal,
} from "../src/lib/catalog/duplicateCards.js";

const PLAN_VERSION = 1;
const APPLY_TIMEOUT_MS = 10 * 60 * 1000;
const INSERT_BATCH_SIZE = 400;

const CARD_SELECT = {
  id: true,
  game: true,
  language: true,
  name: true,
  setName: true,
  setCode: true,
  number: true,
  rarity: true,
  imageUrl: true,
  displayImageUrl: true,
  tcgApiId: true,
  tcgDexId: true,
  cardmarketId: true,
  edition: true,
  finish: true,
  createdAt: true,
  updatedAt: true,
  _count: {
    select: {
      checkedComps: true,
      comps: true,
      inventory: true,
      snapshots: true,
      watches: true,
      dealSessionLines: true,
      scanEvents: true,
    },
  },
} satisfies Prisma.CardSelect;

type CardRow = Prisma.CardGetPayload<{ select: typeof CARD_SELECT }>;
type ReferenceCounts = CardRow["_count"];
type DesiredCard = Pick<CardRow,
  | "name"
  | "setName"
  | "setCode"
  | "number"
  | "rarity"
  | "imageUrl"
  | "displayImageUrl"
  | "tcgApiId"
  | "tcgDexId"
  | "cardmarketId"
  | "edition"
  | "finish"
>;

type PlannedMember = Omit<CardRow, "createdAt" | "updatedAt" | "_count"> & {
  createdAt: string;
  updatedAt: string;
  references: ReferenceCounts;
};

type ConsolidationAction = {
  winnerId: string;
  loserIds: string[];
  desired: DesiredCard;
  members: PlannedMember[];
  referenceCount: number;
};

type SkippedGroup = {
  reason: string;
  memberIds: string[];
  identity: string;
  referenceCount: number;
};

type PlanContent = {
  version: typeof PLAN_VERSION;
  databaseFingerprint: string;
  sourceCardCount: number;
  actions: ConsolidationAction[];
  skipped: SkippedGroup[];
};

type ConsolidationPlan = PlanContent & {
  generatedAt: string;
  planHash: string;
};

const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DIRECT_URL or DATABASE_URL is required.");
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const apply = process.argv.includes("--apply");
const planArg = argumentValue("--plan");

try {
  if (apply) {
    if (!planArg) throw new Error("Apply requires --plan=/absolute/or/relative/plan.json.");
    const saved = JSON.parse(await readFile(path.resolve(planArg), "utf8")) as ConsolidationPlan;
    validateSavedPlan(saved);
    const confirmation = argumentValue("--confirm");
    if (confirmation !== saved.planHash) {
      throw new Error(`Refusing apply: pass --confirm=${saved.planHash} from the reviewed dry-run plan.`);
    }
    const current = await buildPlan();
    if (current.planHash !== saved.planHash) {
      throw new Error(
        `Refusing apply: database state changed after the plan was generated (saved ${saved.planHash}, current ${current.planHash}). Generate and review a fresh plan.`,
      );
    }
    const referencedSkips = saved.skipped.filter((group) => group.referenceCount > 0);
    if (referencedSkips.length > 0 && !process.argv.includes("--allow-referenced-skips")) {
      throw new Error(
        `Refusing apply: ${referencedSkips.length} ambiguous groups have persisted references. Review them before using --allow-referenced-skips.`,
      );
    }
    await applyPlan(saved.actions);
    console.log(`Applied plan ${saved.planHash}`);
    console.log(`Consolidated groups: ${saved.actions.length}`);
    console.log(`Removed duplicate card rows: ${saved.actions.reduce((sum, action) => sum + action.loserIds.length, 0)}`);
  } else {
    const plan = await buildPlan();
    const planPath = path.resolve(planArg ?? defaultPlanPath(plan.generatedAt));
    await mkdir(path.dirname(planPath), { recursive: true });
    await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await chmod(planPath, 0o600);
    console.log(`Dry-run plan: ${planPath}`);
    console.log(`Plan hash: ${plan.planHash}`);
    console.log(`Safe groups: ${plan.actions.length}`);
    console.log(`Duplicate rows to remove: ${plan.actions.reduce((sum, action) => sum + action.loserIds.length, 0)}`);
    console.log(`Groups with persisted references: ${plan.actions.filter((action) => action.referenceCount > 0).length}`);
    console.log(`Skipped ambiguous/colliding groups: ${plan.skipped.length}`);
    console.log(`Skipped groups with persisted references: ${plan.skipped.filter((group) => group.referenceCount > 0).length}`);
    console.log(`No data was changed. Apply only with --apply --plan=${planPath} --confirm=${plan.planHash}`);
  }
} finally {
  await prisma.$disconnect();
}

async function buildPlan(): Promise<ConsolidationPlan> {
  const cards = await prisma.card.findMany({
    select: CARD_SELECT,
    orderBy: [{ game: "asc" }, { language: "asc" }, { setName: "asc" }, { name: "asc" }, { number: "asc" }, { id: "asc" }],
  });
  const grouped = groupDuplicateCardIdentities(cards);
  const duplicateCardIds = new Set(grouped.groups.flatMap((group) => group.map((card) => card.id)));
  const [snapshots, watches] = await Promise.all([
    prisma.priceSnapshot.findMany({
      where: { cardId: { in: [...duplicateCardIds] } },
      select: { cardId: true, grade: true, takenAt: true },
      orderBy: { id: "asc" },
    }),
    prisma.watch.findMany({
      where: { cardId: { in: [...duplicateCardIds] } },
      select: { cardId: true, grade: true },
      orderBy: { id: "asc" },
    }),
  ]);
  const snapshotsByCard = groupByCardId(snapshots);
  const watchesByCard = groupByCardId(watches);
  const actions: ConsolidationAction[] = [];
  const skipped: SkippedGroup[] = grouped.conflicts.map((conflict) => ({
    reason: conflict.reason,
    memberIds: conflict.members.map((card) => card.id),
    identity: identityLabel(conflict.members[0]!),
    referenceCount: conflict.members.reduce((sum, card) => sum + referenceCount(card._count), 0),
  }));

  for (const group of grouped.groups) {
    const conflictReason = metadataConflict(group)
      ?? relationCollision(group, snapshotsByCard, watchesByCard);
    const totalReferences = group.reduce((sum, card) => sum + referenceCount(card._count), 0);
    if (conflictReason) {
      skipped.push({
        reason: conflictReason,
        memberIds: group.map((card) => card.id),
        identity: identityLabel(group[0]!),
        referenceCount: totalReferences,
      });
      continue;
    }
    const winner = chooseWinner(group);
    actions.push({
      winnerId: winner.id,
      loserIds: group.map((card) => card.id).filter((id) => id !== winner.id).sort(),
      desired: mergedCard(group, winner),
      members: group.map(plannedMember),
      referenceCount: totalReferences,
    });
  }

  actions.sort((left, right) => left.winnerId.localeCompare(right.winnerId));
  skipped.sort((left, right) => left.memberIds[0]!.localeCompare(right.memberIds[0]!));
  const content: PlanContent = {
    version: PLAN_VERSION,
    databaseFingerprint: databaseFingerprint(databaseUrl!),
    sourceCardCount: cards.length,
    actions,
    skipped,
  };
  return {
    ...content,
    generatedAt: new Date().toISOString(),
    planHash: hashPlanContent(content),
  };
}

async function applyPlan(actions: ConsolidationAction[]): Promise<void> {
  if (actions.length === 0) return;
  const mappings = actions.flatMap((action) => action.loserIds.map((loserId) => ({
    loserId,
    winnerId: action.winnerId,
    desired: action.desired,
  })));

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      CREATE TEMP TABLE "_CardConsolidation" (
        "loserId" TEXT PRIMARY KEY,
        "winnerId" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "setName" TEXT NOT NULL,
        "setCode" TEXT,
        "number" TEXT,
        "rarity" TEXT,
        "imageUrl" TEXT,
        "displayImageUrl" TEXT,
        "tcgApiId" TEXT,
        "tcgDexId" TEXT,
        "cardmarketId" TEXT,
        "edition" TEXT,
        "finish" TEXT
      ) ON COMMIT DROP
    `;
    for (let index = 0; index < mappings.length; index += INSERT_BATCH_SIZE) {
      const batch = mappings.slice(index, index + INSERT_BATCH_SIZE);
      const values = batch.map((mapping) => Prisma.sql`(
        ${mapping.loserId}, ${mapping.winnerId}, ${mapping.desired.name}, ${mapping.desired.setName},
        ${mapping.desired.setCode}, ${mapping.desired.number}, ${mapping.desired.rarity}, ${mapping.desired.imageUrl},
        ${mapping.desired.displayImageUrl}, ${mapping.desired.tcgApiId}, ${mapping.desired.tcgDexId},
        ${mapping.desired.cardmarketId}, ${mapping.desired.edition}, ${mapping.desired.finish}
      )`);
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "_CardConsolidation" (
          "loserId", "winnerId", "name", "setName", "setCode", "number", "rarity", "imageUrl",
          "displayImageUrl", "tcgApiId", "tcgDexId", "cardmarketId", "edition", "finish"
        ) VALUES ${Prisma.join(values)}
      `);
    }

    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Card"
      WHERE "id" IN (
        SELECT "loserId" FROM "_CardConsolidation"
        UNION
        SELECT "winnerId" FROM "_CardConsolidation"
      )
      FOR UPDATE
    `;
    const expectedCardCount = mappings.length + new Set(actions.map((action) => action.winnerId)).size;
    if (locked.length !== expectedCardCount) {
      throw new Error(`Card preflight changed inside transaction: expected ${expectedCardCount}, locked ${locked.length}.`);
    }

    const snapshotCollisions = await tx.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS "count" FROM (
        SELECT COALESCE(m."winnerId", p."cardId") AS target, p."grade", p."takenAt"
        FROM "PriceSnapshot" p
        LEFT JOIN "_CardConsolidation" m ON m."loserId" = p."cardId"
        WHERE p."cardId" IN (
          SELECT "loserId" FROM "_CardConsolidation" UNION SELECT "winnerId" FROM "_CardConsolidation"
        )
        GROUP BY target, p."grade", p."takenAt"
        HAVING COUNT(*) > 1
      ) collisions
    `;
    const watchCollisions = await tx.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS "count" FROM (
        SELECT COALESCE(m."winnerId", w."cardId") AS target, w."grade"
        FROM "Watch" w
        LEFT JOIN "_CardConsolidation" m ON m."loserId" = w."cardId"
        WHERE w."cardId" IN (
          SELECT "loserId" FROM "_CardConsolidation" UNION SELECT "winnerId" FROM "_CardConsolidation"
        )
        GROUP BY target, w."grade"
        HAVING COUNT(*) > 1
      ) collisions
    `;
    if (Number(snapshotCollisions[0]?.count ?? 0n) > 0 || Number(watchCollisions[0]?.count ?? 0n) > 0) {
      throw new Error("Relation uniqueness changed after dry-run; no card consolidation was committed.");
    }

    for (const table of ["InventoryItem", "CompResult", "CheckedComp", "PriceSnapshot", "DealSessionLine", "ScanEvent", "Watch"] as const) {
      await tx.$executeRawUnsafe(
        `UPDATE "${table}" r SET "cardId" = m."winnerId" FROM "_CardConsolidation" m WHERE r."cardId" = m."loserId"`,
      );
    }
    await tx.$executeRaw`
      UPDATE "Card" c
      SET "tcgApiId" = NULL, "tcgDexId" = NULL
      FROM "_CardConsolidation" m
      WHERE c."id" = m."loserId"
    `;
    await tx.$executeRaw`
      UPDATE "Card" c SET
        "name" = desired."name",
        "setName" = desired."setName",
        "setCode" = desired."setCode",
        "number" = desired."number",
        "rarity" = desired."rarity",
        "imageUrl" = desired."imageUrl",
        "displayImageUrl" = desired."displayImageUrl",
        "tcgApiId" = desired."tcgApiId",
        "tcgDexId" = desired."tcgDexId",
        "cardmarketId" = desired."cardmarketId",
        "edition" = desired."edition",
        "finish" = desired."finish",
        "updatedAt" = NOW()
      FROM (
        SELECT DISTINCT ON ("winnerId") * FROM "_CardConsolidation" ORDER BY "winnerId", "loserId"
      ) desired
      WHERE c."id" = desired."winnerId"
    `;
    await tx.$executeRaw`
      DELETE FROM "Card" c USING "_CardConsolidation" m WHERE c."id" = m."loserId"
    `;

    const remaining = await tx.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS "count" FROM "Card" c
      JOIN "_CardConsolidation" m ON m."loserId" = c."id"
    `;
    if (Number(remaining[0]?.count ?? 0n) !== 0) {
      throw new Error("Post-apply invariant failed: duplicate card rows remain; transaction rolled back.");
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: APPLY_TIMEOUT_MS, maxWait: 30_000 });
}

function chooseWinner(group: CardRow[]): CardRow {
  return [...group].sort((left, right) => {
    const printed = Number(hasPrintedCollectorTotal(right.number)) - Number(hasPrintedCollectorTotal(left.number));
    if (printed !== 0) return printed;
    const refs = referenceCount(right._count) - referenceCount(left._count);
    if (refs !== 0) return refs;
    const tcgApi = Number(Boolean(right.tcgApiId)) - Number(Boolean(left.tcgApiId));
    if (tcgApi !== 0) return tcgApi;
    const metadata = metadataScore(right) - metadataScore(left);
    if (metadata !== 0) return metadata;
    const created = left.createdAt.getTime() - right.createdAt.getTime();
    return created || left.id.localeCompare(right.id);
  })[0]!;
}

function mergedCard(group: CardRow[], winner: CardRow): DesiredCard {
  const optional = <K extends keyof DesiredCard>(key: K): DesiredCard[K] =>
    (winner[key] ?? group.map((card) => card[key]).find((value) => value != null) ?? null) as DesiredCard[K];
  return {
    name: winner.name,
    setName: winner.setName,
    setCode: optional("setCode"),
    number: optional("number"),
    rarity: optional("rarity"),
    imageUrl: optional("imageUrl"),
    displayImageUrl: optional("displayImageUrl"),
    tcgApiId: optional("tcgApiId"),
    tcgDexId: optional("tcgDexId"),
    cardmarketId: optional("cardmarketId"),
    edition: optional("edition"),
    finish: optional("finish"),
  };
}

function metadataConflict(group: CardRow[]): string | null {
  for (const field of ["tcgApiId", "tcgDexId", "cardmarketId"] as const) {
    const values = new Set(group.map((card) => card[field]).filter((value): value is string => Boolean(value)));
    if (values.size > 1) return `conflicting-${field}`;
  }
  return null;
}

function relationCollision(
  group: CardRow[],
  snapshotsByCard: Map<string, Array<{ cardId: string; grade: string; takenAt: Date }>>,
  watchesByCard: Map<string, Array<{ cardId: string; grade: string }>>,
): string | null {
  const snapshotKeys = new Set<string>();
  for (const card of group) {
    for (const snapshot of snapshotsByCard.get(card.id) ?? []) {
      const key = `${snapshot.grade}\u0000${snapshot.takenAt.toISOString()}`;
      if (snapshotKeys.has(key)) return "price-snapshot-unique-collision";
      snapshotKeys.add(key);
    }
  }
  const watchGrades = new Set<string>();
  for (const card of group) {
    for (const watch of watchesByCard.get(card.id) ?? []) {
      if (watchGrades.has(watch.grade)) return "watch-unique-collision";
      watchGrades.add(watch.grade);
    }
  }
  return null;
}

function plannedMember(card: CardRow): PlannedMember {
  const { createdAt, updatedAt, _count, ...identity } = card;
  return {
    ...identity,
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
    references: _count,
  };
}

function referenceCount(counts: ReferenceCounts): number {
  return Object.values(counts).reduce((sum, count) => sum + count, 0);
}

function metadataScore(card: CardRow): number {
  return [
    card.setCode,
    card.rarity,
    card.imageUrl,
    card.displayImageUrl,
    card.tcgApiId,
    card.tcgDexId,
    card.cardmarketId,
  ].filter(Boolean).length;
}

function groupByCardId<T extends { cardId: string }>(rows: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) grouped.set(row.cardId, [...(grouped.get(row.cardId) ?? []), row]);
  return grouped;
}

function identityLabel(card: Pick<CardRow, "game" | "language" | "setName" | "name" | "number" | "edition" | "finish">): string {
  return `${card.game}/${card.language} · ${card.setName} · ${card.name} · ${card.number ?? "no number"} · ${card.edition ?? "no edition"}/${card.finish ?? "no finish"}`;
}

function databaseFingerprint(value: string): string {
  const parsed = new URL(value);
  const host = parsed.hostname.replace(/-pooler(?=\.)/, "");
  return sha256(`${host}${parsed.port ? `:${parsed.port}` : ""}${parsed.pathname}`);
}

function hashPlanContent(content: PlanContent): string {
  return sha256(JSON.stringify(content));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function validateSavedPlan(plan: ConsolidationPlan): void {
  if (plan.version !== PLAN_VERSION || !Array.isArray(plan.actions) || !Array.isArray(plan.skipped)) {
    throw new Error("Unsupported or malformed consolidation plan.");
  }
  const { generatedAt: _generatedAt, planHash, ...content } = plan;
  const computed = hashPlanContent(content);
  if (computed !== planHash) throw new Error(`Plan file hash mismatch: expected ${planHash}, computed ${computed}.`);
}

function argumentValue(name: string): string | null {
  const prefix = `${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function defaultPlanPath(generatedAt: string): string {
  const stamp = generatedAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return path.join(process.cwd(), "output", "audits", `card-consolidation-plan-${stamp}.json`);
}
