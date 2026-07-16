/**
 * Friday Deploy Simulator - DOM shell over pure game.mjs engine.
 * No network, no AI, no frameworks.
 */

import {
  advanceGame,
  applyDecision,
  buildShareText,
  createInitialState,
} from "./game.mjs";

const ROUND_MS = 12000;
const MAX_FEED = 8;

/** @type {import('./game.mjs').GameState} */
let state = createInitialState(freshSeed());
let started = false;
let paused = true;
let lastTs = 0;
/** @type {number | null} */
let rafId = null;
/** @type {Array<{ t: string, text: string, sev: string }>} */
let feed = [];
let reducedMotion =
  typeof matchMedia === "function" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches;

// DOM refs

const el = {
  shell: document.getElementById("game-shell"),
  diffCode: document.getElementById("diff-code"),
  approve: document.getElementById("approve-button"),
  reject: document.getElementById("reject-button"),
  score: document.getElementById("score-value"),
  combo: document.getElementById("combo-value"),
  timer: document.getElementById("timer-value"),
  cardClock: document.getElementById("card-clock"),
  healthMeter: document.getElementById("health-meter"),
  healthFill: document.getElementById("health-fill"),
  latency: document.getElementById("latency-value"),
  errors: document.getElementById("errors-value"),
  pager: document.getElementById("pager-value"),
  blocked: document.getElementById("blocked-value"),
  severity: document.getElementById("severity-badge"),
  statusList: document.getElementById("status-list"),
  canvas: /** @type {HTMLCanvasElement} */ (
    document.getElementById("incident-canvas")
  ),
  resultPanel: document.getElementById("result-panel"),
  resultTitle: document.getElementById("result-title"),
  resultKicker: document.getElementById("result-kicker"),
  resultTime: document.getElementById("result-time"),
  resultBlocked: document.getElementById("result-blocked"),
  resultScore: document.getElementById("result-score"),
  startPanel: document.getElementById("start-panel"),
  start: document.getElementById("start-button"),
  share: document.getElementById("share-button"),
  retry: document.getElementById("retry-button"),
  topBar: document.querySelector(".top-bar"),
  sound: /** @type {HTMLInputElement} */ (
    document.getElementById("sound-toggle")
  ),
};

const ctx = el.canvas.getContext("2d");

// Audio (optional, local Web Audio only)

/** @type {AudioContext | null} */
let audioCtx = null;

function soundEnabled() {
  return Boolean(el.sound?.checked);
}

function ensureAudio() {
  if (!soundEnabled()) return null;
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audioCtx = new AC();
  }
  if (audioCtx.state === "suspended") {
    void audioCtx.resume();
  }
  return audioCtx;
}

/**
 * @param {number} freq
 * @param {number} dur
 * @param {"sine" | "square" | "triangle" | "sawtooth"} type
 * @param {number} gain
 */
function beep(freq, dur, type = "square", gain = 0.04) {
  const ac = ensureAudio();
  if (!ac) return;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.value = gain;
  g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
  osc.connect(g);
  g.connect(ac.destination);
  osc.start();
  osc.stop(ac.currentTime + dur);
}

function playCorrect() {
  beep(660, 0.06, "square", 0.035);
  setTimeout(() => beep(880, 0.05, "square", 0.03), 40);
}

function playWrong() {
  beep(140, 0.12, "sawtooth", 0.05);
}

function playTimeout() {
  beep(220, 0.08, "triangle", 0.03);
}

function playEnd(survived) {
  if (survived) {
    beep(523, 0.08, "square", 0.04);
    setTimeout(() => beep(659, 0.08, "square", 0.04), 90);
    setTimeout(() => beep(784, 0.12, "square", 0.045), 180);
  } else {
    beep(110, 0.25, "sawtooth", 0.06);
  }
}

// Helpers

function freshSeed() {
  return (Math.random() * 0xffffffff) >>> 0;
}

/**
 * @param {number} health
 */
function severityFor(health) {
  if (health <= 0) return "outage";
  if (health <= 40) return "critical";
  if (health <= 70) return "degraded";
  return "healthy";
}

/**
 * @param {number} health
 */
function badgeFor(health) {
  const s = severityFor(health);
  if (s === "healthy") return "NOMINAL";
  if (s === "degraded") return "DEGRADED";
  if (s === "critical") return "CRITICAL";
  return "OUTAGE";
}

/**
 * @param {number} health
 * @param {number} elapsedMs
 */
function latencyFor(health, elapsedMs) {
  const base = 42 + (100 - health) * 4.2 + elapsedMs * 0.008;
  return `${Math.round(base)}ms`;
}

