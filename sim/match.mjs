#!/usr/bin/env node
// 봇끼리 한 경기(상점 + 전투 반복)를 여러 번 돌려 경기 흐름을 본다.
//
//   node sim/match.mjs                경기 300판
//   node sim/match.mjs --games 1000
//   node sim/match.mjs --econ "{\"playerHp\":60}"     경제 수치를 바꿔서
//
// 결과는 sim/out/match_*.csv 에도 저장한다.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as E from '../engine/index.js';
import { Tally, percentile, round, pct, ci95, writeCsv, parseArgs } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const GAMES = Number(args.games || 300);
const SEED = Number(args.seed || 1);
const ECON = args.econ ? JSON.parse(args.econ) : {};
const OUT = path.resolve(args.out || path.join(path.dirname(fileURLToPath(import.meta.url)), 'out'));
const STYLES = Object.keys(E.SHOP_STYLES);
const t0 = Date.now();

function playGame(seed) {
  const rng = E.makeRng(E.hashSeed(seed, 'setup'));
  const players = [0, 1].map(() => ({ commander: rng.pick(E.COMMANDER_IDS), picks: E.botPicks(rng) }));
  const styles = [rng.pick(STYLES), rng.pick(STYLES)];
  const game = E.createGame({ seed, players, econ: ECON });
  const perRound = [];
  let battleMs = 0;
  while (game.phase !== 'over' && game.round < 80) {
    for (const p of [0, 1]) E.runShopBot(game, p, { style: styles[p] });
    perRound.push(game.players.map((P) => ({ level: P.level, gold: P.gold, deck: P.deck.length, hp: P.hp })));
    const battles = E.roundBattles(game).map((b) => ({ ...b, state: E.runBattle(b.cfg).state }));
    const s = E.finishRound(game, battles);
    battleMs += Math.max(...s.results.map((r) => r.timeMs));
  }
  return { game, styles, perRound, battleMs };
}

const rounds = [];
const minutes = [];
const cmds = new Tally();
const styleTally = new Tally();
const cardBuys = new Tally();
const byRound = new Tally();
const sum = { level: 0, deck: 0, stars: 0, fused: 0, gold: 0, rerolls: 0, xp: 0, removed: 0, winnerHp: 0, comebacks: 0, seat0: 0, draws: 0 };

for (let i = 0; i < GAMES; i++) {
  const { game, styles, perRound, battleMs } = playGame(E.hashSeed(SEED, 'game', i));
  rounds.push(game.round);
  minutes.push((game.round * game.econ.shopSeconds * 1000 + battleMs) / 60000);
  if (game.winner === -1) sum.draws++;
  if (game.winner === 0) sum.seat0++;
  game.players.forEach((P, p) => {
    const pts = game.winner === -1 ? 0.5 : game.winner === p ? 1 : 0;
    cmds.add(P.commander, { n: 1, pts });
    styleTally.add(styles[p], { n: 1, pts });
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
    // 역전: 한때 HP가 10 이상 뒤졌던 쪽이 이긴 경기
    if (perRound.some((r) => r[1 - game.winner].hp - r[game.winner].hp >= 10)) sum.comebacks++;
  }
  perRound.forEach((r, k) => {
    for (const s of r) byRound.add(k + 1, { n: 1, level: s.level, gold: s.gold, deck: s.deck, hp: s.hp });
  });
}

const sides = GAMES * 2;
rounds.sort((a, b) => a - b);
minutes.sort((a, b) => a - b);
const overall = {
  경기수: GAMES,
  라운드_중앙값: percentile(rounds, 0.5), 라운드_p10: percentile(rounds, 0.1), 라운드_p90: percentile(rounds, 0.9),
  '시간_중앙값(분)': round(percentile(minutes, 0.5), 1), '시간_p90(분)': round(percentile(minutes, 0.9), 1),
  끝날때_레벨: round(sum.level / sides, 1), 덱_장수: round(sum.deck / sides, 1),
  강화된_카드: round(sum.stars / sides, 1), 융합_카드: round(sum.fused / sides, 2),
  남은_골드: round(sum.gold / sides, 1), 리롤: round(sum.rerolls / sides, 1), 경험치_구매: round(sum.xp / sides, 1), 카드_빼기: round(sum.removed / sides, 1),
  승자_남은HP: round(sum.winnerHp / Math.max(1, GAMES - sum.draws), 1),
  역전승: pct(sum.comebacks / Math.max(1, GAMES - sum.draws)),
  '0번자리_승률': pct((sum.seat0 + sum.draws / 2) / GAMES),
};
console.log(`\n━━ 한 경기 흐름 (${GAMES}경기, 목표 10~15분) ━━`);
console.table([overall]);
writeCsv(path.join(OUT, 'match_overall.csv'), [overall]);

console.log('\n━━ 라운드별 평균 (상점을 마친 시점) ━━');
const roundRows = byRound.entries().filter(([, r]) => r.n >= sides * 0.2).map(([k, r]) => ({
  라운드: k, 표본: r.n, 레벨: round(r.level / r.n, 1), 골드: round(r.gold / r.n, 1), 덱_장수: round(r.deck / r.n, 1), HP: round(r.hp / r.n, 1),
}));
console.table(roundRows);
writeCsv(path.join(OUT, 'match_rounds.csv'), roundRows);

console.log('\n━━ 지휘관·상점 성향별 승률 ━━');
const cmdRows = cmds.entries().map(([id, r]) => ({ 구분: E.COMMANDERS[id].name, 경기: r.n, 승률: pct(r.pts / r.n), 오차: ci95(r.pts / r.n, r.n) })).sort((a, b) => b.승률 - a.승률);
const styleNames = { eco: '저축형', balanced: '균형형', spend: '소비형' };
const styleRows = styleTally.entries().map(([id, r]) => ({ 구분: styleNames[id], 경기: r.n, 승률: pct(r.pts / r.n), 오차: ci95(r.pts / r.n, r.n) })).sort((a, b) => b.승률 - a.승률);
console.table([...cmdRows, ...styleRows]);
writeCsv(path.join(OUT, 'match_commanders.csv'), [...cmdRows, ...styleRows]);

console.log('\n━━ 많이 산 카드 ━━');
const buyRows = cardBuys.entries().map(([id, r]) => ({
  카드: E.CARDS[id].name, 등급: E.CARDS[id].tier, 경기당_구매: round(r.bought / sides, 2), 산_쪽의_승률: pct(r.pts / r.games),
})).sort((a, b) => b.경기당_구매 - a.경기당_구매);
console.table(buyRows);
writeCsv(path.join(OUT, 'match_cards.csv'), buyRows);

console.log(`\n${((Date.now() - t0) / 1000).toFixed(1)}초. CSV: ${OUT}`);
