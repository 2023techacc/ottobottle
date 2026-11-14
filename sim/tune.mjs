#!/usr/bin/env node
// 전투 길이를 목표(30~45초)에 맞추는 규칙 수치를 찾는다.
//
//   node sim/tune.mjs --stage sweep     수치를 하나씩 바꿔 영향 보기
//   node sim/tune.mjs --stage grid      조합 탐색 (점수순 상위 출력)
//   node sim/tune.mjs --stage report    프리셋(engine/rules.js의 PRESETS) 상세 비교
//   --games 600   조합당 판 수
//
// 결과는 sim/out/tune_*.csv 에도 저장한다.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as E from '../engine/index.js';
import { randomMatch, score, PaceStats, Tally, round, pct, writeCsv, parseArgs } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
// 다른 스크립트가 evaluate 등을 가져다 쓸 때는 아래 실험을 돌리지 않는다
const IS_MAIN = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const STAGE = IS_MAIN ? args.stage || 'sweep' : 'none';
const GAMES = Number(args.games || 600);
const SEED = Number(args.seed || 1);
const OUT = path.resolve(args.out || path.join(path.dirname(fileURLToPath(import.meta.url)), 'out'));
const t0 = Date.now();
let battles = 0;

// 규칙과 상관없이 "덱에서 가장 비싼 유닛"의 값. 선봉 규칙을 바꿔도 같은 기준으로 비교하려고 고정했다.
const vanguardValue = (deck) => {
  const v = E.pickVanguard(deck, 1)[0];
  if (!v) return 0;
  const c = deck[v.index];
  return E.CARDS[c.id].cost * (c.stars || 1);
};

/** 무작위 중반 덱 대전을 n판 돌려 전투 흐름 지표를 낸다. 같은 시드면 대진이 같아서 규칙끼리 바로 비교된다. */
export function evaluate(rules, n = GAMES) {
  const pace = new PaceStats();
  let vanN = 0;
  let vanPts = 0;
  let unitCards = 0;
  let bigPlays = 0;
  for (let i = 0; i < n; i++) {
    const cfg = randomMatch(E.hashSeed(SEED, 'tune', i), { rules });
    const { state, result } = E.runBattle(cfg);
    battles++;
    pace.add(state);
    const v = cfg.players.map((p) => vanguardValue(p.deck));
    if (v[0] !== v[1]) {
      vanN++;
      vanPts += score(result, v[0] > v[1] ? 0 : 1);
    }
    for (const P of state.players) {
      for (const [id, k] of Object.entries(P.stats.plays)) {
        if (E.CARDS[id].type === 'unit') unitCards += k;
        if (E.CARDS[id].cost >= 5) bigPlays += k;
      }
    }
  }
  const s = pace.summary();
  return {
    ...s,
    vanguard_edge: vanN ? pct(vanPts / vanN) : 50,
    big_plays: round(bigPlays / (n * 2), 2),
    units_played: round(unitCards / (n * 2), 1),
  };
}

/** 같은 덱을 쥐여 주고 판단하는 봇이 무작위 봇을 이기는 비율. 실력이 결과에 반영되는 정도를 본다. */
export function skill(rules, n = 400) {
  let a = 0;
  let total = 0;
  for (let seed = 1; seed <= n; seed++) {
    const rng = E.makeRng(E.hashSeed(SEED, 'skill', seed));
    const commander = rng.pick(E.COMMANDER_IDS);
    const deck = E.randomMidDeck(commander, rng);
    const sideA = seed % 2;
    const players = [{ commander, deck }, { commander, deck }];
    players[sideA].bot = { style: 'smart' };
    players[1 - sideA].bot = { style: 'random' };
    const { result } = E.runBattle({ seed, players, rules });
    battles++;
    total++;
    a += score(result, sideA);
  }
  return pct(a / total);
}

/**
 * t초 시점에 보드 유닛 체력 합이 더 큰 쪽이 결국 이기는 비율.
 * 높을수록 초반에 결판이 나고, 낮을수록 역전이 많다.
 */
export function leadHold(rules, n = 600, marks = [5, 10]) {
  const out = marks.map(() => ({ n: 0, pts: 0 }));
  for (let i = 0; i < n; i++) {
    const cfg = randomMatch(E.hashSeed(SEED, 'tune', i), { rules });
    const lead = marks.map(() => null);
    // runBattle을 그대로 써서 선봉·시작 카드 같은 규칙이 다른 실험과 똑같이 적용되게 한다
    const { state } = E.runBattle({
      ...cfg,
      onTick(st) {
        marks.forEach((m, k) => {
          if (lead[k] !== null || st.timeMs < m * 1000) return;
          const hp = [0, 1].map((p) => E.unitsOf(st, p).reduce((sum, u) => sum + u.hp, 0));
          lead[k] = hp[0] === hp[1] ? -1 : hp[0] > hp[1] ? 0 : 1;
        });
      },
    });
    battles++;
    marks.forEach((m, k) => {
      if (lead[k] === null || lead[k] < 0) return;
      out[k].n++;
      out[k].pts += score(state.result, lead[k]);
    });
  }
  return out.map((o) => (o.n ? pct(o.pts / o.n) : 0));
}

