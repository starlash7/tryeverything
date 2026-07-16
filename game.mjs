/**
 * Friday Deploy Simulator - pure game logic (no DOM).
 *
 * @typedef {"approve" | "reject"} Decision
 * @typedef {"safe" | "dangerous"} DiffKind
 * @typedef {{ id: string, code: string, kind: DiffKind }} DiffItem
 * @typedef {"running" | "ended"} Phase
 * @typedef {null | "survived" | "outage"} EndReason
 * @typedef {{
 *   phase: Phase,
 *   seed: number,
 *   health: number,
 *   score: number,
 *   combo: number,
 *   elapsedMs: number,
 *   blocked: number,
 *   approvedSafe: number,
 *   currentDiff: DiffItem | null,
 *   endReason: EndReason,
 *   deck: readonly DiffItem[],
 *   cursor: number,
 *   cardElapsedMs: number,
 *   cardDeadlineMs: number,
 * }} GameState
 */

/** Fixed pool: 8 safe + 8 dangerous one-line diffs. */
const DIFFS = Object.freeze([
  Object.freeze({ id: "s1", code: "deploy.requireGreenCI = true", kind: "safe" }),
  Object.freeze({ id: "s2", code: "logs.redactSecrets = true", kind: "safe" }),
  Object.freeze({ id: "s3", code: "auth.sessionTimeout = 900", kind: "safe" }),
  Object.freeze({ id: "s4", code: "rateLimit.maxRequests = 100", kind: "safe" }),
  Object.freeze({ id: "s5", code: "backup.enabled = true", kind: "safe" }),
  Object.freeze({ id: "s6", code: 'tls.minVersion = "1.2"', kind: "safe" }),
  Object.freeze({ id: "s7", code: "featureFlags.rollout = 0.05", kind: "safe" }),
  Object.freeze({ id: "s8", code: "cache.ttlSeconds = 300", kind: "safe" }),
  Object.freeze({ id: "d1", code: "deploy.skipTests = true", kind: "dangerous" }),
  Object.freeze({ id: "d2", code: "auth.required = false", kind: "dangerous" }),
  Object.freeze({ id: "d3", code: 'db.query = "DROP TABLE users"', kind: "dangerous" }),
  Object.freeze({ id: "d4", code: 'cors.origin = "*"', kind: "dangerous" }),
  Object.freeze({ id: "d5", code: 'secrets.apiKey = "hardcoded-prod-key"', kind: "dangerous" }),
  Object.freeze({ id: "d6", code: "firewall.allowAll = true", kind: "dangerous" }),
  Object.freeze({ id: "d7", code: "payments.idempotency = false", kind: "dangerous" }),
  Object.freeze({ id: "d8", code: "logger.level = \"debug\"; console.log(process.env)", kind: "dangerous" }),
]);

/**
 * Mulberry32 PRNG - deterministic from a 32-bit seed.
 * @param {number} seed
 * @returns {() => number} unit interval [0, 1)
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fisher-Yates shuffle of indices, seeded.
 * @param {number} length
 * @param {() => number} rand
 * @returns {number[]}
 */
function shuffledIndices(length, rand) {
  const order = Array.from({ length }, (_, i) => i);
  for (let i = length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = order[i];
    order[i] = order[j];
    order[j] = tmp;
  }
  return order;
}

/**
 * Start a new round at full health with a deterministic first card.
 * @param {number} seed
 * @returns {GameState}
 */
export function createInitialState(seed) {
  const rand = mulberry32(seed);
  const order = shuffledIndices(DIFFS.length, rand);
  const deck = Object.freeze(order.map((index) => DIFFS[index]));

  return {
    phase: "running",
    seed,
    health: 100,
    score: 0,
    combo: 0,
    elapsedMs: 0,
    blocked: 0,
    approvedSafe: 0,
    currentDiff: deck[0],
    endReason: null,
    deck,
    cursor: 0,
    cardElapsedMs: 0,
    cardDeadlineMs: 1250,
  };
}

/**
 * Resolve the visible diff and immediately reveal the next one.
 * @param {GameState} state
 * @param {Decision} decision
 * @returns {GameState}
 */
export function applyDecision(state, decision) {
  if (state.phase !== "running" || !state.currentDiff) return state;

  const correct =
    (state.currentDiff.kind === "safe" && decision === "approve") ||
    (state.currentDiff.kind === "dangerous" && decision === "reject");
  const cursor = state.cursor + 1;
  const health = correct ? state.health : Math.max(0, state.health - 25);

  return {
    ...state,
    phase: health === 0 ? "ended" : "running",
    health,
    score: correct
      ? state.score + 100 * Math.min(state.combo + 1, 5)
      : state.score,
    combo: correct ? state.combo + 1 : 0,
    blocked:
      state.blocked + Number(correct && state.currentDiff.kind === "dangerous"),
    approvedSafe:
      state.approvedSafe + Number(correct && state.currentDiff.kind === "safe"),
    currentDiff: health === 0 ? null : state.deck[cursor % state.deck.length],
    endReason: health === 0 ? "outage" : null,
    cursor,
    cardElapsedMs: 0,
    cardDeadlineMs: Math.max(550, 1250 - cursor * 75),
  };
}

/**
 * Advance the round clock and expire the current diff when its deadline passes.
 * @param {GameState} state
 * @param {number} deltaMs
 * @returns {GameState}
 */
export function advanceGame(state, deltaMs) {
  if (state.phase !== "running" || deltaMs <= 0) return state;

  const appliedDeltaMs = Math.min(deltaMs, 12000 - state.elapsedMs);
  const elapsedMs = state.elapsedMs + appliedDeltaMs;
  let health = state.health;
  let cursor = state.cursor;
  let cardElapsedMs = state.cardElapsedMs + appliedDeltaMs;
  let cardDeadlineMs = state.cardDeadlineMs;

  while (cardElapsedMs >= cardDeadlineMs && health > 0) {
    cardElapsedMs -= cardDeadlineMs;
    health = Math.max(0, health - 15);
    cursor += 1;
    cardDeadlineMs = Math.max(550, 1250 - cursor * 75);
  }

  const outage = health === 0;
  const survived = elapsedMs === 12000 && !outage;
  return {
    ...state,
    phase: outage || survived ? "ended" : "running",
    health,
    combo: cursor === state.cursor ? state.combo : 0,
    elapsedMs,
    currentDiff:
      outage || survived ? null : state.deck[cursor % state.deck.length],
    endReason: outage ? "outage" : survived ? "survived" : null,
    cursor,
    cardElapsedMs,
    cardDeadlineMs,
  };
}

/**
 * Build the text used by the X share action.
 * @param {GameState} state
 * @param {string} url
 * @returns {string}
 */
export function buildShareText(state, url) {
  const seconds = (state.elapsedMs / 1000).toFixed(1);
  return (
    `I kept production alive for ${seconds}s and blocked ${state.blocked} ` +
    `cursed diffs. Can you beat my code review? ${url}`
  );
}
