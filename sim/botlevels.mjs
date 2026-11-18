#!/usr/bin/env node
// 전투 봇 난이도끼리 맞붙여 승률을 본다 (리그전).
//
//   node sim/botlevels.mjs                     결투 · 난투장, 짝마다 600판
//   node sim/botlevels.mjs --games 1000 --formats duel
//
// 결투: 두 자리를 번갈아 맡는다. 난투장: 4자리 중 두 자리씩 나눠 맡고 자리를 돌린다 (점수 = 1위 1, 2위 2/3, 3위 1/3, 4위 0).
// 덱은 무작위 중반 덱. 레이팅은 결투 결과로 매긴 Elo 비슷한 값 (보통 = 1000).
// 결과는 sim/out/botlevels_*.csv 에도 저장한다.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as E from '../engine/index.js';
import { round, pct, writeCsv, parseArgs } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const GAMES = Number(args.games || 600);
const SEED = Number(args.seed || 1);
const OUT = path.resolve(args.out || path.join(path.dirname(fileURLToPath(import.meta.url)), 'out'));
const FORMATS = args.formats && args.formats !== true ? String(args.formats).split(',') : ['duel', 'melee4'];
const LEVELS = Object.keys(E.BOT_LEVELS);
const NAMES = Object.fromEntries(LEVELS.map((k) => [k, E.BOT_LEVELS[k].name || k]));
const t0 = Date.now();

function play(format, a, b, g) {
  const n = format === 'duel' ? 2 : 4;
  const seed = E.hashSeed(SEED, 'levels', format, a, b, g);
  const rng = E.makeRng(seed);
  const cs = Array.from({ length: n }, () => rng.pick(E.COMMANDER_IDS));
  const decks = cs.map((c) => E.randomMidDeck(c, rng));
  const isA = (p) => (format === 'duel' ? p === g % 2 : (p + g) % 4 < 2);
  const { state } = E.runFieldBattle({
    seed, format, battlefield: rng.pick([null, ...E.BATTLEFIELD_IDS]),
    players: cs.map((commander, p) => ({ commander, deck: decks[p], bot: E.BOT_LEVELS[isA(p) ? a : b] })),
  });
  const r = state.result;
  let pts = 0;
  let seats = 0;
  for (let p = 0; p < n; p++) {
    if (!isA(p)) continue;
    seats++;
    pts += n === 2 ? (r.winner === -1 ? 0.5 : r.winner === p ? 1 : 0) : (n - 1 - r.ranks[p]) / (n - 1);
  }
  return pts / seats;
}

const rows = [];
const duel = {};
for (const format of FORMATS) {
  for (let i = 0; i < LEVELS.length; i++) {
    for (let j = i + 1; j < LEVELS.length; j++) {
      const a = LEVELS[i];
      const b = LEVELS[j];
      let s = 0;
      for (let g = 0; g < GAMES; g++) s += play(format, a, b, g);
      const wr = s / GAMES;
      rows.push({ 형식: format === 'duel' ? '결투' : '난투장', 위: NAMES[a], 아래: NAMES[b], '위의 승점(%)': pct(wr), 오차: round(196 * Math.sqrt((wr * (1 - wr)) / GAMES), 1) });
      if (format === 'duel') duel[`${a}|${b}`] = wr;
    }
  }
  console.error(`${format} 끝 (${((Date.now() - t0) / 1000).toFixed(0)}초)`);
}

console.log(`\n━━ 난이도끼리 (짝마다 ${GAMES}판, 무작위 중반 덱) ━━`);
console.table(rows);
writeCsv(path.join(OUT, 'botlevels_pairs.csv'), rows);

if (Object.keys(duel).length) {
  // 결투 결과로 레이팅: 기대 승률 1 / (1 + 10^((Rb - Ra)/400))에 맞춰 반복해서 고친다
  const R = Object.fromEntries(LEVELS.map((k) => [k, 1000]));
  for (let it = 0; it < 2000; it++) {
    for (const [key, wr] of Object.entries(duel)) {
      const [a, b] = key.split('|');
      const w = Math.min(0.99, Math.max(0.01, wr));
      const exp = 1 / (1 + 10 ** ((R[b] - R[a]) / 400));
      const step = 4 * (w - exp);
      R[a] += step;
      R[b] -= step;
    }
    const shift = 1000 - R.normal;
    for (const k of LEVELS) R[k] += shift;
  }
  const ratings = LEVELS.map((k) => ({ 난이도: NAMES[k], 레이팅: Math.round(R[k]), '보통 상대 기대 승률(%)': pct(1 / (1 + 10 ** ((R.normal - R[k]) / 400))) }));
  console.log('\n━━ 결투 레이팅 (보통 = 1000) ━━');
  console.table(ratings);
  writeCsv(path.join(OUT, 'botlevels_ratings.csv'), ratings);
}
console.log(`${((Date.now() - t0) / 1000).toFixed(1)}초. CSV: ${OUT}`);
