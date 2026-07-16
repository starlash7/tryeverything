# Friday Deploy Simulator

A 12-second code-review game built with the open-source Grok Build coding
agent. Approve safe diffs, reject cursed ones, and keep production alive.

[Play on GitHub Pages](https://starlash7.github.io/tryeverything/)

## Run locally

```bash
python3 -m http.server 4173 --bind 127.0.0.1
```

Open `http://127.0.0.1:4173/`.

## Test

```bash
node --test game.test.mjs ui.test.mjs
```

The game uses plain HTML, CSS, JavaScript, and Canvas. It has no framework,
backend, runtime AI, analytics, or external assets.

## Grok Build record

Grok Build `0.2.101` was installed from the official xAI installer and used
through subscription OAuth. This project used three accepted Grok Build
prompts: the initial plan-only brief, a test-driven engine slice, and the UI
integration. Human-guided TDD and browser review followed; this was not a
one-prompt build.

Measured implementation window: 46 minutes from the first failing test at
15:00:56 KST to the fresh local Node, browser, and video verification at
15:47:17 KST on July 16, 2026.

Initial prompt, sent verbatim:

```text
Build a polished single-screen browser game called "Friday Deploy Simulator"
using only HTML, CSS, and vanilla JavaScript. A 12-second round shows one-line
code diffs; players Approve safe changes and Reject dangerous ones while
production health, latency, errors, and pager alerts escalate. Use a Grok
Build-inspired terminal plus a production telemetry rail, responsive
desktop/mobile controls, no external assets, no backend, and no runtime AI.
Keep core game logic deterministic and testable. Add reduced-motion support
and a shareable result. Do not add a framework or dependencies.
```

Follow-up record:

1. Implement only the first failing Node test slice in `game.mjs`, including
   the fixed 8-safe/8-dangerous diff pool and deterministic seed.
2. Build `index.html`, `styles.css`, and `app.mjs` over the tested engine with
   the approved industrial terminal/telemetry direction and accessibility
   requirements.
3. The generated work was reviewed and corrected for test coverage, mobile
   header overflow, start-state timing, modal focus isolation, health colors,
   and popup-safe X sharing.

Grok Build is the open-source coding-agent harness and TUI; the model weights
are not included in this repository. See
[xai-org/grok-build](https://github.com/xai-org/grok-build).

## X post

```text
Grok Build is open-source, so I turned Friday deploy anxiety into a game.

Production did not survive my code review.
```

First reply details: playable link, source, 3 accepted Grok Build prompts, and
a 46-minute measured implementation window.
