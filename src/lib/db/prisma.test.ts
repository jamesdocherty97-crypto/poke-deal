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
