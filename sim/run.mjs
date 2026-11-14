#!/usr/bin/env node
// 봇 대 봇 대량 시뮬레이션.
//
//   node sim/run.mjs                      전부 실행 (실험당 2000판)
//   node sim/run.mjs --games 10000        판 수 바꾸기
//   node sim/run.mjs --only cards,pace    일부 실험만
//   node sim/run.mjs --seed 7 --out sim/out
//   node sim/run.mjs --rules '{"commanderHp":60}'   규칙 수치를 바꿔서 전체 실행
//
// 결과는 표로 출력하고 CSV로도 저장한다.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as E from '../engine/index.js';
import { randomMatch, score, Tally, PaceStats, round, pct, ci95, writeCsv, parseArgs } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const GAMES = Number(args.games || 2000);
const SEED = Number(args.seed || 1);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(args.out || path.join(HERE, 'out'));
const BASE_RULES = args.rules ? JSON.parse(args.rules) : {};
const ONLY = args.only ? String(args.only).split(',') : null;
const want = (name) => !ONLY || ONLY.includes(name);

const t0 = Date.now();
let totalBattles = 0;
const battle = (cfg) => {
  totalBattles++;
  return E.runBattle({ ...cfg, rules: { ...BASE_RULES, ...(cfg.rules || {}) } });
};
const title = (s) => console.log(`\n━━ ${s} ━━`);

// ─────────────────────────────────────────────────────────────
// 1. 지휘관 시작 덱끼리
// ─────────────────────────────────────────────────────────────
if (want('commanders')) {
  title(`지휘관 시작 덱 상성 (조합당 ${Math.max(40, Math.round(GAMES / 5))}판, 자리 바꿔 가며)`);
  const ids = E.COMMANDER_IDS;
  const perPair = Math.max(40, Math.round(GAMES / 5));
  const rows = [];
  const total = new Tally();
  const table = {};
  for (const a of ids) {
    table[E.COMMANDERS[a].name] = {};
    for (const b of ids) {
      let pts = 0;
      const pace = new PaceStats();
      for (let i = 0; i < perPair; i++) {
        const seat = i % 2;
        const players = [];
        players[seat] = { commander: a, deck: E.startDeck(a) };
        players[1 - seat] = { commander: b, deck: E.startDeck(b) };
        const { state, result } = battle({ seed: E.hashSeed(SEED, 'cmd', a, b, i), players });
        pts += score(result, seat);
        pace.add(state);
      }
      const wr = pts / perPair;
      const sum = pace.summary();
      rows.push({ 지휘관: E.COMMANDERS[a].name, 상대: E.COMMANDERS[b].name, 판수: perPair, 승률: pct(wr), 전투길이_중앙값: sum.len_median, 시간초과: sum.timeout_pct });
      table[E.COMMANDERS[a].name][E.COMMANDERS[b].name] = pct(wr);
      if (a !== b) total.add(a, { pts, n: perPair });
    }
  }
  for (const [a, r] of total.entries()) table[E.COMMANDERS[a].name]['전체'] = pct(r.pts / r.n);
  console.table(table);
  writeCsv(path.join(OUT, 'commanders.csv'), rows);
}

