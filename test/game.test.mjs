import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../engine/index.js';

const PICKS_A = ['shield', 'bat', 'archer', 'dagger', 'lancer', 'pyro', 'firebolt', 'scout'];
const PICKS_B = ['shield', 'rats', 'frostwitch', 'colossus', 'chain', 'armor', 'crystal', 'supply'];

function mk(o = {}) {
  return E.createGame({
    seed: o.seed ?? 3,
    econ: o.econ,
    startDecks: 'commander', // 아래 테스트는 지휘관별 시작 덱을 전제로 한다. 드래프트는 draft.test.mjs에서 본다.
    players: [
      { commander: o.c0 || 'general', picks: o.p0 || PICKS_A },
      { commander: o.c1 || 'lord', picks: o.p1 || PICKS_B },
    ],
  });
}

/** 전투를 돌리지 않고 결과만 넣어 라운드를 넘긴다 */
function fakeRound(game, winner, survivors = [0, 0], invested = [false, false]) {
  const battles = E.roundBattles(game).map((b) => ({
    ...b,
    state: {
      result: { winner: b.kind === 'practice' ? (winner === 'lose' ? 1 : 0) : winner, survivors, timeMs: 30000 },
      players: [{ invested: invested[b.sides[0]] }, { invested: b.sides[1] === null ? false : invested[b.sides[1]] }],
    },
  }));
  return E.finishRound(game, battles);
}
const skipPractice = (game) => {
  while (E.roundInfo(game).format === 'practice') fakeRound(game, 'lose');
};

// ───────────────────────── 사전 선택과 공용 풀 ─────────────────────────

test('픽 카드: 8종, 중복 없음, 5등급은 1종까지', () => {
  assert.equal(E.validatePicks(PICKS_A).ok, true);
  assert.equal(E.validatePicks(PICKS_A.slice(0, 7)).ok, false);
  assert.equal(E.validatePicks([...PICKS_A.slice(0, 7), 'shield']).ok, false);
  assert.equal(E.validatePicks([...PICKS_A.slice(0, 7), 'disrupt']).ok, false, '지휘관 고유 카드는 고를 수 없다');
  assert.throws(() => mk({ p0: PICKS_A.slice(0, 5) }));
});

test('공용 풀: 등급별 장수, 고른 사람 한 명당 +50%', () => {
  const g = mk();
  assert.equal(g.pool.rats, 18, '1등급 12장, 한 명이 골라 +50%');
  assert.equal(g.pool.shield, 24, '두 명이 골라 +100%');
  assert.equal(g.pool.warcry, 12, '아무도 고르지 않은 1등급');
  assert.equal(g.pool.pyro, 9, '4등급 6장 +50%');
  assert.equal(g.pool.colossus, 6, '5등급 4장 +50%');
  assert.equal(g.pool.disrupt, undefined, '지휘관 고유 카드는 풀에 없다');
});

test('시작 상태: HP 40, 레벨 3, 시작 덱 8장, 첫 수입 5골드', () => {
  const g = mk({ c1: 'merchant' });
  const [a, b] = g.players;
  assert.deepEqual([a.hp, a.level, a.deck.length, a.gold], [40, 3, 8, 5]);
  assert.equal(b.gold, 6, '상인은 라운드당 +1');
  assert.equal(g.round, 1);
  assert.equal(E.roundInfo(g).format, 'practice');
  assert.equal(a.shop.length, 5);
});

// ───────────────────────── 상점 ─────────────────────────

test('상점: 시그니처 칸은 내 픽에서만, 레벨 3에서는 1~2등급만 뜬다', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const g = mk({ seed });
    for (const P of g.players) {
      for (let k = 0; k < 5; k++) {
        P.gold = 99;
        P.shop.forEach((s, i) => {
          if (!s) return;
          assert.ok(E.CARDS[s.id].tier <= 2, `레벨 3에 ${s.id}`);
          assert.equal(s.signature, i === 0);
          if (s.signature) assert.ok(P.picks.includes(s.id), `시그니처 칸에 ${s.id}`);
        });
        E.reroll(g, P.idx);
      }
    }
  }
});

