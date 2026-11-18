#!/usr/bin/env node
// 랭크전 시뮬레이션: 실력(전투 봇 난이도)과 성격이 다른 봇들이 시즌 동안 랭크 경기를 하고, 티어 분포를 본다.
//
//   node sim/ranked.mjs                        8인 랭크, 봇 160명, 25회 (한 사람당 25경기)
//   node sim/ranked.mjs --mode duel --players 200 --sessions 40
//   node sim/ranked.mjs --mix "{\"beginner\":15,\"easy\":30,\"normal\":35,\"hard\":20}"
//
// 한 회(session)마다 모두를 레이팅으로 줄 세워 로비를 짜고, 경기를 모두 치른 뒤 레이팅을 고친다.
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
const MIX = args.mix ? JSON.parse(args.mix) : { beginner: 15, easy: 30, normal: 35, hard: 20 };
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

// 봇 선수들: 실력(난이도)과 성격은 시즌 내내 그대로
const pool = Array.from({ length: PLAYERS }, (_, i) => ({
  id: i, level: pickWeighted(MIX), persona: rng.pick(E.PERSONA_IDS), rating: E.RANKED.start, games: 0, wins: 0, history: [],
}));

/** 한 경기를 끝까지 돌려 자리마다 순위를 돌려준다 */
function playMatch(seed, entrants) {
  const r = E.makeRng(E.hashSeed(seed, 'setup'));
  const econ = { ...E.DEFAULT_ECON, ...E.MODES[MODE].econ };
  const players = entrants.map((b) => ({ persona: b.persona, commander: E.personaCommander(r, b.persona, E.COMMANDER_IDS), picks: E.botPicks(r, econ, b.persona) }));
  const game = E.createGame({ seed, players, mode: MODE });
  for (const P of game.players) E.runDraftBot(game, P.idx);
  while (game.phase !== 'over' && game.round < 120) {
    for (const p of E.shopBotOrder(game)) E.runShopBot(game, p, {});
    const battles = E.assignBattleBots(game, E.roundBattles(game), (p) => entrants[p].level).map((b) => ({ ...b, state: E.runRoundBattle(b).state }));
    E.finishRound(game, battles);
  }
  return game.players.map((P) => P.place);
}

const swings = [];
for (let s = 0; s < SESSIONS; s++) {
  const lobbies = E.matchmake(pool, SIZE, rng);
  let moved = 0;
  lobbies.forEach((ids, li) => {
    const entrants = ids.map((i) => pool[i]);
    const places = playMatch(E.hashSeed(SEED, 'match', s, li), entrants);
    const deltas = E.rateMatch(entrants.map((b) => b.rating), places, entrants.map((b) => b.games));
    entrants.forEach((b, k) => {
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
const personaRows = E.PERSONA_IDS.map((id) => {
  const xs = pool.filter((b) => b.persona === id);
  if (!xs.length) return null;
  return { 성격: E.PERSONAS[id].name, 인원: xs.length, 평균_레이팅: Math.round(xs.reduce((a, b) => a + b.rating, 0) / xs.length), 난이도_보통이상: pct(xs.filter((b) => b.level === 'normal' || b.level === 'hard').length / xs.length) };
}).filter(Boolean);
const swingRows = swings.map((v, i) => ({ 회: i + 1, '한 경기 평균 변화': round(v, 1) })).filter((r) => r.회 === 1 || r.회 % 5 === 0);

console.log(`\n━━ ${E.MODES[MODE].name} 랭크전: 봇 ${PLAYERS}명 × ${SESSIONS}경기 (난이도 비율 ${JSON.stringify(MIX)}) ━━`);
console.log('\n티어 분포 (마지막 레이팅)');
console.table(tierRows);
console.log('\n난이도별');
console.table(levelRows);
console.log('\n성격별');
console.table(personaRows);
console.log('\n레이팅이 자리 잡는 속도');
console.table(swingRows);
writeCsv(path.join(OUT, `ranked_${MODE}_tiers.csv`), tierRows);
writeCsv(path.join(OUT, `ranked_${MODE}_levels.csv`), levelRows);
writeCsv(path.join(OUT, `ranked_${MODE}_personas.csv`), personaRows);
console.log(`\n${((Date.now() - t0) / 1000).toFixed(1)}초. CSV: ${OUT}`);
