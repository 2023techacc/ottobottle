import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../engine/index.js';

const ECON8 = { ...E.DEFAULT_ECON, ...E.MODES.rank8.econ };
const PICKS = ['shield', 'bat', 'archer', 'dagger', 'lancer'];

function mk(n = 8, o = {}) {
  return E.createGame({
    seed: o.seed ?? 11,
    mode: 'rank8',
    startDecks: 'commander',
    players: Array.from({ length: n }, (_, i) => ({ commander: (o.commanders || [])[i] || 'general', picks: PICKS })),
  });
}

/** 전투를 돌리지 않고 결과만 만들어 넣는다. make(b)가 주는 값으로 결과를 덮어쓴다. */
function fake(game, make = () => ({})) {
  const battles = E.roundBattles(game).map((b) => {
    const n = b.sides.length;
    const r = { winner: 0, winnerTeam: 0, ranks: b.sides.map((_, i) => i), survivors: new Array(n).fill(0), timeMs: 30000, bossDamage: [10, 0], ...make(b) };
    return { ...b, state: { result: r, players: b.sides.map((_, i) => ({ invested: false, dead: (r.dead || [])[i] || false })) } };
  });
  return E.finishRound(game, battles);
}
/** HP를 깎지 않고 원하는 라운드까지 넘긴다 */
function advanceTo(game, round) {
  while (game.round < round) {
    fake(game);
    for (const P of game.players) {
      P.hp = P.maxHp;
      P.streak = 0;
    }
  }
}

// ───────────────────────── 모드와 로테이션 ─────────────────────────

test('8인 랭크: HP 100, 픽 카드 5종, 같은 카드를 여덟 명이 고르면 풀이 5배', () => {
  const g = mk();
  assert.equal(g.mode, 'rank8');
  assert.equal(g.players.length, 8);
  assert.ok(g.players.every((P) => P.hp === 100 && P.alive));
  assert.equal(g.econ.picks, 5);
  assert.equal(g.pool.shield, 12 * 5, '한 명당 +50%');
  assert.equal(g.pool.rats, 12);
  assert.equal(E.validatePicks(PICKS, ECON8).ok, true);
  assert.equal(E.validatePicks([...PICKS, 'rats'], ECON8).ok, false);
});

test('8인 로테이션: 연습 2판, 결투 사이에 난투장·연합전·보스가 끼어든다 (삼파전은 없다)', () => {
  const g = mk();
  const formats = [];
  for (let r = 1; r <= 14; r++) formats.push(E.formatOf(g, r));
  assert.deepEqual(formats, [
    'practice', 'practice', 'duel', 'duel', 'melee4', 'duel', 'alliance', 'duel', 'boss', 'melee4', 'duel', 'melee4', 'duel', 'melee4',
  ]);
  assert.equal(E.formatOf(g, 15), 'duel');
  assert.equal(E.formatOf(g, 16), 'melee4');
  assert.equal(E.roundInfo(g, 9).battlefield, null, '보스 레이드에는 전장 효과가 없다');
  assert.equal(E.roundInfo(g, 9).baseDamage, 0);
  assert.ok(E.roundInfo(g, 5).battlefield);
});

test('남은 인원에 맞추기: 3명이면 결투 (한 명은 유령과), 2명이면 결투', () => {
  const g = mk();
  for (const i of [3, 4, 5, 6, 7]) g.players[i].alive = false;
  assert.equal(E.formatOf(g, 10), 'duel');
  assert.equal(E.formatOf(g, 11), 'duel');
  assert.equal(E.formatOf(g, 9), 'boss');
  g.players[2].alive = false;
  assert.equal(E.formatOf(g, 10), 'duel');
  assert.equal(E.formatOf(g, 7), 'duel');
});

// ───────────────────────── 조 편성과 유령 ─────────────────────────

