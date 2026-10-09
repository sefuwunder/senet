# Senet — a cozy 3D game of the pharaohs

The 5,000-year-old Egyptian race game, reimagined as a bright, cheery, cozy
3D playground where **Zaha Hadid** meets **Frank Gehry**: the S-track board
floats on flowing white parametric ribbons and a sculpted dune, while
crumpled titanium-gold blobs, a rose knot, and a tilting silver tower keep
watch from the sidelines.

## Play

`bun src/server.ts` → http://127.0.0.1:3026 (or `PORT=xxxx`)

You (gold) face a heuristic rival (coral). Cast the four sticks, click a
glowing pawn, race all five pawns off the board. Full rules are in the **?**
panel in-game.

## Architecture notes

- `public/rules.js` — pure game logic (no DOM, no three.js). Imported by the
  UI and by `bun test`. This is where the rules live; tweak here.
- `public/game.js` — three.js scene, animation, audio, UI wiring.
- `public/index.html` — shell + HUD; `public/styles.css` — the cozy chrome.
- three.js r160 loads from the jsDelivr CDN via an import map — the one
  pragmatic dependency (sculptural architecture wants a real renderer).
  Server, rules, and audio are zero-dependency. To play fully offline,
  vendor `three.module.js` + `OrbitControls.js` locally and repoint the map.

## Rules (as implemented)

- 5 pawns each, alternating on squares 1–10. Gold moves first.
- Sticks: 4 lots; light faces count 1–4, all dark = 5. Throws of **1, 4, 5**
  grant another throw.
- Move forward; landing on a rival pawn swaps places; own pawns block.
- **26 House of Beauty** must be landed on — it can't be jumped over.
- **27 House of Water** sends the pawn back to **15 House of Rebirth**.
- **Houses 26–30 are sacred** — no swapping there.
- Land **exactly on 30** to bear a pawn off. First to bear off all five wins.

## Checks

- `bun test` — 12 rules-engine tests.
- `node --check public/game.js` — syntax (it's a module; check parses fine).
- Respects `prefers-reduced-motion` (no auto-orbit, confetti, or tumble).