/**
 * 목표에서 벗어난 만큼 벌점. 낮을수록 좋다.
 *   길이 중앙값 30~37초, 하위 10%도 20초 이상, 과열 도달 55~90%,
 *   시간 초과 35% 이하, 무승부 3% 이하, 손패 가득 15% 이하, 끝날 때 최대 마나 6.5 이상
 *   (선봉 우위는 어떤 수치에서도 80% 안팎이라 벌점에 넣지 않고 따로 본다)
 */
export function penalty(m) {
  const below = (x, lo, w) => (x < lo ? (lo - x) * w : 0);
  const above = (x, hi, w) => (x > hi ? (x - hi) * w : 0);
  return round(
    below(m.len_median, 30, 2) + above(m.len_median, 37, 2)
    + below(m.len_p10, 20, 1)
    + below(m.overtime_pct, 55, 0.2) + above(m.overtime_pct, 90, 0.3)
    + above(m.timeout_pct, 35, 0.5)
    + above(m.draw_pct, 3, 2)
    + above(m.hand_full_pct, 15, 0.5)
    + below(m.max_mana_end, 6.5, 4),
    1,
  );
}

const cols = (label, value, m) => ({
  [label]: value,
  길이_p10: m.len_p10, 중앙값: m.len_median, p90: m.len_p90,
  과열_도달: m.overtime_pct, 시간초과: m.timeout_pct, 무승부: m.draw_pct,
  낸_카드: m.cards_played, 큰카드: m.big_plays, 손패_가득: m.hand_full_pct, 마나_가득: m.mana_capped_pct,
  끝_최대마나: m.max_mana_end, 선봉_우위: m.vanguard_edge, 벌점: penalty(m),
});

function table(name, label, variants) {
  console.log(`\n━━ ${name} ━━`);
  const rows = variants.map(([value, rules]) => cols(label, value, evaluate(rules)));
  console.table(rows);
  writeCsv(path.join(OUT, `tune_${name.replace(/[^\w가-힣]+/g, '_')}.csv`), rows);
  return rows;
}

// ─────────────────────────────────────────────────────────────
if (STAGE === 'sweep') {
  console.log(`수치를 하나씩 바꿔 보기 (값마다 ${GAMES}판). 선봉_우위 = 덱의 가장 비싼 유닛이 상대보다 비싼 쪽의 승률`);
  table('지휘관 체력', '지휘관_체력', [30, 60, 100, 150, 250, 400].map((v) => [v, { commanderHp: v }]));
  table('유닛 체력 배율', '유닛_체력', [1, 1.5, 2, 3, 4].map((v) => [`×${v}`, { unitHpMult: v }]));
  table('유닛 공격력 배율', '유닛_공격', [1, 0.75, 0.5, 0.35, 0.25].map((v) => [`×${v}`, { unitAtkMult: v }]));
  table('공격 간격 배율', '공격_간격', [1, 1.5, 2, 3].map((v) => [`×${v}`, { attackIntervalMult: v }]));
  table('선봉', '선봉', [
    ['1칸 (기본)', {}],
    ['없음', { vanguardSlots: 0 }],
    ['1칸, 3마나 이하', { vanguardMaxCost: 3 }],
    ['1칸, 2마나 이하', { vanguardMaxCost: 2 }],
  ]);
  table('마나 회복 간격', '마나_간격', [1000, 1500, 2000, 2500].map((v) => [`${v / 1000}초`, { manaIntervalMs: v }]));
  table('시작 마나', '시작_마나', [1, 2, 3, 5].map((v) => [v, { startMana: v }]));
}

// ─────────────────────────────────────────────────────────────
if (STAGE === 'grid') {
  const grid = JSON.parse(args.grid || 'null') || {
    commanderHp: [30, 45, 60],
    unitAtkMult: [1, 0.6, 0.45, 0.35],
    unitHpMult: [1, 1.5],
    vanguardMaxCost: [99, 3],
  };
  const keys = Object.keys(grid);
  let combos = [{}];
  for (const k of keys) combos = combos.flatMap((c) => grid[k].map((v) => ({ ...c, [k]: v })));
  console.log(`조합 탐색: ${combos.length}개 조합 × ${GAMES}판`);
  const rows = combos.map((rules) => {
    const m = evaluate(rules);
    return { ...rules, ...cols('_', '', m) };
  });
  for (const r of rows) delete r._;
  rows.sort((a, b) => a.벌점 - b.벌점);
  console.table(rows.slice(0, Number(args.top || 15)));
  writeCsv(path.join(OUT, 'tune_grid.csv'), rows);
}

