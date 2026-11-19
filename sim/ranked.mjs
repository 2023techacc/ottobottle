#!/usr/bin/env node
// 랭크전 시뮬레이션: 실력(전투 봇 난이도)과 성격이 다른 봇들이 시즌 동안 랭크 경기를 하고, 티어 분포를 본다.
//
//   node sim/ranked.mjs                        8인 랭크, 봇 160명, 25회 (한 사람당 25경기)
//   node sim/ranked.mjs --mode duel --players 200 --sessions 40
//   node sim/ranked.mjs --mix "{\"beginner\":15,\"easy\":30,\"normal\":35,\"hard\":20}"
//
// 성향별 레이팅 재기:
//   node sim/ranked.mjs --level normal                 모두 같은 실력 → 성격·지휘관·상점 성향 차이만 남는다
//   node sim/ranked.mjs --level normal --personas none --commanders main
//                                                      성격 없이, 사람마다 주력 지휘관 하나로 → 지휘관별 레이팅
//   node sim/ranked.mjs --personas rusher,big          이 성격들만
//   --commanders persona  경기마다 성격이 좋아하는 지휘관 (기본, 70%)
//   --commanders main     사람마다 주력 지휘관 하나를 정해 계속 쓴다 (성격이 있으면 성격대로 고른다)
//   --commanders random   경기마다 아무 지휘관
//
// 한 회(session)마다 모두를 레이팅으로 줄 세워 로비를 짜고, 경기를 모두 치른 뒤 레이팅을 고친다.
// 묶음별 "기대 대비 성적"은 경기 전 레이팅으로 기대한 승점과 실제 승점의 차이 (상대 하나하나와 견준 평균, %p).
// 0이면 레이팅만큼 했다는 뜻이고, 이를 레이팅 차로 바꾼 값이 "레이팅 환산"이다 (그 묶음이 평균보다 몇 점 센가).
// 결과는 sim/out/ranked_*.csv 에도 저장한다.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as E from '../engine/index.js';
import { round, pct, writeCsv, parseArgs } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const MODE = args.mode || 'rank8';
const SIZE = E.MODES[MODE].players;
const PLAYERS = Number(args.players || (MODE === 'duel' ? 200 : 160));
const SESSIONS = Number(args.sessions || (MODE === 'duel' ? 40 : 25));
const SEED = Number(args.seed || 1);
const MIX = args.level ? { [args.level]: 1 } : args.mix ? JSON.parse(args.mix) : { beginner: 15, easy: 30, normal: 35, hard: 20 };
const PERSONA_POOL = args.personas === 'none' ? [null] : args.personas && args.personas !== true ? String(args.personas).split(',') : E.PERSONA_IDS;
const COMMANDERS = args.commanders || 'persona'; // persona | main | random
for (const id of Object.keys(MIX)) if (!E.BOT_LEVELS[id]) throw new Error(`모르는 난이도: ${id}`);
for (const id of PERSONA_POOL) if (id && !E.PERSONAS[id]) throw new Error(`모르는 성격: ${id}`);
if (!['persona', 'main', 'random'].includes(COMMANDERS)) throw new Error(`--commanders는 persona, main, random 중 하나`);
const OUT = path.resolve(args.out || path.join(path.dirname(fileURLToPath(import.meta.url)), 'out'));
const LEVEL_IDS = Object.keys(E.BOT_LEVELS);
const t0 = Date.now();

const rng = E.makeRng(E.hashSeed(SEED, 'ranked', MODE));
function pickWeighted(weights) {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let x = rng() * total;
  for (const [k, w] of Object.entries(weights)) {
    x -= w;
    if (x < 0) return k;
  }
  return Object.keys(weights)[0];
}

// 봇 선수들: 실력(난이도)·성격·주력 지휘관은 시즌 내내 그대로
const pool = Array.from({ length: PLAYERS }, (_, i) => {
  const persona = rng.pick(PERSONA_POOL);
  const main = persona ? E.personaCommander(rng, persona, E.COMMANDER_IDS) : rng.pick(E.COMMANDER_IDS);
  return { id: i, level: pickWeighted(MIX), persona, main, rating: E.RANKED.start, games: 0, wins: 0, history: [] };
});
const styleOf = (b) => (b.persona ? E.PERSONAS[b.persona].shop : 'balanced');
const personaName = (id) => (id ? E.PERSONAS[id].name : '성격 없음');

/** 이번 경기의 지휘관 */
function commanderFor(b, r) {
  if (COMMANDERS === 'main') return b.main;
  if (COMMANDERS === 'random' || !b.persona) return r.pick(E.COMMANDER_IDS);
  return E.personaCommander(r, b.persona, E.COMMANDER_IDS);
}

