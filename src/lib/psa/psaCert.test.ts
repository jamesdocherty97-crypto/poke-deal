import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PsaCertLookup, mapPsaCertResponse } from "./psaCert.js";
import { psaGradeLabelToGrade } from "./types.js";

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("./__fixtures__/psa-cert.json", import.meta.url)), "utf8"),
);

test("psaGradeLabelToGrade maps PSA labels to canonical grades", () => {
  assert.equal(psaGradeLabelToGrade("GEM MT 10"), "PSA_10");
  assert.equal(psaGradeLabelToGrade("MINT 9"), "PSA_9");
  assert.equal(psaGradeLabelToGrade("NM-MT 8"), "PSA_8");
  assert.equal(psaGradeLabelToGrade("PR 1"), "PSA_1");
  assert.equal(psaGradeLabelToGrade("AUTHENTIC"), null);
  assert.equal(psaGradeLabelToGrade("MINT 9.5"), null); // half grades not representable
  assert.equal(psaGradeLabelToGrade(undefined), null);
});

test("mapPsaCertResponse parses a successful PSACert envelope", () => {
  const r = mapPsaCertResponse(fixture, "79721014", true);
  assert.equal(r.found, true);
  assert.equal(r.certNumber, "79721014");
  assert.equal(r.subject, "UMBREON VMAX");
  assert.equal(r.cardNumber, "215");
  assert.equal(r.variety, "ALTERNATE ART SECRET");
  assert.equal(r.gradeLabel, "GEM MT 10");
  assert.equal(r.grade, "PSA_10");
  assert.equal(r.totalPopulation, 12863);
  assert.equal(r.populationHigher, 0);
  assert.equal(r.live, true);
});

test("mapPsaCertResponse handles invalid and empty responses", () => {
  const invalid = mapPsaCertResponse(
    { IsValidRequest: false, ServerMessage: "Invalid CertNo" },
    "abc",
    true,
  );
  assert.equal(invalid.found, false);
  assert.match(invalid.reason ?? "", /Invalid/);

  const empty = mapPsaCertResponse(
    { IsValidRequest: true, ServerMessage: "No data found" },
    "00000000",
    true,
  );
  assert.equal(empty.found, false);
  assert.match(empty.reason ?? "", /No data/);
});

test("offline mode returns a demoable fixture cert", async () => {
  const offline = new PsaCertLookup(undefined);
  assert.equal(offline.live, false);
  const r = await offline.lookup("79721014");
  assert.equal(r.found, true);
  assert.equal(r.grade, "PSA_10");
  assert.equal(r.live, false);
});

test("non-numeric cert input is rejected before any network call", async () => {
  let called = false;
  const fetchImpl = (async () => {
    called = true;
    return Response.json({});
  }) as typeof fetch;
  const lookup = new PsaCertLookup("token", fetchImpl, 5);
  const r = await lookup.lookup("   ");
  assert.equal(r.found, false);
  assert.equal(called, false);
});

test("live mode sends bearer token and maps the response", async () => {
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    assert.match(String(url), /\/cert\/GetByCertNumber\/79721014$/);
    assert.equal((init?.headers as Record<string, string>).Authorization, "bearer secret-token");
    assert.ok(init?.signal, "live requests should carry a timeout signal");
    return Response.json(fixture);
  }) as typeof fetch;
  const lookup = new PsaCertLookup("secret-token", fetchImpl, 5);
  const r = await lookup.lookup("79721014");
  assert.equal(r.found, true);
  assert.equal(r.subject, "UMBREON VMAX");
  assert.equal(r.live, true);
});

test("live mode degrades gracefully on network/HTTP errors", async () => {
  const throwing = new PsaCertLookup("secret-token", (async () => {
    throw new Error("network down");
  }) as typeof fetch, 5);
  const r = await throwing.lookup("79721014");
  assert.equal(r.found, false);
  assert.match(r.reason ?? "", /failed/);

  const http500 = new PsaCertLookup("secret-token", (async () =>
    new Response("", { status: 500 })) as typeof fetch, 5);
  const r500 = await http500.lookup("79721014");
  assert.equal(r500.found, false);
  assert.match(r500.reason ?? "", /credentials|500/);
});
