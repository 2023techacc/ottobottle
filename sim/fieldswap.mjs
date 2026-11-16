#!/usr/bin/env node
// 유닛 소환 전투: 카드 하나의 힘을 형식별로 잰다 ("넣어 보기" 실험).
//
// 덱에 있을 때 승률(sim/field.mjs)은 지휘관의 시작 덱과 섞여 있다 (쥐 떼는 상인 덱에 많다).
// 여기서는 무작위 중반 덱끼리 붙이되, 한 자리의 덱에서만 카드 2장을 빼고 재려는 카드 2장을 넣는다.
// 자리에 따른 유불리가 없으므로 그 자리의 승률이 기대 승률에서 벗어난 만큼이 그 카드의 효과다.
//
//   node sim/fieldswap.mjs                     유닛 9종, 형식마다 1500판씩 (난투장은 2배)
//   node sim/fieldswap.mjs --games 3000
//   node sim/fieldswap.mjs --cards rats,shield --copies 2
//   node sim/fieldswap.mjs --formats melee4 --rules "{\"killScore\":0}"
//
// 결과는 sim/out/field_swap.csv 에도 저장한다.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as E from '../engine/index.js';
import { round, pct, writeCsv, parseArgs } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const GAMES = Number(args.games || 1500);
const SEED = Number(args.seed || 1);
const COPIES = Number(args.copies || 2);
const OUT = path.resolve(args.out || path.join(path.dirname(fileURLToPath(import.meta.url)), 'out'));
const CARD_IDS = args.cards && args.cards !== true ? String(args.cards).split(',') : Object.keys(E.Field.FIELD_STATS);
const ALL_FORMATS = { duel: { n: 2, name: '결투', mult: 1 }, melee4: { n: 4, name: '난투장', mult: 2 }, alliance: { n: 4, name: '연합전', mult: 1 } };
const FORMATS = args.formats && args.formats !== true
  ? Object.fromEntries(String(args.formats).split(',').map((k) => [k, ALL_FORMATS[k]]))
  : ALL_FORMATS;
const RULES = args.rules ? JSON.parse(args.rules) : {};
const t0 = Date.now();

/** 덱에서 지휘관 고유 카드가 아닌 카드 몇 장을 빼고 id를 그만큼 넣는다 */
function swapIn(deck, id, copies, rng) {
  const out = [...deck];
  for (let k = 0; k < copies; k++) {
    const removable = out.map((c, i) => i).filter((i) => !E.CARDS[out[i].id].commanderCard && out[i].id !== id);
    if (!removable.length) break;
    out.splice(rng.pick(removable), 1);
  }
  for (let k = 0; k < copies; k++) out.push({ id, stars: 1, fuse: null });
  return out;
}

const rows = [];
for (const id of CARD_IDS) {
  const def = E.CARDS[id];
  const row = { 카드: def.name, 마나: def.cost, 종류: def.ranged ? '원거리' : '근접' };
  for (const [format, f] of Object.entries(FORMATS)) {
    const games = GAMES * f.mult;
    let pts = 0;
    let fair = 0;
    for (let i = 0; i < games; i++) {
      // 카드가 달라도 같은 대진을 쓴다 (비교할 때 잡음이 줄어든다)
      const seed = E.hashSeed(SEED, 'swap', format, i);
      const rng = E.makeRng(seed);
      const cs = Array.from({ length: f.n }, () => rng.pick(E.COMMANDER_IDS));
      const decks = cs.map((c) => E.randomMidDeck(c, rng));
      const seat = i % f.n;
      decks[seat] = swapIn(decks[seat], id, COPIES, rng);
      const { state } = E.runFieldBattle({
        seed, format, rules: RULES, battlefield: rng.pick([null, ...E.BATTLEFIELD_IDS]),
        players: cs.map((commander, p) => ({ commander, deck: decks[p] })),
      });
      const teams = new Set(state.players.map((P) => P.team)).size;
      fair = 1 / teams;
      const w = state.result.winnerTeam;
      pts += w === -1 ? fair : w === state.players[seat].team ? 1 : 0;
    }
    const wr = pts / games;
    row[`${f.name}_승률`] = pct(wr);
    row[`${f.name}_지수`] = Math.round((wr / fair) * 100);
    row[`${f.name}_오차`] = Math.round((196 * Math.sqrt((wr * (1 - wr)) / games)) / fair);
  }
  rows.push(row);
  console.error(`${def.name} 끝 (${((Date.now() - t0) / 1000).toFixed(0)}초)`);
}

console.log(`\n━━ 카드 ${COPIES}장을 넣었을 때 그 자리의 승률 (지수 = 승률 ÷ 기대 × 100. 기대: 결투·연합전 50%, 난투장 25%) ━━`);
console.table(rows.map((r) => {
  const out = { 카드: r.카드, 마나: r.마나, 종류: r.종류 };
  for (const f of Object.values(FORMATS)) out[f.name] = `${r[`${f.name}_지수`]} ±${r[`${f.name}_오차`]}`;
  return out;
}));
writeCsv(path.join(OUT, 'field_swap.csv'), rows);
console.log(`${round((Date.now() - t0) / 1000, 1)}초. CSV: ${OUT}`);