// 묶음별 기록: 경기마다 참가자 한 명이 한 줄 (배치 경기는 빼고 센다. 레이팅이 아직 자리를 못 잡아서)
const groups = { level: new Map(), persona: new Map(), commander: new Map(), style: new Map() };
function record(kind, key, rec) {
  const g = groups[kind];
  const x = g.get(key) || { n: 0, perf: 0, place: 0, first: 0, top: 0, delta: 0 };
  x.n++;
  x.perf += rec.perf;
  x.place += rec.place;
  x.first += rec.place === 1 ? 1 : 0;
  x.top += rec.place <= SIZE / 2 ? 1 : 0;
  x.delta += rec.delta;
  g.set(key, x);
}

/** 한 경기를 끝까지 돌려 자리마다 순위를 돌려준다 */
function playMatch(seed, entrants) {
  const r = E.makeRng(E.hashSeed(seed, 'setup'));
  const econ = { ...E.DEFAULT_ECON, ...E.MODES[MODE].econ };
  const players = entrants.map((b) => ({ persona: b.persona, commander: commanderFor(b, r), picks: E.botPicks(r, econ, b.persona) }));
  const game = E.createGame({ seed, players, mode: MODE });
  for (const P of game.players) E.runDraftBot(game, P.idx);
  while (game.phase !== 'over' && game.round < 120) {
    for (const p of E.shopBotOrder(game)) E.runShopBot(game, p, { level: entrants[p].level });
    const battles = E.assignBattleBots(game, E.roundBattles(game), (p) => entrants[p].level).map((b) => ({ ...b, state: E.runRoundBattle(b).state }));
    E.finishRound(game, battles);
  }
  return { places: game.players.map((P) => P.place), commanders: game.players.map((P) => P.commander) };
}

const swings = [];
for (let s = 0; s < SESSIONS; s++) {
  const lobbies = E.matchmake(pool, SIZE, rng);
  let moved = 0;
  lobbies.forEach((ids, li) => {
    const entrants = ids.map((i) => pool[i]);
    const { places, commanders } = playMatch(E.hashSeed(SEED, 'match', s, li), entrants);
    const before = entrants.map((b) => b.rating);
    const deltas = E.rateMatch(before, places, entrants.map((b) => b.games));
    entrants.forEach((b, k) => {
      if (b.games >= E.RANKED.placementGames) {
        // 기대 대비 성적: 상대 하나하나와 견준 (실제 − 기대)의 평균
        let perf = 0;
        entrants.forEach((o, j) => {
          if (j === k) return;
          const actual = places[k] < places[j] ? 1 : places[k] === places[j] ? 0.5 : 0;
          perf += actual - E.expectedScore(before[k], before[j]);
        });
        const rec = { perf: perf / (SIZE - 1), place: places[k], delta: deltas[k] };
        record('level', b.level, rec);
        record('persona', b.persona, rec);
        record('commander', commanders[k], rec);
        record('style', styleOf(b), rec);
      }
      b.rating = Math.max(E.RANKED.floor, b.rating + deltas[k]);
      b.games++;
      if (places[k] === 1) b.wins++;
      moved += Math.abs(deltas[k]);
    });
  });
  swings.push(moved / Math.max(1, lobbies.length * SIZE));
  for (const b of pool) b.history.push(b.rating);
  if ((s + 1) % 5 === 0) console.error(`${s + 1}/${SESSIONS}회 (${((Date.now() - t0) / 1000).toFixed(0)}초)`);
}