// ─────────────────────────────────────────────────────────────
if (STAGE === 'report') {
  const n = Number(args.games || 2000);
  console.log(`프리셋 상세 비교 (프리셋마다 ${n}판 + 실력 반영 400판)`);
  const rows = [];
  for (const [id, preset] of Object.entries(E.PRESETS)) {
    const m = evaluate(preset.rules, n);
    const [hold5, hold10] = leadHold(preset.rules);
    rows.push({
      프리셋: preset.name, ...cols('_', '', m), 평균_손패: m.hand_avg, 낸_유닛: m.units_played,
      판단봇_승률: skill(preset.rules), '5초_우세_승률': hold5, '10초_우세_승률': hold10,
    });
    delete rows[rows.length - 1]._;

    // 카드·지휘관 균형이 어떻게 달라지는지
    const cards = new Tally();
    const cmds = new Tally();
    for (let i = 0; i < n; i++) {
      const cfg = randomMatch(E.hashSeed(SEED, 'tune', i), { rules: preset.rules });
      const { result } = E.runBattle(cfg);
      battles++;
      for (let p = 0; p < 2; p++) {
        const s = score(result, p);
        cmds.add(cfg.players[p].commander, { n: 1, pts: s });
        for (const cid of new Set(cfg.players[p].deck.map((c) => c.id))) cards.add(cid, { n: 1, pts: s });
      }
    }
    const cardRows = cards.entries()
      .map(([cid, r]) => ({ 카드: E.CARDS[cid].name, 마나: E.CARDS[cid].cost, 판수: r.n, 승률: pct(r.pts / r.n) }))
      .sort((a, b) => b.승률 - a.승률);
    const cmdRows = cmds.entries()
      .map(([cid, r]) => ({ 지휘관: E.COMMANDERS[cid].name, 판수: r.n, 승률: pct(r.pts / r.n) }))
      .sort((a, b) => b.승률 - a.승률);
    writeCsv(path.join(OUT, `tune_report_${id}_cards.csv`), cardRows);
    writeCsv(path.join(OUT, `tune_report_${id}_commanders.csv`), cmdRows);
    const spread = (list) => round(Math.max(...list.map((r) => r.승률)) - Math.min(...list.map((r) => r.승률)), 1);
    Object.assign(rows[rows.length - 1], {
      카드_승률폭: spread(cardRows),
      최강_카드: `${cardRows[0].카드} ${cardRows[0].승률}`,
      최약_카드: `${cardRows[cardRows.length - 1].카드} ${cardRows[cardRows.length - 1].승률}`,
      지휘관_승률폭: spread(cmdRows),
      최강_지휘관: `${cmdRows[0].지휘관} ${cmdRows[0].승률}`,
    });
  }
  console.table(rows);
  writeCsv(path.join(OUT, 'tune_report.csv'), rows);

  // 조정안 위에 얹어 볼 만한 추가 변경
  const baseId = args.addon || 'recommended';
  const b = E.PRESETS[baseId].rules;
  console.log(`
━━ ${E.PRESETS[baseId].name} 위에 하나씩 얹어 보기 ━━`);
  const addons = [
    ['(그대로)', {}],
    ['선봉 없음', { vanguardSlots: 0 }],
    ['선봉 3마나 이하', { vanguardMaxCost: 3 }],
    ['마나 최대치 6초마다 +1', { maxManaIntervalMs: 6000 }],
    ['마나 최대치 5초마다 +1', { maxManaIntervalMs: 5000 }],
    ['뽑기 2.5초', { drawIntervalMs: 2500 }],
    ['뽑기 4초', { drawIntervalMs: 4000 }],
    ['손패 최대 5장', { handMax: 5 }],
    ['마나 회복 1.2초', { manaIntervalMs: 1200 }],
    ['마나 회복 2초', { manaIntervalMs: 2000 }],
    ['과열 없음', { overtimeAtkPerSec: 0 }],
    ['전투 50초 · 과열 40초', { battleMs: 50000, overtimeMs: 40000 }],
  ];
  const addRows = addons.map(([label, extra]) => {
    const m = evaluate({ ...b, ...extra }, Math.min(n, 1000));
    return { ...cols('변경', label, m), 평균_손패: m.hand_avg, 다시뽑기: m.redraws };
  });
  console.table(addRows);
  writeCsv(path.join(OUT, `tune_addons_${baseId}.csv`), addRows);
}

if (IS_MAIN) {
  const sec = (Date.now() - t0) / 1000;
  console.log(`\n${battles.toLocaleString()}판, ${sec.toFixed(1)}초`);
}