test('조 편성: 결투 4조, 난투장 2조, 연합전 4팀. 3명이 남으면 결투 2조에 유령 1개', () => {
  const g = mk();
  advanceTo(g, 3);
  assert.deepEqual(g.groups.map((x) => x.length), [2, 2, 2, 2]);
  assert.equal(new Set(g.groups.flat().map((m) => m.p)).size, 8, '모두 한 번씩 들어간다');
  advanceTo(g, 5);
  assert.deepEqual(g.groups.map((x) => x.length), [4, 4]);
  assert.equal(g.groups.flat().filter((m) => m.p === null).length, 0);
  assert.equal(E.roundBattles(g)[0].cfg.format, 'melee4');
  advanceTo(g, 7);
  assert.deepEqual(g.groups.map((x) => x.length), [4, 4]);
  const battles = E.roundBattles(g);
  assert.equal(battles[0].cfg.format, 'alliance');
  assert.equal(battles[0].cfg.players.length, 4);
  advanceTo(g, 10);
  assert.deepEqual(g.groups.map((x) => x.length), [4, 4]);
  assert.equal(E.roundBattles(g)[0].cfg.format, 'melee4');
  // 3명만 남기면 결투 2조: 한 조에는 유령이 들어온다
  const h = mk();
  advanceTo(h, 10);
  for (const i of [3, 4, 5, 6, 7]) h.players[i].alive = false;
  h.eliminated.push(3, 4, 5, 6, 7);
  fake(h);
  assert.equal(E.formatOf(h), 'duel');
  assert.deepEqual(h.groups.map((x) => x.length), [2, 2]);
  const ghosts = h.groups.flat().filter((m) => m.p === null);
  assert.equal(ghosts.length, 1);
  assert.equal(ghosts[0].ghostOf, 7, '가장 최근에 탈락한 플레이어의 유령');
});

test('유령 보드: 탈락자의 마지막 덱을 복제하고, 유령은 피해를 받지 않는다', () => {
  const g = mk();
  advanceTo(g, 3);
  // 7번을 탈락시킨다
  g.players[7].hp = 1;
  fake(g, (b) => (b.sides.includes(7) ? { winner: 1 - b.sides.indexOf(7), survivors: [2, 2] } : {}));
  assert.equal(g.players[7].alive, false);
  assert.equal(g.players[7].place, 8);
  assert.deepEqual(g.eliminated, [7]);
  assert.ok(g.players[7].ghost.deck.length >= 8);
  for (const P of g.players) P.hp = Math.max(P.hp, 50);
  // 7명 결투: 한 조에 유령이 들어온다
  assert.equal(E.formatOf(g), 'duel');
  const ghostGroup = g.groups.find((x) => x.some((m) => m.p === null));
  assert.equal(ghostGroup.find((m) => m.p === null).ghostOf, 7);
  const battles = E.roundBattles(g);
  const gb = battles.find((b) => b.sides.includes(null));
  assert.equal(gb.cfg.players[gb.sides.indexOf(null)].name, `${g.players[7].name}의 유령`);
  // 유령에게 지면 피해는 그대로 받는다
  const real = gb.sides.find((p) => p !== null);
  const hp = g.players[real].hp;
  const base = E.roundInfo(g).baseDamage;
  const s = fake(g, (b) => (b.sides.includes(null) ? { winner: b.sides.indexOf(null), survivors: [3, 3] } : {}));
  assert.equal(g.players[real].hp, hp - (base + 3 * ECON8.survivorDamage));
  assert.equal(s.results.filter((r) => r.group === battles.indexOf(gb)).length, 1, '유령 쪽 결과는 없다');
});

// ───────────────────────── 형식별 피해 ─────────────────────────

test('8인 기본 피해는 3에서 라운드마다 +1 (최대 20), 남은 유닛 한 기당 3. 1:1은 2에서 두 라운드마다 +1 (최대 8)', () => {
  const g = mk();
  const d = (r) => E.roundInfo(g, r).baseDamage;
  assert.deepEqual([3, 4, 5, 6, 8, 18, 30].map(d), [3, 4, 5, 6, 8, 18, 20]);
  assert.equal(d(9), 0, '보스 레이드');
  assert.equal(g.econ.survivorDamage, 3);
  const duel = E.createGame({ seed: 1, startDecks: 'commander', players: [{ commander: 'general', picks: [...PICKS, 'rats', 'turtle', 'banner'] }, { commander: 'lord', picks: [...PICKS, 'rats', 'turtle', 'banner'] }] });
  assert.deepEqual([3, 4, 5, 6, 14, 30].map((r) => E.roundInfo(duel, r).baseDamage), [2, 2, 3, 3, 7, 8]);
  assert.equal(duel.econ.survivorDamage, 1);
});


