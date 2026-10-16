import assert from "node:assert/strict";
import test from "node:test";
import { getPrisma } from "./prisma.js";

test("getPrisma reuses one client in a production runtime", () => {
  const original = process.env.NODE_ENV;
  Object.assign(process.env, { NODE_ENV: "production" });
  try {
    assert.equal(getPrisma(), getPrisma());
  } finally {
    if (original === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
    else Object.assign(process.env, { NODE_ENV: original });
  }
});

test("previews never use DATABASE_URL and refuse the production host", async () => {
  const { resolveDatasourceUrl } = await import("./prisma.js");
  const prod = "postgresql://u:p@ep-prod-123-pooler.eu-west-2.aws.neon.tech/db?sslmode=require";
  const prodDirect = "postgresql://u:p@ep-prod-123.eu-west-2.aws.neon.tech/db?sslmode=require";
  const branch = "postgresql://u:p@ep-preview-456-pooler.eu-west-2.aws.neon.tech/db?sslmode=require";

  for (const vercelEnv of [undefined, "production", "development"]) {
    assert.equal(resolveDatasourceUrl({ VERCEL_ENV: vercelEnv, DATABASE_URL: prod }), null);
  }
  assert.throws(() => resolveDatasourceUrl({ VERCEL_ENV: "preview", DATABASE_URL: prod }), /PREVIEW_DATABASE_URL/);
  assert.throws(() => resolveDatasourceUrl({ VERCEL_ENV: "preview" }), /PREVIEW_DATABASE_URL/);
  assert.throws(() => resolveDatasourceUrl({ VERCEL_ENV: "Preview", DATABASE_URL: prod, PREVIEW_DATABASE_URL: prod }), /same database host/);
  assert.throws(() => resolveDatasourceUrl({ VERCEL_ENV: "preview", DATABASE_URL: prod, PREVIEW_DATABASE_URL: prodDirect }), /same database host/);
  assert.equal(resolveDatasourceUrl({ VERCEL_ENV: "preview", DATABASE_URL: prod, PREVIEW_DATABASE_URL: branch }), branch);
  assert.equal(resolveDatasourceUrl({ VERCEL_ENV: "preview", PREVIEW_DATABASE_URL: branch }), branch);

  // Error messages never echo a connection string.
  try {
    resolveDatasourceUrl({ VERCEL_ENV: "preview", DATABASE_URL: prod, PREVIEW_DATABASE_URL: prod });
  } catch (error) {
    assert.equal(String(error).includes("u:p@"), false);
  }
});

test("getPrisma in a preview without PREVIEW_DATABASE_URL refuses before building a client", async () => {
  const { getPrisma } = await import("./prisma.js");
  const globals = globalThis as { prisma?: unknown };
  const previous = { prisma: globals.prisma, VERCEL_ENV: process.env.VERCEL_ENV, PREVIEW_DATABASE_URL: process.env.PREVIEW_DATABASE_URL };
  delete globals.prisma;
  process.env.VERCEL_ENV = "preview";
  delete process.env.PREVIEW_DATABASE_URL;
  try {
    assert.throws(() => getPrisma(), /PREVIEW_DATABASE_URL/);
    assert.equal(globals.prisma, undefined);
  } finally {
    if (previous.prisma !== undefined) globals.prisma = previous.prisma;
    for (const key of ["VERCEL_ENV", "PREVIEW_DATABASE_URL"] as const) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