/**
 * @param {number} health
 */
function errorsFor(health) {
  const pct = 0.01 + (100 - health) * 0.18;
  return `${pct.toFixed(2)}%`;
}

/**
 * @param {number} health
 */
function pagerFor(health) {
  if (health <= 0) return "PAGE EVERYONE";
  if (health <= 40) return "firing";
  if (health <= 70) return "elevated";
  return "quiet";
}

/**
 * @param {string} text
 * @param {"ok" | "warn" | "bad"} sev
 */
function pushFeed(text, sev = "ok") {
  const t = new Date().toISOString().slice(11, 19);
  feed.unshift({ t, text, sev });
  if (feed.length > MAX_FEED) feed.length = MAX_FEED;
  renderFeed();
}

function renderFeed() {
  if (!el.statusList) return;
  el.statusList.replaceChildren(
    ...feed.map((item) => {
      const li = document.createElement("li");
      li.className = `sev-${item.sev}`;
      li.textContent = `${item.t}  ${item.text}`;
      return li;
    }),
  );
}

function triggerShake() {
  if (reducedMotion || !el.shell) return;
  el.shell.classList.remove("is-shaking");
  // force reflow to restart animation
  void el.shell.offsetWidth;
  el.shell.classList.add("is-shaking");
  window.setTimeout(() => el.shell?.classList.remove("is-shaking"), 400);
}

// Canvas: code-native server rack

/** @type {{ x: number, y: number, vx: number, vy: number, life: number, kind: "smoke" | "spark" }[]} */
const particles = [];

/**
 * @param {number} damage
 *   0 healthy to 1 dead
 */
function spawnIncidentFx(damage) {
  if (!ctx || reducedMotion) return;
  const w = el.canvas.width;
  const h = el.canvas.height;
  const smokeN = Math.floor(damage * 3);
  const sparkN = Math.floor(damage * 5);

  for (let i = 0; i < smokeN; i += 1) {
    particles.push({
      x: w * (0.2 + Math.random() * 0.6),
      y: h * (0.35 + Math.random() * 0.35),
      vx: (Math.random() - 0.5) * 0.4,
      vy: -0.4 - Math.random() * 0.6,
      life: 40 + Math.random() * 40,
      kind: "smoke",
    });
  }
  for (let i = 0; i < sparkN; i += 1) {
    particles.push({
      x: w * (0.25 + Math.random() * 0.5),
      y: h * (0.3 + Math.random() * 0.4),
      vx: (Math.random() - 0.5) * 3,
      vy: -1 - Math.random() * 2.5,
      life: 12 + Math.random() * 18,
      kind: "spark",
    });
  }
  if (particles.length > 120) particles.splice(0, particles.length - 120);
}

/**
 * @param {number} health
 * @param {number} elapsedMs
 */