test('난투장 피해: 1위 0%, 2위 30%, 3위 70%, 4위 100%. 군주는 8인 경기에서 25% 덜 받는다', () => {
  const g = mk(8, { commanders: ['lord', 'lord', 'lord', 'lord', 'lord', 'lord', 'lord', 'lord'] });
  const h = mk();
  for (const game of [g, h]) advanceTo(game, 10);
  const base = E.roundInfo(h).baseDamage;
  assert.equal(base, 10);
  const full = base + 5 * ECON8.survivorDamage; // 살아남은 상대의 유닛 5기
  const res = () => ({ ranks: [0, 1, 2, 3], survivors: [5, 0, 0, 0], dead: [false, true, true, true] });
  const sh = fake(h, res);
  const sg = fake(g, res);
  const dmg = (s, group, rank) => s.results.find((x) => x.group === group && x.rank === rank).damage;
  assert.deepEqual([0, 1, 2, 3].map((k) => dmg(sh, 0, k)), [0, 0.3, 0.7, 1].map((x) => Math.ceil(full * x)));
  assert.deepEqual([0, 1, 2, 3].map((k) => dmg(sg, 0, k)), [0, 0.3, 0.7, 1].map((x) => Math.ceil(Math.ceil(full * x) * 0.75)), '군주: 올림(피해 × 0.75)');
});

test('연합전 피해: 진 팀의 두 명이 각자 결투 피해의 절반을 받는다', () => {
  const g = mk();
  advanceTo(g, 7);
  const base = E.roundInfo(g).baseDamage;
  assert.equal(base, 7);
  const b = E.roundBattles(g)[0];
  const s = fake(g, () => ({ winnerTeam: 1, ranks: [2, 3, 0, 0], survivors: [0, 0, 3, 2] }));
  const r = (p) => s.results.find((x) => x.p === p);
  assert.equal(r(b.sides[0]).damage, Math.ceil((base + 5 * ECON8.survivorDamage) / 2));
  assert.equal(r(b.sides[1]).damage, Math.ceil((base + 5 * ECON8.survivorDamage) / 2));
  assert.equal(r(b.sides[2]).damage, 0);
  assert.deepEqual([r(b.sides[0]).won, r(b.sides[3]).won], [false, true]);
});

test('보스 레이드: HP 피해 없음, 준 피해 순위로 보상 (1~2위 4장 중 1장 + 5골드, 3~5위 3장 중 1장, 6~8위 2골드)', () => {
  const g = mk();
  advanceTo(g, 9);
  assert.equal(E.roundBattles(g)[0].cfg.format, 'boss');
  const gold = g.players.map((P) => P.gold);
  const income = g.players.map((P) => E.incomePreview(g, P.idx).total);
  const s = fake(g, (b) => ({ bossDamage: [100 - b.sides[0] * 10, 0] })); // 0번이 가장 많이 줬다
  assert.ok(g.players.every((P) => P.hp === 100));
  const bonus = g.players.map((P, i) => P.gold - gold[i] - income[i]);
  assert.deepEqual(bonus, [5, 5, 0, 0, 0, 2, 2, 2]);
  assert.deepEqual(g.players.map((P) => (P.reward ? P.reward.options.length : 0)), [4, 4, 3, 3, 3, 0, 0, 0]);
  assert.deepEqual(s.results.map((r) => r.rank), [0, 1, 2, 3, 4, 5, 6, 7]);

  const P = g.players[0];
  const id = P.reward.options[1];
  const pool = g.pool[id];
  const n = P.deck.length;
  const total = E.poolTotal(g);
  assert.equal(E.claimReward(g, 0, 1).ok, true);
  assert.equal(P.deck.length, n + 1);
  assert.equal(P.deck[n].id, id);
  assert.equal(g.pool[id], pool - 1);
  assert.equal(P.reward, null);
  assert.equal(E.poolTotal(g), total);
  assert.equal(E.claimReward(g, 0, 0).ok, false);
  E.skipReward(g, 1);
  assert.equal(g.players[1].reward, null);
});

// ───────────────────────── 탈락과 순위 ─────────────────────────

