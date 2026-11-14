#!/usr/bin/env node
// 선봉을 없앤 규칙에서 "시작 카드 고르기"와 "상점 레벨 보상"을 재 본다.
//
//   node sim/opening.mjs                 전부
//   node sim/opening.mjs --only picks    시작 카드를 몇 장 고르게 할지
//   node sim/opening.mjs --only policy   무엇을 고르느냐가 승패에 얼마나 반영되는지
//   node sim/opening.mjs --only bonus    레벨 보상 후보(시작 마나, 마나 최대치, 시작 손패, 고르는 장수)의 값
//   --games 1500
//
// 결과는 sim/out/opening_*.csv 에도 저장한다.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as E from '../engine/index.js';
import { evaluate, skill, leadHold } from './tune.mjs';
import { randomMatch, score, Tally, round, pct, ci95, writeCsv, parseArgs } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const GAMES = Number(args.games || 1500);
const SEED = Number(args.seed || 1);
const ONLY = args.only ? String(args.only).split(',') : null;
const want = (name) => !ONLY || ONLY.includes(name);
const OUT = path.resolve(args.out || path.join(path.dirname(fileURLToPath(import.meta.url)), 'out'));
const t0 = Date.now();

/** 선봉 없는 기준 규칙. --rules 로 덮어쓸 수 있다. */
const BASE = { ...E.PRESETS.cards.rules, ...(args.rules ? JSON.parse(args.rules) : {}) };
console.log('기준 규칙:', JSON.stringify(BASE));

const show = (title, rows, file) => {
  console.log(`\n━━ ${title} ━━`);
  console.table(rows);
  writeCsv(path.join(OUT, file), rows);
};

/** 같은 덱을 양쪽에 쥐여 주고 A쪽만 조건을 바꿔서 A의 승률을 잰다. 자리는 번갈아 앉힌다. */
function mirrorDuel(n, rules, sideA, sideB = {}) {
  let pts = 0;
  for (let i = 0; i < n; i++) {
    const rng = E.makeRng(E.hashSeed(SEED, 'mirror', i));
    const commander = rng.pick(E.COMMANDER_IDS);
    const deck = E.randomMidDeck(commander, rng);
    const seatA = i % 2;
    const players = [];
    players[seatA] = { commander, deck, ...sideA };
    players[1 - seatA] = { commander, deck, ...sideB };
    const { result } = E.runBattle({ seed: E.hashSeed(SEED, 'mirror', i), players, rules });
    pts += score(result, seatA);
  }
  return { rate: pct(pts / n), ci: ci95(pts / n, n) };
}

// ─────────────────────────────────────────────────────────────
// 1. 시작 카드를 몇 장 고르게 할까
// ─────────────────────────────────────────────────────────────
if (want('picks')) {
  const rows = [];
  for (const n of [0, 1, 2, 3, 4]) {
    const rules = { ...BASE, openingPicks: n };
    const m = evaluate(rules, GAMES);
    const [h5, h10] = leadHold(rules, Math.min(GAMES, 800));
    const cards = new Tally();
    const cmds = new Tally();
    for (let i = 0; i < GAMES; i++) {
      const cfg = randomMatch(E.hashSeed(SEED, 'tune', i), { rules });
      const { result } = E.runBattle(cfg);
      for (let p = 0; p < 2; p++) {
        const s = score(result, p);
        cmds.add(cfg.players[p].commander, { n: 1, pts: s });
        for (const id of new Set(cfg.players[p].deck.map((c) => c.id))) cards.add(id, { n: 1, pts: s });
      }
    }
    const cr = cards.entries().map(([id, r]) => [E.CARDS[id].name, pct(r.pts / r.n)]).sort((a, b) => b[1] - a[1]);
    const mr = cmds.entries().map(([id, r]) => [E.COMMANDERS[id].name, pct(r.pts / r.n)]).sort((a, b) => b[1] - a[1]);
    rows.push({
      고르는_장수: n,
      길이_중앙값: m.len_median, 길이_p10: m.len_p10, '40초_채움': m.timeout_pct,
      최고유닛_우위: m.vanguard_edge, '5초_우세_승률': h5, '10초_우세_승률': h10, 판단봇_승률: skill(rules),
      낸_카드: m.cards_played, 큰카드: m.big_plays,
      카드_승률폭: round(cr[0][1] - cr[cr.length - 1][1], 1),
      최강_카드: cr.slice(0, 2).map((x) => x.join(' ')).join(' / '),
      지휘관_승률폭: round(mr[0][1] - mr[mr.length - 1][1], 1),
      최강_지휘관: mr[0].join(' '),
    });
  }
  show(`시작 카드를 몇 장 고르게 할까 (장수마다 ${GAMES}판, 봇은 "3마나 안에서 가장 센 유닛부터" 고른다)`, rows, 'opening_picks.csv');
}