function drawRack(health, elapsedMs) {
  if (!ctx) return;
  const w = el.canvas.width;
  const h = el.canvas.height;
  const damage = Math.max(0, Math.min(1, (100 - health) / 100));
  const sev = severityFor(health);

  ctx.fillStyle = "#0a0a0a";
  ctx.fillRect(0, 0, w, h);

  // floor grid (ASCII-ops floor)
  ctx.strokeStyle = "#1a1a1a";
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 16) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, h * 0.72);
    ctx.lineTo(x + 0.5, h);
    ctx.stroke();
  }

  const racks = 4;
  const rackW = Math.floor(w / (racks + 1.2));
  const rackH = Math.floor(h * 0.55);
  const baseY = Math.floor(h * 0.72);
  const gap = Math.floor((w - racks * rackW) / (racks + 1));

  for (let r = 0; r < racks; r += 1) {
    const x = gap + r * (rackW + gap);
    const y = baseY - rackH;

    // chassis
    ctx.fillStyle = "#161616";
    ctx.strokeStyle = "#2c2c2c";
    ctx.lineWidth = 1;
    ctx.fillRect(x, y, rackW, rackH);
    ctx.strokeRect(x + 0.5, y + 0.5, rackW - 1, rackH - 1);

    // rails
    ctx.fillStyle = "#222";
    ctx.fillRect(x + 3, y + 3, 4, rackH - 6);
    ctx.fillRect(x + rackW - 7, y + 3, 4, rackH - 6);

    // U-slots + LEDs
    const slots = 10;
    const slotH = Math.floor((rackH - 16) / slots);
    for (let s = 0; s < slots; s += 1) {
      const sy = y + 8 + s * slotH;
      ctx.fillStyle = s % 2 === 0 ? "#1c1c1c" : "#181818";
      ctx.fillRect(x + 10, sy, rackW - 20, slotH - 2);

      // LED health cascade from left to right as damage rises
      const slotDamageThreshold = (r * slots + s) / (racks * slots);
      let led = "#2f9e5f";
      if (damage > slotDamageThreshold + 0.15) led = "#d64545";
      else if (damage > slotDamageThreshold) led = "#c9a227";
      // blink critical LEDs
      if (sev === "critical" || sev === "outage") {
        const blink = Math.floor(elapsedMs / 180) % 2 === 0;
        if (led === "#d64545" && blink) led = "#7a1f1f";
      }
      ctx.fillStyle = led;
      ctx.fillRect(x + rackW - 14, sy + 2, 4, Math.max(2, slotH - 6));
    }

    // unit tag
    ctx.fillStyle = "#3a3a3a";
    ctx.font = "9px monospace";
    ctx.fillText(`R${r + 1}`, x + 12, y + rackH - 6);
  }

  // particles
  for (let i = particles.length - 1; i >= 0; i -= 1) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.life -= 1;
    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }
    if (p.kind === "smoke") {
      const a = Math.min(0.35, p.life / 80);
      ctx.fillStyle = `rgba(90,90,90,${a})`;
      const size = 6 + (40 - Math.min(40, p.life)) * 0.25;
      ctx.fillRect(p.x, p.y, size, size * 0.7);
    } else {
      ctx.fillStyle = Math.random() > 0.3 ? "#d64545" : "#c9a227";
      ctx.fillRect(p.x, p.y, 2, 2);
    }
  }

  // ambient smoke/sparks when damaged
  if (damage > 0.15 && !reducedMotion && Math.random() < damage * 0.35) {
    spawnIncidentFx(damage * 0.5);
  }

  // outage flash bar
  if (sev === "outage") {
    ctx.fillStyle = "rgba(214,69,69,0.12)";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#d64545";
    ctx.font = "bold 12px monospace";
    ctx.fillText("PRODUCTION DOWN", 12, 18);
  } else if (sev === "critical") {
    ctx.fillStyle = "#d64545";
    ctx.font = "bold 11px monospace";
    ctx.fillText("INCIDENT", 12, 16);
  }
}

// Render

function render() {
  const remaining = Math.max(0, ROUND_MS - state.elapsedMs);
  const cardLeft = Math.max(0, state.cardDeadlineMs - state.cardElapsedMs);

  if (el.score) el.score.textContent = String(state.score);
  if (el.combo) el.combo.textContent = `x${state.combo}`;
  if (el.timer) el.timer.textContent = (remaining / 1000).toFixed(1);
  if (el.cardClock) el.cardClock.textContent = (cardLeft / 1000).toFixed(2);

  if (el.healthFill) {
    el.healthFill.style.width = `${Math.max(0, state.health)}%`;
  }
  if (el.healthMeter) {
    el.healthMeter.setAttribute("aria-valuenow", String(state.health));
  }

  if (el.diffCode) {
    el.diffCode.textContent = state.currentDiff
      ? state.currentDiff.code
      : "-";
  }

  if (el.latency) {
    el.latency.textContent = latencyFor(state.health, state.elapsedMs);
  }
  if (el.errors) el.errors.textContent = errorsFor(state.health);
  if (el.pager) el.pager.textContent = pagerFor(state.health);
  if (el.blocked) el.blocked.textContent = String(state.blocked);

  const sev = severityFor(state.health);
  if (el.shell) el.shell.dataset.severity = sev;
  document.body.dataset.severity = sev;
  if (el.severity) el.severity.textContent = badgeFor(state.health);

  const running = state.phase === "running";
  if (el.approve) el.approve.disabled = !running;
  if (el.reject) el.reject.disabled = !running;

  drawRack(state.health, state.elapsedMs);
}

function setBackgroundInert(inert) {
  if (el.topBar) el.topBar.inert = inert;
  if (el.shell) el.shell.inert = inert;
}

function showResult() {
  if (!el.resultPanel) return;
  const survived = state.endReason === "survived";
  if (el.resultKicker) {
    el.resultKicker.textContent = survived ? "SURVIVED" : "OUTAGE";
  }
  if (el.resultTitle) {
    el.resultTitle.textContent = survived
      ? "Production held"
      : "Production down";
  }
  if (el.resultTime) {
    el.resultTime.textContent = `${(state.elapsedMs / 1000).toFixed(1)}s`;
  }
  if (el.resultBlocked) el.resultBlocked.textContent = String(state.blocked);
  if (el.resultScore) el.resultScore.textContent = String(state.score);
  setBackgroundInert(true);
  el.resultPanel.hidden = false;
  el.retry?.focus();
  playEnd(survived);
  pushFeed(
    survived ? "round complete - survived" : "round complete - outage",
    survived ? "ok" : "bad",
  );
}