test('시그니처 칸: 그 등급의 픽이 없으면 가장 가까운 낮은 등급에서 뜬다', () => {
  // 1등급 픽이 하나도 없으면 레벨 3 시그니처 칸은 2등급 픽만 나올 수 있다
  const picks = ['dagger', 'frostwitch', 'purify', 'awaken', 'armor', 'supply', 'lancer', 'chain'];
  for (let seed = 1; seed <= 30; seed++) {
    const g = mk({ seed, p0: picks });
    assert.equal(E.CARDS[g.players[0].shop[0].id].tier, 2);
  }
});

test('첩보원은 시그니처 칸이 2개', () => {
  const g = mk({ c0: 'spy' });
  assert.deepEqual(g.players[0].shop.map((s) => s.signature), [true, true, false, false, false]);
  assert.deepEqual(g.players[1].shop.map((s) => s.signature), [true, false, false, false, false]);
});

test('구매: 가격은 등급, 풀에서 빠지고 덱에 들어간다', () => {
  const g = mk();
  const P = g.players[0];
  const s = P.shop[1];
  const cost = E.CARDS[s.id].tier;
  const before = g.pool[s.id];
  const total = E.poolTotal(g);
  assert.equal(E.buy(g, 0, 1).ok, true);
  assert.equal(P.gold, 5 - cost);
  assert.equal(g.pool[s.id], before - 1);
  assert.equal(P.deck.length, 9);
  assert.equal(P.deck[8].id, s.id);
  assert.equal(E.buy(g, 0, 1).ok, false, '이미 산 칸');
  assert.equal(E.poolTotal(g), total);
  P.gold = 0;
  assert.equal(E.buy(g, 0, 2).ok, false, '골드 부족');
});

test('리롤 2골드, 상인은 라운드 첫 리롤 무료', () => {
  const g = mk({ c1: 'merchant' });
  assert.equal(E.reroll(g, 0).ok, true);
  assert.equal(g.players[0].gold, 3);
  assert.equal(E.rerollCostOf(g, 1), 0);
  E.reroll(g, 1);
  assert.equal(g.players[1].gold, 6);
  E.reroll(g, 1);
  assert.equal(g.players[1].gold, 4);
  fakeRound(g, 'lose');
  assert.equal(E.rerollCostOf(g, 1), 0, '다음 라운드에 다시 무료');
});

test('잠금: 다음 라운드에도 같은 상점이 유지된다 (무료)', () => {
  const g = mk();
  const before = g.players[0].shop.map((s) => s && s.id);
  const other = g.players[1].shop.map((s) => s && s.id);
  E.toggleLock(g, 0);
  assert.equal(g.players[0].gold, 5);
  fakeRound(g, 'lose');
  assert.deepEqual(g.players[0].shop.map((s) => s && s.id), before);
  assert.equal(g.players[0].locked, false, '잠금은 한 라운드만 유지');
  fakeRound(g, 'lose');
  const later = g.players[0].shop.map((s) => s && s.id);
  assert.ok(JSON.stringify(later) !== JSON.stringify(before) || JSON.stringify(g.players[1].shop.map((s) => s && s.id)) !== JSON.stringify(other));
});

test('경험치: 4골드에 4, 라운드마다 2, 레벨 3→4는 6', () => {
  const g = mk();
  const P = g.players[0];
  P.gold = 20;
  E.buyXp(g, 0);
  assert.deepEqual([P.level, P.xp, P.gold], [3, 4, 16]);
  E.buyXp(g, 0);
  assert.deepEqual([P.level, P.xp], [4, 2]);
  fakeRound(g, 'lose');
  assert.equal(P.xp, 4, '라운드가 넘어가며 +2');
  P.level = 8;
  assert.equal(E.buyXp(g, 0).ok, false);
});

