import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { resolve } from "node:path";

const tokensPath = resolve(import.meta.dirname, "../packages/ui-kit/src/tokens.css");

function channel(value) {
  const scaled = value / 255;
  return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

function ratio(foreground, background) {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function block(css, selector) {
  const start = css.indexOf(selector);
  assert.notEqual(start, -1, selector);
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    else if (css[index] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, index);
    }
  }
  throw new Error(`unclosed ${selector}`);
}

function variables(body) {
  const map = new Map();
  for (const match of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    map.set(match[1], match[2].trim());
  }
  return map;
}

const pairs = [
  ["--ui-color-ink", "--ui-color-canvas", 4.5],
  ["--ui-color-ink", "--ui-color-surface", 4.5],
  ["--ui-color-muted", "--ui-color-surface", 4.5],
  ["--ui-color-muted", "--ui-color-canvas", 4.5],
  ["--ui-color-on-accent", "--ui-color-accent", 4.5],
  ["--ui-color-loading-ink", "--ui-color-loading-bg", 4.5],
  ["--ui-color-empty-ink", "--ui-color-empty-bg", 4.5],
  ["--ui-color-stale-ink", "--ui-color-stale-bg", 4.5],
  ["--ui-color-error-ink", "--ui-color-error-bg", 4.5],
  ["--ui-color-restricted-ink", "--ui-color-restricted-bg", 4.5],
  ["--ui-color-focus", "--ui-color-surface", 3],
  ["--ui-color-focus", "--ui-color-canvas", 3],
  ["--ui-color-border", "--ui-color-surface", 3],
  ["--ui-color-border", "--ui-color-canvas", 3],
];

test("light and dark tokens meet the WCAG 2.2 AA contrast pairs", async () => {
  const css = await readFile(tokensPath, "utf8");
  const light = variables(block(css, ".ui-gallery,\n.ui-gallery[data-theme=\"light\"]"));
  const dark = variables(block(css, ".ui-gallery[data-theme=\"dark\"]"));
  const media = variables(block(css, ".ui-gallery:not([data-theme=\"light\"])"));
  assert.deepEqual([...media.entries()], [...dark.entries()]);
  assert.equal(light.get("--ui-focus-width"), "3px");
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /\.ui-gallery button \{\s*transition:\s*none;/);
  for (const theme of [light, dark]) {
    for (const [foreground, background, minimum] of pairs) {
      const value = ratio(theme.get(foreground), theme.get(background));
      assert.ok(value >= minimum, `${foreground} on ${background} is ${value.toFixed(2)}, need ${minimum}`);
    }
  }
  assert.equal(css.includes("LIVE"), false);
});
