#!/usr/bin/env node
// 유닛 소환 전투를 봇끼리 돌려 전투 흐름을 본다.
//
//   node sim/field.mjs                       결투 2000판
//   node sim/field.mjs --format melee4       형식: duel, melee4(중앙 점령), alliance, ffa(대난투), all(대난투 빼고 셋)
//   node sim/field.mjs --format ffa --players 10 --games 200    대난투는 한 판이 1초쯤 걸린다
//   node sim/field.mjs --games 5000
//   node sim/field.mjs --rules "{\"commanderHp\":30}"
//
// 결과는 sim/out/field_*.csv 에도 저장한다.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as E from '../engine/index.js';
import { Tally, PaceStats, round, pct, ci95, writeCsv, parseArgs } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const GAMES = Number(args.games || 2000);
const SEED = Number(args.seed || 1);
const RULES = args.rules ? JSON.parse(args.rules) : {};
const OUT = path.resolve(args.out || path.join(path.dirname(fileURLToPath(import.meta.url)), 'out'));
const FFA_N = Number(args.players || 8);
const SEATS = { duel: 2, melee4: 4, alliance: 4, ffa: FFA_N };
const NAMES = { duel: '결투 (1:1)', melee4: '난투장 (4인 · 중앙 점령)', alliance: '연합전 (2:2)', ffa: `대난투 (${FFA_N}인)` };
const FORMATS = !args.format || args.format === true ? ['duel'] : args.format === 'all' ? ['duel', 'melee4', 'alliance'] : String(args.format).split(',');
for (const f of FORMATS) {
  if (!SEATS[f]) {
    console.error(`모르는 형식: ${f} (duel, melee4, alliance, ffa, all 중 하나)`);
    process.exit(1);
  }
}
const t0 = Date.now();

/** 이긴 팀에 1점. 승자가 없으면 팀 수로 나눈다. */
function teamScore(state, p) {
  const r = state.result;
  const teams = new Set(state.players.map((P) => P.team)).size;
  if (r.winnerTeam === -1) return 1 / teams;
  return r.winnerTeam === state.players[p].team ? 1 : 0;
}

const MELEE_BUCKETS = [{ name: '0~1장', max: 1 }, { name: '2~3장', max: 3 }, { name: '4~5장', max: 5 }, { name: '6장 이상', max: Infinity }];

function runFormat(format) {
  const n = SEATS[format];
  const pace = new PaceStats();
  const cards = new Tally();
  const cmds = new Tally();
  const comp = new Tally(); // 덱에 든 근접 유닛 카드 장수별
  const seats = new Array(n).fill(0);
  let walked = 0;
  let peakUnits = 0;
  let avgUnits = 0;
  let eliminated = 0;
  let lastOne = 0;
  let fair = 0;
  let noWinner = 0;
  const cap = { early: 0, first: 0, second: 0, inZone: 0, ticks: 0, lead: 0 };
  for (let i = 0; i < GAMES; i++) {
    const seed = E.hashSeed(SEED, 'field', format, i);
    const rng = E.makeRng(seed);
    const cs = Array.from({ length: n }, () => rng.pick(E.COMMANDER_IDS));
    const decks = cs.map((c) => E.randomMidDeck(c, rng));
    let peak = 0;
    let unitSum = 0;
    let unitTicks = 0;
    const { state } = E.runFieldBattle({
      seed, format, rules: RULES, battlefield: rng.pick([null, ...E.BATTLEFIELD_IDS]),
      players: cs.map((commander, p) => ({ commander, deck: decks[p] })),
      onTick: (s) => {
        if (s.units.length > peak) peak = s.units.length;
        unitSum += s.units.length;
        unitTicks++;
        if (s.capture) {
          cap.inZone += s.capture.counts.reduce((a, b) => a + b, 0);
          cap.ticks++;
        }
      },
    });
    pace.add(state);
    if (state.result.winnerTeam === -1) noWinner++;
    if (state.capture) {
      const sc = [...state.result.scores].sort((a, b) => b - a);
      if (state.result.reason === 'capture') cap.early++;
      cap.first += sc[0];
      cap.second += sc[1];
    }
    peakUnits += peak;
    avgUnits += unitSum / Math.max(1, unitTicks);
    eliminated += state.players.filter((P) => P.dead).length;
    if (state.players.filter((P) => !P.dead).length === 1) lastOne++;
    fair = 1 / new Set(state.players.map((P) => P.team)).size;
    for (let p = 0; p < n; p++) {
      const s = teamScore(state, p);
      seats[p] += s;
      walked += state.players[p].stats.walked;
      cmds.add(cs[p], { n: 1, pts: s });
      const melee = decks[p].filter((c) => E.CARDS[c.id].type === 'unit' && !E.CARDS[c.id].ranged).length;
      comp.add(MELEE_BUCKETS.find((b) => melee <= b.max).name, { n: 1, pts: s });
      for (const id of new Set(decks[p].map((c) => c.id))) cards.add(id, { n: 1, pts: s });
      for (const [id, k] of Object.entries(state.players[p].stats.plays)) cards.add(id, { plays: k });
    }
  }

  const s = pace.summary();
  const overall = {
    형식: NAMES[format], 판수: s.games, 길이_p10: s.len_p10, 길이_중앙값: s.len_median, 길이_p90: s.len_p90,
    과열_도달: s.overtime_pct, 시간초과: s.timeout_pct, 승자_없음: pct(noWinner / GAMES),
    낸_카드: s.cards_played, 걸은_거리: round(walked / (GAMES * n), 1), 필드_유닛_최대: round(peakUnits / GAMES, 1), 필드_유닛_평균: round(avgUnits / GAMES, 1),
    탈락_인원: round(eliminated / GAMES, 1), 한_명만_남은_판: pct(lastOne / GAMES),
    평균_손패: s.hand_avg, 손패_가득: s.hand_full_pct, 끝날때_최대마나: s.max_mana_end,
  };
  console.log(`\n━━ 유닛 소환 전투 · ${NAMES[format]} (${GAMES}판, 무작위 중반 덱) ━━`);
  console.table([overall]);
  if (cap.ticks) {
    const capRow = { 목표_점수로_끝난_판: pct(cap.early / GAMES), '1위_점수': round(cap.first / GAMES, 1), '2위_점수': round(cap.second / GAMES, 1), 원_안의_유닛_평균: round(cap.inZone / cap.ticks, 1) };
    console.log('중앙 점령');
    console.table([capRow]);
    Object.assign(overall, capRow);
  }

  const seatRows = seats.map((pts, p) => ({ 형식: NAMES[format], 자리: p, 승률: pct(pts / GAMES), 기대: pct(fair), 오차: ci95(pts / GAMES, GAMES) }));
  console.log('자리별 승률 (같은 팀이면 함께 이긴다)');
  console.table(seatRows);

  const cardRows = cards.entries().map(([id, r]) => {
    const def = E.CARDS[id];
    const fs = E.Field.FIELD_STATS[id];
    return {
      형식: NAMES[format], 카드: def.name, 마나: def.cost, 사거리: fs ? fs.range : '', 속도: fs ? fs.speed : '', 반지름: fs ? fs.radius : '',
      덱에_있던_판: r.n, 승률: pct(r.pts / r.n), 오차: ci95(r.pts / r.n, r.n), 판당_낸_횟수: round((r.plays || 0) / r.n, 2),
    };
  }).sort((a, b) => b.승률 - a.승률);
  console.log(`카드별 (덱에 있을 때 승률, 기대 ${pct(fair)}%)`);
  console.table(cardRows.map(({ 형식, ...row }) => row));

  const cmdRows = cmds.entries().map(([id, r]) => ({ 형식: NAMES[format], 지휘관: E.COMMANDERS[id].name, 판수: r.n, 승률: pct(r.pts / r.n), 오차: ci95(r.pts / r.n, r.n) })).sort((a, b) => b.승률 - a.승률);
  console.log('지휘관별');
  console.table(cmdRows.map(({ 형식, ...row }) => row));
  const compRows = MELEE_BUCKETS.map((b) => ({ r: comp.rows.get(b.name), name: b.name })).filter((x) => x.r)
    .map(({ r, name }) => ({ 형식: NAMES[format], 근접_유닛: name, 판수: r.n, 승률: pct(r.pts / r.n), 오차: ci95(r.pts / r.n, r.n) }));
  return { format, fair, overall, seatRows, cardRows, cmdRows, compRows };
}