test('레벨 보상: 고르는 시작 카드 장수 1·1·2·2·3·3', () => {
  const g = mk();
  const P = g.players[0];
  const counts = [3, 4, 5, 6, 7, 8].map((lv) => {
    P.level = lv;
    return E.openingCount(g, 0);
  });
  assert.deepEqual(counts, [1, 1, 2, 2, 3, 3]);
  P.level = 3;
  E.setOpening(g, 0, P.deck.map((c) => c.key));
  assert.equal(P.opening.length, 1, '레벨이 허용하는 장수까지만');
});

test('카드 빼기: 2골드, 라운드당 1번, 덱 최소 8장, 산 카드는 풀로 돌아간다', () => {
  const g = mk();
  const P = g.players[0];
  P.gold = 20;
  assert.equal(E.removeCard(g, 0, P.deck[0].key).ok, false, '8장에서는 뺄 수 없다');
  E.buy(g, 0, 1);
  E.buy(g, 0, 2);
  const bought = P.deck[8];
  const pool = g.pool[bought.id];
  const gold = P.gold;
  assert.equal(E.removeCard(g, 0, bought.key).ok, true);
  assert.equal(P.gold, gold - 2);
  assert.equal(g.pool[bought.id], pool + 1);
  assert.equal(E.removeCard(g, 0, P.deck[8].key).ok, false, '라운드당 1번');
  fakeRound(g, 'lose');
  const startCard = P.deck[0];
  const poolStart = g.pool[startCard.id];
  assert.equal(E.removeCard(g, 0, startCard.key).ok, true);
  assert.equal(g.pool[startCard.id], poolStart, '시작 덱 카드는 풀에서 온 게 아니라서 돌아가지 않는다');
});

// ───────────────────────── 강화와 융합 ─────────────────────────

function give(g, p, id, n = 1) {
  const P = g.players[p];
  const out = [];
  for (let i = 0; i < n; i++) {
    g.pool[id]--;
    const c = { key: g.nextKey++, id, stars: 1, fuse: null, origin: 'pool', parts: [id] };
    P.deck.push(c);
    out.push(c);
  }
  return out;
}

test('강화: 같은 카드 3장 → 2성 1장, 2성 3장 → 3성', () => {
  const g = mk({ c0: 'merchant' }); // 시작 덱에 쥐 떼 2장
  const P = g.players[0];
  assert.deepEqual(E.upgradable(g, 0), []);
  give(g, 0, 'rats', 2);
  give(g, 0, 'bat', 1);
  const total = E.poolTotal(g);
  assert.deepEqual(E.upgradable(g, 0), [{ id: 'rats', stars: 1, count: 4 }]);
  const res = E.upgrade(g, 0, 'rats', 1);
  assert.equal(res.ok, true);
  assert.equal(res.card.stars, 2);
  assert.equal(P.deck.filter((c) => c.id === 'rats').length, 2);
  assert.equal(P.deck.length, 9);
  assert.equal(E.poolTotal(g), total, '합쳐도 풀 장수는 보존된다');
  assert.equal(E.upgrade(g, 0, 'rats', 1).ok, false);
});

test('강화: 합친 뒤 덱이 8장 밑으로 내려가면 안 된다', () => {
  const g = mk(); // 장군 시작 덱에 방패병 3장
  assert.deepEqual(E.upgradable(g, 0), []);
  assert.equal(E.upgrade(g, 0, 'shield', 1).ok, false);
  give(g, 0, 'bat', 2);
  assert.equal(E.upgrade(g, 0, 'shield', 1).ok, true);
});

