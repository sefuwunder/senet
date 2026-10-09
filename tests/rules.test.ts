// Tests for the senet rules engine (pure logic, no DOM / no three.js).
import { test, expect } from "bun:test";
import {
  newGame, pawnAt, borneOff, castSticks, legalMoves, applyMove,
  nextTurn, aiChooseMove, squareXZ, EXTRA_TURNS,
} from "../public/rules.js";

const pawn = (game, player, n = 0) =>
  game.pawns.filter((p) => p.player === player)[n];

test("setup: alternating pawns on squares 1..10", () => {
  const g = newGame();
  expect(g.pawns.length).toBe(10);
  for (let s = 1; s <= 10; s++) {
    const p = pawnAt(g, s);
    expect(p).toBeTruthy();
    expect(p.player).toBe(s % 2 === 1 ? "coral" : "gold");
  }
  expect(g.turn).toBe("gold");
});

test("sticks: values 1..5, faces match lights", () => {
  for (let i = 0; i < 200; i++) {
    const r = castSticks();
    expect(r.faces.length).toBe(4);
    const lights = r.faces.filter(Boolean).length;
    expect(r.value).toBe(lights === 0 ? 5 : lights);
    expect(r.value).toBeGreaterThanOrEqual(1);
    expect(r.value).toBeLessThanOrEqual(5);
  }
  expect(EXTRA_TURNS.has(1) && EXTRA_TURNS.has(4) && EXTRA_TURNS.has(5)).toBe(true);
  expect(EXTRA_TURNS.has(2) || EXTRA_TURNS.has(3)).toBe(false);
});

test("basic move + swap", () => {
  const g = newGame();
  // gold pawn on 2, throw 1 → 3 (coral) → swap
  const moves = legalMoves(g, "gold", 1);
  const m = moves.find((m) => m.from === 2);
  expect(m).toBeTruthy();
  expect(m.to).toBe(3);
  expect(m.swap?.player).toBe("coral");
  const ev = applyMove(g, m);
  expect(pawnAt(g, 3).player).toBe("gold");
  expect(pawnAt(g, 2).player).toBe("coral");
  expect(ev.some((e) => e.t === "swap")).toBe(true);
});

test("own pawn blocks", () => {
  const g = newGame();
  // gold on 2 and 4; throw 2 from 2 → 4 blocked
  const moves = legalMoves(g, "gold", 2);
  expect(moves.some((m) => m.from === 2)).toBe(false);
});

test("Beauty (26) cannot be jumped over", () => {
  const g = newGame();
  const p = pawn(g, "gold");
  p.square = 24;
  // clear 25..30 of enemies for the test
  g.pawns.forEach((q) => { if (q.square >= 25) q.square = 0; });
  expect(legalMoves(g, "gold", 3).some((m) => m.from === 24)).toBe(false); // 24+3=27 jumps 26
  expect(legalMoves(g, "gold", 2).some((m) => m.from === 24 && m.to === 26)).toBe(true);
});

test("Water (27) sends pawn back to 15", () => {
  const g = newGame();
  const p = pawn(g, "gold");
  p.square = 26; // 26 cannot be jumped over, so the water is reached from 26
  g.pawns.forEach((q) => { if (q !== p && q.square >= 15 && q.square <= 27) q.square = 0; });
  const m = legalMoves(g, "gold", 1).find((m) => m.from === 26);
  expect(m?.to).toBe(27);
  const ev = applyMove(g, m);
  expect(p.square).toBe(15);
  expect(ev.some((e) => e.t === "water")).toBe(true);
});

test("exact landing on 30 bears off; overshoot illegal", () => {
  const g = newGame();
  const p = pawn(g, "gold");
  p.square = 28;
  g.pawns.forEach((q) => { if (q !== p && q.square >= 28) q.square = 0; });
  expect(legalMoves(g, "gold", 3).some((m) => m.from === 28)).toBe(false); // 31 > 30
  const m = legalMoves(g, "gold", 2).find((m) => m.from === 28);
  expect(m?.bearsOff).toBe(true);
  applyMove(g, m);
  expect(p.square).toBe(0);
  expect(borneOff(g, "gold")).toBe(1);
});

test("houses 26+ are safe from swapping", () => {
  const g = newGame();
  const gp = pawn(g, "gold"); gp.square = 24;
  const cp = pawn(g, "coral"); cp.square = 26;
  g.pawns.forEach((q) => { if (q !== gp && q !== cp && q.square >= 24) q.square = 0; });
  expect(legalMoves(g, "gold", 2).some((m) => m.from === 24)).toBe(false);
});

test("extra turn on 1/4/5, switch otherwise", () => {
  const g = newGame();
  expect(nextTurn(g, 4)).toBe("gold");
  expect(g.extraTurn).toBe(true);
  expect(nextTurn(g, 2)).toBe("coral");
  expect(g.extraTurn).toBe(false);
});

test("win when all 5 borne off", () => {
  const g = newGame();
  const golds = g.pawns.filter((p) => p.player === "gold");
  golds.forEach((p, i) => { p.square = i < 4 ? 0 : 29; });
  g.pawns.forEach((p) => { if (p.player === "coral") p.square = 0; });
  const m = legalMoves(g, "gold", 1).find((m) => m.from === 29);
  const ev = applyMove(g, m);
  expect(g.winner).toBe("gold");
  expect(ev.some((e) => e.t === "win")).toBe(true);
});

test("AI always picks a legal move", () => {
  for (let i = 0; i < 50; i++) {
    const g = newGame();
    const v = 1 + Math.floor(Math.random() * 5);
    const m = aiChooseMove(g, "coral", v);
    const legal = legalMoves(g, "coral", v);
    if (legal.length === 0) expect(m).toBeNull();
    else expect(legal.some((l) => l.pawn === m.pawn && l.from === m.from && l.to === m.to)).toBe(true);
  }
});

test("squareXZ: S-track layout", () => {
  const a = squareXZ(1), b = squareXZ(10), c = squareXZ(11), d = squareXZ(20), e = squareXZ(21), f = squareXZ(30);
  expect(a.x).toBeLessThan(b.x); // row 0 left→right
  expect(c.x).toBeGreaterThan(d.x); // row 1 right→left
  expect(e.x).toBeLessThan(f.x); // row 2 left→right
  expect(a.z).toBeLessThan(c.z);
  expect(c.z).toBeLessThan(e.z);
});
