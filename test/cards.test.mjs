// 카드·자원·키워드 테스트 (유닛 소환 전투). 수치를 읽기 쉽게 유닛 공격·체력 배율은 1로 둔다.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../engine/index.js';

const F = E.Field;
const ONE = { unitAtkMult: 1, unitHpMult: 1 };
const filler = (id = 'shield', n = 8) => Array.from({ length: n }, () => ({ id }));

function mk(o = {}) {
  return F.createField({
    seed: o.seed ?? 7,
    format: o.format || 'duel',
    battlefield: o.battlefield,
    rules: { ...ONE, ...(o.rules || {}) },
    stakes: o.stakes,
    players: o.players || [
      { commander: o.c0 || 'merchant', deck: o.d0 || filler(), opening: o.o0 },
      { commander: o.c1 || 'merchant', deck: o.d1 || filler(), opening: o.o1 },
    ],
  });
}
const put = (s, owner, x, y, id, extra = {}) => F.summonUnit(s, owner, x, y, { id, ...extra });
/** 걷지 않는 유닛 (공격은 한다) */
const still = (s, owner, x, y, id, extra) => Object.assign(put(s, owner, x, y, id, extra), { speed: 0 });
/** 제자리에 서서 아무것도 하지 않는 표적용 유닛 */
const dummy = (s, owner, x, y, id, extra) => Object.assign(put(s, owner, x, y, id, extra), { speed: 0, interval: 1e9 });
const run = (s, ms) => {
  const end = s.timeMs + ms;
  while (s.timeMs < end && !s.over) F.step(s);
};
let giveN = 0;
function give(s, p, id, x = {}) {
  const c = { uid: `g${giveN++}`, id, stars: 1, fuse: null, drawnAt: s.timeMs, zeroCost: false, ...x };
  s.players[p].hand.push(c);
  return c;
}
const play = (s, p, c, target) => F.applyAction(s, p, { type: 'play', uid: c.uid, target });
const near = (a, b, msg = '') => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≈ ${b} ${msg}`);

// ───────────────────────── 마나·뽑기 ─────────────────────────

test('마나: 3에서 시작, 1.5초마다 1, 최대치는 8초마다 1씩 8까지', () => {
  const s = mk({ rules: { battleMs: 60000 } });
  const P = s.players[0];
  assert.deepEqual([P.mana, P.maxMana], [3, 3]);
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
  assert.deepEqual([P.maxMana, P.mana], [8, 8]);
});

test('뽑기: 4장으로 시작, 3초마다 1장, 손패 7장에서 멈추고, 덱이 비면 버린 더미를 섞는다', () => {
  let s = mk({ d0: filler('shield', 20) });
  let P = s.players[0];
  assert.equal(P.hand.length, 4);
  run(s, 3000);
  assert.equal(P.hand.length, 5);
  run(s, 6000);
  assert.equal(P.hand.length, 7);
  run(s, 9000);
  assert.equal(P.hand.length, 7);
  assert.equal(P.deck.length, 13);
  assert.ok(P.stats.handFullMs > 0);

  s = mk({ d0: filler('shield', 5) });
  P = s.players[0];
  run(s, 3000);
  assert.equal(P.deck.length, 0);
  P.discard.push(...P.hand.splice(0, 3));
  run(s, 3000);
  assert.deepEqual([P.hand.length, P.deck.length, P.discard.length], [3, 2, 0]);
});

test('다시 뽑기: 마나 1, 쿨다운 4초', () => {
  const s = mk({ d0: filler('shield', 20) });
  const P = s.players[0];
  const uid = P.hand[0].uid;
  assert.equal(F.applyAction(s, 0, { type: 'redraw', uid }).ok, true);
  assert.equal(P.mana, 2);
  assert.equal(P.hand.length, 4);
  assert.ok(!P.hand.some((c) => c.uid === uid));
  assert.equal(F.applyAction(s, 0, { type: 'redraw', uid: P.hand[0].uid }).ok, false);
  run(s, 4000);
  assert.equal(F.applyAction(s, 0, { type: 'redraw', uid: P.hand[0].uid }).ok, true);
});

test('시작 카드 고르기와 레벨 보너스, 첩보원', () => {
  const deck = [...filler('shield', 12), { id: 'lancer' }, { id: 'pyro' }, { id: 'colossus' }];
  for (let seed = 1; seed <= 20; seed++) {
    const s = mk({ seed, rules: { openingPicks: 2 }, d0: deck, o0: [12, 14] });
    const ids = s.players[0].hand.map((c) => c.id);
    assert.equal(ids.length, 4, '고른 카드는 시작 손패 4장에 포함된다');
    assert.ok(ids.includes('lancer') && ids.includes('colossus'), `seed ${seed}: ${ids}`);
    assert.equal(F.countCards(s, 0), deck.length);
  }
  const b = F.createField({
    seed: 3,
    rules: { battleMs: 60000 },
    players: [
      { commander: 'merchant', deck: filler('shield', 20), bonus: { startMana: 1, maxMana: 2, startHand: 1 } },
      { commander: 'merchant', deck: filler('shield', 20) },
    ],
  });
  assert.deepEqual([b.players[0].mana, b.players[0].maxMana, b.players[0].hand.length], [4, 5, 5]);
  assert.deepEqual([b.players[1].mana, b.players[1].maxMana, b.players[1].hand.length], [3, 3, 4]);

  const sp = F.createField({
    seed: 5,
    rules: { openingPicks: 2 },
    players: [
      { commander: 'spy', deck: [...filler('shield', 10), { id: 'lancer' }, { id: 'dagger', stars: 2 }], opening: [0, 1] },
      { commander: 'general', deck: [...filler('shield', 10), { id: 'lancer' }, { id: 'dagger', stars: 2 }], opening: [10, 11] },
    ],
  });
  assert.deepEqual(sp.players[0].knownEnemyOpening.map((c) => E.cardLabel(c)), ['창기병', '그림자 단검★★']);
  assert.equal(sp.players[1].knownEnemyOpening, null, '첩보원이 아니면 보지 못한다');
});

// ───────────────────────── 유닛 키워드 ─────────────────────────

test('흡혈: 준 피해의 30%만큼 회복한다', () => {
  const s = mk();
  const bat = put(s, 0, 0, 0, 'bat');
  dummy(s, 1, 0, 1.2, 'colossus');
  bat.hp = 5;
  run(s, 900);
  near(bat.hp, 5.9);
});

test('가시: 근접 공격자에게 매번 피해. 유닛 공격 배율을 따른다 (기본 규칙에서 가시 거북은 1)', () => {
  let s = mk();
  const d = put(s, 0, 0, 0, 'dagger');
  dummy(s, 1, 0, 1, 'shield', { fuse: 'thorns' });
  run(s, 1100);
  near(d.hp, 7);

  s = F.createField({ seed: 1, players: [{ commander: 'merchant', deck: filler() }, { commander: 'merchant', deck: filler() }] });
  const r = put(s, 0, 0, 0, 'rats');
  const t = dummy(s, 1, 0, 1, 'turtle');
  const hp = r.hp;
  run(s, 600);
  near(r.hp, hp - 1);
  assert.ok(t.hp < t.maxHp);
});

test('집결: 가까이(1.7 안) 있는 아군 1기당 공격 +2 × 유닛 공격 배율', () => {
  const s = mk();
  const u = dummy(s, 0, 0, -3, 'banner');
  near(F.currentAtk(s, u), 2);
  dummy(s, 0, 1, -3, 'rats');
  dummy(s, 0, -1.2, -3, 'archer');
  dummy(s, 0, 3, -3, 'shield'); // 멀다
  near(F.currentAtk(s, u), 6);
  const d = F.createField({ seed: 1, players: [{ commander: 'merchant', deck: filler() }, { commander: 'merchant', deck: filler() }] });
  const v = dummy(d, 0, 0, -3, 'banner');
  dummy(d, 0, 1, -3, 'rats');
  near(F.currentAtk(d, v), (2 + 2) * 0.5, '기본 규칙(공격 ×0.5)에서는 아군 1기당 +1');
});

test('냉기: 공격 간격 +15%, 침묵(교란 2초)은 필살기 게이지를 멈춘다', () => {
  const s = mk();
  put(s, 0, 0, -3, 'frostwitch');
  const l = still(s, 1, 0, 2, 'lancer');
  l.attackTimer = -1e9; // 치지는 않게
  run(s, 1300);
  assert.equal(l.slows.length, 1);
  assert.equal(F.effInterval(s, l), 1725);

  const t = mk();
  const pyro = dummy(t, 1, 0, 3, 'pyro');
  const d = give(t, 0, 'disrupt');
  assert.equal(play(t, 0, d, { unitId: pyro.id }).ok, true);
  assert.equal(pyro.silenceUntil, 2000);
});

test('강화 2성은 공격·체력 1.8배, 융합 효과는 유닛에 붙고 이름에 나온다', () => {
  const s = mk();
  const u = put(s, 0, 0, -3, 'lancer', { stars: 2 });
  near(u.atk, 10.8);
  near(u.maxHp, 32.4);
  const f = put(s, 0, 2, -3, 'shield', { fuse: 'lifesteal' });
  assert.deepEqual(f.keywords, ['guard', 'lifesteal']);
  assert.equal(f.name, '흡혈 방패병');
});

// ───────────────────────── 주문·강화·운영 ─────────────────────────

test('화염탄: 피해 6, 연계(3초 안에 다른 카드를 냈다면) 10', () => {
  const s = mk();
  const u = dummy(s, 1, 0, 3, 'colossus');
  play(s, 0, give(s, 0, 'firebolt'), { unitId: u.id });
  near(u.hp, 54);
  run(s, 1000);
  play(s, 0, give(s, 0, 'firebolt'), { unitId: u.id });
  near(u.hp, 44, '1초 전에 카드를 냈으므로 연계');
  const c = give(s, 0, 'firebolt');
  run(s, 3100);
  play(s, 0, c, { unitId: u.id });
  near(u.hp, 38, '3초가 지나 연계가 끊겼다');
});

test('강철 갑옷은 체력 +12, 정화는 강화를 지운다. 각성은 필살기 게이지 +60%', () => {
  const s = mk();
  const u = dummy(s, 1, 0, 3, 'lancer');
  play(s, 1, give(s, 1, 'armor'), { unitId: u.id });
  assert.deepEqual([u.maxHp, u.hp], [30, 30]);
  play(s, 0, give(s, 0, 'purify'), { unitId: u.id });
  assert.deepEqual([u.maxHp, u.hp, u.buffs.length], [18, 18, 0]);
  const a = dummy(s, 0, 0, -3, 'archer');
  const sh = dummy(s, 0, 2, -3, 'shield');
  s.players[0].mana = 8;
  const aw = give(s, 0, 'awaken');
  assert.equal(play(s, 0, aw, { unitId: sh.id }).ok, false, '필살기가 없는 유닛에는 쓸 수 없다');
  assert.equal(play(s, 0, aw, { unitId: a.id }).ok, true);
  assert.equal(a.gauge, 60);
});

test('정찰·마나 결정·비축·징집령', () => {
  let s = mk({ d0: filler('shield', 20) });
  let P = s.players[0];
  const sc = give(s, 0, 'scout');
  play(s, 0, sc);
  assert.equal(P.hand.length, 6);
  assert.equal(P.mana, 3);
  assert.ok(P.exiled.includes(sc) && !P.discard.includes(sc), '일회');

  s = mk();
  P = s.players[0];
  const cr = give(s, 0, 'crystal');
  assert.equal(F.effectiveCost(s, 0, cr), 1);
  run(s, 5000);
  assert.equal(F.effectiveCost(s, 0, cr), 0, '숙성: 5초마다 −1');
  const before = P.mana;
  play(s, 0, cr);
  assert.equal(P.mana, before + 3);

  s = mk();
  P = s.players[0];
  const st = give(s, 0, 'stockpile');
  play(s, 0, st);
  assert.equal(P.maxMana, 4);
  assert.ok(P.exiled.includes(st));

  s = mk({ d0: [...filler('lancer', 6), { id: 'rats' }, { id: 'bat' }, { id: 'firebolt' }, { id: 'scout' }] });
  P = s.players[0];
  P.deck.push(...P.hand.splice(0, 4));
  play(s, 0, give(s, 0, 'muster'));
  assert.deepEqual(P.hand.map((c) => c.id).sort(), ['bat', 'rats']);
});

test('보급선: 다음 유닛 2장 비용 −1, ◆순환으로 1장 뽑는다', () => {
  const s = mk({ d0: filler('shield', 20) });
  const P = s.players[0];
  P.mana = 8;
  const su = give(s, 0, 'supply');
  const bats = [give(s, 0, 'bat'), give(s, 0, 'bat'), give(s, 0, 'bat')];
  P.hand.splice(0, 4);
  const handBefore = P.hand.length;
  play(s, 0, su);
  assert.equal(P.hand.length, handBefore, '보급선이 나가고 1장이 들어온다');
  assert.equal(F.effectiveCost(s, 0, bats[0]), 1);
  assert.equal(play(s, 0, bats[0], { cell: 0 }).ok, true);
  assert.equal(play(s, 0, bats[1], { cell: 1 }).ok, true);
  assert.equal(F.effectiveCost(s, 0, bats[2]), 2);
  assert.equal(P.mana, 8 - 2 - 1 - 1);
});

test('촉매와 연금술사: 융합 카드 비용 −1, 촉매를 쓰면 0. 마나가 모자라면 낼 수 없다', () => {
  const s = mk({ c0: 'alchemist' });
  const fused = give(s, 0, 'lancer', { fuse: 'lifesteal' });
  const plain = give(s, 0, 'lancer');
  const cat = give(s, 0, 'catalyst');
  assert.equal(F.effectiveCost(s, 0, fused), 3);
  assert.equal(F.effectiveCost(s, 0, plain), 4);
  assert.equal(play(s, 0, plain, { cell: 0 }).ok, false, '마나 3으로 4마나 카드는 못 낸다');
  assert.equal(play(s, 0, cat, { uid: plain.uid }).ok, false, '융합 카드만 고를 수 있다');
  assert.equal(play(s, 0, cat, { uid: fused.uid }).ok, true);
  assert.equal(F.effectiveCost(s, 0, fused), 0);
});

// ───────────────────────── 전장·과열 ─────────────────────────

test('전장: 폭우, 안개, 마력 폭주, 화산. 과열은 30초 뒤 매초 공격 +10%', () => {
  let s = mk({ battlefield: 'rain' });
  assert.equal(F.effInterval(s, still(s, 0, 0, -3, 'archer')), 1200);
  assert.equal(F.effInterval(s, still(s, 0, 2, -3, 'shield')), 1200);

  s = mk({ battlefield: 'fog' });
  const hidden = dummy(s, 1, 0, 3, 'archer');
  assert.equal(F.targetable(s, hidden), false);
  run(s, 5000);
  assert.equal(F.targetable(s, hidden), true);

  s = mk({ battlefield: 'surge' });
  const ar = put(s, 0, 0, -1, 'archer');
  dummy(s, 1, 0, 2, 'colossus');
  run(s, 1000);
  near(ar.gauge, 37.5);

  s = mk({ battlefield: 'volcano', rules: { commanderHp: 9999 } });
  const c = dummy(s, 0, 0, -3, 'colossus');
  run(s, 9900);
  near(c.hp, 60);
  run(s, 100);
  near(c.hp, 57);

  s = mk({ rules: { battleMs: 60000 } });
  const u = dummy(s, 0, 0, -3, 'shield');
  run(s, 31000);
  near(F.currentAtk(s, u), 2 * 1.1);
});

// ───────────────────────── 2026-11-17에 더한 카드 ─────────────────────────

test('포고: 지목한 적 유닛을 내 유닛 전체가 먼저 노리고, 그 유닛이 받는 피해 +25%', () => {
  const s = mk({ c0: 'lord' });
  const l = put(s, 0, 0, -1, 'lancer');
  const nearFoe = dummy(s, 1, 0, 0.2, 'shield');
  const farFoe = dummy(s, 1, 3.5, 4, 'colossus');
  assert.equal(F.chooseTarget(s, l).unit, nearFoe, '평소에는 가장 가까운 적');
  const d = give(s, 0, 'decree');
  assert.equal(play(s, 0, d, { unitId: farFoe.id }).ok, true);
  assert.equal(F.chooseTarget(s, l).unit, farFoe, '지목하면 멀어도 그 유닛부터');
  while (farFoe.hp === farFoe.maxHp && s.timeMs < 5000) F.step(s);
  near(farFoe.maxHp - farFoe.hp, 6 * 1.25, '창기병이 걸어가서 쳤고, 피해 +25%');
  run(s, 6100);
  assert.equal(F.chooseTarget(s, l).unit === farFoe && F.chooseTarget(s, l).d > 3, false, '6초가 지나면 다시 가까운 적');
});

test('포고는 어느 형식에서나 낼 수 있다 (예전에는 난전 전용)', () => {
  const s = mk({ c0: 'lord' });
  const foe = dummy(s, 1, 0, 3, 'shield');
  assert.equal(F.legalTargets(s, 0, give(s, 0, 'decree').uid).length, 1);
  assert.ok(foe);
});

test('눈보라: 표적과 그 주변(2.2 안)의 적 모두에게 피해 4와 감속. 멀리 있는 적과 내 유닛은 맞지 않는다', () => {
  const s = mk();
  const a = dummy(s, 1, 0, 3, 'lancer');
  const b = dummy(s, 1, 1.5, 3, 'lancer');
  const far = dummy(s, 1, -4, 3, 'lancer');
  const mine = dummy(s, 0, 0.5, 2.2, 'lancer');
  assert.equal(play(s, 0, give(s, 0, 'blizzard'), { unitId: a.id }).ok, true);
  near(a.hp, 14);
  near(b.hp, 14);
  near(far.hp, 18);
  near(mine.hp, 18);
  assert.equal(a.slows.length, 1);
});

test('폭탄 고블린: 쓰러지면 주변(2 안)의 적 모두에게 피해 8 × 공격 배율. 그 폭발로 쓰러진 유닛도 바로 처리된다', () => {
  const s = mk();
  const bomb = dummy(s, 0, 0, 0, 'bomber');
  const a = dummy(s, 1, 1, 0.5, 'shield');
  const weak = dummy(s, 1, -1, 0.5, 'rats');
  const far = dummy(s, 1, 4, 3, 'shield');
  const ally = dummy(s, 0, 0, -1.5, 'bat');
  play(s, 1, give(s, 1, 'firebolt'), { unitId: bomb.id });
  play(s, 1, give(s, 1, 'firebolt'), { unitId: bomb.id }); // 연계 10: 체력 7을 넘는다
  assert.equal(F.findUnit(s, bomb.id), null);
  near(a.hp, 14 - 8);
  near(far.hp, 14);
  near(ally.hp, 8, '내 유닛은 맞지 않는다');
  assert.equal(F.findUnit(s, weak.id), null, '쥐 떼(체력 4)는 폭발에 쓰러졌다');
  assert.equal(F.unitsOf(s, 1).filter((u) => u.token).length, 2, '쓰러진 쥐 떼는 분열했다');
});

test('망치 기사: 친 대상을 1.5만큼 밀어낸다 (거신은 절반, 보스는 밀리지 않는다)', () => {
  const s = mk();
  const h = dummy(s, 0, 0, 0, 'hammer');
  h.interval = 1600;
  const t = dummy(s, 1, 0, 1.2, 'lancer');
  t.speed = 1; // 걷는 유닛이어야 밀린다
  run(s, 1600);
  near(t.y, 1.2 + 1.5);
  near(t.hp, 18 - 5);

  const c = mk();
  const h2 = dummy(c, 0, 0, 0, 'hammer');
  h2.interval = 1600;
  const col = dummy(c, 1, 0, 1.4, 'colossus');
  col.speed = 1; // 걷는 유닛이어야 밀린다
  run(c, 1600);
  near(col.y, 1.4 + 0.75, '군중 제어 절반');
});

// ───────────────────────── 투자와 봇 ─────────────────────────

test('투자: 한 경기 안의 전투(stakes)에서만 봇이 낸다', () => {
  const deck = [{ id: 'invest' }, ...filler('scout', 3)];
  const count = (stakes) => {
    let n = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const { state } = E.runFieldBattle({ seed, stakes, rules: { battleMs: 8000 }, players: [{ commander: 'merchant', deck, opening: [] }, { commander: 'merchant', deck: filler('scout', 4) }] });
      if (state.players[0].invested) n++;
    }
    return n;
  };
  assert.equal(count(false), 0, '전투 한 판에서는 아무 효과가 없으므로 내지 않는다');
  assert.ok(count(true) >= 8, '경기 안에서는 낸다');
});

test('난투장 1위 견제: 봇은 나보다 점수가 높은 상대 중 1위의 유닛을 주문으로 먼저 노린다', () => {
  const s = mk({
    format: 'melee4',
    players: [0, 1, 2, 3].map(() => ({ commander: 'merchant', deck: filler('scout', 8) })),
  });
  s.players[2].capMs = 9000;
  s.players[1].capMs = 3000;
  assert.equal(E.leaderOf(s, 0), 2);
  assert.equal(E.leaderOf(s, 2), -1, '내가 1위면 견제할 상대가 없다');
  // 상대 1과 2의 같은 유닛이 같은 거리에 있다. 2가 앞서 있으니 2의 유닛을 친다
  const a = dummy(s, 1, -2, 0, 'rats');
  const b = dummy(s, 2, 2, 0, 'rats');
  const P = s.players[0];
  P.hand = [];
  give(s, 0, 'firebolt');
  P.mana = 3;
  const bot = E.createFieldBot({ seed: 1, reactMin: 0, reactMax: 0, mistake: 0 });
  bot.decide(s, 0);
  const action = bot.decide(s, 0);
  assert.equal(action.target.unitId, b.id);
  assert.ok(a);
});

test('봇: 곧 낼 수 있는 비싼 카드를 위해 마나를 모으고, 마나만 모자란 카드는 다시 뽑기로 버리지 않는다', () => {
  const decide = (s, opts = {}) => {
    const bot = E.createFieldBot({ seed: 1, reactMin: 0, reactMax: 0, mistake: 0, ...opts });
    bot.decide(s, 0);
    return bot.decide(s, 0);
  };
  const setup = (hand, mana, maxMana) => {
    const s = mk({ players: [{ commander: 'merchant', deck: filler('shield', 8) }, { commander: 'merchant', deck: filler('shield', 8) }] });
    const P = s.players[0];
    P.hand = [];
    for (const id of hand) give(s, 0, id);
    Object.assign(P, { mana, maxMana, manaTimer: 0 });
    s.timeMs = 9000;
    return s;
  };
  // 마나 3: 쥐 떼(1)를 내기보다 1마나만 더 모아서 창기병(4)을 낸다
  assert.equal(decide(setup(['rats', 'lancer'], 3, 4)), null);
  assert.equal(decide(setup(['rats', 'lancer'], 3, 4), { plan: false }).uid !== undefined, true, '예전 봇은 쥐 떼를 바로 낸다');
  // 최대 마나 3: 창기병(4)은 몇 초 뒤면 낼 수 있으니 들고 있는다 (예전 봇은 다시 뽑기로 버렸다)
  assert.equal(decide(setup(['lancer'], 1, 3)), null);
  assert.equal(decide(setup(['lancer'], 1, 3), { plan: false }).type, 'redraw');
  // 이번 전투에 못 낼 거신은 버린다
  assert.equal(decide(setup(['colossus'], 1, 4)).type, 'redraw');
});

// ───────────────────────── 대난투 ─────────────────────────

const ffaPlayers = (n, seed = 1) => {
  const rng = E.makeRng(seed);
  return Array.from({ length: n }, () => {
    const c = rng.pick(E.COMMANDER_IDS);
    return { commander: c, deck: E.randomMidDeck(c, rng) };
  });
};

test('대난투: 3~12명. 필드는 반지름 "4 + 인원 × 1.7"인 원이고 본진이 둘레에 같은 간격으로 놓인다', () => {
  assert.throws(() => F.createField({ seed: 1, format: 'ffa', players: ffaPlayers(2) }));
  assert.throws(() => F.createField({ seed: 1, format: 'ffa', players: ffaPlayers(13) }));
  const s = F.createField({ seed: 1, format: 'ffa', players: ffaPlayers(8) });
  assert.equal(s.arena.shape, 'circle');
  near(s.arena.r, 17.6);
  for (const P of s.players) near(Math.hypot(P.base.x, P.base.y), 17.6);
  near(s.players[0].base.y, -17.6, '0번이 아래');
  assert.equal(s.rules.battleMs, 75000);
  // 어느 인원에서나 남의 배치 칸과 겹치지 않는다 (칸 한 변이 2)
  for (let n = 3; n <= 12; n++) {
    const t = F.createField({ seed: 1, format: 'ffa', players: ffaPlayers(n) });
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        for (const a of F.deployCells(t, p)) for (const b of F.deployCells(t, q)) assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 1.99, `${n}명 ${p}·${q}`);
      }
    }
  }
});

test('대난투: 유닛 카드 한 장에 같은 유닛 3기가 나오고, 카드는 한 장만 돌아온다. 16기까지', () => {
  const s = F.createField({ seed: 1, format: 'ffa', players: ffaPlayers(4).map((p) => ({ ...p, deck: filler('shield', 8) })) });
  const P = s.players[0];
  P.mana = 99;
  const c = give(s, 0, 'lancer');
  assert.equal(play(s, 0, c, { cell: 7 }).ok, true);
  const units = F.unitsOf(s, 0);
  assert.equal(units.length, 3);
  assert.equal(units.filter((u) => u.card).length, 1, '카드가 붙은 유닛은 하나');
  assert.equal(F.countCards(s, 0), 9, '카드 수는 그대로 (덱 8장 + 준 카드 1장)');
  for (let i = 0; i < 6; i++) play(s, 0, give(s, 0, 'rats'), { cell: F.deployCells(s, 0).find((x) => x.free).i });
  assert.equal(F.unitsOf(s, 0).length, 16, '한도에서 멈춘다');
});

test('대난투: 본진은 가까이(4 안) 있는 자기 유닛만 지킨다', () => {
  const s = F.createField({ seed: 1, format: 'ffa', players: ffaPlayers(4) });
  const b = s.players[1].base;
  const attacker = dummy(s, 0, b.x * 0.75, b.y * 0.75, 'lancer');
  const guard = dummy(s, 1, b.x * 0.2, b.y * 0.2, 'shield'); // 본진에서 멀다
  const tg = F.chooseTarget(s, attacker);
  assert.equal(tg.base, 1, '멀리 나간 유닛은 본진을 지키지 못한다');
  guard.x = b.x * 0.85;
  guard.y = b.y * 0.85;
  assert.equal(F.chooseTarget(s, attacker).unit, guard);
});

test('대난투: 봇끼리 끝까지 진행되고, 필드에 유닛이 많고, 같은 시드면 결과가 같다', () => {
  let peak = 0;
  const cfg = () => ({ seed: 4, format: 'ffa', players: ffaPlayers(8, 4), logEvents: true });
  const a = E.runFieldBattle({ ...cfg(), onTick: (s) => { peak = Math.max(peak, s.units.length); } });
  const b = E.runFieldBattle(cfg());
  assert.ok(a.state.over);
  assert.deepEqual(a.result, b.result);
  assert.ok(peak >= 40, `필드 유닛 최대 ${peak}기`);
  assert.deepEqual([...a.result.ranks].sort((x, y) => x - y)[0], 0);
  for (const P of a.state.players) assert.equal(F.countCards(a.state, P.idx), cfg().players[P.idx].deck.length);
});