test('융합: 재료의 ◆ 효과가 몸체에 붙고 재료는 사라진다. 경기당 3회, 연금술사는 5회', () => {
  const g = mk({ c1: 'alchemist' });
  const P = g.players[0];
  assert.equal(P.fusionsLeft, 3);
  assert.equal(g.players[1].fusionsLeft, 5);
  const [bat] = give(g, 0, 'bat');
  const [fb] = give(g, 0, 'firebolt');
  const [supply] = give(g, 0, 'supply');
  const lancer = P.deck.find((c) => c.id === 'lancer');
  const archer = P.deck.find((c) => c.id === 'archer');
  assert.equal(E.fuse(g, 0, lancer.key, archer.key).ok, false, '견습 궁수에는 ◆ 효과가 없다');
  assert.equal(E.fuse(g, 0, fb.key, bat.key).ok, false, '유닛 키워드는 주문에 붙지 않는다');
  assert.equal(E.fuse(g, 0, lancer.key, bat.key).ok, true);
  assert.equal(lancer.fuse, 'lifesteal');
  assert.ok(!P.deck.includes(bat));
  assert.equal(P.fusionsLeft, 2);
  assert.equal(E.fuse(g, 0, lancer.key, supply.key).ok, false, '한 카드에 효과는 하나');
  assert.equal(E.fuse(g, 0, fb.key, supply.key).ok, true, '순환은 주문에도 붙는다');
  assert.equal(fb.fuse, 'cycle');
});

test('융합 카드를 빼면 몸체와 재료가 모두 풀로 돌아간다', () => {
  const g = mk();
  const P = g.players[0];
  P.gold = 10;
  const [dagger] = give(g, 0, 'dagger');
  const [bat] = give(g, 0, 'bat');
  give(g, 0, 'rats');
  const pools = [g.pool.dagger, g.pool.bat];
  E.fuse(g, 0, dagger.key, bat.key);
  assert.equal(E.removeCard(g, 0, dagger.key).ok, true);
  assert.deepEqual([g.pool.dagger, g.pool.bat], [pools[0] + 1, pools[1] + 1]);
});

// ───────────────────────── 수입 ─────────────────────────

test('수입: 기본 5, 이자 10골드당 1(최대 3), 연승·연패 2회 +1, 4회 +2', () => {
  const g = mk();
  const [a, b] = g.players;
  skipPractice(g);
  a.gold = 0;
  b.gold = 0;
  fakeRound(g, 0);
  assert.equal(a.gold, 5);
  a.gold = 25;
  b.gold = 47;
  fakeRound(g, 0); // a 2연승, b 2연패
  assert.equal(a.gold, 25 + 5 + 2 + 1);
  assert.equal(b.gold, 47 + 5 + 3 + 1, '이자는 최대 3, 연패도 보너스를 받는다');
  assert.deepEqual([a.streak, b.streak], [2, -2]);
  fakeRound(g, 0);
  fakeRound(g, 0);
  assert.equal(E.streakBonusOf(g, a.streak), 2);
  assert.equal(E.incomePreview(g, 1).streak, 2);
  a.hp = 40;
  b.hp = 40;
  fakeRound(g, 1);
  assert.deepEqual([a.streak, b.streak], [-1, 1], '연속이 끊긴다');
});

// ───────────────────────── 라운드와 피해 ─────────────────────────

test('1~2라운드는 연습: HP 피해 없음, 이기면 골드 +2', () => {
  const g = mk();
  const [a, b] = g.players;
  const battles = E.roundBattles(g);
  assert.equal(battles.length, 2);
  assert.deepEqual(battles.map((x) => x.sides), [[0, null], [1, null]]);
  assert.equal(battles[0].cfg.players[1].name, '중립 몬스터');
  assert.equal(battles[0].cfg.battlefield, null, '연습 라운드에는 전장 효과가 없다');
  const s = fakeRound(g, 0);
  assert.deepEqual([a.hp, b.hp], [40, 40]);
  assert.equal(a.gold, 5 + 2 + 5);
  assert.equal(s.results[0].gold, 2);
  assert.equal(E.roundInfo(g).format, 'practice');
  fakeRound(g, 'lose');
  assert.equal(E.roundInfo(g).format, 'duel');
  assert.equal(g.round, 3);
});