const tierRows = E.TIERS.map((t) => {
  const inTier = pool.filter((b) => E.tierOf(b.rating).id === t.id);
  const row = { 티어: t.name, 레이팅: Number.isFinite(t.min) ? `${t.min}~` : '~', 인원: inTier.length, 비율: pct(inTier.length / PLAYERS) };
  for (const lv of LEVEL_IDS) row[E.BOT_LEVELS[lv].name] = inTier.filter((b) => b.level === lv).length;
  return row;
});
const levelRows = LEVEL_IDS.filter((lv) => pool.some((b) => b.level === lv)).map((lv) => {
  const xs = pool.filter((b) => b.level === lv).map((b) => b.rating).sort((a, b) => a - b);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const tiers = {};
  for (const r of xs) tiers[E.tierOf(r).name] = (tiers[E.tierOf(r).name] || 0) + 1;
  const main = Object.entries(tiers).sort((a, b) => b[1] - a[1])[0];
  return { 난이도: E.BOT_LEVELS[lv].name, 인원: xs.length, 평균_레이팅: Math.round(mean), 최저: xs[0], 중앙값: xs[Math.floor(xs.length / 2)], 최고: xs[xs.length - 1], 가장_많은_티어: `${main[0]} (${pct(main[1] / xs.length)}%)` };
});
const personaRows = PERSONA_POOL.map((id) => {
  const xs = pool.filter((b) => b.persona === id);
  if (!xs.length) return null;
  return { 성격: personaName(id), 인원: xs.length, 평균_레이팅: Math.round(xs.reduce((a, b) => a + b.rating, 0) / xs.length), 난이도_보통이상: pct(xs.filter((b) => b.level === 'normal' || b.level === 'hard').length / xs.length) };
}).filter(Boolean);
const mainRows = COMMANDERS === 'main' ? E.COMMANDER_IDS.map((id) => {
  const xs = pool.filter((b) => b.main === id);
  if (!xs.length) return null;
  return { 주력_지휘관: E.COMMANDERS[id].name, 인원: xs.length, 평균_레이팅: Math.round(xs.reduce((a, b) => a + b.rating, 0) / xs.length) };
}).filter(Boolean) : [];

/** 기대 대비 성적을 레이팅 차로 바꾼다: 평균 상대를 이길 확률이 0.5 + perf일 때의 레이팅 차 */
const toRating = (perf) => {
  const p = Math.min(0.99, Math.max(0.01, 0.5 + perf));
  return Math.round(400 * Math.log10(p / (1 - p)));
};
const STYLE_NAMES = { eco: '저축형', balanced: '균형형', spend: '소비형' };
const LABEL = {
  level: (k) => E.BOT_LEVELS[k].name, persona: personaName, commander: (k) => E.COMMANDERS[k].name, style: (k) => STYLE_NAMES[k] || k,
};
const groupRows = (kind) => [...groups[kind].entries()].map(([k, x]) => {
  const perf = x.perf / x.n;
  const err = 1.96 * 0.5 / Math.sqrt(x.n); // 기대 대비 성적의 대략적인 오차
  return {
    구분: LABEL[kind](k), 경기: x.n, 평균_순위: round(x.place / x.n, 2), '1위(%)': pct(x.first / x.n), '상위_절반(%)': pct(x.top / x.n),
    '기대_대비(%p)': round(perf * 100, 1), '오차(%p)': round(err * 100, 1), 레이팅_환산: toRating(perf), 경기당_레이팅_변화: round(x.delta / x.n, 1),
  };
}).sort((a, b) => b['기대_대비(%p)'] - a['기대_대비(%p)']);
const swingRows = swings.map((v, i) => ({ 회: i + 1, '한 경기 평균 변화': round(v, 1) })).filter((r) => r.회 === 1 || r.회 % 5 === 0);

console.log(`\n━━ ${E.MODES[MODE].name} 랭크전: 봇 ${PLAYERS}명 × ${SESSIONS}경기 (난이도 ${JSON.stringify(MIX)} · 성격 ${PERSONA_POOL.map(personaName).join('/')} · 지휘관 ${COMMANDERS}) ━━`);
console.log('\n티어 분포 (마지막 레이팅)');
console.table(tierRows);
console.log('\n난이도별');
console.table(levelRows);
console.log('\n성격별 (마지막 레이팅)');
console.table(personaRows);
if (mainRows.length) {
  console.log('\n주력 지휘관별 (마지막 레이팅)');
  console.table(mainRows);
}
console.log('\n━━ 성향별 기대 대비 성적 (배치 10경기 뒤의 경기만. 레이팅 환산 = 평균보다 몇 점 센가) ━━');
const groupNames = { level: '실력(난이도)', persona: '성격', commander: '이번 경기 지휘관', style: '상점 성향' };
const allGroupRows = [];
for (const kind of Object.keys(groups)) {
  if (groups[kind].size < 2) continue;
  const rows = groupRows(kind);
  console.log(`\n${groupNames[kind]}`);
  console.table(rows);
  for (const r of rows) allGroupRows.push({ 묶음: groupNames[kind], ...r });
}
console.log('\n레이팅이 자리 잡는 속도');
console.table(swingRows);
writeCsv(path.join(OUT, `ranked_${MODE}_tiers.csv`), tierRows);
writeCsv(path.join(OUT, `ranked_${MODE}_levels.csv`), levelRows);
writeCsv(path.join(OUT, `ranked_${MODE}_personas.csv`), personaRows);
writeCsv(path.join(OUT, `ranked_${MODE}_groups.csv`), allGroupRows);
console.log(`\n${((Date.now() - t0) / 1000).toFixed(1)}초. CSV: ${OUT}`);
