#!/usr/bin/env node
// 봇끼리 한 경기(상점 + 전투 반복)를 여러 번 돌려 경기 흐름을 본다.
//
//   node sim/match.mjs                      1:1 경기 300판
//   node sim/match.mjs --mode rank8         8인 경기 60판
//   node sim/match.mjs --games 1000
//   node sim/match.mjs --econ "{\"playerHp\":60}"     경제 수치를 바꿔서
//   node sim/match.mjs --spy-info on        첩보원 봇이 상대 시작 카드를 보고 미리 돌려 본다 (6~7배 느리다)
//   node sim/match.mjs --levels             플레이어마다 전투 봇 난이도를 무작위로 (난이도별 순위를 본다)
//   node sim/match.mjs --personas           플레이어마다 봇 성격을 무작위로 (지휘관·상점 성향도 성격을 따른다. 성격별 순위를 본다)
//
// 결과는 sim/out/match_<모드>_*.csv 에도 저장한다.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as E from '../engine/index.js';
import { Tally, percentile, round, pct, ci95, writeCsv, parseArgs } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const MODE = args.mode || 'duel';
const N = E.MODES[MODE].players;
const GAMES = Number(args.games || (MODE === 'duel' ? 300 : 60));
const SEED = Number(args.seed || 1);
const ECON = args.econ ? JSON.parse(args.econ) : {};
const SPY_INFO = args['spy-info'] === 'on'; // --spy-info on: 첩보원 봇이 상대 시작 카드를 보고 미리 돌려 본다 (느리다)
const LEVELS = args.levels ? Object.keys(E.BOT_LEVELS) : null; // --levels: 플레이어마다 난이도를 무작위로
const PERSONAS = args.personas ? E.PERSONA_IDS : null; // --personas: 플레이어마다 성격을 무작위로
const OUT = path.resolve(args.out || path.join(path.dirname(fileURLToPath(import.meta.url)), 'out'));
const STYLES = Object.keys(E.SHOP_STYLES);
const FORMAT_NAMES = { practice: '연습', duel: '결투', melee4: '난투장', alliance: '연합전', boss: '보스 레이드' };
const t0 = Date.now();

function playGame(seed) {
  const rng = E.makeRng(E.hashSeed(seed, 'setup'));
  const econ = { ...E.DEFAULT_ECON, ...E.MODES[MODE].econ, ...ECON };
  const players = Array.from({ length: N }, () => {
    if (!PERSONAS) return { commander: rng.pick(E.COMMANDER_IDS), picks: E.botPicks(rng, econ) };
    const persona = rng.pick(PERSONAS);
    return { persona, commander: E.personaCommander(rng, persona, E.COMMANDER_IDS), picks: E.botPicks(rng, econ, persona) };
  });
  // 성격이 있으면 상점 성향도 성격을 따른다 (styles[p]가 null이면 상점 봇이 성격의 성향을 쓴다)
  const styles = players.map((pc) => (pc.persona ? null : rng.pick(STYLES)));
  const levels = players.map(() => (LEVELS ? rng.pick(LEVELS) : 'normal'));
  const game = E.createGame({ seed, players, mode: MODE, econ: ECON });
  for (const P of game.players) E.runDraftBot(game, P.idx);
  const perRound = [];
  const formats = [];
  let battleMs = 0;
  while (game.phase !== 'over' && game.round < 120) {
    for (const p of E.shopBotOrder(game)) E.runShopBot(game, p, { style: styles[p], spyInfo: SPY_INFO });
    perRound.push(game.players.map((P) => ({ alive: P.alive, level: P.level, gold: P.gold, deck: P.deck.length, hp: P.hp })));
    // 플레이어(와 그 유령)는 자기 난이도·성격으로 싸운다. 중립 몬스터·보스는 그대로
    const battles = E.assignBattleBots(game, E.roundBattles(game), (p) => levels[p]).map((b) => ({ ...b, state: E.runRoundBattle(b).state }));
    const s = E.finishRound(game, battles);
    const longest = Math.max(...s.results.map((r) => r.timeMs));
    battleMs += longest;
    formats.push({ format: s.format, ms: longest, damage: s.results.reduce((a, r) => a + r.damage, 0), sides: s.results.length });
  }
  return { game, styles, levels, perRound, battleMs, formats };
}