test('결투: 패자는 기본 피해 + 승자 보드에 남은 유닛 수만큼 HP를 잃는다', () => {
  const g = mk();
  skipPractice(g);
  const info = E.roundInfo(g);
  assert.equal(info.baseDamage, 2);
  assert.ok(E.BATTLEFIELD_IDS.includes(info.battlefield));
  assert.equal(E.roundBattles(g).length, 1);
  fakeRound(g, 0, [3, 0]);
  assert.deepEqual(g.players.map((P) => P.hp), [40, 35]);
});

test('기본 피해는 라운드에 따라 2에서 8까지 오른다', () => {
  const g = mk();
  const base = [];
  for (let r = 1; r <= 17; r++) base.push(E.roundInfo(g, r).baseDamage);
  assert.deepEqual(base, [0, 0, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 8]);
});

test('무승부면 양쪽이 기본 피해의 절반을 받는다', () => {
  const g = mk();
  skipPractice(g);
  fakeRound(g, 0);
  fakeRound(g, 0);
  assert.equal(E.roundInfo(g).baseDamage, 3);
  const hp = g.players.map((P) => P.hp);
  fakeRound(g, -1);
  assert.deepEqual(g.players.map((P) => P.hp), [hp[0] - 2, hp[1] - 2]);
  assert.deepEqual(g.players.map((P) => P.streak), [0, 0]);
});

test('투자: 그 전투에서 이기면 골드 +3', () => {
  const g = mk({ c0: 'merchant' });
  skipPractice(g);
  const a = g.players[0];
  a.gold = 0;
  fakeRound(g, 0, [0, 0], [true, true]);
  assert.equal(a.gold, 3 + 5 + 1, '투자 3 + 기본 5 + 상인 1');
});

test('HP가 0이 되면 경기가 끝난다', () => {
  const g = mk();
  skipPractice(g);
  g.players[1].hp = 3;
  const s = fakeRound(g, 0, [2, 0]);
  assert.equal(g.phase, 'over');
  assert.equal(g.winner, 0);
  assert.equal(s.over, true);
  assert.equal(E.buy(g, 0, 0).ok, false, '끝난 뒤에는 상점을 쓸 수 없다');
});

test('전투 설정: 덱, 고른 시작 카드, 레벨에 따른 장수가 넘어간다', () => {
  const g = mk();
  skipPractice(g);
  const P = g.players[0];
  P.level = 5;
  const lancer = P.deck.find((c) => c.id === 'lancer');
  const archer = P.deck.find((c) => c.id === 'archer');
  E.setOpening(g, 0, [lancer.key, archer.key]);
  const [b] = E.roundBattles(g);
  assert.equal(b.cfg.rules.vanguardSlots, 0);
  assert.equal(b.cfg.players[0].bonus.openingPicks, 2);
  const state = E.createBattle(b.cfg);
  const hand = state.players[0].hand.map((c) => c.id);
  assert.ok(hand.includes('lancer') && hand.includes('archer'), String(hand));
  assert.equal(E.unitsOf(state, 0).length, 0);
});

// ───────────────────────── 봇끼리 한 경기 ─────────────────────────

function botGame(seed, styles = ['balanced', 'balanced'], battle = undefined) {
  const rng = E.makeRng(E.hashSeed(seed, 'setup'));
  const players = [0, 1].map(() => ({ commander: rng.pick(E.COMMANDER_IDS), picks: E.botPicks(rng) }));
  const game = E.createGame({ seed, players, battle });
  const total = E.poolTotal(game);
  for (const P of game.players) E.runDraftBot(game, P.idx);
  assert.equal(game.phase, 'shop');
  while (game.phase !== 'over') {
    assert.ok(game.round < 60, '경기가 끝나지 않는다');
    for (const p of [0, 1]) E.runShopBot(game, p, { style: styles[p] });
    for (const P of game.players) {
      assert.ok(P.gold >= 0);
      assert.ok(P.deck.length >= game.econ.deckMin && P.deck.length <= game.econ.deckMax);
      assert.ok(P.opening.length <= E.openingCount(game, P.idx));
      assert.ok(P.deck.filter((c) => c.fuse).length <= E.COMMANDERS[P.commander].fusions);
    }
    for (const id of E.POOL_CARD_IDS) assert.ok(game.pool[id] >= 0, `${id} 풀이 음수`);
    assert.equal(E.poolTotal(game), total, '풀과 덱의 카드 수 합은 변하지 않는다');
    const battles = E.roundBattles(game).map((b) => ({ ...b, state: E.runRoundBattle(b).state }));
    E.finishRound(game, battles);
  }
  return game;
}

