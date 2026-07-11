import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export function getPrisma(): PrismaClient {
  const client =
    globalForPrisma.prisma ??
    new PrismaClient({
      log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    });

  // A serverless production isolate may serve many requests. Reuse the same
  // Prisma pool for the lifetime of that isolate instead of constructing a
  // fresh pool per request. Provider-side pooling is still recommended for
  // DATABASE_URL; this guards the application side of the connection budget.
  globalForPrisma.prisma = client;

  return client;
}
