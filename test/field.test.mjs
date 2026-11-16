import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../engine/index.js';

const F = E.Field;
const filler = (id = 'shield', n = 8) => Array.from({ length: n }, () => ({ id }));
// 숫자를 읽기 쉽게, 테스트에서는 배율 없이 기획서 수치 그대로 쓴다
const PLAIN = { unitAtkMult: 1, unitHpMult: 1, commanderHp: 30 };
const SIZE = { duel: 2, melee4: 4, alliance: 4 };

function mk(o = {}) {
  const format = o.format || 'duel';
  return F.createField({
    seed: o.seed ?? 7,
    format,
    battlefield: o.battlefield,
    rules: { ...PLAIN, ...(o.rules || {}) },
    players: Array.from({ length: SIZE[format] }, (_, i) => ({ commander: (o.commanders || [])[i] || 'merchant', deck: filler() })),
  });
}
const put = (s, owner, x, y, id, extra = {}) => F.summonUnit(s, owner, x, y, { id, ...extra });
/** 제자리에 서서 아무것도 하지 않는 표적용 유닛 */
const dummy = (s, owner, x, y, id) => Object.assign(put(s, owner, x, y, id), { speed: 0, interval: 1e9 });
const run = (s, ms) => {
  const end = s.timeMs + ms;
  while (s.timeMs < end && !s.over) F.step(s);
};
let giveN = 0;
function give(s, p, id, x = {}) {
  const c = { uid: `f${giveN++}`, id, stars: 1, fuse: null, drawnAt: s.timeMs, zeroCost: false, ...x };
  s.players[p].hand.push(c);
  return c;
}
const play = (s, p, c, target) => F.applyAction(s, p, { type: 'play', uid: c.uid, target });
const near = (a, b, msg = '', eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b} ${msg}`);
const cell = (s, p, col, row) => F.cellCenter(s, p, col, row);

// ───────────────────────── 필드와 배치 ─────────────────────────

test('결투 필드: 가로 10 × 세로 12, 본진은 아래와 위. 배치 칸은 본진 앞 가로 5 × 세로 3', () => {
  const s = mk();
  assert.deepEqual([s.arena.shape, s.arena.w, s.arena.h], ['rect', 10, 12]);
  assert.deepEqual(s.players.map((P) => P.base), [{ x: 0, y: -6 }, { x: 0, y: 6 }]);
  assert.deepEqual(cell(s, 0, 2, 0), { x: 0, y: -5 }, '가운데 줄, 본진 바로 앞');
  assert.deepEqual(cell(s, 0, 0, 2), { x: -4, y: -1 }, '왼쪽 끝, 맨 앞줄');
  assert.deepEqual(cell(s, 1, 2, 0), { x: 0, y: 5 });
  assert.deepEqual(cell(s, 1, 0, 2), { x: 4, y: 1 }, '상대는 반 바퀴 돌린 모양이다');
  assert.equal(F.deployCells(s, 0).length, 15);
  assert.ok(F.deployCells(s, 0).every((c) => c.free));
});

test('난투장 필드는 원이고 본진 넷이 둘레에 같은 간격으로 놓인다. 연합전은 한 팀이 같은 쪽에 선다. 삼파전은 없다', () => {
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const s4 = mk({ format: 'melee4' });
  assert.equal(s4.arena.shape, 'circle');
  assert.deepEqual(s4.players.map((P) => [Math.round(P.base.x) + 0, Math.round(P.base.y) + 0]), [[0, -10], [-10, 0], [0, 10], [10, 0]]);
  // 배치 칸끼리 겹치지 않는다
  const all = s4.players.flatMap((P) => F.deployCells(s4, P.idx));
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) assert.ok(d(all[i], all[j]) > 1.2, `${i},${j}`);
  assert.deepEqual([s4.capture.x, s4.capture.y, s4.capture.radius, s4.capture.goal], [0, 0, 3, 20]);
  const sa = mk({ format: 'alliance' });
  assert.deepEqual(sa.players.map((P) => P.team), [0, 0, 1, 1]);
  assert.deepEqual(sa.players.map((P) => P.base.y), [-6, -6, 6, 6]);
  assert.equal(sa.capture, null);
  assert.equal(mk().capture, null);
  assert.throws(() => F.createField({ seed: 1, format: 'melee3', players: [0, 1, 2].map(() => ({ commander: 'merchant', deck: filler() })) }));
});

test('소환: 내 배치 칸에만 놓을 수 있고, 유닛이 서 있는 칸에는 못 놓는다', () => {
  const s = mk();
  const c = give(s, 0, 'shield');
  assert.equal(play(s, 0, c, { cell: 99 }).ok, false);
  assert.equal(play(s, 0, c, {}).ok, false);
  dummy(s, 0, 0, -5, 'rats'); // 가운데 뒷줄 칸에 서 있다
  assert.equal(play(s, 0, c, { cell: F.cellIndex(2, 0) }).ok, false, '유닛이 서 있는 칸');
  assert.equal(F.legalTargets(s, 0, c.uid).length, 14);
  assert.equal(play(s, 0, c, { cell: F.cellIndex(0, 2) }).ok, true);
  const u = F.unitsOf(s, 0).find((x) => x.defId === 'shield');
  assert.deepEqual([u.x, u.y], [-4, -1]);
  assert.equal(s.players[0].mana, 2);
});

test('배치 칸은 배치할 때만 쓴다: 유닛이 걸어 나가면 그 칸은 다시 빈다', () => {
  const s = mk();
  const i = F.cellIndex(2, 2);
  put(s, 0, 0, -1, 'bat');
  assert.equal(F.deployCells(s, 0)[i].free, false);
  run(s, 1000);
  assert.equal(F.deployCells(s, 0)[i].free, true);
});

test('유닛은 8기까지. 가득 차면 내 유닛 하나를 대체하고 그 자리에 나온다', () => {
  const s = mk({ rules: { commanderHp: 9999 } });
  const first = dummy(s, 0, -4, -5, 'rats');
  for (let k = 1; k < 8; k++) dummy(s, 0, -4 + k, -5, 'rats');
  s.players[0].mana = 8;
  const c = give(s, 0, 'lancer');
  assert.deepEqual(F.legalTargets(s, 0, c.uid).length, 8);
  assert.equal(play(s, 0, c, { cell: F.cellIndex(2, 2) }).ok, false, '가득 찼을 때는 빈칸에 놓을 수 없다');
  assert.equal(play(s, 0, c, { replace: first.id }).ok, true);
  const u = F.unitsOf(s, 0).find((x) => x.defId === 'lancer');
  assert.deepEqual([u.x, u.y], [-4, -5]);
  assert.equal(F.unitsOf(s, 0).length, 8);
});

// ───────────────────────── 이동과 사거리 ─────────────────────────

test('유닛은 칸과 상관없이 표적 쪽으로 부드럽게 걷는다', () => {
  const s = mk();
  const lancer = put(s, 0, 0, -5, 'lancer'); // 초당 4.4
  dummy(s, 1, 3, 5, 'colossus');
  run(s, 100);
  near(Math.hypot(lancer.x, lancer.y + 5), 0.44, '한 틱(0.1초)에 0.44만큼');
  assert.ok(lancer.x > 0 && lancer.y > -5, '대각선 방향으로 곧장 간다');
  run(s, 900);
  near(Math.hypot(lancer.x, lancer.y + 5), 4.4, '1초에 4.4');
  assert.equal(lancer.moving, true);
});

test('근접 유닛은 붙을 때까지 걸어가서 싸우고, 싸우는 동안에는 서 있는다', () => {
  const s = mk();
  const lancer = put(s, 0, 0, -1, 'lancer'); // 사거리 1.5
  const shield = dummy(s, 1, 0, 3, 'shield');
  run(s, 1500);
  assert.equal(lancer.moving, false);
  assert.ok(F.distance(lancer, shield) <= 1.5 + 1e-9 && F.distance(lancer, shield) > 0.9, `거리 ${F.distance(lancer, shield)}`);
  near(shield.hp, 8, '1.5초에 첫 공격');
  const at = [lancer.x, lancer.y];
  run(s, 1500);
  assert.deepEqual([lancer.x, lancer.y], at);
  near(shield.hp, 2);
});

test('원거리 유닛은 사거리 안에 들 때까지만 다가가서 제자리에서 쏜다', () => {
  const s = mk();
  const archer = put(s, 0, 0, -5, 'archer'); // 사거리 6, 초당 3.3
  const target = dummy(s, 1, 0, 5, 'colossus'); // 10 떨어져 있다. 거신은 몸집이 커서 6.35에서 닿는다
  run(s, 3000);
  const d = F.distance(archer, target);
  assert.ok(d <= 6.35 + 1e-9 && d > 5.9, `거리 ${d}`);
  assert.equal(archer.moving, false);
  assert.ok(target.hp < 60);
  const s2 = mk();
  const still = put(s2, 0, 0, -1, 'archer');
  const t2 = dummy(s2, 1, 0, 5, 'shield'); // 딱 6
  run(s2, 1000);
  assert.deepEqual([still.x, still.y], [0, -1], '이미 사거리 안이면 움직이지 않는다');
  near(t2.hp, 11);
});

test('적 유닛이 없으면 적 본진으로 걸어가서 지휘관을 친다. 원거리는 멀리서 친다', () => {
  const s = mk();
  const bat = put(s, 0, 0, 3, 'bat'); // 사거리 1.3 + 본진 크기 1
  run(s, 400);
  assert.ok(bat.y > 3.5);
  run(s, 600);
  near(s.players[1].hp, 27, '0.9초에 첫 공격');
  assert.ok(bat.y <= 6 - 2.3 + 0.2);

  const s2 = mk();
  const archer = put(s2, 0, 0, -1, 'archer'); // 본진까지 7 = 사거리 6 + 본진 1
  run(s2, 1000);
  assert.deepEqual([archer.x, archer.y], [0, -1]);
  near(s2.players[1].hp, 27);
});

test('결투: 적 유닛이 하나라도 있으면 본진을 칠 수 없다 (지나쳐 가지 않는다)', () => {
  const s = mk();
  const bat = put(s, 0, 0, 4, 'bat'); // 적 본진 바로 앞
  const far = dummy(s, 1, -4, -5, 'shield'); // 적 유닛은 반대편 끝에 있다
  const tg = F.chooseTarget(s, bat);
  assert.equal(tg.unit, far);
  assert.equal(tg.inRange, false);
  run(s, 2000);
  assert.equal(s.players[1].hp, 30);
  assert.ok(bat.y < 4, '돌아서 적 유닛에게 간다');
});

test('표적: 가장 가까운 적. 치고 있던 적이 사거리 안에 있으면 더 가까운 적이 와도 계속 친다', () => {
  const s = mk();
  const u = dummy(s, 0, 0, -5, 'archer');
  const a = dummy(s, 1, 0, 0, 'shield');
  const b = dummy(s, 1, 3, 0, 'shield');
  assert.equal(F.chooseTarget(s, u).unit, a);
  run(s, 100);
  assert.equal(u.targetId, a.id);
  const closer = dummy(s, 1, 0, -3, 'shield');
  assert.equal(F.chooseTarget(s, u).unit, a, '계속 a를 친다');
  u.targetId = null;
  assert.equal(F.chooseTarget(s, u).unit, closer);
  assert.ok(b);
});

test('암살: 적 원거리 유닛부터 노린다', () => {
  const s = mk();
  const d = put(s, 0, 0, -1, 'dagger');
  dummy(s, 1, 0, 1, 'shield'); // 바로 앞의 근접 유닛
  const archer = dummy(s, 1, 3, 5, 'archer');
  assert.equal(F.chooseTarget(s, d).unit, archer);
  const plain = put(s, 0, 2, -1, 'bat');
  assert.equal(F.chooseTarget(s, plain).unit.defId, 'shield');
});

test('유닛은 서로 겹치지 않고 밀어낸다. 필드 밖으로 나가지도 않는다', () => {
  const s = mk({ rules: { commanderHp: 9999 } });
  const a = put(s, 0, 0, 0, 'shield');
  const b = put(s, 0, 0, 0, 'shield');
  const c = put(s, 0, 0, 0, 'colossus');
  dummy(s, 1, 0, 5.4, 'colossus');
  run(s, 300);
  const d = F.distance;
  assert.ok(d(a, b) >= 0.9 - 0.05, `방패병끼리 ${d(a, b)}`);
  assert.ok(d(a, c) >= 1.25 - 0.05 && d(b, c) >= 1.25 - 0.05);
  const edge = put(s, 0, 4.9, -5.9, 'rats');
  run(s, 100);
  assert.ok(Math.abs(edge.x) <= 5 - edge.radius + 1e-9 && Math.abs(edge.y) <= 6 - edge.radius + 1e-9);
});

// ───────────────────────── 키워드와 필살기 ─────────────────────────

test('수호: 가까이(1.7 안) 있는 아군이 받는 피해의 20%를 대신 받는다', () => {
  const s = mk();
  put(s, 0, 0, -1.2, 'dagger'); // 피해 5, 1.1초
  const bat = dummy(s, 1, 0, 0, 'bat');
  const guard = dummy(s, 1, 1.2, 1.1, 'shield'); // 1.63 떨어져 있다
  const farGuard = dummy(s, 1, 3, 0, 'shield');
  run(s, 1100);
  near(bat.hp, 8 - 4);
  near(guard.hp, 14 - 1);
  near(farGuard.hp, 14, '멀리 있는 수호는 대신 받지 않는다');
});

test('관통: 표적 바로 뒤의 적에게도 50% 피해', () => {
  const s = mk();
  put(s, 0, 0, -1.4, 'lancer');
  const front = dummy(s, 1, 0, 0, 'bat');
  const behind = dummy(s, 1, 0, 1.2, 'archer');
  const side = dummy(s, 1, 2.5, 0, 'archer');
  run(s, 1500);
  near(front.hp, 2);
  near(behind.hp, 3);
  near(side.hp, 6, '옆에 있으면 맞지 않는다');
});

test('분열: 쓰러지면 그 자리에 작은 복제 2개가 나온다', () => {
  const s = mk();
  put(s, 0, 0, -1.4, 'lancer');
  dummy(s, 1, 0, 0, 'rats');
  run(s, 1500);
  const tokens = F.unitsOf(s, 1);
  assert.equal(tokens.length, 2);
  assert.ok(tokens.every((t) => t.token && !t.keywords.includes('split') && Math.hypot(t.x, t.y) < 1.5));
  near(tokens[0].maxHp, 2);
});

test('화염술사 필살기: 전조 1초 뒤 표적 주변(반지름 2.2)에 피해 20', () => {
  const s = mk({ rules: { commanderHp: 9999 } });
  const pyro = dummy(s, 1, 0, 5, 'pyro'); // 사거리 8
  const center = dummy(s, 0, 0, -2, 'colossus');
  const close = dummy(s, 0, 2, -2, 'colossus');
  const far = dummy(s, 0, 4.5, -2, 'colossus');
  pyro.gauge = 100;
  run(s, 100);
  assert.equal(s.telegraphs.length, 1);
  assert.deepEqual([s.telegraphs[0].x, s.telegraphs[0].y, s.telegraphs[0].radius], [0, -2, 2.2]);
  run(s, 900);
  assert.equal(center.hp, 60, '전조 중에는 아직 피해가 없다');
  run(s, 100);
  assert.deepEqual([center.hp, close.hp, far.hp], [40, 40, 60]);
});

test('필살기 범위는 전조 때의 자리로 정해진다: 그 사이에 벗어나면 맞지 않는다', () => {
  const s = mk({ rules: { commanderHp: 9999 } });
  const pyro = dummy(s, 1, 0, 5, 'pyro');
  const target = dummy(s, 0, 0, -1, 'colossus');
  pyro.gauge = 100;
  run(s, 100);
  s.players[0].mana = 3;
  assert.equal(play(s, 0, give(s, 0, 'retreat'), { unitId: target.id, cell: F.cellIndex(0, 0) }).ok, true);
  assert.deepEqual([target.x, target.y], [-4, -5]);
  run(s, 1000);
  assert.equal(target.hp, 60);
});

test('거신 필살기: 전조 1.2초 뒤 자기 주변(반지름 3.2)에 피해 25', () => {
  const s = mk({ rules: { commanderHp: 9999 } });
  const col = dummy(s, 0, 0, 0, 'colossus');
  const a = dummy(s, 1, 0, 2, 'colossus'); // 사거리 1.7 + 몸집 → 닿는다
  const b = dummy(s, 1, -3, 1, 'colossus');
  const far = dummy(s, 1, 0, 5.2, 'colossus');
  col.gauge = 100;
  run(s, 100);
  assert.deepEqual([s.telegraphs[0].x, s.telegraphs[0].y, s.telegraphs[0].radius], [0, 0, 3.2]);
  run(s, 1200);
  assert.deepEqual([a.hp, b.hp, far.hp], [35, 35, 60]);
});

// ───────────────────────── 카드 ─────────────────────────

test('후퇴: 내 배치 칸으로 옮기고 체력 5 회복', () => {
  const s = mk();
  const bat = dummy(s, 0, 0, 4, 'bat'); // 상대 쪽까지 나가 있다
  bat.hp = 2;
  const r = give(s, 0, 'retreat');
  assert.equal(play(s, 0, r, { unitId: bat.id, cell: 99 }).ok, false);
  assert.equal(play(s, 0, r, { unitId: bat.id, cell: F.cellIndex(2, 0) }).ok, true);
  assert.deepEqual([bat.x, bat.y], [0, -5]);
  near(bat.hp, 7);
});

test('전투 함성은 근접 유닛에만, 방진은 원거리 유닛이 받는 범위 피해를 줄인다', () => {
  const s = mk({ rules: { commanderHp: 9999 } });
  const melee = dummy(s, 0, 0, -1, 'colossus');
  const ranged = dummy(s, 0, 1, -2, 'pyro');
  s.players[0].mana = 6;
  play(s, 0, give(s, 0, 'warcry'));
  near(F.currentAtk(s, melee), 12);
  near(F.currentAtk(s, ranged), 4);
  const pyro = dummy(s, 1, 0, 5, 'pyro');
  pyro.gauge = 100;
  run(s, 100);
  play(s, 0, give(s, 0, 'phalanx'));
  run(s, 1000);
  near(melee.hp, 40, '근접 유닛은 그대로 20을 받는다');
  near(ranged.hp, 6, '원거리 유닛은 절반만 받는다');
});

test('연쇄 번개: 처음 맞은 유닛에서 가까운 순서로 10/7/5', () => {
  const s = mk();
  s.players[0].mana = 4;
  const a = dummy(s, 1, -4, 0, 'lancer');
  const b = dummy(s, 1, -3, 1, 'lancer');
  const c = dummy(s, 1, 0, 0, 'lancer');
  const d = dummy(s, 1, 4, 5, 'colossus');
  assert.equal(play(s, 0, give(s, 0, 'chain'), { unitId: a.id }).ok, true);
  assert.deepEqual([a.hp, b.hp, c.hp, d.hp], [8, 11, 13, 60]);
});

test('장군은 근접 유닛 체력 +10%, 좁은 협곡은 양쪽 끝 배치 줄을 막고, 안개는 원거리 유닛을 5초 가린다', () => {
  let s = mk({ commanders: ['general'] });
  near(put(s, 0, 0, -5, 'shield').maxHp, 15.4);
  near(put(s, 0, 2, -5, 'archer').maxHp, 6);

  s = mk({ battlefield: 'canyon' });
  assert.equal(F.deployCells(s, 0).filter((c) => c.free).length, 9);
  assert.equal(play(s, 0, give(s, 0, 'shield'), { cell: F.cellIndex(0, 0) }).ok, false);

  s = mk({ battlefield: 'fog' });
  const mine = dummy(s, 0, 0, -1, 'archer');
  const hidden = dummy(s, 1, 0, 3, 'archer');
  assert.equal(F.chooseTarget(s, mine), null);
  assert.deepEqual(F.legalTargets(s, 0, give(s, 0, 'firebolt').uid), []);
  run(s, 5000);
  assert.equal(F.chooseTarget(s, mine).unit, hidden);
});

// ───────────────────────── 난전과 연합전 ─────────────────────────

test('난투장: 본진은 표적이 아니다. 상대할 적이 없으면 가운데 원으로 걸어가서 버틴다', () => {
  const s = mk({ format: 'melee4' });
  const b1 = s.players[1].base; // 왼쪽
  const raider = put(s, 0, b1.x + 2, b1.y, 'bat'); // 상대 본진 코앞
  const tg = F.chooseTarget(s, raider);
  assert.equal(tg.zone, true);
  assert.equal(tg.base, undefined);
  run(s, 4000);
  assert.equal(s.players[1].hp, 30, '본진은 맞지 않는다');
  assert.ok(Math.hypot(raider.x, raider.y) <= s.capture.radius * s.rules.captureHold + 1e-6, '원 안쪽까지 들어와 있다');
  assert.equal(raider.moving, false);
  assert.equal(F.chooseTarget(s, raider).inRange, true);
});

test('난투장: 가까이 온 적만 상대한다. 멀리서 쏘는 적을 쫓아 원을 비우지 않는다. 암살은 원거리 유닛을 쫓아간다', () => {
  const s = mk({ format: 'melee4' });
  const holder = put(s, 0, 0, 0, 'shield');
  const sniper = dummy(s, 1, -7, 0, 'archer');
  assert.equal(F.chooseTarget(s, holder).zone, true, '7 떨어진 적은 상대하지 않는다');
  const brawler = dummy(s, 2, 0, 4, 'shield');
  assert.equal(F.chooseTarget(s, holder).unit, brawler, '4 떨어진 적은 상대한다');
  const dagger = put(s, 0, 0, -1, 'dagger');
  assert.equal(F.chooseTarget(s, dagger).unit, sniper);
  // 원거리 유닛은 사거리 안이면 멀어도 쏜다
  const archer = put(s, 3, 0, -6.5, 'archer');
  assert.equal(F.chooseTarget(s, archer).unit, dagger);
  assert.equal(F.chooseTarget(s, archer).inRange, true);
});

test('난투장 점수: 원 안에 유닛이 가장 많은 한 사람만 1초에 1점. 같으면 아무도 얻지 못한다', () => {
  const s = mk({ format: 'melee4' });
  const still = (owner, x, y) => Object.assign(dummy(s, owner, x, y, 'shield'), { range: 0 }); // 서로 치지도 않게
  s.rules.captureAggro = 0;
  still(0, 0, -2);
  run(s, 2000);
  assert.deepEqual(s.players.map((P) => P.capMs), [2000, 0, 0, 0]);
  assert.equal(s.capture.holder, 0);
  const rival = still(1, 0, 2);
  run(s, 1000);
  assert.deepEqual(s.players.map((P) => P.capMs), [2000, 0, 0, 0], '1 대 1이면 아무도 못 얻는다');
  assert.equal(s.capture.holder, -1);
  assert.deepEqual(s.capture.counts, [1, 1, 0, 0]);
  still(1, 2, 0);
  still(2, 0, 3.5); // 원 밖
  run(s, 1000);
  assert.deepEqual(s.players.map((P) => P.capMs), [2000, 1000, 0, 0]);
  rival.dying = true;
  run(s, 100);
  assert.equal(s.capture.holder, -1, '다시 1 대 1');
});

test('난투장: 20점에 먼저 닿으면 바로 끝난다. 아니면 40초에 점수순으로 순위를 매기고, 같으면 공동 순위', () => {
  const s = mk({ format: 'melee4' });
  Object.assign(dummy(s, 2, 0, 0, 'shield'), { range: 0 });
  run(s, 19900);
  assert.equal(s.over, false);
  run(s, 100);
  assert.equal(s.over, true);
  assert.equal(s.result.reason, 'capture');
  assert.equal(s.result.winner, 2);
  assert.deepEqual(s.result.ranks, [1, 1, 0, 1]);
  assert.deepEqual(s.result.scores, [0, 0, 20, 0]);

  const t = mk({ format: 'melee4' });
  t.players[1].capMs = 7000;
  t.players[3].capMs = 3000;
  t.players[0].hp = 0; // 난투장에서는 지휘관 체력이 승패와 상관없다
  run(t, 40000);
  assert.equal(t.over, true);
  assert.equal(t.result.reason, 'time');
  assert.equal(t.result.timeMs, 40000);
  assert.deepEqual(t.result.ranks, [2, 0, 2, 1]);
  assert.deepEqual(t.result.order.slice(0, 2), [1, 3]);
});

test('난투장 처치 점수: 적 유닛을 쓰러뜨리면 1점, 원 안에서면 2점, 작은 복제는 절반. 결투에는 없다', () => {
  const s = mk({ format: 'melee4' });
  s.rules.captureAggro = 0;
  const kill = (victimOwner, x, y, id = 'shield', extra = {}) => {
    const v = Object.assign(dummy(s, victimOwner, x, y, id), { range: 0, hp: 0.01 }, extra);
    F.applyActions(s, [{ type: 'play', uid: give(s, 0, 'firebolt').uid, target: { unitId: v.id } }, null, null, null]);
    assert.equal(F.findUnit(s, v.id), null);
  };
  kill(1, -7, 0); // 원 밖
  near(s.players[0].capMs, 1000);
  kill(2, 0, 2); // 원 안 (반지름 3)
  near(s.players[0].capMs, 3000);
  kill(3, 7, 0, 'rats', { token: true }); // 원 밖의 작은 복제
  near(s.players[0].capMs, 3500);
  near(s.players[0].stats.killScore, 3.5);
  near(s.players[0].stats.kills, 3);
  assert.deepEqual(s.players.slice(1).map((P) => P.capMs), [0, 0, 0], '쓰러진 쪽은 점수를 잃지 않는다');

  // 결투에는 처치 점수가 없다
  const d = mk();
  const v = Object.assign(dummy(d, 1, 0, 3, 'shield'), { hp: 0.01 });
  play(d, 0, give(d, 0, 'firebolt'), { unitId: v.id });
  assert.equal(d.players[0].capMs, 0);
});

test('난투장 처치 점수: 같은 순간에 함께 쓰러뜨리면 나눠 갖는다. 쓰러진 순간에 친 적만 받는다', () => {
  const s = mk({ format: 'melee4' });
  s.rules.captureAggro = 0;
  const v = Object.assign(dummy(s, 1, -7, 0, 'shield'), { range: 0, hp: 0.01 });
  const fire = (p) => ({ type: 'play', uid: give(s, p, 'firebolt').uid, target: { unitId: v.id } });
  F.applyActions(s, [fire(0), null, fire(2), null]);
  near(s.players[0].capMs, 500);
  near(s.players[2].capMs, 500);
  // 먼저 깎아 둔 쪽은 받지 못한다 (쓰러진 순간에 친 사람만)
  const w = Object.assign(dummy(s, 1, -7, 2, 'colossus'), { range: 0 });
  F.applyActions(s, [{ type: 'play', uid: give(s, 0, 'firebolt').uid, target: { unitId: w.id } }, null, null, null]);
  run(s, 100);
  w.hp = 0.01;
  F.applyActions(s, [null, null, null, { type: 'play', uid: give(s, 3, 'firebolt').uid, target: { unitId: w.id } }]);
  near(s.players[0].capMs, 500);
  near(s.players[3].capMs, 1000);
});


test('연합전: 같은 팀은 서로 치지 않고, 주문도 걸 수 없다. 두 지휘관이 모두 쓰러져야 진다', () => {
  const s = mk({ format: 'alliance', rules: { battleMs: 60000 } });
  const mine = put(s, 0, -5, -1, 'bat');
  const ally = dummy(s, 1, -4, -1, 'shield');
  const foe = dummy(s, 3, 5, 3, 'shield');
  assert.equal(F.chooseTarget(s, mine).unit, foe, '2번은 유닛이 없지만, 팀원(3번)의 유닛이 있어서 본진을 칠 수 없다');
  assert.deepEqual(F.legalTargets(s, 0, give(s, 0, 'firebolt').uid), [{ unitId: foe.id }]);
  assert.equal(play(s, 0, give(s, 0, 'firebolt'), { unitId: ally.id }).ok, false);
  s.players[2].hp = 0;
  run(s, 100);
  assert.equal(s.over, false);
  s.players[3].hp = 0;
  run(s, 100);
  assert.equal(s.over, true);
  assert.equal(s.result.winnerTeam, 0);
});

test('같은 순간의 공격에는 순서가 없다: 그 틱에 쓰러지는 수호 유닛도 끝까지 피해를 나눠 받는다', () => {
  const s = mk({ format: 'melee4' });
  s.rules.captureAggro = 0;
  // 0번과 2번의 방패병(수호)이 각각 옆의 박쥐를 지킨다. 둘 다 체력이 거의 없다.
  const g0 = Object.assign(dummy(s, 0, 0, -1, 'shield'), { hp: 0.1 });
  const b0 = dummy(s, 0, 1, -1, 'bat');
  const g2 = Object.assign(dummy(s, 2, 0, 1, 'shield'), { hp: 0.1 });
  const b2 = dummy(s, 2, -1, 1, 'bat');
  // 같은 틱에 방패병도 맞고 박쥐도 맞는다. 방패병을 치는 쪽이 먼저 처리되든 나중에 처리되든 박쥐가 받는 피해는 같아야 한다.
  const hit = (owner, target) => Object.assign(put(s, owner, target.x, target.y + (owner === 1 ? 0.9 : -0.9), 'rats'), { speed: 0, targetId: target.id, attackTimer: 5000 });
  hit(1, g0); // 번호가 앞선 유닛이 0번의 방패병을 먼저 쓰러뜨린다
  hit(3, b0);
  hit(1, b2);
  hit(3, g2); // 2번 쪽은 박쥐가 먼저 맞고 방패병이 나중에 쓰러진다
  const hp = b0.hp;
  run(s, 100);
  assert.equal(F.findUnit(s, g0.id), null);
  assert.equal(F.findUnit(s, g2.id), null);
  near(hp - b0.hp, hp - b2.hp, '두 박쥐가 받은 피해');
  near(hp - b0.hp, E.CARDS.rats.atk * 0.8, '수호가 20%를 대신 받았다');
});

test('같은 순간에 낸 주문에도 순서가 없다: 앞사람의 주문에 쓰러진 유닛도 뒷사람의 주문을 맞는다', () => {
  const s = mk({ format: 'melee4' });
  const a = dummy(s, 1, -3, 0, 'rats'); // 화염탄 한 발이면 쓰러진다
  const acts = [0, 2].map((p) => ({ type: 'play', uid: give(s, p, 'firebolt').uid, target: { unitId: a.id } }));
  const res = F.applyActions(s, [acts[0], null, acts[1], null]);
  assert.deepEqual(res.map((x) => x && x.ok), [true, null, true, null]);
  assert.equal(F.findUnit(s, a.id), null);
  // 따로따로 내면 두 번째는 표적이 없어서 못 낸다
  const b = dummy(s, 1, -3, 1, 'rats');
  assert.equal(play(s, 0, give(s, 0, 'firebolt'), { unitId: b.id }).ok, true);
  assert.equal(play(s, 2, give(s, 2, 'firebolt'), { unitId: b.id }).ok, false);
});

// ───────────────────────── 봇끼리 ─────────────────────────

function botMatch(format, seed, extra = {}) {
  const rng = E.makeRng(seed);
  const players = Array.from({ length: SIZE[format] }, () => {
    const commander = rng.pick(E.COMMANDER_IDS);
    return { commander, deck: E.randomMidDeck(commander, rng) };
  });
  return { seed, format, battlefield: rng.pick([null, ...E.BATTLEFIELD_IDS]), players, ...extra };
}

test('같은 시드면 결과와 이벤트 기록이 완전히 같다 (모든 형식)', () => {
  for (const format of Object.keys(SIZE)) {
    const a = E.runFieldBattle(botMatch(format, 3, { logEvents: true }));
    const b = E.runFieldBattle(botMatch(format, 3, { logEvents: true }));
    assert.deepEqual(a.result, b.result);
    assert.equal(JSON.stringify(a.state.events), JSON.stringify(b.state.events));
  }
});

test('불변식: 유닛은 필드 안에 있고 심하게 겹치지 않으며, 카드가 사라지지 않는다', () => {
  for (const format of Object.keys(SIZE)) {
    for (let seed = 1; seed <= 15; seed++) {
      const cfg = botMatch(format, seed);
      cfg.players[seed % cfg.players.length].bot = { style: seed % 3 === 0 ? 'random' : 'smart' };
      const sizes = cfg.players.map((p) => p.deck.length);
      E.runFieldBattle({
        ...cfg,
        onTick(state) {
          const a = state.arena;
          for (const u of state.units) {
            assert.ok(u.hp > 0 && u.hp <= u.maxHp + 1e-9);
            if (a.shape === 'circle') assert.ok(Math.hypot(u.x, u.y) <= a.r - u.radius + 1e-6, `${format} ${seed}`);
            else assert.ok(Math.abs(u.x) <= a.w / 2 - u.radius + 1e-6 && Math.abs(u.y) <= a.h / 2 - u.radius + 1e-6);
          }
          state.players.forEach((P, p) => {
            if (P.dead) return;
            assert.equal(F.countCards(state, p), sizes[p], `${format} seed ${seed}`);
            assert.ok(F.unitsOf(state, p).filter((u) => !u.token).length <= state.rules.unitCap);
          });
        },
      });
    }
  }
});

test('자리 편향이 없다: 어느 형식에서도 한 자리만 유난히 이기거나 지지 않는다', () => {
  const counts = {};
  for (const format of Object.keys(SIZE)) {
    const n = SIZE[format];
    const wins = new Array(format === 'alliance' ? 2 : n).fill(0);
    let decided = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const { result } = E.runFieldBattle(botMatch(format, seed));
      const w = format === 'alliance' ? result.winnerTeam : result.winner;
      if (w < 0) continue;
      wins[w]++;
      decided++;
    }
    counts[format] = wins;
    const fair = decided / wins.length;
    for (const w of wins) assert.ok(w > fair * 0.72 && w < fair * 1.28, `${format}: ${wins} (기대 ${fair.toFixed(0)})`);
  }
  assert.ok(counts.duel);
});

test('난투장은 자리만 다르고 조건이 같으면 결과도 같다: 같은 덱·같은 섞기면 전원 공동 1위', () => {
  for (const format of ['melee4']) {
    for (let seed = 1; seed <= 30; seed++) {
      const rng = E.makeRng(seed);
      const commander = rng.pick(E.COMMANDER_IDS);
      const deck = E.randomMidDeck(commander, rng);
      const players = Array.from({ length: SIZE[format] }, () => ({ commander, deck, seed: 77 + seed, bot: { seed: 5 + seed } }));
      const { result } = E.runFieldBattle({ seed, format, players });
      assert.ok(result.ranks.every((r) => r === 0), `${format} seed ${seed}: ${result.ranks} 점수 ${result.scores}`);
    }
  }
});

test('봇: 같은 덱이면 판단하는 봇이 무작위 봇보다 많이 이긴다', () => {
  let a = 0;
  let n = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const rng = E.makeRng(seed);
    const commander = rng.pick(E.COMMANDER_IDS);
    const deck = E.randomMidDeck(commander, rng);
    const side = seed % 2;
    const players = [{ commander, deck }, { commander, deck }];
    players[side].bot = { style: 'smart' };
    players[1 - side].bot = { style: 'random' };
    const { result } = E.runFieldBattle({ seed, players });
    if (result.winner === -1) continue;
    n++;
    if (result.winner === side) a++;
  }
  assert.ok(a / n > 0.6, `판단 봇 승률 ${((a / n) * 100).toFixed(1)}%`);
});

test('전투 길이: 결투는 기본 수치로 중앙값이 24~36초', () => {
  const lens = [];
  for (let seed = 1; seed <= 200; seed++) lens.push(E.runFieldBattle(botMatch('duel', seed)).result.timeMs / 1000);
  const med = lens.sort((x, y) => x - y)[100];
  assert.ok(med >= 24 && med <= 36, `중앙값 ${med}초`);
});