test('봇끼리 한 경기가 끝까지 진행되고, 카드가 새거나 늘지 않는다', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const g = botGame(seed, [['eco', 'balanced', 'spend'][seed % 3], 'balanced']);
    assert.equal(g.phase, 'over');
    assert.ok(g.winner === 0 || g.winner === 1 || g.winner === -1);
    assert.ok(g.round >= 4);
    assert.ok(Math.min(...g.players.map((P) => P.hp)) <= 0);
  }
});

test('같은 시드면 경기 전체가 똑같이 진행된다', () => {
  const a = botGame(7);
  const b = botGame(7);
  assert.deepEqual(a.history, b.history);
  assert.deepEqual(a.players.map((P) => P.deck.map((c) => [c.id, c.stars, c.fuse])), b.players.map((P) => P.deck.map((c) => [c.id, c.stars, c.fuse])));
  assert.notDeepEqual(botGame(8).history, a.history);
});

// ───────────────────────── 전투 방식 ─────────────────────────

test('전투 방식: 기본은 유닛 전투, 예전 칸 전투도 고를 수 있다', () => {
  const g = mk();
  assert.equal(g.battle, 'field');
  assert.ok(E.roundBattles(g).every((b) => b.engine === 'field'));
  // 유닛 전투의 규칙은 FIELD_RULES가 기본이다 (칸 전투의 "E. 카드 위주" 수치를 덮어쓰지 않는다)
  assert.equal(E.fullBattleRules(g).commanderHp, E.Field.FIELD_RULES.commanderHp);
  assert.equal(E.fullBattleRules(g).openingPicks, 0, '시작 카드 장수는 상점 레벨이 정한다');
  const c = E.createGame({ seed: 3, battle: 'cells', startDecks: 'commander', players: g.players.map((P) => ({ commander: P.commander, picks: P.picks })) });
  assert.equal(c.battle, 'cells');
  assert.equal(E.fullBattleRules(c).commanderHp, E.PRESETS.cards.rules.commanderHp);
  assert.ok(E.roundBattles(c).every((b) => b.engine === 'cells'));
  assert.throws(() => E.createGame({ seed: 1, battle: 'nope', players: g.players.map((P) => ({ commander: P.commander, picks: P.picks })) }));
});

test('유닛 전투 경기: 시작 카드와 레벨 보너스가 전투에 그대로 넘어간다', () => {
  const g = mk();
  const P = g.players[0];
  E.setOpening(g, 0, [P.deck[2].key]);
  const [b] = E.roundBattles(g);
  const { state } = E.runRoundBattle(b);
  assert.equal(state.mode, 'field');
  assert.equal(b.cfg.players[0].bonus.openingPicks, E.openingCount(g, 0));
  // 고른 시작 카드는 첫 손패에 들어 있다 (냈거나 손에 있거나)
  const id = P.deck[2].id;
  assert.ok(state.players[0].stats.plays[id] > 0 || state.players[0].hand.some((c) => c.id === id) || state.units.some((u) => u.owner === 0 && u.defId === id));
});

test('예전 칸 전투로도 봇끼리 한 경기가 끝까지 진행된다', () => {
  for (let seed = 1; seed <= 6; seed++) {
    const g = botGame(seed, ['balanced', 'balanced'], 'cells');
    assert.equal(g.phase, 'over');
    assert.ok(Math.min(...g.players.map((P) => P.hp)) <= 0);
  }
});
