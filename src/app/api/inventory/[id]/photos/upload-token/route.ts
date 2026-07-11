import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/db/prisma";
import {
  ALLOWED_PHOTO_CONTENT_TYPES,
  MAX_PHOTO_UPLOAD_BYTES,
  validateInventoryPhotoUploadPath,
} from "@/lib/photos/uploadPolicy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  props: { params: Promise<{ id: string }> },
) {
  const params = await props.params;
  const body = (await request.json().catch(() => null)) as HandleUploadBody | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid upload request." }, { status: 400 });
  }

  try {
    const response = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname) => {
        const item = await getPrisma().inventoryItem.findUnique({
          where: { id: params.id },
          select: { id: true },
        });
        if (!item) {
          throw new Error("Inventory item not found.");
        }

        validateInventoryPhotoUploadPath(params.id, pathname);

        return {
          allowedContentTypes: [...ALLOWED_PHOTO_CONTENT_TYPES],
          maximumSizeInBytes: MAX_PHOTO_UPLOAD_BYTES,
          addRandomSuffix: true,
          allowOverwrite: false,
        };
      },
    });

    return NextResponse.json(response);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Photo upload token failed." },
      { status: 400 },
    );
  }
}