// ─────────────────────────────────────────────────────────────
// 2. 무엇을 고르느냐가 얼마나 중요한가
// ─────────────────────────────────────────────────────────────
if (want('policy')) {
  const names = { tempo: '3마나 안에서 가장 센 유닛', cheap: '싼 유닛부터', big: '가장 센 유닛(비용 무시)', curve: '1·2·3마나 유닛 하나씩', ops: '운영 카드부터' };
  const rows = [];
  for (const n of [1, 2, 3]) {
    const rules = { ...BASE, openingPicks: n };
    for (const [policy, label] of Object.entries(names)) {
      const r = mirrorDuel(GAMES, rules, { openingPolicy: policy }, { openingPolicy: 'random' });
      rows.push({ 고르는_장수: n, 고르는_방식: label, '무작위로_고른_상대에게_승률': r.rate, 오차: r.ci });
    }
    const none = mirrorDuel(GAMES, rules, { openingPolicy: 'tempo' }, { openingPolicy: 'none' });
    rows.push({ 고르는_장수: n, 고르는_방식: '(참고) 안 고른 상대에게', '무작위로_고른_상대에게_승률': none.rate, 오차: none.ci });
  }
  show(`무엇을 고르느냐의 값 (같은 덱, 조합마다 ${GAMES}판)`, rows, 'opening_policy.csv');
}

// ─────────────────────────────────────────────────────────────
// 3. 상점 레벨 보상 후보: 한쪽만 받았을 때 승률
// ─────────────────────────────────────────────────────────────
if (want('bonus')) {
  const variants = [
    ['시작 마나 +1', { startMana: 1 }],
    ['시작 마나 +2', { startMana: 2 }],
    ['마나 최대치 +1', { maxMana: 1 }],
    ['마나 최대치 +2', { maxMana: 2 }],
    ['시작 손패 +1장', { startHand: 1 }],
    ['시작 손패 +2장', { startHand: 2 }],
    ['고르는 시작 카드 +1장', { openingPicks: 1 }],
    ['고르는 시작 카드 +2장', { openingPicks: 2 }],
    ['시작 마나 +1 · 최대치 +1', { startMana: 1, maxMana: 1 }],
    ['시작 마나 +1 · 고르는 카드 +1', { startMana: 1, openingPicks: 1 }],
  ];
  const rows = variants.map(([label, bonus]) => {
    const r = mirrorDuel(GAMES, BASE, { bonus });
    return { 한쪽만_받는_보상: label, 받은_쪽_승률: r.rate, 오차: r.ci, '유리함(%p)': round(r.rate - 50, 1) };
  });
  // 비교 기준: 예전 방식(무료 선봉 1칸)을 한쪽만 가졌을 때
  const van = mirrorDuel(GAMES, { ...BASE, vanguardSlots: 1 }, {}, { vanguard: [] });
  rows.push({ 한쪽만_받는_보상: '(참고) 무료 선봉 1칸', 받은_쪽_승률: van.rate, 오차: van.ci, '유리함(%p)': round(van.rate - 50, 1) });
  const van3 = mirrorDuel(GAMES, { ...BASE, vanguardSlots: 1, vanguardMaxCost: 3 }, {}, { vanguard: [] });
  rows.push({ 한쪽만_받는_보상: '(참고) 무료 선봉 1칸, 3마나 이하', 받은_쪽_승률: van3.rate, 오차: van3.ci, '유리함(%p)': round(van3.rate - 50, 1) });
  show(`상점 레벨 보상 후보의 값 (같은 덱, 한쪽만 보상, 후보마다 ${GAMES}판)`, rows, 'opening_bonus.csv');
}

console.log(`\n${((Date.now() - t0) / 1000).toFixed(1)}초. CSV: ${OUT}`);
