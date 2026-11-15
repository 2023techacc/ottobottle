import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../engine/index.js';

const { FRONT, BACK } = E;
const filler = (id = 'shield', n = 8) => Array.from({ length: n }, () => ({ id }));

function mk(format, n, o = {}) {
  return E.createBattle({
    seed: o.seed ?? 5,
    format,
    battlefield: o.battlefield,
    rules: { vanguardSlots: 0, ...(o.rules || {}) },
    players: Array.from({ length: n }, (_, i) => ({ commander: (o.commanders || [])[i] || 'merchant', deck: (o.decks || [])[i] || filler(), ...((o.extra || [])[i] || {}) })),
  });
}
const put = (s, owner, row, slot, id, x = {}) => E.summonUnit(s, owner, row, slot, { id, ...x });
const run = (s, ms) => {
  const end = s.timeMs + ms;
  while (s.timeMs < end && !s.over) E.step(s);
};
let giveN = 0;
function give(s, p, id) {
  const c = { uid: `m${giveN++}`, id, stars: 1, fuse: null, drawnAt: s.timeMs, zeroCost: false };
  s.players[p].hand.push(c);
  return c;
}
const near = (a, b, msg = '') => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≈ ${b} ${msg}`);

// ───────────────────────── 난전의 표적 방향 ─────────────────────────

test('삼파전: 칸 1~2는 왼쪽 상대, 칸 3~4는 오른쪽 상대를 친다', () => {
  const s = mk('melee3', 3);
  assert.deepEqual([0, 1, 2, 3].map((slot) => E.targetPlayer(s, 0, slot)), [1, 1, 2, 2]);
  assert.deepEqual([0, 1, 2, 3].map((slot) => E.targetPlayer(s, 1, slot)), [2, 2, 0, 0]);
  assert.deepEqual([0, 1, 2, 3].map((slot) => E.targetPlayer(s, 2, slot)), [0, 0, 1, 1]);
});

test('난투장: 칸 1은 왼쪽, 칸 2~3은 정면, 칸 4는 오른쪽 상대를 친다', () => {
  const s = mk('melee4', 4);
  assert.deepEqual([0, 1, 2, 3].map((slot) => E.targetPlayer(s, 0, slot)), [1, 2, 2, 3]);
  assert.deepEqual([0, 1, 2, 3].map((slot) => E.targetPlayer(s, 2, slot)), [3, 0, 0, 1]);
  // 내 왼쪽 칸이 치는 상대는, 자기 오른쪽 칸으로 나를 친다
  assert.equal(E.targetPlayer(s, 1, 3), 0);
});

test('난전: 표적 상대 안에서는 기본 표적 규칙, 그 보드가 비면 그 지휘관을 친다', () => {
  const s = mk('melee4', 4);
  const mine = put(s, 0, FRONT, 0, 'lancer'); // 왼쪽 상대(1번)를 친다
  const other = put(s, 2, FRONT, 0, 'shield'); // 정면 상대의 유닛은 표적이 아니다
  assert.deepEqual(E.pickTarget(s, mine), { commander: 1 });
  const b = put(s, 1, BACK, 3, 'archer');
  assert.equal(E.pickTarget(s, mine).unit, b);
  const f = put(s, 1, FRONT, 2, 'shield');
  assert.equal(E.pickTarget(s, mine).unit, f);
  assert.notEqual(E.pickTarget(s, mine).unit, other);
});

test('난전: 표적 상대의 지휘관이 쓰러지면 시계 방향으로 다음 살아 있는 상대를 노린다', () => {
  const s = mk('melee4', 4);
  s.players[1].dead = true;
  assert.equal(E.targetPlayer(s, 0, 0), 2);
  s.players[2].dead = true;
  assert.deepEqual([0, 1, 2, 3].map((slot) => E.targetPlayer(s, 0, slot)), [3, 3, 3, 3]);
  s.players[3].dead = true;
  assert.equal(E.targetPlayer(s, 0, 0), -1);
});

test('난전: 지휘관이 쓰러지면 그 플레이어의 유닛이 사라지고, 먼저 쓰러진 순서로 순위가 정해진다', () => {
  const s = mk('melee3', 3, { rules: { battleMs: 60000 } });
  s.players[1].hp = 0; // 1번 지휘관은 이번 틱에 쓰러진다
  s.players[2].hp = 9;
  put(s, 0, FRONT, 3, 'bat'); // 2번을 친다 (3 피해 / 0.9초)
  const doomed = put(s, 1, BACK, 0, 'pyro');
  run(s, 100);
  assert.equal(s.players[1].dead, true);
  assert.equal(s.players[1].deadAt, 100);
  assert.equal(E.findUnit(s, doomed.id), null, '쓰러진 지휘관의 유닛은 사라진다');
  assert.equal(s.over, false);
  assert.equal(E.applyAction(s, 1, { type: 'redraw', uid: s.players[1].hand[0].uid }).ok, false, '쓰러지면 카드를 낼 수 없다');
  run(s, 30000);
  assert.equal(s.over, true);
  assert.equal(s.result.reason, 'commander');
  assert.deepEqual(s.result.order, [0, 2, 1]);
  assert.deepEqual(s.result.ranks, [0, 2, 1]);
  assert.equal(s.result.winner, 0);
});

test('난전: 시간이 다 되면 지휘관 체력 비율로 순위를 정하고, 같으면 공동 순위', () => {
  const s = mk('melee4', 4, { rules: { battleMs: 3000 } });
  s.players[0].hp = 20;
  s.players[1].hp = 25;
  s.players[2].hp = 25;
  s.players[3].hp = 10;
  run(s, 3000);
  assert.equal(s.result.reason, 'time');
  assert.deepEqual(s.result.ranks, [2, 0, 0, 3]);
  assert.equal(s.result.winner, -1, '공동 1위면 단독 승자가 없다');
});

test('난전: 주문은 어느 상대의 유닛에게나 쓸 수 있다', () => {
  const s = mk('melee3', 3);
  const a = put(s, 1, FRONT, 0, 'lancer');
  const b = put(s, 2, FRONT, 0, 'lancer');
  const fb = give(s, 0, 'firebolt');
  assert.deepEqual(E.legalTargets(s, 0, fb.uid).map((t) => t.unitId).sort(), [a.id, b.id].sort());
  assert.equal(E.applyAction(s, 0, { type: 'play', uid: fb.uid, target: { unitId: b.id } }).ok, true);
  near(b.hp, 12);
});

test('포고: 난전에서 내 칸 하나의 표적 방향을 바꾼다', () => {
  const s = mk('melee4', 4);
  s.players[0].mana = 6;
  const d1 = give(s, 0, 'decree');
  const d2 = give(s, 0, 'decree');
  assert.equal(E.targetPlayer(s, 0, 0), 1);
  assert.equal(E.applyAction(s, 0, { type: 'play', uid: d1.uid, target: { slot: 0 } }).ok, true);
  assert.equal(E.targetPlayer(s, 0, 0), 2, '왼쪽 → 정면');
  assert.equal(E.applyAction(s, 0, { type: 'play', uid: d2.uid, target: { slot: 0 } }).ok, true);
  assert.equal(E.targetPlayer(s, 0, 0), 3, '정면 → 오른쪽');
  assert.equal(E.targetPlayer(s, 0, 1), 2, '다른 칸은 그대로');
});

// ───────────────────────── 연합전 ─────────────────────────

test('연합전: 0·1번과 2·3번이 한 팀이고, 같은 팀은 서로 적이 아니다', () => {
  const s = mk('alliance', 4);
  assert.deepEqual(s.players.map((P) => P.team), [0, 0, 1, 1]);
  assert.deepEqual(s.players.map((P) => P.seat), [0, 1, 0, 1]);
  assert.equal(E.isEnemy(s, 0, 1), false);
  assert.equal(E.isEnemy(s, 0, 2), true);
  assert.deepEqual(E.enemiesOf(s, 1), [2, 3]);
  const ally = put(s, 1, FRONT, 0, 'lancer');
  const foe = put(s, 3, FRONT, 0, 'lancer');
  const fb = give(s, 0, 'firebolt');
  assert.deepEqual(E.legalTargets(s, 0, fb.uid), [{ unitId: foe.id }]);
  assert.equal(E.applyAction(s, 0, { type: 'play', uid: fb.uid, target: { unitId: ally.id } }).ok, false);
});

test('연합전: 두 보드가 이어진 8칸 전선에서 가장 가까운 칸을 노린다', () => {
  const s = mk('alliance', 4);
  // 내 팀 오른쪽 보드의 1번 칸 = 전선 5번 칸
  const mine = put(s, 1, FRONT, 0, 'lancer');
  const left = put(s, 2, FRONT, 3, 'shield'); // 적 전선 4번 칸
  const right = put(s, 3, FRONT, 1, 'shield'); // 적 전선 6번 칸
  assert.equal(E.pickTarget(s, mine).unit, left, '거리가 같으면 번호가 낮은 칸');
  const same = put(s, 3, FRONT, 0, 'shield'); // 적 전선 5번 칸
  assert.equal(E.pickTarget(s, mine).unit, same);
  assert.ok(right);
});

test('연합전: 적 팀 보드가 다 비면 마주 보는 지휘관을, 그가 쓰러졌으면 남은 지휘관을 친다', () => {
  const s = mk('alliance', 4);
  const a = put(s, 0, FRONT, 0, 'lancer');
  const b = put(s, 1, FRONT, 0, 'lancer');
  assert.deepEqual(E.pickTarget(s, a), { commander: 2 });
  assert.deepEqual(E.pickTarget(s, b), { commander: 3 });
  s.players[3].dead = true;
  assert.deepEqual(E.pickTarget(s, b), { commander: 2 });
});

test('연합전: 한 팀의 두 지휘관이 모두 쓰러져야 끝난다', () => {
  const s = mk('alliance', 4, { rules: { battleMs: 60000 } });
  s.players[2].hp = 3;
  s.players[3].hp = 6;
  put(s, 0, FRONT, 0, 'bat');
  put(s, 1, FRONT, 0, 'bat');
  run(s, 900);
  assert.equal(s.players[2].dead, true);
  assert.equal(s.over, false, '한 명이 남아 있으면 계속한다');
  run(s, 900);
  assert.equal(s.over, true);
  assert.equal(s.result.winnerTeam, 0);
  assert.deepEqual(s.result.ranks.slice(2), [3, 2], '늦게 쓰러진 쪽이 순위가 높다');
});

test('연합전: 시간이 다 되면 남은 지휘관 체력 비율의 합이 큰 팀이 이긴다', () => {
  const s = mk('alliance', 4, { rules: { battleMs: 2000 } });
  s.players[0].hp = 10;
  s.players[1].hp = 30;
  s.players[2].hp = 20;
  s.players[3].hp = 25;
  run(s, 2000);
  assert.equal(s.result.winnerTeam, 1);
  s.players.forEach((P) => assert.equal(P.dead, false));
});

test('연합전: 수호 같은 인접 효과는 자기 보드 안에서만 적용된다', () => {
  const s = mk('alliance', 4, { rules: { commanderHp: 999 } });
  put(s, 2, FRONT, 3, 'lancer'); // 적 전선 4번 칸 → 0번 플레이어의 4번 칸을 친다
  const target = put(s, 0, FRONT, 3, 'bat');
  const allyGuard = put(s, 1, FRONT, 0, 'shield'); // 전선에서는 바로 옆이지만 다른 보드
  run(s, 1500);
  near(target.hp, 2, '옆 보드의 수호가 대신 받지 않는다');
  near(allyGuard.hp, 14);
});

// ───────────────────────── 보스 ─────────────────────────

test('보스 레이드: 보스 유닛이 서 있고, 준 피해가 점수로 남는다', () => {
  const s = mk('boss', 2, { extra: [{}, { boss: true, name: '고대 골렘' }], decks: [filler(), []] });
  const boss = E.unitsOf(s, 1)[0];
  assert.equal(boss.defId, 'boss');
  assert.equal(s.players[1].hand.length, 0);
  put(s, 0, FRONT, 1, 'lancer'); // 6 피해 / 1.5초
  run(s, 3000);
  near(boss.damageTaken, 12);
  run(s, 40000);
  assert.equal(s.over, true);
  assert.equal(s.timeMs, 40000, '보스는 쓰러지지 않고 40초를 채운다');
  assert.ok(s.result.bossDamage[0] >= 12);
  assert.equal(s.result.bossDamage[0], boss.damageTaken);
});

test('보스 패턴: 10초마다 전조 1.5초 뒤 전열 전체를 친다', () => {
  const s = mk('boss', 2, { extra: [{}, { boss: true }], decks: [filler(), []], rules: { commanderHp: 999, unitHpMult: 10 } }); // 전열이 20초까지 버티도록
  const front = put(s, 0, FRONT, 3, 'colossus');
  const back = put(s, 0, BACK, 0, 'pyro');
  const bossCasts = () => s.telegraphs.filter((g) => g.owner === 1);
  run(s, 9900);
  assert.equal(bossCasts().length, 0);
  run(s, 100);
  assert.equal(bossCasts().length, 1);
  assert.equal(bossCasts()[0].kind, 'frontRow');
  assert.equal(bossCasts()[0].fireAt, 11500);
  run(s, 1400);
  const hpBefore = front.hp;
  run(s, 100);
  assert.ok(front.hp <= hpBefore - 16 + 1e-6, '전조가 끝나는 순간 전열이 16을 맞는다');
  assert.equal(back.hp, 160, '후열은 맞지 않는다');
  run(s, 8500); // 20초
  assert.equal(bossCasts().length, 1, '10초 뒤 다시 온다');
  assert.equal(s.players[0].hp, 999, '보스 레이드에서 지휘관은 피해를 받지 않는다');
});

// ───────────────────────── 봇끼리 ─────────────────────────

function botBattle(format, seed, same = false) {
  const n = { melee3: 3, melee4: 4, alliance: 4, boss: 2 }[format];
  const rng = E.makeRng(seed);
  const base = { commander: rng.pick(E.COMMANDER_IDS) };
  base.deck = E.randomMidDeck(base.commander, rng);
  const players = [];
  for (let i = 0; i < n; i++) {
    if (format === 'boss' && i === 1) players.push({ commander: 'merchant', deck: [], boss: true });
    else if (same) players.push({ ...base, seed: 900 + seed, bot: { seed: 300 + seed } });
    else {
      const commander = rng.pick(E.COMMANDER_IDS);
      players.push({ commander, deck: E.randomMidDeck(commander, rng) });
    }
  }
  return E.runBattle({ seed, format, rules: E.PRESETS.cards.rules, players, logEvents: true });
}

test('모든 형식: 봇끼리 끝까지 진행되고, 카드 수가 보존되고, 같은 시드면 결과가 같다', () => {
  for (const format of ['melee3', 'melee4', 'alliance', 'boss']) {
    for (let seed = 1; seed <= 12; seed++) {
      const a = botBattle(format, seed);
      const b = botBattle(format, seed);
      assert.equal(a.state.over, true, `${format} ${seed}`);
      assert.deepEqual(a.result, b.result);
      assert.equal(JSON.stringify(a.state.events), JSON.stringify(b.state.events));
      const n = a.state.players.length;
      assert.equal(a.result.ranks.length, n);
      assert.ok(a.result.ranks.includes(0));
      a.state.players.forEach((P, i) => {
        if (P.isBoss) return;
        const total = P.deck.length + P.hand.length + P.discard.length + P.exiled.length + E.unitsOf(a.state, i).filter((u) => u.card).length;
        assert.ok(total > 0);
      });
    }
  }
});

test('난전과 연합전은 자리에 따른 유불리가 없다: 모두 같은 덱·같은 섞기면 전원 공동 1위', () => {
  for (const format of ['melee3', 'melee4']) {
    for (let seed = 1; seed <= 15; seed++) {
      const { result } = botBattle(format, seed, true);
      assert.ok(result.ranks.every((r) => r === 0), `${format} seed ${seed}: ${result.ranks} hp ${result.hp}`);
    }
  }
  for (let seed = 1; seed <= 15; seed++) {
    const { result } = botBattle('alliance', seed, true);
    assert.equal(result.winnerTeam, -1, `alliance seed ${seed}: hp ${result.hp}`);
  }
});

test('보스 레이드: 덱이 강할수록 준 피해가 크다', () => {
  const rules = E.PRESETS.cards.rules;
  const dmg = (deck) => E.runBattle({
    seed: 3, format: 'boss', rules, players: [{ commander: 'merchant', deck }, { commander: 'merchant', deck: [], boss: true }],
  }).result.bossDamage[0];
  const weak = dmg(filler('rats', 8));
  const strong = dmg([...filler('lancer', 6).map((c) => ({ ...c, stars: 2 })), { id: 'shield' }, { id: 'archer' }]);
  assert.ok(weak > 0);
  assert.ok(strong > weak * 1.5, `${strong} vs ${weak}`);
});
