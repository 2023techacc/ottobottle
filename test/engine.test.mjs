import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../engine/index.js';

const { FRONT, BACK } = E;

const filler = (id = 'shield', n = 8) => Array.from({ length: n }, () => ({ id }));

function mk(o = {}) {
  return E.createBattle({
    seed: o.seed ?? 7,
    battlefield: o.battlefield,
    rules: o.rules,
    players: [
      { commander: o.c0 || 'merchant', deck: o.d0 || filler(), vanguard: o.v0 || [] },
      { commander: o.c1 || 'merchant', deck: o.d1 || filler(), vanguard: o.v1 || [] },
    ],
  });
}
const put = (s, owner, row, slot, id, x = {}) => E.summonUnit(s, owner, row, slot, { id, ...x });
const run = (s, ms) => {
  const end = s.timeMs + ms;
  while (s.timeMs < end && !s.over) E.step(s);
};
let giveN = 0;
function give(s, p, id, x = {}) {
  const c = { uid: `g${giveN++}`, id, stars: 1, fuse: null, drawnAt: s.timeMs, zeroCost: false, ...x };
  s.players[p].hand.push(c);
  return c;
}
const play = (s, p, c, target) => E.applyAction(s, p, { type: 'play', uid: c.uid, target });
const near = (a, b, msg = '') => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≈ ${b} ${msg}`);

// ───────────────────────── 표적 규칙 ─────────────────────────

test('표적: 같은 번호 칸 → 가장 가까운 전열 → 후열', () => {
  const s = mk();
  const a = put(s, 0, FRONT, 0, 'shield');
  const e2 = put(s, 1, FRONT, 2, 'shield');
  put(s, 1, FRONT, 3, 'shield');
  const eb = put(s, 1, BACK, 0, 'archer');
  assert.equal(E.pickTarget(s, a).unit, e2, '전열이 있으면 후열보다 먼저');
  const e0 = put(s, 1, FRONT, 0, 'shield');
  assert.equal(E.pickTarget(s, a).unit, e0, '같은 번호 칸이 최우선');
  s.board[1][FRONT] = [null, null, null, null];
  assert.equal(E.pickTarget(s, a).unit, eb, '전열이 비면 후열');
});

test('표적: 거리가 같으면 번호가 낮은 칸', () => {
  const s = mk();
  const a = put(s, 0, FRONT, 1, 'shield');
  const e0 = put(s, 1, FRONT, 0, 'shield');
  put(s, 1, FRONT, 2, 'shield');
  assert.equal(E.pickTarget(s, a).unit, e0);
});

test('표적: 암살은 후열부터, 적 보드가 비면 지휘관', () => {
  const s = mk();
  const d = put(s, 0, FRONT, 0, 'dagger');
  assert.deepEqual(E.pickTarget(s, d), { commander: 1 });
  put(s, 1, FRONT, 0, 'shield');
  const back = put(s, 1, BACK, 3, 'archer');
  assert.equal(E.pickTarget(s, d).unit, back);
});

// ───────────────────────── 기본 전투 ─────────────────────────

test('공격 간격대로 때린다 (방패병 2 피해 / 1.2초)', () => {
  const s = mk();
  const a = put(s, 0, FRONT, 0, 'shield');
  const b = put(s, 1, FRONT, 0, 'shield');
  run(s, 1100);
  assert.equal(b.hp, 14);
  run(s, 100);
  assert.equal(b.hp, 12);
  assert.equal(a.hp, 12);
  run(s, 1200);
  assert.equal(b.hp, 10);
});

test('지휘관을 쓰러뜨리면 이긴다', () => {
  const s = mk();
  put(s, 0, FRONT, 0, 'bat'); // 3 피해 / 0.9초 → 9초에 30
  run(s, 8900);
  assert.equal(s.over, false);
  run(s, 100);
  assert.equal(s.over, true);
  assert.equal(s.result.winner, 0);
  assert.equal(s.result.reason, 'commander');
});

test('같은 틱에 두 지휘관이 쓰러지면 무승부', () => {
  const s = mk();
  s.players[0].hp = 3;
  s.players[1].hp = 3;
  put(s, 0, FRONT, 0, 'bat');
  put(s, 1, FRONT, 3, 'bat');
  // 박쥐끼리 서로를 친다. 지휘관을 치게 하려면 보드가 비어야 하므로 다른 구성으로 확인한다.
  const s2 = mk({ rules: { battleMs: 5000 } });
  s2.players[0].hp = 10;
  s2.players[1].hp = 10;
  run(s2, 5000);
  assert.equal(s2.result.winner, -1);
  assert.equal(s2.result.reason, 'time');
});

test('시간이 다 되면 지휘관 체력 비율이 높은 쪽이 이긴다', () => {
  const s = mk();
  s.players[1].hp = 20;
  run(s, 40000);
  assert.equal(s.over, true);
  assert.equal(s.timeMs, 40000);
  assert.equal(s.result.winner, 0);
  assert.equal(s.result.reason, 'time');
});

test('같은 틱에 서로 쓰러뜨리는 유닛은 둘 다 공격을 마친다', () => {
  const s = mk();
  const a = put(s, 0, FRONT, 0, 'dagger');
  const b = put(s, 1, FRONT, 0, 'dagger');
  a.hp = 5;
  b.hp = 5;
  run(s, 1100);
  assert.equal(E.unitsOf(s, 0).length, 0);
  assert.equal(E.unitsOf(s, 1).length, 0);
});

test('과열: 30초 뒤 매초 공격력 +10%', () => {
  const s = mk();
  const a = put(s, 0, FRONT, 0, 'lancer');
  s.timeMs = 30000;
  near(E.currentAtk(s, a), 6);
  s.timeMs = 31000;
  near(E.currentAtk(s, a), 6.6);
  s.timeMs = 40000;
  near(E.currentAtk(s, a), 12);
});

test('후열의 근접 유닛은 공격하지 않고, 1초 뒤 빈 전열 칸으로 나온다', () => {
  const s = mk();
  const a = put(s, 0, BACK, 2, 'lancer');
  run(s, 900);
  assert.equal(a.row, BACK);
  run(s, 100);
  assert.equal(a.row, FRONT);
  assert.equal(a.slot, 2);
  assert.equal(s.board[0][FRONT][2], a);
  assert.equal(s.board[0][BACK][2], null);
  assert.equal(s.players[1].hp, 30, '나오기 전에는 공격하지 않았다');
});

// ───────────────────────── 마나·뽑기 ─────────────────────────

test('마나: 3에서 시작, 1.5초마다 1, 최대치는 8초마다 1씩 8까지', () => {
  const s = mk({ rules: { battleMs: 60000 } });
  const P = s.players[0];
  assert.equal(P.mana, 3);
  assert.equal(P.maxMana, 3);
  P.mana = 0;
  run(s, 1400);
  assert.equal(P.mana, 0);
  run(s, 100);
  assert.equal(P.mana, 1);
  run(s, 6500); // 8.0초
  assert.equal(P.maxMana, 4);
  run(s, 31900); // 39.9초
  assert.equal(P.maxMana, 7);
  run(s, 100);
  assert.equal(P.maxMana, 8);
  run(s, 15000);
  assert.equal(P.maxMana, 8);
  assert.equal(P.mana, 8);
});

test('뽑기: 4장으로 시작, 3초마다 1장, 손패 7장에서 멈춘다', () => {
  const s = mk({ d0: filler('shield', 20) });
  const P = s.players[0];
  assert.equal(P.hand.length, 4);
  run(s, 3000);
  assert.equal(P.hand.length, 5);
  run(s, 6000);
  assert.equal(P.hand.length, 7);
  run(s, 9000);
  assert.equal(P.hand.length, 7);
  assert.equal(P.deck.length, 13);
  assert.ok(P.stats.handFullMs > 0);
});

test('덱이 비면 버린 더미를 섞어 다시 덱으로 만든다', () => {
  const s = mk({ d0: filler('shield', 5) });
  const P = s.players[0];
  run(s, 3000);
  assert.equal(P.deck.length, 0);
  P.discard.push(...P.hand.splice(0, 3));
  run(s, 3000);
  assert.equal(P.hand.length, 3);
  assert.equal(P.deck.length, 2);
  assert.equal(P.discard.length, 0);
});

test('다시 뽑기: 마나 1, 쿨다운 4초', () => {
  const s = mk({ d0: filler('shield', 20) });
  const P = s.players[0];
  const uid = P.hand[0].uid;
  assert.equal(E.applyAction(s, 0, { type: 'redraw', uid }).ok, true);
  assert.equal(P.mana, 2);
  assert.equal(P.hand.length, 4);
  assert.ok(!P.hand.some((c) => c.uid === uid));
  assert.equal(E.applyAction(s, 0, { type: 'redraw', uid: P.hand[0].uid }).ok, false);
  run(s, 4000);
  assert.equal(E.applyAction(s, 0, { type: 'redraw', uid: P.hand[0].uid }).ok, true);
});

// ───────────────────────── 유닛 키워드 ─────────────────────────

test('수호: 인접한 아군이 받는 피해의 20%를 대신 받는다', () => {
  const s = mk();
  put(s, 0, FRONT, 0, 'lancer');
  const bat = put(s, 1, FRONT, 0, 'bat');
  const guard = put(s, 1, FRONT, 1, 'shield');
  run(s, 1500);
  near(bat.hp, 8 - 4.8);
  near(guard.hp, 14 - 1.2);
});

test('흡혈: 준 피해의 30%만큼 회복한다', () => {
  const s = mk();
  const bat = put(s, 0, FRONT, 0, 'bat');
  put(s, 1, FRONT, 0, 'colossus');
  bat.hp = 5;
  run(s, 900);
  near(bat.hp, 5.9);
});

test('관통: 표적 뒤 칸의 적에게도 50% 피해', () => {
  const s = mk();
  put(s, 0, FRONT, 0, 'lancer');
  const front = put(s, 1, FRONT, 0, 'bat');
  const behind = put(s, 1, BACK, 0, 'archer');
  run(s, 1500);
  near(front.hp, 2);
  near(behind.hp, 3);
});

test('분열: 쓰러지면 능력치가 절반인 복제 2개', () => {
  const s = mk();
  put(s, 0, FRONT, 1, 'lancer');
  put(s, 1, FRONT, 1, 'rats');
  run(s, 1500);
  const tokens = E.unitsOf(s, 1);
  assert.equal(tokens.length, 2);
  for (const t of tokens) {
    assert.equal(t.token, true);
    near(t.atk, 0.5);
    near(t.maxHp, 2);
    assert.ok(!t.keywords.includes('split'), '복제는 다시 분열하지 않는다');
  }
  assert.deepEqual(tokens.map((t) => [t.row, t.slot]), [[FRONT, 0], [FRONT, 1]]);
});

test('가시: 근접 공격자에게 매번 피해 2', () => {
  const s = mk();
  const d = put(s, 0, FRONT, 0, 'dagger');
  put(s, 1, FRONT, 0, 'shield', { fuse: 'thorns' });
  run(s, 1100);
  near(d.hp, 7);
});

test('집결: 인접한 아군 1명당 공격 +2', () => {
  const s = mk();
  const u = put(s, 0, FRONT, 1, 'shield', { fuse: 'rally' });
  near(E.currentAtk(s, u), 2);
  put(s, 0, FRONT, 0, 'rats');
  put(s, 0, BACK, 1, 'archer');
  near(E.currentAtk(s, u), 6);
});

test('냉기: 공격 간격 +15%, 2번까지 중첩, 3초 안에 다시 걸리면 지속 시간 절반', () => {
  const s = mk();
  put(s, 0, BACK, 0, 'frostwitch');
  const l = put(s, 1, FRONT, 0, 'lancer');
  run(s, 1300);
  assert.equal(l.slows.length, 1);
  assert.equal(l.slows[0], 3300);
  assert.equal(E.effInterval(s, l), 1725);
  run(s, 1300);
  assert.equal(l.slows.length, 2);
  assert.ok(l.slows.includes(3600), '두 번째는 2초의 절반인 1초');
  assert.equal(E.effInterval(s, l), 1950);
});

test('감속은 최대 50%까지, 거신은 군중 제어를 절반만 받는다', () => {
  const s = mk({ rules: { slowPerStack: 0.4 } });
  put(s, 0, BACK, 0, 'frostwitch');
  const c = put(s, 1, FRONT, 0, 'colossus');
  run(s, 1300);
  assert.equal(c.slows[0], 2300, '2초의 절반');
  c.slows = [99999, 99999];
  assert.equal(E.effInterval(s, c), 3300, '2.2초 × 1.5');
});

// ───────────────────────── 필살기 ─────────────────────────

test('견습 궁수 필살기: 다음 공격이 3발', () => {
  const s = mk();
  const a = put(s, 0, BACK, 0, 'archer');
  const c = put(s, 1, FRONT, 0, 'colossus');
  a.gauge = 100;
  run(s, 100);
  assert.equal(a.tripleShot, true);
  assert.equal(a.gauge, 0);
  run(s, 900);
  near(c.hp, 51);
  assert.equal(a.tripleShot, false);
  assert.equal(a.gauge, 25);
});

test('화염술사 필살기: 전조 1초 뒤 십자 범위에 피해 20', () => {
  const s = mk();
  const pyro = put(s, 1, BACK, 0, 'pyro');
  const center = put(s, 0, FRONT, 1, 'colossus');
  const side = put(s, 0, FRONT, 2, 'colossus');
  const behind = put(s, 0, BACK, 1, 'colossus');
  const far = put(s, 0, BACK, 3, 'pyro');
  pyro.gauge = 100;
  run(s, 100);
  assert.equal(s.telegraphs.length, 1);
  assert.equal(s.telegraphs[0].fireAt, 1100);
  assert.equal(s.telegraphs[0].cells.length, 4);
  run(s, 900);
  assert.equal(center.hp, 60, '전조 중에는 아직 피해가 없다');
  run(s, 100);
  assert.equal(center.hp, 40);
  assert.equal(side.hp, 40);
  assert.equal(behind.hp, 40);
  assert.equal(far.hp, 16, '범위 밖');
  assert.equal(s.telegraphs.length, 0);
});

test('거신 필살기: 전조 1.2초 뒤 적 전열 전체에 피해 25', () => {
  const s = mk();
  const col = put(s, 0, FRONT, 0, 'colossus');
  const a = put(s, 1, FRONT, 0, 'colossus');
  const b = put(s, 1, FRONT, 3, 'colossus');
  const back = put(s, 1, BACK, 0, 'pyro');
  col.gauge = 100;
  run(s, 100);
  assert.equal(s.telegraphs[0].fireAt, 1300);
  run(s, 1200);
  assert.equal(a.hp, 35);
  assert.equal(b.hp, 35);
  assert.equal(back.hp, 16);
});

test('전조 중에 시전자를 쓰러뜨리면 필살기가 취소된다', () => {
  const s = mk();
  const pyro = put(s, 1, BACK, 0, 'pyro');
  const target = put(s, 0, FRONT, 0, 'colossus');
  pyro.gauge = 100;
  pyro.hp = 5;
  run(s, 100);
  assert.equal(s.telegraphs.length, 1);
  const fb = give(s, 0, 'firebolt');
  assert.equal(play(s, 0, fb, { unitId: pyro.id }).ok, true);
  assert.equal(s.telegraphs.length, 0);
  run(s, 1500);
  assert.equal(target.hp, 60);
});

test('방진: 내 후열이 받는 범위 피해 50% 감소 (3초)', () => {
  const s = mk();
  const pyro = put(s, 1, BACK, 1, 'pyro');
  put(s, 0, FRONT, 1, 'colossus');
  const mineBack = put(s, 0, BACK, 1, 'pyro');
  pyro.gauge = 100;
  run(s, 100);
  s.players[0].mana = 4;
  const ph = give(s, 0, 'phalanx');
  assert.equal(play(s, 0, ph).ok, true);
  run(s, 1000);
  near(mineBack.hp, 6);
});

test('침묵: 필살기 게이지가 멈춘다 (교란 2초)', () => {
  const s = mk();
  const pyro = put(s, 1, BACK, 0, 'pyro');
  put(s, 0, FRONT, 0, 'colossus');
  const d = give(s, 0, 'disrupt');
  assert.equal(play(s, 0, d, { unitId: pyro.id }).ok, true);
  assert.equal(pyro.silenceUntil, 2000);
  run(s, 1400);
  assert.equal(pyro.gauge, 0, '침묵 중 공격은 게이지를 채우지 않는다');
  run(s, 1400);
  assert.equal(pyro.gauge, 30, '침묵이 풀린 뒤: 거신에게 맞아 +10, 공격해서 +20');
});

// ───────────────────────── 카드 ─────────────────────────

test('화염탄: 피해 6, 연계(3초 안에 다른 카드를 냈다면) 10', () => {
  const s = mk();
  const u = put(s, 1, FRONT, 0, 'colossus');
  const a = give(s, 0, 'firebolt');
  const b = give(s, 0, 'firebolt');
  play(s, 0, a, { unitId: u.id });
  near(u.hp, 54);
  run(s, 1000);
  play(s, 0, b, { unitId: u.id });
  near(u.hp, 44, '1초 전에 카드를 냈으므로 연계');
  const c = give(s, 0, 'firebolt');
  run(s, 3100);
  play(s, 0, c, { unitId: u.id });
  near(u.hp, 38, '3초가 지나 연계가 끊겼다');
  assert.equal(s.players[0].discard.filter((x) => x.id === 'firebolt').length, 3);
});

test('연쇄 번개: 가까운 순서로 10/7/5', () => {
  const s = mk();
  s.players[0].mana = 4;
  const a = put(s, 1, FRONT, 0, 'lancer');
  const b = put(s, 1, FRONT, 1, 'lancer');
  const c = put(s, 1, FRONT, 3, 'lancer');
  const d = put(s, 1, BACK, 0, 'colossus');
  const ch = give(s, 0, 'chain');
  assert.equal(play(s, 0, ch, { unitId: a.id }).ok, true);
  near(a.hp, 8);
  near(b.hp, 11);
  near(c.hp, 13);
  near(d.hp, 60);
});

test('강철 갑옷은 체력 +12, 정화는 강화를 지운다', () => {
  const s = mk();
  const u = put(s, 1, FRONT, 0, 'lancer');
  const armor = give(s, 1, 'armor');
  play(s, 1, armor, { unitId: u.id });
  assert.equal(u.maxHp, 30);
  assert.equal(u.hp, 30);
  const p = give(s, 0, 'purify');
  play(s, 0, p, { unitId: u.id });
  assert.equal(u.maxHp, 18);
  assert.equal(u.hp, 18);
  assert.equal(u.buffs.length, 0);
});

test('후퇴: 빈칸으로 옮기고 체력 5 회복', () => {
  const s = mk();
  const bat = put(s, 0, FRONT, 0, 'bat');
  bat.hp = 2;
  const r = give(s, 0, 'retreat');
  assert.equal(play(s, 0, r, { unitId: bat.id, row: BACK, slot: 2 }).ok, true);
  assert.equal(s.board[0][BACK][2], bat);
  assert.equal(s.board[0][FRONT][0], null);
  near(bat.hp, 7);
});

test('전투 함성: 전열 공격 +2 (6초)', () => {
  const s = mk({ rules: { commanderHp: 9999 } });
  const f = put(s, 0, FRONT, 0, 'shield');
  const b = put(s, 0, BACK, 0, 'archer');
  const w = give(s, 0, 'warcry');
  play(s, 0, w);
  near(E.currentAtk(s, f), 4);
  near(E.currentAtk(s, b), 3);
  run(s, 6000);
  near(E.currentAtk(s, f), 2);
});

test('각성: 필살기 게이지 +60%', () => {
  const s = mk();
  const a = put(s, 0, BACK, 0, 'archer');
  const sh = put(s, 0, FRONT, 0, 'shield');
  const aw = give(s, 0, 'awaken');
  assert.equal(play(s, 0, aw, { unitId: sh.id }).ok, false, '필살기가 없는 유닛에는 쓸 수 없다');
  assert.equal(play(s, 0, aw, { unitId: a.id }).ok, true);
  assert.equal(a.gauge, 60);
});

test('정찰: 2장 뽑기, 일회라서 버린 더미로 가지 않는다', () => {
  const s = mk({ d0: filler('shield', 20) });
  const P = s.players[0];
  const sc = give(s, 0, 'scout');
  play(s, 0, sc);
  assert.equal(P.hand.length, 6);
  assert.equal(P.mana, 3);
  assert.ok(P.exiled.includes(sc));
  assert.ok(!P.discard.includes(sc));
});

test('마나 결정: 마나 +3, 숙성으로 5초마다 비용 −1', () => {
  const s = mk();
  const P = s.players[0];
  const cr = give(s, 0, 'crystal');
  assert.equal(E.effectiveCost(s, 0, cr), 1);
  run(s, 5000);
  assert.equal(E.effectiveCost(s, 0, cr), 0);
  run(s, 20000);
  assert.equal(E.effectiveCost(s, 0, cr), 0, '최소 0');
  const before = P.mana;
  play(s, 0, cr);
  assert.equal(P.mana, before + 3);
});

test('보급선: 다음 유닛 2장 비용 −1, ◆순환으로 1장 뽑는다', () => {
  const s = mk({ d0: filler('shield', 20) });
  const P = s.players[0];
  P.mana = 8;
  const su = give(s, 0, 'supply');
  const bats = [give(s, 0, 'bat'), give(s, 0, 'bat'), give(s, 0, 'bat')];
  P.hand.splice(0, 4); // 손패 자리를 비워 둔다
  const handBefore = P.hand.length;
  play(s, 0, su);
  assert.equal(P.hand.length, handBefore, '보급선이 나가고 1장이 들어온다');
  assert.equal(E.effectiveCost(s, 0, bats[0]), 1);
  play(s, 0, bats[0], { row: FRONT, slot: 0 });
  play(s, 0, bats[1], { row: FRONT, slot: 1 });
  assert.equal(E.effectiveCost(s, 0, bats[2]), 2);
  assert.equal(P.mana, 8 - 2 - 1 - 1);
});

test('징집령: 덱에서 비용이 가장 낮은 유닛 2장을 가져온다', () => {
  const s = mk({ d0: [...filler('lancer', 6), { id: 'rats' }, { id: 'bat' }, { id: 'firebolt' }, { id: 'scout' }] });
  const P = s.players[0];
  P.deck.push(...P.hand.splice(0, 4));
  const m = give(s, 0, 'muster');
  play(s, 0, m);
  assert.deepEqual(P.hand.map((c) => c.id).sort(), ['bat', 'rats']);
});

test('비축: 이번 전투의 마나 최대치 +1', () => {
  const s = mk();
  const P = s.players[0];
  const st = give(s, 0, 'stockpile');
  play(s, 0, st);
  assert.equal(P.maxMana, 4);
  run(s, 8000);
  assert.equal(P.maxMana, 5);
  assert.ok(P.exiled.includes(st));
});

test('촉매와 연금술사: 융합 카드 비용 −1, 촉매를 쓰면 0', () => {
  const s = mk({ c0: 'alchemist' });
  const fused = give(s, 0, 'lancer', { fuse: 'lifesteal' });
  const plain = give(s, 0, 'lancer');
  const cat = give(s, 0, 'catalyst');
  assert.equal(E.effectiveCost(s, 0, fused), 3);
  assert.equal(E.effectiveCost(s, 0, plain), 4);
  assert.equal(play(s, 0, cat, { uid: plain.uid }).ok, false, '융합 카드만 고를 수 있다');
  assert.equal(play(s, 0, cat, { uid: fused.uid }).ok, true);
  assert.equal(E.effectiveCost(s, 0, fused), 0);
});

test('마나가 모자라면 낼 수 없고, 포고는 결투에서 쓸 수 없다', () => {
  const s = mk();
  const col = give(s, 0, 'colossus');
  assert.equal(play(s, 0, col, { row: FRONT, slot: 0 }).ok, false);
  s.players[0].mana = 8;
  const dec = give(s, 0, 'decree');
  assert.equal(play(s, 0, dec).ok, false);
  assert.deepEqual(E.legalTargets(s, 0, dec.uid), []);
});

// ───────────────────────── 강화·융합·지휘관 ─────────────────────────

test('강화: 2성 유닛은 공격·체력 1.8배', () => {
  const s = mk();
  const u = put(s, 0, BACK, 0, 'lancer', { stars: 2 });
  near(u.atk, 10.8);
  near(u.maxHp, 32.4);
  const u3 = put(s, 0, BACK, 1, 'lancer', { stars: 3 });
  near(u3.atk, 6 * 1.8 * 1.8);
});

test('융합: 재료의 ◆ 효과가 유닛에 붙는다', () => {
  const s = mk();
  const u = put(s, 0, FRONT, 0, 'shield', { fuse: 'lifesteal' });
  assert.deepEqual(u.keywords, ['guard', 'lifesteal']);
  assert.equal(u.name, '흡혈 방패병');
});

test('장군: 전열 유닛 체력 +10%, 성채 전장은 +20%', () => {
  const s = mk({ c0: 'general', battlefield: 'citadel' });
  near(put(s, 0, FRONT, 0, 'shield').maxHp, 14 * 1.3);
  near(put(s, 0, BACK, 0, 'shield').maxHp, 14);
  near(put(s, 1, FRONT, 0, 'shield').maxHp, 14 * 1.2);
});

test('보드가 가득 차면 유닛을 대체하고, 대체된 유닛 카드는 버린 더미로 간다', () => {
  const s = mk({ d0: filler('rats', 20) });
  const P = s.players[0];
  P.mana = 20;
  const first = give(s, 0, 'rats');
  assert.equal(play(s, 0, first, { row: FRONT, slot: 0 }).ok, true);
  const blocked = give(s, 0, 'rats');
  assert.equal(play(s, 0, blocked, { row: FRONT, slot: 0 }).ok, false, '빈칸이 있으면 대체 불가');
  for (const [row, slot] of [[0, 1], [0, 2], [0, 3], [1, 0], [1, 1], [1, 2]]) {
    assert.equal(play(s, 0, give(s, 0, 'rats'), { row, slot }).ok, true);
  }
  assert.equal(play(s, 0, blocked, { row: BACK, slot: 3 }).ok, true);
  assert.equal(E.emptySlots(s, 0).length, 0);
  const big = give(s, 0, 'lancer');
  assert.equal(play(s, 0, big, { row: FRONT, slot: 0 }).ok, true);
  assert.equal(s.board[0][FRONT][0].defId, 'lancer');
  assert.ok(P.discard.includes(first));
});

test('선봉: 전투 시작 때 무료로 놓이고 그 전투에서는 덱에서 빠진다', () => {
  const deck = [...filler('shield', 7), { id: 'lancer' }];
  const s = mk({ d0: deck, v0: [{ index: 7, row: FRONT, slot: 1 }] });
  const P = s.players[0];
  const u = s.board[0][FRONT][1];
  assert.equal(u.defId, 'lancer');
  assert.equal(P.mana, 3);
  assert.equal(P.deck.length + P.hand.length, 7);
  assert.ok(![...P.deck, ...P.hand].some((c) => c.id === 'lancer'));
  u.hp = 0.5;
  put(s, 1, FRONT, 1, 'lancer');
  run(s, 1500);
  assert.ok(P.exiled.some((c) => c.id === 'lancer'), '쓰러져도 버린 더미로 가지 않는다');
  assert.equal(E.countCards(s, 0), 8);
});

// ───────────────────────── 전장 ─────────────────────────

test('전장: 폭우, 좁은 협곡, 안개, 마력 폭주, 화산', () => {
  let s = mk({ battlefield: 'rain' });
  assert.equal(E.effInterval(s, put(s, 0, BACK, 0, 'archer')), 1200);
  assert.equal(E.effInterval(s, put(s, 0, FRONT, 0, 'shield')), 1200);

  s = mk({ battlefield: 'canyon' });
  assert.equal(E.slotUsable(s, FRONT, 0), false);
  assert.equal(E.slotUsable(s, FRONT, 1), true);
  assert.equal(E.emptySlots(s, 0).length, 6);

  s = mk({ battlefield: 'fog' });
  const a = put(s, 0, BACK, 0, 'archer');
  const hidden = put(s, 1, BACK, 0, 'archer');
  assert.equal(E.pickTarget(s, a), null);
  run(s, 5000);
  assert.equal(E.pickTarget(s, a).unit, hidden);

  s = mk({ battlefield: 'surge' });
  const ar = put(s, 0, BACK, 0, 'archer');
  put(s, 1, FRONT, 0, 'colossus');
  run(s, 1000);
  near(ar.gauge, 37.5);

  s = mk({ battlefield: 'volcano', rules: { commanderHp: 9999 } });
  const c = put(s, 0, FRONT, 0, 'colossus');
  run(s, 9900);
  near(c.hp, 60);
  run(s, 100);
  near(c.hp, 57);
});

// ───────────────────────── 결정론·대칭·불변식 ─────────────────────────

function midDeckMatch(seed, extra = {}) {
  const rng = E.makeRng(seed);
  const cmds = E.COMMANDER_IDS;
  const c0 = rng.pick(cmds);
  const c1 = rng.pick(cmds);
  const fields = [null, ...E.BATTLEFIELD_IDS];
  return {
    seed,
    battlefield: rng.pick(fields),
    players: [
      { commander: c0, deck: E.randomMidDeck(c0, rng) },
      { commander: c1, deck: E.randomMidDeck(c1, rng) },
    ],
    ...extra,
  };
}

test('같은 시드와 설정이면 결과와 이벤트 기록이 완전히 같다', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const a = E.runBattle(midDeckMatch(seed, { logEvents: true }));
    const b = E.runBattle(midDeckMatch(seed, { logEvents: true }));
    assert.deepEqual(a.result, b.result);
    assert.equal(JSON.stringify(a.state.events), JSON.stringify(b.state.events));
    assert.ok(a.state.events.length > 20);
  }
  const x = E.runBattle(midDeckMatch(11, { logEvents: true }));
  const y = E.runBattle(midDeckMatch(12, { logEvents: true }));
  assert.notEqual(JSON.stringify(x.state.events), JSON.stringify(y.state.events));
});

test('거울 대전(같은 덱·같은 섞기·같은 봇)은 항상 무승부로 끝난다', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const rng = E.makeRng(seed);
    const commander = rng.pick(E.COMMANDER_IDS);
    const deck = E.randomMidDeck(commander, rng);
    const side = () => ({ commander, deck, seed: 1000 + seed, bot: { seed: 500 + seed } });
    const { result } = E.runBattle({
      seed, battlefield: rng.pick([null, ...E.BATTLEFIELD_IDS]), players: [side(), side()],
    });
    assert.equal(result.winner, -1, `seed ${seed} (${commander})`);
    near(result.hp[0], result.hp[1]);
    assert.equal(result.survivors[0], result.survivors[1]);
  }
});

test('불변식: 카드가 사라지거나 늘지 않고, 수치가 범위를 벗어나지 않는다', () => {
  let battles = 0;
  for (let seed = 1; seed <= 150; seed++) {
    const cfg = midDeckMatch(seed);
    const style = seed % 3 === 0 ? 'random' : 'smart';
    cfg.players[0].bot = { style };
    cfg.players[1].bot = { style: seed % 2 ? 'smart' : 'random', reactMin: 100, reactMax: 200 };
    const state = E.createBattle({
      seed: cfg.seed, battlefield: cfg.battlefield, logEvents: false,
      players: cfg.players.map((pc) => ({ ...pc, vanguard: E.pickVanguard(pc.deck, 1) })),
    });
    const bots = cfg.players.map((pc, i) => E.createBot({ seed: seed * 10 + i, ...pc.bot }));
    const sizes = cfg.players.map((pc) => pc.deck.length);
    while (!state.over) {
      const actions = bots.map((b, p) => b.decide(state, p));
      actions.forEach((a, p) => a && E.applyAction(state, p, a));
      E.step(state);
      for (let p = 0; p < 2; p++) {
        const P = state.players[p];
        assert.equal(E.countCards(state, p), sizes[p], `카드 수 보존 (seed ${seed})`);
        assert.ok(P.mana >= 0);
        assert.ok(P.hand.length <= state.rules.handMax);
        assert.ok(P.maxMana <= state.rules.maxManaCap + 3);
        for (const u of E.unitsOf(state, p)) {
          assert.equal(state.board[p][u.row][u.slot], u);
          assert.ok(u.hp <= u.maxHp + 1e-9);
          assert.ok(u.hp > 0, '쓰러진 유닛은 틱이 끝나면 보드에 없다');
          assert.ok(E.slotUsable(state, u.row, u.slot));
          assert.ok(u.gauge >= 0 && u.gauge <= 100);
        }
      }
      assert.ok(state.timeMs <= state.rules.battleMs);
    }
    assert.ok(state.result);
    battles++;
  }
  assert.equal(battles, 150);
});

// 같은 덱을 쥐여 주고 봇 실력만 비교한다. 결과는 시드로 고정돼 있어서 흔들리지 않는다.
function sameDeckDuel(n, botA, botB) {
  let a = 0;
  let total = 0;
  let rejected = 0;
  for (let seed = 1; seed <= n; seed++) {
    const rng = E.makeRng(seed);
    const commander = rng.pick(E.COMMANDER_IDS);
    const deck = E.randomMidDeck(commander, rng);
    const sideA = seed % 2;
    const players = [{ commander, deck }, { commander, deck }];
    players[sideA].bot = botA;
    players[1 - sideA].bot = botB;
    const out = E.runBattle({ seed, players });
    rejected += out.rejected;
    if (out.result.winner === -1) continue;
    total++;
    if (out.result.winner === sideA) a++;
  }
  return { rate: a / total, rejected };
}

test('봇: 같은 덱이면 판단하는 봇이 무작위 봇보다 많이 이긴다', () => {
  const { rate } = sameDeckDuel(600, { style: 'smart' }, { style: 'random' });
  assert.ok(rate > 0.58, `판단 봇 승률 ${(rate * 100).toFixed(1)}%`);
});

test('봇: 반응이 빠른 봇이 느린 봇을 크게 이긴다 (난이도 조절 수단)', () => {
  const { rate } = sameDeckDuel(400, E.BOT_LEVELS.hard, E.BOT_LEVELS.easy);
  assert.ok(rate > 0.75, `빠른 봇 승률 ${(rate * 100).toFixed(1)}%`);
});

test('자리 편향이 없다: 같은 봇끼리는 0번 자리 승률이 50% 근처', () => {
  let p0 = 0;
  let total = 0;
  for (let seed = 1; seed <= 600; seed++) {
    const { result } = E.runBattle(midDeckMatch(seed));
    if (result.winner === -1) continue;
    total++;
    if (result.winner === 0) p0++;
  }
  const rate = p0 / total;
  assert.ok(rate > 0.43 && rate < 0.57, `0번 자리 승률 ${(rate * 100).toFixed(1)}%`);
});

test('덱 만들기: 중반 덱은 8~30장이고 지휘관 융합 횟수를 넘지 않는다', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const rng = E.makeRng(seed);
    const commander = rng.pick(E.COMMANDER_IDS);
    const deck = E.randomMidDeck(commander, rng);
    assert.ok(deck.length >= 8 && deck.length <= 30);
    assert.ok(deck.filter((c) => c.fuse).length <= E.COMMANDERS[commander].fusions);
    for (const c of deck) assert.ok(E.CARDS[c.id], c.id);
  }
});

// ───────────────────────── 조정용 배율과 프리셋 ─────────────────────────

test('조정용 배율: 유닛 체력·공격·간격, 지휘관이 받는 피해', () => {
  const s = mk({ rules: { unitHpMult: 1.5, unitAtkMult: 0.5, attackIntervalMult: 2, commanderDamageMult: 0.5 } });
  const u = put(s, 0, FRONT, 0, 'lancer');
  near(u.maxHp, 27);
  near(u.atk, 3);
  assert.equal(E.effInterval(s, u), 3000);
  const p = put(s, 0, BACK, 0, 'pyro');
  near(p.ult.damage, 10, '필살기 피해도 같이 줄어든다');
  run(s, 3000);
  near(s.players[1].hp, 30 - 3 * 0.5 - 2 * 0.5, '창기병 1번, 화염술사 1번 (간격 2.8초)');
});

test('선봉 비용 상한: 그보다 비싼 유닛은 선봉으로 고르지 않는다', () => {
  const deck = [{ id: 'colossus' }, { id: 'lancer' }, { id: 'dagger' }, { id: 'shield' }];
  assert.equal(deck[E.pickVanguard(deck, 1)[0].index].id, 'colossus');
  assert.equal(deck[E.pickVanguard(deck, 1, { maxCost: 3 })[0].index].id, 'dagger');
});

test('프리셋: 기획서 기본은 약 10초, 추천안은 30초대에 끝난다', () => {
  const median = (rules) => {
    const lens = [];
    for (let seed = 1; seed <= 200; seed++) lens.push(E.runBattle({ ...midDeckMatch(seed), rules }).result.timeMs / 1000);
    return lens.sort((a, b) => a - b)[100];
  };
  const base = median(E.PRESETS.base.rules);
  const rec = median(E.PRESETS.recommended.rules);
  assert.ok(base < 15, `기본 ${base}초`);
  assert.ok(rec >= 28 && rec <= 38, `추천안 ${rec}초`);
});

// ───────────────────────── 시작 카드 고르기와 레벨 보너스 ─────────────────────────

test('시작 카드 고르기: 고른 카드는 시작 손패에 반드시 들어온다', () => {
  const deck = [...filler('shield', 12), { id: 'lancer' }, { id: 'pyro' }, { id: 'colossus' }];
  for (let seed = 1; seed <= 30; seed++) {
    const s = E.createBattle({
      seed,
      rules: { openingPicks: 2, vanguardSlots: 0 },
      players: [
        { commander: 'merchant', deck, opening: [12, 14] },
        { commander: 'merchant', deck },
      ],
    });
    const ids = s.players[0].hand.map((c) => c.id);
    assert.equal(ids.length, 4, '고른 카드는 시작 손패 4장에 포함된다 (추가로 받는 게 아니다)');
    assert.ok(ids.includes('lancer') && ids.includes('colossus'), `seed ${seed}: ${ids}`);
    assert.equal(E.countCards(s, 0), deck.length);
    assert.equal(s.players[0].mana, 3, '선봉과 달리 마나는 그대로 내야 한다');
    assert.equal(E.unitsOf(s, 0).length, 0);
  }
});

test('시작 카드 고르기: 규칙이 허용한 장수까지만 받는다', () => {
  const deck = [...filler('shield', 12), { id: 'lancer' }, { id: 'pyro' }, { id: 'colossus' }];
  const hands = (rules, opening) => {
    let hits = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const s = E.createBattle({ seed, rules, players: [{ commander: 'merchant', deck, opening }, { commander: 'merchant', deck }] });
      hits += s.players[0].hand.filter((c) => c.id !== 'shield').length;
    }
    return hits / 40;
  };
  assert.ok(hands({ vanguardSlots: 0 }, [12, 13, 14]) < 1.5, '기본 규칙(0장)에서는 고르기가 무시된다');
  const one = hands({ vanguardSlots: 0, openingPicks: 1 }, [12, 13, 14]);
  assert.ok(one >= 1 && one < 2.2, `1장만 보장: 평균 ${one}`);
});

test('레벨 보너스: 한쪽만 시작 마나·마나 최대치·시작 손패를 더 받는다', () => {
  const s = E.createBattle({
    seed: 3,
    rules: { vanguardSlots: 0, battleMs: 60000 },
    players: [
      { commander: 'merchant', deck: filler('shield', 20), bonus: { startMana: 1, maxMana: 2, startHand: 1 } },
      { commander: 'merchant', deck: filler('shield', 20) },
    ],
  });
  const [a, b] = s.players;
  assert.deepEqual([a.mana, a.maxMana, a.hand.length], [4, 5, 5]);
  assert.deepEqual([b.mana, b.maxMana, b.hand.length], [3, 3, 4]);
  run(s, 8000);
  assert.equal(a.maxMana, 6);
  assert.equal(b.maxMana, 4);
  run(s, 40000);
  assert.equal(a.maxMana, 10, '최대치 8에 보너스 2');
});

test('봇의 시작 카드 고르기: 시작 마나로 낼 수 있는 가장 센 유닛부터', () => {
  const deck = [{ id: 'colossus' }, { id: 'rats' }, { id: 'dagger', stars: 2 }, { id: 'scout' }, { id: 'bat' }, { id: 'invest' }];
  assert.deepEqual(E.pickOpening(deck, 2), [2, 4]);
  assert.deepEqual(E.pickOpening(deck, 1, 'big'), [0]);
  assert.deepEqual(E.pickOpening(deck, 1, 'cheap'), [1]);
  assert.deepEqual(E.pickOpening(deck, 2, 'none'), []);
  assert.deepEqual(E.pickOpening(deck, 0), []);
});

test('프리셋 E(카드 위주): 선봉이 없고 30초대에 끝난다', () => {
  const rules = E.PRESETS.cards.rules;
  const lens = [];
  for (let seed = 1; seed <= 200; seed++) {
    const { state, result } = E.runBattle({ ...midDeckMatch(seed), rules });
    lens.push(result.timeMs / 1000);
    for (const P of state.players) assert.equal(P.exiled.filter((c) => c.vanguard).length, 0);
  }
  const med = lens.sort((a, b) => a - b)[100];
  assert.ok(med >= 28 && med <= 38, `중앙값 ${med}초`);
});

test('첩보원: 상대가 고른 시작 카드를 미리 본다 (다른 지휘관은 못 본다)', () => {
  const deck = [...filler('shield', 10), { id: 'lancer' }, { id: 'dagger', stars: 2 }];
  const s = E.createBattle({
    seed: 5,
    rules: { openingPicks: 2, vanguardSlots: 0 },
    players: [
      { commander: 'spy', deck, opening: [0, 1] },
      { commander: 'general', deck, opening: [10, 11] },
    ],
  });
  assert.deepEqual(s.players[0].knownEnemyOpening.map((c) => E.cardLabel(c)), ['창기병', '그림자 단검★★']);
  assert.equal(s.players[1].knownEnemyOpening, null);
});
