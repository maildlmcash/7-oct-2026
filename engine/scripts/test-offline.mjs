import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const testDir = resolve(root, "tests");
const files = (await readdir(testDir))
  .filter((name) => name.endsWith(".mjs"))
  .filter((name) => !name.endsWith("-migration.mjs") && name !== "checklist-schema.mjs")
  .sort()
  .map((name) => resolve(testDir, name));

if (files.length === 0) {
  process.stderr.write("No offline tests were discovered.\n");
  process.exit(2);
}

const result = spawnSync(process.execPath, ["--test", ...files], { cwd: root, stdio: "inherit", env: process.env });
process.exit(result.status ?? 1);
