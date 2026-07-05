import type { CatalogCard, CatalogSource } from "../catalog/types.js";
import { PrismaCardCache, type PrismaCardDb } from "../catalog/prismaCardCache.js";
import { getPrisma } from "../db/prisma.js";
import type { CardRef } from "../domain/types.js";
import type { CompCardImageEvidence } from "./cardArt.js";

export function withResolvedDisplayImage<T extends CatalogCard | null | undefined>(
  catalog: T,
  cardImage: CompCardImageEvidence,
): T {
  if (!catalog || !cardImage.imageUrl || cardImage.listingSafe || catalog.imageUrl || catalog.displayImageUrl) return catalog;
  return { ...catalog, displayImageUrl: cardImage.imageUrl } as T;
}

export async function persistResolvedDisplayImage(input: {
  card: CardRef;
  catalog?: CatalogCard | null;
  cardImage: CompCardImageEvidence;
  catalogSource?: CatalogSource | null;
}): Promise<void> {
  if (!process.env.DATABASE_URL || !input.cardImage.imageUrl || input.cardImage.listingSafe) return;

  const prisma = getPrisma();
  const catalogWithDisplay = withResolvedDisplayImage(input.catalog, input.cardImage);
  const cardForCache =
    catalogWithDisplay ??
    ({
      ...input.card,
      displayImageUrl: input.cardImage.imageUrl,
    } as CardRef & { displayImageUrl: string });

  const cache = new PrismaCardCache(prisma as unknown as PrismaCardDb, input.catalogSource ?? null);
  const row = await cache.resolve(cardForCache);
  if (row.imageUrl || row.displayImageUrl === input.cardImage.imageUrl) return;

  await prisma.card.update({
    where: { id: row.id },
    data: { displayImageUrl: input.cardImage.imageUrl },
  });
}