function hideResult() {
  if (el.resultPanel) el.resultPanel.hidden = true;
  setBackgroundInert(false);
}

// Game loop

/**
 * @param {number} ts
 */
function frame(ts) {
  rafId = null;
  if (paused || state.phase !== "running") {
    lastTs = ts;
    render();
    if (state.phase === "running") {
      rafId = requestAnimationFrame(frame);
    }
    return;
  }

  if (!lastTs) lastTs = ts;
  const delta = Math.min(100, ts - lastTs);
  lastTs = ts;

  const beforeCursor = state.cursor;
  const beforeHealth = state.health;
  const beforePhase = state.phase;

  state = advanceGame(state, delta);

  if (state.cursor !== beforeCursor && state.health < beforeHealth) {
    playTimeout();
    triggerShake();
    spawnIncidentFx((100 - state.health) / 100);
    pushFeed(`timeout | health ${state.health}`, "warn");
  }

  if (state.phase === "ended" && beforePhase === "running") {
    render();
    showResult();
    return;
  }

  render();
  rafId = requestAnimationFrame(frame);
}

function startLoop() {
  if (!started || paused || state.phase !== "running") return;
  if (rafId != null) cancelAnimationFrame(rafId);
  lastTs = 0;
  rafId = requestAnimationFrame(frame);
}

/**
 * @param {"approve" | "reject"} decision
 */
function decide(decision) {
  if (state.phase !== "running" || paused) return;

  const before = state;
  state = applyDecision(state, decision);

  const lostHealth = state.health < before.health;
  if (lostHealth) {
    playWrong();
    triggerShake();
    spawnIncidentFx((100 - state.health) / 100);
    pushFeed(`${decision} | fault | health ${state.health}`, "bad");
  } else {
    playCorrect();
    const tag =
      decision === "reject" && before.currentDiff?.kind === "dangerous"
        ? "blocked"
        : "shipped";
    pushFeed(`${decision} | ${tag} | +score`, "ok");
  }

  render();

  if (state.phase === "ended") {
    showResult();
  }
}

function restart() {
  state = createInitialState(freshSeed());
  started = true;
  paused = document.hidden;
  feed = [];
  particles.length = 0;
  hideResult();
  pushFeed("deploy window open", "ok");
  pushFeed("diff stream online", "ok");
  render();
  startLoop();
}

function begin() {
  started = true;
  paused = document.hidden;
  if (el.startPanel) el.startPanel.hidden = true;
  setBackgroundInert(false);
  pushFeed("deploy window open", "ok");
  pushFeed("diff stream online", "ok");
  render();
  if (!paused) startLoop();
  el.approve?.focus();
}

// Events

el.approve?.addEventListener("click", () => decide("approve"));
el.reject?.addEventListener("click", () => decide("reject"));

el.retry?.addEventListener("click", () => restart());
el.start?.addEventListener("click", () => begin());

el.share?.addEventListener("click", () => {
  const url = window.location.href.split("#")[0];
  const text = buildShareText(state, url);
  const intent = `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
  window.open(intent, "_blank", "noopener,noreferrer");
});

window.addEventListener("keydown", (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const target = /** @type {HTMLElement | null} */ (event.target);
  if (
    target &&
    (target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable)
  ) {
    return;
  }

  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (key === "a") {
    event.preventDefault();
    decide("approve");
  } else if (key === "r") {
    event.preventDefault();
    // Retry when result is open; reject during round
    if (state.phase === "ended" && el.resultPanel && !el.resultPanel.hidden) {
      restart();
    } else {
      decide("reject");
    }
  }
});

document.addEventListener("visibilitychange", () => {
  paused = !started || document.hidden;
  if (!paused && state.phase === "running") {
    lastTs = 0;
    if (rafId == null) startLoop();
  }
});

if (typeof matchMedia === "function") {
  const mq = matchMedia("(prefers-reduced-motion: reduce)");
  const syncMotion = () => {
    reducedMotion = mq.matches;
    if (reducedMotion) particles.length = 0;
  };
  if (mq.addEventListener) mq.addEventListener("change", syncMotion);
  else if (mq.addListener) mq.addListener(syncMotion);
}

el.sound?.addEventListener("change", () => {
  if (el.sound.checked) ensureAudio();
});

// Boot
render();
setBackgroundInert(true);
el.start?.focus();
