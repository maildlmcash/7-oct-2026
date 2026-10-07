import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const adrPath = resolve(root, "docs/adr/0001-baseline.md");
const evidenceDir = resolve(root, "docs/architecture/evidence/1-a-1");

const requiredQuotes = [
  ["toolchain.txt", "node: v22.23.3"],
  ["root-npm-ci.txt", "Invalid: lock file's ajv@6.15.0 does not satisfy ajv@8.20.0"],
  ["root-typecheck.txt", "sh: tsc: command not found"],
  ["root-test.txt", "Cannot find package '@tanstack/react-start'"],
  ["root-test.txt", "Cannot find package 'jose'"],
  ["engine-install.txt", "Done in 24.4s using pnpm v10.17.1"],
  ["engine-typecheck.txt", "app/cex-desk.tsx(128,52): error TS7006: Parameter 'place' implicitly has an 'any' type."],
  ["engine-test.txt", "# tests 268"],
  ["engine-test.txt", "# pass 267"],
  ["engine-test.txt", "# fail 0"],
  ["engine-test.txt", "# skipped 1"],
  ["engine-audit.txt", "GHSA-7mvr-c777-76hp"],
];

test("1.A.1 baseline ADR quotes the measured command transcripts", async () => {
  const adr = await readFile(adrPath, "utf8");
  assert.match(adr, /DLM CASH/);
  assert.match(adr, /maildlmcash/);
  assert.match(adr, /## Unresolved blockers/);
  assert.match(adr, /## Owners/);
  assert.match(adr, /apps\/control-web/);
  assert.match(adr, /engine\/apps\/web|apps\/web/);
  assert.doesNotMatch(adr, /LIVE status: verified/i);
  assert.doesNotMatch(adr, /liveTrading["']?\s*[:=]\s*["']?ON/i);

  for (const [file, quote] of requiredQuotes) {
    const transcript = await readFile(resolve(evidenceDir, file), "utf8");
    assert.ok(transcript.includes(quote), `${file} missing measured line: ${quote}`);
    assert.ok(adr.includes(quote), `ADR dropped measured line from ${file}: ${quote}`);
  }
});

test("1.A.1 target map keeps the existing product paths", async () => {
  const map = await readFile(resolve(root, "docs/architecture/target-map.md"), "utf8");
  assert.match(map, /engine\/apps\/web/);
  assert.match(map, /engine\/packages\/ui-kit/);
  assert.match(map, /docs\/decisions/);
  assert.match(map, /No source directory was renamed/);
  assert.doesNotMatch(map, /LIVE data was collected/i);
});
