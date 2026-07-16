import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

test("the document exposes the complete accessible game surface", () => {
  assert.equal(existsSync("index.html"), true, "index.html must exist");

  const html = readFileSync("index.html", "utf8");
  const requiredMarkup = [
    '<main id="game-shell"',
    'id="diff-code"',
    'id="approve-button"',
    'id="reject-button"',
    'id="telemetry"',
    'id="health-meter"',
    'id="incident-canvas"',
    'id="result-panel"',
    'id="share-button"',
    'id="start-panel"',
    'id="start-button"',
    'Built with Grok Build',
    'aria-live="polite"',
  ];

  for (const snippet of requiredMarkup) {
    assert.ok(html.includes(snippet), `missing markup: ${snippet}`);
  }
});

test("social preview and GitHub Pages deployment files are present", () => {
  const html = readFileSync("index.html", "utf8");
  assert.ok(html.includes('property="og:image"'));
  assert.ok(html.includes('name="twitter:card"'));
  assert.equal(existsSync("assets/og-card.png"), true, "OG image must exist");
  assert.equal(
    existsSync(".github/workflows/pages.yml"),
    true,
    "Pages workflow must exist",
  );

  const workflow = readFileSync(".github/workflows/pages.yml", "utf8");
  assert.ok(workflow.includes("actions/deploy-pages@v4"));
  assert.ok(workflow.includes("node --test game.test.mjs ui.test.mjs"));
});