const rounds = [];
const minutes = [];
const firstOut = [];
const cmds = new Tally();
const styleTally = new Tally();
const levelTally = new Tally();
const personaTally = new Tally();
const cardBuys = new Tally();
const byRound = new Tally();
const byFormat = new Tally();
const sum = { level: 0, deck: 0, stars: 0, fused: 0, gold: 0, rerolls: 0, xp: 0, removed: 0, winnerHp: 0, comebacks: 0, seat0: 0, draws: 0 };

for (let i = 0; i < GAMES; i++) {
  const { game, styles, levels, perRound, battleMs, formats } = playGame(E.hashSeed(SEED, 'game', i));
  rounds.push(game.round);
  minutes.push((game.round * game.econ.shopSeconds * 1000 + battleMs) / 60000);
  const outs = game.players.filter((P) => P.eliminatedRound).map((P) => P.eliminatedRound);
  if (outs.length) firstOut.push(Math.min(...outs));
  if (game.winner === -1) sum.draws++;
  if (game.winner === 0) sum.seat0++;
  game.players.forEach((P, p) => {
    // 승점: 1위 1점 … 꼴찌 0점 (1:1에서는 승 1, 패 0과 같다)
    const pts = game.winner === -1 && N === 2 ? 0.5 : (N - P.place) / (N - 1);
    const row = { n: 1, pts, place: P.place, first: P.place === 1 ? 1 : 0, top: P.place <= N / 2 ? 1 : 0 };
    cmds.add(P.commander, row);
    if (styles[p]) styleTally.add(styles[p], row);
    if (P.persona) personaTally.add(P.persona, row);
    if (LEVELS) levelTally.add(levels[p], row);
    sum.level += P.level;
    sum.deck += P.deck.length;
    sum.stars += P.deck.filter((c) => c.stars > 1).length;
    sum.fused += P.deck.filter((c) => c.fuse).length;
    sum.gold += P.gold;
    sum.rerolls += P.stats.rerolls;
    sum.xp += P.stats.xpBought;
    sum.removed += P.stats.removed;
    for (const [id, k] of Object.entries(P.stats.bought)) cardBuys.add(id, { bought: k, games: 1, pts });
  });
  if (game.winner >= 0) {
    sum.winnerHp += game.players[game.winner].hp;
    // 역전: 한때 HP가 최고보다 maxHp의 25% 이상 뒤졌던 쪽이 이긴 경기
    const gap = game.econ.playerHp * 0.25;
    if (perRound.some((r) => Math.max(...r.map((x) => x.hp)) - r[game.winner].hp >= gap)) sum.comebacks++;
  }
  perRound.forEach((r, k) => {
    for (const s of r) if (s.alive) byRound.add(k + 1, { n: 1, level: s.level, gold: s.gold, deck: s.deck, hp: s.hp });
    byRound.add(k + 1, { games: 1, alive: r.filter((s) => s.alive).length });
  });
  for (const f of formats) byFormat.add(f.format, { n: 1, ms: f.ms, damage: f.damage, sides: f.sides });
}

const sides = GAMES * N;
rounds.sort((a, b) => a - b);
minutes.sort((a, b) => a - b);
firstOut.sort((a, b) => a - b);
const overall = {
  모드: E.MODES[MODE].name,
  경기수: GAMES,
  라운드_중앙값: percentile(rounds, 0.5), 라운드_p10: percentile(rounds, 0.1), 라운드_p90: percentile(rounds, 0.9),
  '시간_중앙값(분)': round(percentile(minutes, 0.5), 1), '시간_p90(분)': round(percentile(minutes, 0.9), 1),
  첫_탈락_라운드: percentile(firstOut, 0.5),
  끝날때_레벨: round(sum.level / sides, 1), 덱_장수: round(sum.deck / sides, 1),
  강화된_카드: round(sum.stars / sides, 1), 융합_카드: round(sum.fused / sides, 2),
  남은_골드: round(sum.gold / sides, 1), 리롤: round(sum.rerolls / sides, 1), 경험치_구매: round(sum.xp / sides, 1), 카드_빼기: round(sum.removed / sides, 1),
  우승자_남은HP: round(sum.winnerHp / Math.max(1, GAMES - sum.draws), 1),
  역전_우승: pct(sum.comebacks / Math.max(1, GAMES - sum.draws)),
};
if (N === 2) overall['0번자리_승률'] = pct((sum.seat0 + sum.draws / 2) / GAMES);
const goal = MODE === 'duel' ? '10~15분' : '20~25분, 약 15라운드';
console.log(`\n━━ ${E.MODES[MODE].name} 한 경기 흐름 (${GAMES}경기, 목표 ${goal}) ━━`);
console.table([overall]);
writeCsv(path.join(OUT, `match_${MODE}_overall.csv`), [overall]);