// ─────────────────────────────────────────────────────────────
// 2. 카드별 승률 (무작위 중반 덱)
// ─────────────────────────────────────────────────────────────
if (want('cards')) {
  const n = GAMES * 2;
  title(`카드별 승률 (무작위 중반 덱 ${n}판)`);
  const cards = new Tally();
  const cmds = new Tally();
  const vans = new Tally();
  const fields = new Map();
  const pace = new PaceStats();
  for (let i = 0; i < n; i++) {
    const cfg = randomMatch(E.hashSeed(SEED, 'cards', i));
    const { state, result } = battle(cfg);
    pace.add(state);
    const key = cfg.battlefield || 'none';
    if (!fields.has(key)) fields.set(key, new PaceStats());
    fields.get(key).add(state);
    for (let p = 0; p < 2; p++) {
      const s = score(result, p);
      cmds.add(cfg.players[p].commander, { n: 1, pts: s });
      const v = E.pickVanguard(cfg.players[p].deck, state.rules.vanguardSlots)[0];
      if (v) {
        const vc = cfg.players[p].deck[v.index];
        vans.add(E.CARDS[vc.id].name + '★'.repeat(vc.stars - 1), { n: 1, pts: s });
      }
      const inDeck = new Set(cfg.players[p].deck.map((c) => c.id));
      for (const id of inDeck) cards.add(id, { decks: 1, deckPts: s });
      const plays = state.players[p].stats.plays;
      for (const [id, k] of Object.entries(plays)) cards.add(id, { plays: k, playedGames: 1, playedPts: s });
      for (const c of cfg.players[p].deck) {
        if (c.stars > 1) cards.add(c.id, { starred: 1 });
        if (c.fuse) cards.add(c.id, { fused: 1 });
      }
    }
  }

  const cardRows = cards.entries().map(([id, r]) => {
    const def = E.CARDS[id];
    const wrDeck = r.decks ? r.deckPts / r.decks : 0;
    const wrPlayed = r.playedGames ? r.playedPts / r.playedGames : 0;
    return {
      카드: def.name,
      종류: { unit: '유닛', spell: '주문', buff: '강화', ops: '운영' }[def.type],
      등급: def.tier,
      마나: def.cost,
      덱에_있던_판: r.decks || 0,
      덱에_있을_때_승률: pct(wrDeck),
      오차: ci95(wrDeck, r.decks || 0),
      낸_판: r.playedGames || 0,
      냈을_때_승률: pct(wrPlayed),
      판당_낸_횟수: round((r.plays || 0) / Math.max(1, r.decks || 0), 2),
    };
  }).sort((a, b) => b.덱에_있을_때_승률 - a.덱에_있을_때_승률);
  console.table(cardRows);
  writeCsv(path.join(OUT, 'cards.csv'), cardRows);

  title('지휘관별 승률 (무작위 중반 덱)');
  const cmdRows = cmds.entries().map(([id, r]) => ({
    지휘관: E.COMMANDERS[id].name, 판수: r.n, 승률: pct(r.pts / r.n), 오차: ci95(r.pts / r.n, r.n),
  })).sort((a, b) => b.승률 - a.승률);
  console.table(cmdRows);
  writeCsv(path.join(OUT, 'commanders_mid.csv'), cmdRows);

  title('선봉으로 나간 카드별 승률');
  const vanRows = vans.entries().map(([name, r]) => ({
    선봉: name, 판수: r.n, 승률: pct(r.pts / r.n), 오차: ci95(r.pts / r.n, r.n),
  })).sort((a, b) => b.승률 - a.승률);
  console.table(vanRows);
  writeCsv(path.join(OUT, 'vanguard.csv'), vanRows);

  title('전장별 전투 흐름');
  const fieldRows = [...fields.entries()].map(([id, ps]) => {
    const s = ps.summary();
    return {
      전장: id === 'none' ? '(없음)' : E.BATTLEFIELDS[id].name, 판수: s.games,
      길이_중앙값: s.len_median, 길이_p90: s.len_p90, 시간초과: s.timeout_pct, 낸_카드: s.cards_played,
    };
  }).sort((a, b) => a.길이_중앙값 - b.길이_중앙값);
  console.table(fieldRows);
  writeCsv(path.join(OUT, 'battlefields.csv'), fieldRows);

  title('전체 전투 흐름');
  console.table([pace.summary()]);
  writeCsv(path.join(OUT, 'overall.csv'), [pace.summary()]);
}

// ─────────────────────────────────────────────────────────────
// 3. 규칙 수치 바꿔 보기
// ─────────────────────────────────────────────────────────────
function sweep(name, label, variants, baseRules = {}) {
  const rows = [];
  for (const v of variants) {
    const pace = new PaceStats();
    for (let i = 0; i < GAMES; i++) {
      // 같은 시드를 써서 모든 값이 같은 대진으로 비교되게 한다
      const cfg = randomMatch(E.hashSeed(SEED, 'sweep', i), { rules: { ...baseRules, ...v.rules } });
      pace.add(battle(cfg).state);
    }
    const s = pace.summary();
    rows.push({
      [label]: v.label,
      길이_p10: s.len_p10, 길이_중앙값: s.len_median, 길이_p90: s.len_p90,
      과열_도달: s.overtime_pct, 시간초과: s.timeout_pct,
      낸_카드: s.cards_played, 다시뽑기: s.redraws,
      평균_손패: s.hand_avg, 손패_가득: s.hand_full_pct, 마나_가득: s.mana_capped_pct, 끝날때_최대마나: s.max_mana_end,
    });
  }
  console.table(rows);
  writeCsv(path.join(OUT, `${name}.csv`), rows);
  return rows;
}

if (want('pace')) {
  title(`지휘관 체력에 따른 전투 길이 (값마다 ${GAMES}판) — 목표 30~45초`);
  sweep('pace_commander_hp', '지휘관_체력', [30, 45, 60, 80, 100, 150].map((hp) => ({ label: hp, rules: { commanderHp: hp } })));
}

if (want('rules')) {
  for (const hp of [30, 100]) {
    const base = { commanderHp: hp };
    title(`자동 뽑기 간격 (지휘관 체력 ${hp}, 값마다 ${GAMES}판)`);
    sweep(`rules_draw_hp${hp}`, '뽑기_간격(초)', [2000, 3000, 4000].map((ms) => ({ label: ms / 1000, rules: { drawIntervalMs: ms } })), base);
    title(`손패 최대 장수 (지휘관 체력 ${hp})`);
    sweep(`rules_hand_hp${hp}`, '손패_최대', [5, 7, 9].map((n) => ({ label: n, rules: { handMax: n } })), base);
    title(`마나 회복 간격 (지휘관 체력 ${hp})`);
    sweep(`rules_mana_hp${hp}`, '마나_간격(초)', [1000, 1500, 2000].map((ms) => ({ label: ms / 1000, rules: { manaIntervalMs: ms } })), base);
  }
  title('선봉 칸 수 (지휘관 체력 30)');
  sweep('rules_vanguard', '선봉_칸', [0, 1, 2, 3].map((n) => ({ label: n, rules: { vanguardSlots: n } })));
}

const sec = (Date.now() - t0) / 1000;
console.log(`\n${totalBattles.toLocaleString()}판, ${sec.toFixed(1)}초 (초당 ${Math.round(totalBattles / sec).toLocaleString()}판). CSV: ${OUT}`);
