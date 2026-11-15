import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../engine/index.js';

const PICKS_A = ['shield', 'bat', 'archer', 'dagger', 'lancer', 'pyro', 'firebolt', 'scout'];
const PICKS_B = ['shield', 'rats', 'frostwitch', 'colossus', 'chain', 'armor', 'crystal', 'supply'];
const mk = (o = {}) => E.createGame({
  seed: o.seed ?? 4,
  econ: o.econ,
  players: [{ commander: o.c0 || 'general', picks: PICKS_A }, { commander: o.c1 || 'spy', picks: PICKS_B }],
});

test('드래프트: 지휘관 고유 카드 1장만 들고 시작하고, 3장 중 1장 고르기를 7번 한다', () => {
  const g = mk();
  assert.equal(g.phase, 'draft');
  assert.equal(g.round, 0);
  const [a, b] = g.players;
  assert.deepEqual(a.deck.map((c) => c.id), ['phalanx'], '장군의 고유 카드');
  assert.deepEqual(b.deck.map((c) => c.id), ['disrupt'], '첩보원의 고유 카드');
  assert.equal(a.draft.left, 7);
  assert.equal(a.draft.options.length, 3);
  assert.equal(E.buy(g, 0, 0).ok, false, '드래프트 중에는 상점을 쓸 수 없다');
});

test('드래프트 후보: 첫 장은 내 픽에서, 3등급까지만 뜨고, 되도록 서로 다르다', () => {
  let distinct = 0;
  let total = 0;
  const tiers = { 1: 0, 2: 0, 3: 0 };
  for (let seed = 1; seed <= 60; seed++) {
    const g = mk({ seed });
    for (const P of g.players) {
      while (P.draft.left > 0) {
        const opts = P.draft.options;
        assert.equal(opts.length, 3);
        assert.ok(P.picks.includes(opts[0]), `첫 후보 ${opts[0]}는 내 픽이어야 한다`);
        for (const id of opts) {
          assert.ok(E.CARDS[id].tier <= 3, `${id}는 4등급 이상`);
          assert.ok(E.POOL_CARD_IDS.includes(id));
          tiers[E.CARDS[id].tier]++;
        }
        total++;
        if (new Set(opts).size === 3) distinct++;
        E.draftPick(g, P.idx, 0);
      }
    }
  }
  assert.ok(distinct / total > 0.95, `서로 다른 후보 비율 ${(distinct / total).toFixed(2)}`);
  const n = tiers[1] + tiers[2] + tiers[3];
  assert.ok(tiers[1] / n > 0.5 && tiers[3] / n > 0.04 && tiers[3] / n < 0.2, JSON.stringify(tiers));
});

test('드래프트로 고른 카드는 풀에서 빠지고, 모두 다 고르면 1라운드 상점이 열린다', () => {
  const g = mk();
  const total = E.poolTotal(g);
  const [a, b] = g.players;
  const id = a.draft.options[1];
  const pool = g.pool[id];
  const res = E.draftPick(g, 0, 1);
  assert.equal(res.ok, true);
  assert.equal(res.card.id, id);
  assert.equal(g.pool[id], pool - 1);
  assert.equal(a.deck.length, 2);
  assert.equal(a.draft.left, 6);
  assert.equal(E.poolTotal(g), total);
  assert.equal(E.draftPick(g, 0, 5).ok, false);
  for (let i = 0; i < 6; i++) E.draftPick(g, 0, 0);
  assert.equal(a.deck.length, 8);
  assert.equal(E.draftPick(g, 0, 0).ok, false, '이미 다 골랐다');
  assert.equal(g.phase, 'draft', '상대가 아직 고르는 중이다');
  for (let i = 0; i < 7; i++) E.draftPick(g, 1, 2);
  assert.equal(g.phase, 'shop');
  assert.equal(g.round, 1);
  assert.equal(b.deck.length, 8);
  assert.equal(a.gold, 5);
  assert.equal(a.shop.length, 5);
  assert.equal(E.poolTotal(g), total);
});

test('드래프트한 카드는 풀에서 온 카드라서, 빼면 풀로 돌아간다', () => {
  const g = mk();
  for (const P of g.players) E.runDraftBot(g, P.idx);
  const P = g.players[0];
  P.gold = 20;
  E.buy(g, 0, 1);
  const drafted = P.deck[1];
  assert.equal(drafted.origin, 'pool');
  const pool = g.pool[drafted.id];
  assert.equal(E.removeCard(g, 0, drafted.key).ok, true);
  assert.equal(g.pool[drafted.id], pool + 1);
});

test('봇 드래프트: 8장을 채우고 유닛을 넉넉히 고른다', () => {
  let units = 0;
  let n = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const g = mk({ seed });
    for (const P of g.players) E.runDraftBot(g, P.idx);
    assert.equal(g.phase, 'shop');
    for (const P of g.players) {
      assert.equal(P.deck.length, 8);
      units += P.deck.filter((c) => E.CARDS[c.id].type === 'unit').length;
      n++;
    }
  }
  assert.ok(units / n >= 4, `평균 유닛 ${(units / n).toFixed(1)}장`);
});

test('startDecks: "commander"를 주면 예전처럼 지휘관별 시작 덱으로 바로 시작한다', () => {
  const g = E.createGame({ seed: 1, startDecks: 'commander', players: [{ commander: 'general', picks: PICKS_A }, { commander: 'spy', picks: PICKS_B }] });
  assert.equal(g.phase, 'shop');
  assert.deepEqual(g.players[0].deck.map((c) => c.id), E.COMMANDERS.general.deck);
});