console.log('\n━━ 라운드별 평균 (상점을 마친 시점, 살아 있는 플레이어 기준) ━━');
const roundRows = byRound.entries().filter(([, r]) => r.games >= GAMES * 0.2).map(([k, r]) => ({
  라운드: k, 진행_경기: r.games, 남은_인원: round(r.alive / r.games, 1),
  레벨: round(r.level / r.n, 1), 골드: round(r.gold / r.n, 1), 덱_장수: round(r.deck / r.n, 1), HP: round(r.hp / r.n, 1),
}));
console.table(roundRows);
writeCsv(path.join(OUT, `match_${MODE}_rounds.csv`), roundRows);

console.log('\n━━ 형식별 ━━');
const formatRows = byFormat.entries().map(([id, r]) => ({
  형식: FORMAT_NAMES[id], 횟수: r.n, '전투_길이(초)': round(r.ms / r.n / 1000, 1), 한_명당_HP_피해: round(r.damage / Math.max(1, r.sides), 1),
}));
console.table(formatRows);
writeCsv(path.join(OUT, `match_${MODE}_formats.csv`), formatRows);

console.log('\n━━ 지휘관·상점 성향별 ━━');
const styleNames = { eco: '저축형', balanced: '균형형', spend: '소비형' };
const row = (label, r) => ({
  구분: label, 경기: r.n, 평균_순위: round(r.place / r.n, 2), '1위': pct(r.first / r.n), 상위_절반: pct(r.top / r.n), 오차: ci95(r.top / r.n, r.n),
});
const cmdRows = cmds.entries().map(([id, r]) => row(E.COMMANDERS[id].name, r)).sort((a, b) => a.평균_순위 - b.평균_순위);
const styleRows = styleTally.entries().map(([id, r]) => row(styleNames[id], r)).sort((a, b) => a.평균_순위 - b.평균_순위);
console.table([...cmdRows, ...styleRows]);
writeCsv(path.join(OUT, `match_${MODE}_commanders.csv`), [...cmdRows, ...styleRows]);
if (PERSONAS) {
  const personaRows = PERSONAS.filter((k) => personaTally.rows.get(k)).map((k) => row(E.PERSONAS[k].name, personaTally.rows.get(k))).sort((a, b) => a.평균_순위 - b.평균_순위);
  console.log('\n━━ 봇 성격별 ━━');
  console.table(personaRows);
  writeCsv(path.join(OUT, `match_${MODE}_personas.csv`), personaRows);
}
if (LEVELS) {
  const levelRows = LEVELS.filter((k) => levelTally.rows.get(k)).map((k) => row(E.BOT_LEVELS[k].name || k, levelTally.rows.get(k)));
  console.log('\n━━ 전투 봇 난이도별 ━━');
  console.table(levelRows);
  writeCsv(path.join(OUT, `match_${MODE}_levels.csv`), levelRows);
}

console.log('\n━━ 많이 산 카드 ━━');
const buyRows = cardBuys.entries().map(([id, r]) => ({
  카드: E.CARDS[id].name, 등급: E.CARDS[id].tier, 경기당_구매: round(r.bought / sides, 2), 산_쪽의_승점: pct(r.pts / r.games),
})).sort((a, b) => b.경기당_구매 - a.경기당_구매);
console.table(buyRows);
writeCsv(path.join(OUT, `match_${MODE}_cards.csv`), buyRows);

console.log(`\n${((Date.now() - t0) / 1000).toFixed(1)}초. CSV: ${OUT}`);