test('탈락: 같은 라운드에 여럿이 쓰러지면 HP가 더 많이 남은 쪽이 순위가 높고, 카드는 풀로 돌아간다', () => {
  const g = mk();
  advanceTo(g, 3);
  E.buy(g, 0, 1);
  const bought = g.players[0].deck[8];
  const total = E.poolTotal(g);
  // 조와 상관없이 0번과 1번이 모두 지도록 HP를 깎아 둔다
  g.players[0].hp = 1;
  g.players[1].hp = 2;
  const pool = g.pool[bought.id];
  fake(g, (b) => {
    const i0 = b.sides.indexOf(0);
    const i1 = b.sides.indexOf(1);
    if (i0 >= 0 && i1 >= 0) return { winner: -1 }; // 둘이 만났으면 무승부로 둘 다 피해
    if (i0 >= 0) return { winner: 1 - i0, survivors: [5, 5] };
    if (i1 >= 0) return { winner: 1 - i1, survivors: [1, 1] };
    return {};
  });
  assert.equal(g.players[0].alive, false);
  assert.equal(g.players[1].alive, false);
  assert.ok(g.players[1].hp > g.players[0].hp);
  assert.equal(g.players[1].place, 7);
  assert.equal(g.players[0].place, 8);
  assert.equal(E.aliveCount(g), 6);
  assert.equal(g.pool[bought.id], pool + 1, '탈락자의 카드는 풀로 돌아간다');
  assert.equal(E.poolTotal(g), total);
  assert.equal(E.buy(g, 0, 0).ok, false, '탈락하면 상점을 쓸 수 없다');
  assert.equal(g.groups.flat().some((m) => m.p === 0 || m.p === 1), false);
});

test('봇 8명 경기: 끝까지 진행되고 1위부터 8위까지 순위가 매겨진다', () => {
  for (let seed = 1; seed <= 4; seed++) {
    const rng = E.makeRng(E.hashSeed(seed, 'setup'));
    const players = Array.from({ length: 8 }, () => ({ commander: rng.pick(E.COMMANDER_IDS), picks: E.botPicks(rng, ECON8) }));
    const game = E.createGame({ seed, players });
    const total = E.poolTotal(game);
    for (const P of game.players) E.runDraftBot(game, P.idx);
    const seen = new Set();
    while (game.phase !== 'over') {
      assert.ok(game.round < 80, '경기가 끝나지 않는다');
      for (const P of game.players) E.runShopBot(game, P.idx);
      assert.equal(E.poolTotal(game), total, `seed ${seed} round ${game.round}`);
      for (const id of E.POOL_CARD_IDS) assert.ok(game.pool[id] >= 0);
      const battles = E.roundBattles(game).map((b) => ({ ...b, state: E.runRoundBattle(b).state }));
      const real = battles.flatMap((b) => b.sides).filter((p) => p !== null);
      assert.equal(new Set(real).size, E.aliveCount(game), '살아 있는 모두가 한 번씩 싸운다');
      seen.add(E.formatOf(game));
      E.finishRound(game, battles);
    }
    assert.deepEqual([...game.players.map((P) => P.place)].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal(game.players[game.winner].place, 1);
    assert.equal(game.placements[0], game.winner);
    for (const f of ['practice', 'duel', 'alliance', 'boss', 'melee4']) assert.ok(seen.has(f), `${f} 형식을 거쳤다`);
  }
});

test('8인 경기도 같은 시드면 똑같이 진행된다', () => {
  const run = (seed) => {
    const rng = E.makeRng(E.hashSeed(seed, 'setup'));
    const players = Array.from({ length: 8 }, () => ({ commander: rng.pick(E.COMMANDER_IDS), picks: E.botPicks(rng, ECON8) }));
    const game = E.createGame({ seed, players });
    for (const P of game.players) E.runDraftBot(game, P.idx);
    while (game.phase !== 'over') {
      for (const P of game.players) E.runShopBot(game, P.idx);
      E.finishRound(game, E.roundBattles(game).map((b) => ({ ...b, state: E.runRoundBattle(b).state })));
    }
    return game;
  };
  const a = run(9);
  const b = run(9);
  assert.deepEqual(a.placements, b.placements);
  assert.deepEqual(a.history.map((h) => h.hp), b.history.map((h) => h.hp));
});
