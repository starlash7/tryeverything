import test from "node:test";
import assert from "node:assert/strict";

import {
  advanceGame,
  applyDecision,
  buildShareText,
  createInitialState,
} from "./game.mjs";

function correctDecisionFor(state) {
  return state.currentDiff.kind === "safe" ? "approve" : "reject";
}

function wrongDecisionFor(state) {
  return state.currentDiff.kind === "safe" ? "reject" : "approve";
}

function diffSequence(seed, length) {
  let state = createInitialState(seed);
  const ids = [];
  for (let index = 0; index < length; index += 1) {
    ids.push(state.currentDiff.id);
    state = applyDecision(state, correctDecisionFor(state));
  }
  return ids;
}

test("createInitialState starts a deterministic round at full health", () => {
  const state = createInitialState(42);

  assert.equal(state.phase, "running");
  assert.equal(state.seed, 42);
  assert.equal(state.health, 100);
  assert.equal(state.score, 0);
  assert.equal(state.combo, 0);
  assert.equal(state.elapsedMs, 0);
  assert.equal(state.blocked, 0);
  assert.equal(state.approvedSafe, 0);
  assert.equal(state.endReason, null);
  assert.ok(state.currentDiff);
});

test("the same seed reproduces the same diff sequence", () => {
  assert.deepEqual(diffSequence(42, 12), diffSequence(42, 12));
  assert.notDeepEqual(diffSequence(42, 12), diffSequence(43, 12));
});

test("approving a safe diff increases score, combo, and approved count", () => {
  const state = createInitialState(1);
  assert.equal(state.currentDiff.kind, "safe");

  const next = applyDecision(state, "approve");

  assert.equal(next.health, 100);
  assert.equal(next.score, 100);
  assert.equal(next.combo, 1);
  assert.equal(next.approvedSafe, 1);
  assert.equal(next.blocked, 0);
  assert.notEqual(next.currentDiff.id, state.currentDiff.id);
});

test("rejecting a dangerous diff scores and increments the blocked count", () => {
  const state = createInitialState(3);
  assert.equal(state.currentDiff.kind, "dangerous");

  const next = applyDecision(state, "reject");

  assert.equal(next.health, 100);
  assert.equal(next.score, 100);
  assert.equal(next.combo, 1);
  assert.equal(next.blocked, 1);
  assert.equal(next.approvedSafe, 0);
  assert.notEqual(next.currentDiff.id, state.currentDiff.id);
});

test("a wrong decision costs 25 health and resets the combo", () => {
  const scored = applyDecision(createInitialState(1), "approve");
  const state = {
    ...scored,
    currentDiff: { id: "forced-safe", code: "rollback.enabled = true", kind: "safe" },
  };

  const next = applyDecision(state, "reject");

  assert.equal(next.health, 75);
  assert.equal(next.score, 100);
  assert.equal(next.combo, 0);
  assert.notEqual(next.currentDiff.id, state.currentDiff.id);
});

test("consecutive correct decisions multiply the score by the combo", () => {
  let state = createInitialState(42);
  state = applyDecision(state, correctDecisionFor(state));
  state = applyDecision(state, correctDecisionFor(state));

  assert.equal(state.combo, 2);
  assert.equal(state.score, 300);
});

test("the score multiplier caps at five while the combo keeps climbing", () => {
  let state = createInitialState(42);
  for (let index = 0; index < 6; index += 1) {
    state = applyDecision(state, correctDecisionFor(state));
  }

  assert.equal(state.combo, 6);
  assert.equal(state.score, 2000);
});

test("four wrong decisions end the round in an outage", () => {
  let state = createInitialState(42);
  for (let index = 0; index < 4; index += 1) {
    state = applyDecision(state, wrongDecisionFor(state));
  }

  assert.equal(state.health, 0);
  assert.equal(state.phase, "ended");
  assert.equal(state.endReason, "outage");
  assert.equal(state.currentDiff, null);
});

test("letting a diff expire costs 15 health and reveals the next diff", () => {
  const state = createInitialState(42);

  const next = advanceGame(state, 1250);

  assert.equal(next.elapsedMs, 1250);
  assert.equal(next.health, 85);
  assert.equal(next.combo, 0);
  assert.equal(next.cursor, 1);
  assert.notEqual(next.currentDiff.id, state.currentDiff.id);
  assert.equal(next.cardDeadlineMs, 1175);
  assert.equal(next.cardElapsedMs, 0);
});

test("a long frame processes every diff timeout it crosses", () => {
  const state = createInitialState(42);

  const next = advanceGame(state, 2425);

  assert.equal(next.elapsedMs, 2425);
  assert.equal(next.health, 70);
  assert.equal(next.cursor, 2);
  assert.equal(next.cardDeadlineMs, 1100);
  assert.equal(next.cardElapsedMs, 0);
});

test("the round ends as survived at exactly twelve seconds", () => {
  const state = {
    ...createInitialState(42),
    elapsedMs: 11900,
    cardElapsedMs: 100,
    cardDeadlineMs: 1000,
  };

  const next = advanceGame(state, 200);

  assert.equal(next.elapsedMs, 12000);
  assert.equal(next.health, 100);
  assert.equal(next.phase, "ended");
  assert.equal(next.endReason, "survived");
  assert.equal(next.currentDiff, null);
});

test("a timeout that drains health ends the round in an outage", () => {
  const state = { ...createInitialState(42), health: 15 };

  const next = advanceGame(state, 1250);

  assert.equal(next.health, 0);
  assert.equal(next.phase, "ended");
  assert.equal(next.endReason, "outage");
  assert.equal(next.currentDiff, null);
});

test("buildShareText formats the result and playable URL", () => {
  const state = {
    ...createInitialState(42),
    elapsedMs: 9876,
    blocked: 7,
  };

  assert.equal(
    buildShareText(state, "https://example.com/friday-deploy/"),
    "I kept production alive for 9.9s and blocked 7 cursed diffs. " +
      "Can you beat my code review? https://example.com/friday-deploy/",
  );
});