const all = FORMATS.map(runFormat);

// 형식끼리 견주기: 기대 승률이 달라서(결투 50%, 난투장 25%) "기대 대비 지수"로 맞춘다. 100이 보통, 120이면 기대보다 20% 더 이긴다.
if (all.length > 1) {
  const index = (row, fair) => Math.round((row.승률 / (fair * 100)) * 100);
  const compare = (rowsOf, nameKey) => {
    const names = [...new Set(all.flatMap((a) => rowsOf(a).map((r) => r[nameKey])))];
    return names.map((name) => {
      const out = { [nameKey]: name };
      const vals = [];
      for (const a of all) {
        const r = rowsOf(a).find((x) => x[nameKey] === name);
        const short = NAMES[a.format].split(' ')[0];
        out[short] = r ? index(r, a.fair) : '';
        out[`${short}_오차`] = r ? Math.round(r.오차 / (a.fair * 100) * 100) : '';
        if (r) vals.push(out[short]);
      }
      out.최대_차이 = vals.length ? Math.max(...vals) - Math.min(...vals) : '';
      return out;
    });
  };
  const byGap = (x, y) => y.최대_차이 - x.최대_차이;
  const cardCmp = compare((a) => a.cardRows, '카드').sort(byGap).map((r) => ({ ...r, 종류: (() => { const d = Object.values(E.CARDS).find((c) => c.name === r.카드); return d ? (d.type === 'unit' ? (d.ranged ? '원거리' : '근접') : '주문 등') : ''; })() }));
  console.log('\n━━ 형식별 카드 지수 (승률 ÷ 기대 승률 × 100, 덱에 있을 때) ━━');
  console.table(cardCmp);
  const cmdCmp = compare((a) => a.cmdRows, '지휘관').sort(byGap);
  console.log('━━ 형식별 지휘관 지수 ━━');
  console.table(cmdCmp);
  writeCsv(path.join(OUT, 'field_compare_cards.csv'), cardCmp);
  const compCmp = compare((a) => a.compRows, '근접_유닛');
  console.log('━━ 덱에 든 근접 유닛 카드 장수별 지수 ━━');
  console.table(compCmp);
  writeCsv(path.join(OUT, 'field_compare_commanders.csv'), cmdCmp);
  writeCsv(path.join(OUT, 'field_compare_melee.csv'), compCmp);
}
const tag = FORMATS.length === 1 ? `_${FORMATS[0]}` : '';
writeCsv(path.join(OUT, `field${tag}_overall.csv`), all.map((a) => a.overall));
writeCsv(path.join(OUT, `field${tag}_seats.csv`), all.flatMap((a) => a.seatRows));
writeCsv(path.join(OUT, `field${tag}_cards.csv`), all.flatMap((a) => a.cardRows));
writeCsv(path.join(OUT, `field${tag}_commanders.csv`), all.flatMap((a) => a.cmdRows));
console.log(`\n${((Date.now() - t0) / 1000).toFixed(1)}초. CSV: ${OUT}`);
