#!/usr/bin/env node
// 전투 봇이 카드를 제대로 쓰는지 본다. 카드마다 손에 들어온 뒤 어떻게 됐는지 센다.
//
//   node sim/botcheck.mjs                       결투·난투장·연합전 각 600판 (경기 안의 전투처럼 stakes)
//   node sim/botcheck.mjs --format duel --games 2000
//
// 열 설명
//   낸_비율       손에 들어온 카드 중 낸 것
//   버림          다시 뽑기로 버린 것
//   끝까지        전투가 끝날 때까지 손에 남은 것
//   대기(초)      낸 카드가 손에 들어와서 나갈 때까지 걸린 평균 시간
//   묵힘          "마나도 있고 낼 곳도 있는데 안 낸" 시간 ÷ 손에 있던 시간.
//                 높으면 봇이 그 카드를 쓸 때를 잘 모르는 것이다 (일부러 아끼는 카드도 높게 나온다)

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as E from '../engine/index.js';
import { Tally, round, pct, writeCsv, parseArgs } from './lib.mjs';

const F = E.Field;
const args = parseArgs(process.argv.slice(2));
const GAMES = Number(args.games || 600);
const SEED = Number(args.seed || 1);
const OUT = path.resolve(args.out || path.join(path.dirname(fileURLToPath(import.meta.url)), 'out'));
const SEATS = { duel: 2, melee4: 4, alliance: 4 };
const NAMES = { duel: '결투', melee4: '난투장', alliance: '연합전' };
const FORMATS = !args.format || args.format === true ? ['duel', 'melee4', 'alliance'] : String(args.format).split(',');
const t0 = Date.now();

const cards = new Tally();
const overall = [];

for (const format of FORMATS) {
  const n = SEATS[format];
  let capped = 0;
  let ticks = 0;
  for (let g = 0; g < GAMES; g++) {
    const seed = E.hashSeed(SEED, 'botcheck', format, g);
    const rng = E.makeRng(seed);
    const cs = Array.from({ length: n }, () => rng.pick(E.COMMANDER_IDS));
    const decks = cs.map((c) => E.randomMidDeck(c, rng));
    // 손패 추적: uid → { id, since, idle }
    const held = cs.map(() => new Map());
    const redraws = cs.map(() => 0);
    const close = (p, uid, how, now) => {
      const h = held[p].get(uid);
      held[p].delete(uid);
      cards.add(h.id, { seen: 1, [how]: 1, heldMs: now - h.since, idleMs: h.idle, waitMs: how === 'played' ? now - h.since : 0 });
    };
    const { state } = E.runFieldBattle({
      seed, format, stakes: true, battlefield: rng.pick([null, ...E.BATTLEFIELD_IDS]),
      players: cs.map((commander, p) => ({ commander, deck: decks[p] })),
      onTick: (s) => {
        const dt = s.rules.tickMs;
        s.players.forEach((P, p) => {
          if (P.dead) return;
          ticks++;
          if (P.mana >= P.maxMana) capped++;
          const now = s.timeMs;
          const inHand = new Set(P.hand.map((c) => c.uid));
          const redrew = P.stats.redraws > redraws[p];
          redraws[p] = P.stats.redraws;
          for (const uid of [...held[p].keys()]) {
            if (inHand.has(uid)) continue;
            const wasRedrawn = redrew && P.discard.length && P.discard[P.discard.length - 1].uid === uid;
            close(p, uid, wasRedrawn ? 'redrawn' : 'played', now);
          }
          for (const c of P.hand) {
            if (!held[p].has(c.uid)) held[p].set(c.uid, { id: c.id, since: now, idle: 0 });
            const h = held[p].get(c.uid);
            if (F.effectiveCost(s, p, c) <= P.mana && F.legalTargets(s, p, c.uid).length) h.idle += dt;
          }
        });
      },
    });
    state.players.forEach((P, p) => {
      for (const uid of [...held[p].keys()]) close(p, uid, 'kept', state.timeMs);
    });
  }
  overall.push({ 형식: NAMES[format], 판: GAMES, 마나_가득_찬_시간: pct(capped / ticks) });
}

console.log(`\n━━ 봇 점검 (${FORMATS.map((f) => NAMES[f]).join('·')} 각 ${GAMES}판, 무작위 중반 덱) ━━`);
console.table(overall);

const rows = cards.entries().map(([id, r]) => {
  const def = E.CARDS[id];
  return {
    카드: def.name, 종류: def.type === 'unit' ? '유닛' : '주문', 비용: def.cost, 뽑힘: r.seen,
    낸_비율: pct((r.played || 0) / r.seen), 버림: pct((r.redrawn || 0) / r.seen), 끝까지: pct((r.kept || 0) / r.seen),
    '대기(초)': round((r.waitMs || 0) / Math.max(1, r.played || 0) / 1000, 1),
    묵힘: pct((r.idleMs || 0) / Math.max(1, r.heldMs)),
  };
}).sort((a, b) => parseFloat(a.낸_비율) - parseFloat(b.낸_비율));
console.table(rows);
writeCsv(path.join(OUT, 'botcheck_cards.csv'), rows);
console.log(`\n${((Date.now() - t0) / 1000).toFixed(1)}초. CSV: ${OUT}`);
