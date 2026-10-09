// senet — pure game rules (no DOM, no three.js). Shared by the UI and the tests.
//
// Board: 30 squares in an S-track. Row 0: squares 1..10 left→right,
// row 1: 11..20 right→left, row 2: 21..30 left→right.
//
// Setup: 5 pawns each, alternating on squares 1..10 (odd = "coral"/AI, even = "gold"/player).
// Sticks: 4 two-sided lots; lights count 1..4, all-dark = 5. Throws of 1, 4, 5 grant another turn.
// A pawn moves forward by the throw. Landing on an enemy pawn swaps places.
// Own pawns block; squares 26+ are houses of the gods (safe from swapping).
// 26 (Beauty) must be landed on exactly — it cannot be jumped over.
// 27 (Water) sends the pawn back to 15 (swapping with any occupant).
// Landing exactly on 30 bears the pawn off the board. First to bear off all 5 wins.

export const PLAYERS = ["gold", "coral"];
export const PAWNS_EACH = 5;
export const LAST = 30;
export const BEAUTY = 26;
export const WATER = 27;
export const REBIRTH = 15;
export const EXTRA_TURNS = new Set([1, 4, 5]);

export function newGame() {
  // pawns: [{player, square}] — square 0 means borne off
  const pawns = [];
  for (let i = 0; i < PAWNS_EACH; i++) {
    pawns.push({ player: "coral", square: 2 * i + 1 });
    pawns.push({ player: "gold", square: 2 * i + 2 });
  }
  return { pawns, turn: "gold", winner: null, lastThrow: null, extraTurn: false };
}

export function pawnAt(game, square) {
  if (square < 1 || square > LAST) return null;
  return game.pawns.find((p) => p.square === square) || null;
}

export function borneOff(game, player) {
  return game.pawns.filter((p) => p.player === player && p.square === 0).length;
}

/** Roll the four sticks. Returns {lights, value}. */
export function castSticks(rng = Math.random) {
  let lights = 0;
  const faces = [];
  for (let i = 0; i < 4; i++) {
    const light = rng() < 0.5;
    faces.push(light);
    if (light) lights++;
  }
  return { faces, value: lights === 0 ? 5 : lights };
}

/** All legal pawn indices for `player` given a throw value. */
export function legalMoves(game, player, value) {
  const moves = [];
  game.pawns.forEach((p, idx) => {
    if (p.player !== player || p.square === 0) return;
    const from = p.square;
    const to = from + value;
    if (to > LAST) return; // must land exactly on 30
    if (from < BEAUTY && to > BEAUTY) return; // Beauty must be landed on
    const occ = pawnAt(game, to);
    if (occ && occ.player === player) return; // own pawn blocks
    if (occ && to >= BEAUTY) return; // houses of the gods are safe
    moves.push({ pawn: idx, from, to, swap: occ ? occ : null, bearsOff: to === LAST });
  });
  return moves;
}

/**
 * Apply a chosen move. Returns an event list describing what happened
 * (for animation / narration), e.g. [{t:"move",...},{t:"swap",...},{t:"water",...},{t:"bearoff",...}].
 */
export function applyMove(game, move) {
  const events = [];
  const p = game.pawns[move.pawn];
  const from = p.square;
  events.push({ t: "move", pawn: move.pawn, player: p.player, from, to: move.to });

  if (move.swap) {
    const q = game.pawns.indexOf(move.swap);
    game.pawns[q].square = from;
    events.push({ t: "swap", pawn: q, player: move.swap.player, from: move.to, to: from });
  }
  if (move.to === WATER) {
    // House of Water → back to the House of Rebirth, swapping with any occupant
    const occ = pawnAt(game, REBIRTH);
    p.square = REBIRTH;
    events.push({ t: "water", pawn: move.pawn, player: p.player, to: REBIRTH });
    if (occ) {
      const q = game.pawns.indexOf(occ);
      game.pawns[q].square = from;
      events.push({ t: "swap", pawn: q, player: occ.player, from: REBIRTH, to: from });
    }
  } else if (move.to === LAST) {
    p.square = 0;
    events.push({ t: "bearoff", pawn: move.pawn, player: p.player });
  } else {
    p.square = move.to;
  }

  if (borneOff(game, p.player) === PAWNS_EACH) {
    game.winner = p.player;
    events.push({ t: "win", player: p.player });
  }
  return events;
}

/** Advance the turn, honoring extra throws. Returns the next player. */
export function nextTurn(game, value) {
  if (EXTRA_TURNS.has(value) && !game.winner) {
    game.extraTurn = true;
    return game.turn; // same player throws again
  }
  game.extraTurn = false;
  game.turn = game.turn === "gold" ? "coral" : "gold";
  return game.turn;
}

/** Simple heuristic AI: pick the best legal move. */
export function aiChooseMove(game, player, value, rng = Math.random) {
  const moves = legalMoves(game, player, value);
  if (!moves.length) return null;
  let best = null, bestScore = -Infinity;
  for (const m of moves) {
    let s = rng() * 2; // tiebreak jitter
    if (m.bearsOff) s += 1000;
    if (m.to === BEAUTY) s += 60;
    if (m.to === WATER) s -= 250; // avoid the drink
    if (m.swap) s += 40 + m.swap.square * 2; // bumping advanced enemies is tasty
    if (m.from >= BEAUTY && !m.bearsOff) s -= 50; // don't leave safe houses
    s += m.to * 0.6; // prefer progress
    if (s > bestScore) { bestScore = s; best = m; }
  }
  return best;
}

/** Square → board coordinates. Returns {x, z} in tile units. */
export function squareXZ(square, step = 1.14) {
  const n = square - 1;
  const row = Math.floor(n / 10);
  const i = n % 10;
  const x = (row % 2 === 0 ? i - 4.5 : 4.5 - i) * step;
  const z = (row - 1) * step;
  return { x, z };
}
