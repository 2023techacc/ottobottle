// 유닛 소환 전투 (실험). 유닛이 칸에 꽂혀 있지 않고, 필드에 소환돼 걸어가서 사거리 안의 적을 친다.
// 덱·손패·마나·카드는 기존 전투(battle.js)와 같고, 유닛이 싸우는 방식만 다르다.
//
//   - 칸은 "배치"할 때만 쓴다. 자기 본진 앞의 배치 칸(가로 5 × 세로 3)에 유닛을 놓으면,
//     그 뒤로는 칸과 상관없이 자유롭게 걸어 다닌다.
//   - 유닛은 몸집이 있어서 서로 겹치지 않고 밀어낸다. 여럿이 모이면 뒤엉킨다.
//   - 결투, 난투장, 연합전 모두 한 필드에서 싸운다.
//   - 결투와 연합전은 상대 지휘관(본진)을 쓰러뜨리면 이긴다.
//     난투장은 본진을 치지 않는다. 한가운데의 원을 차지하고 있는 동안, 그리고 적 유닛을 쓰러뜨릴 때 점수가 오르고,
//     점수로 순위를 정한다.
//
// 난수는 덱 섞기에만 쓴다. 같은 설정과 같은 입력이면 결과도 같다.
// 좌표: 필드 한가운데가 (0, 0), 위쪽이 +y. 길이 단위는 "배치 칸 한 변 = 2".

import { makeRng, hashSeed } from './rng.js';
import { CARDS, COMMANDERS, UNIT_DIAMONDS, cardLabel } from './cards.js';
import { DEFAULT_RULES } from './rules.js';

const EPS = 1e-9;
/** 거리를 견줄 때는 소수점 아래 여섯 자리까지만 본다 (계산 오차로 판정이 갈리지 않게) */
const q6 = (x) => Math.round(x * 1e6);

export const DEPLOY_COLS = 5;
export const DEPLOY_ROWS = 3;
export const CELL = 2; // 배치 칸 한 변의 길이

/** 유닛 전투에서만 쓰는 능력치: 사거리, 걷는 속도(초당), 몸집(반지름) */
export const FIELD_STATS = Object.freeze({
  shield: { range: 1.3, speed: 3.3, radius: 0.45 },
  rats: { range: 1.2, speed: 5.5, radius: 0.35 },
  bat: { range: 1.3, speed: 5.0, radius: 0.4 },
  archer: { range: 6, speed: 3.3, radius: 0.4 },
  dagger: { range: 1.3, speed: 5.5, radius: 0.4 },
  frostwitch: { range: 6, speed: 3.0, radius: 0.4 },
  lancer: { range: 1.5, speed: 4.4, radius: 0.5 },
  pyro: { range: 8, speed: 2.8, radius: 0.4 },
  colossus: { range: 1.7, speed: 2.2, radius: 0.8 },
});

/** 유닛 전투의 기본 규칙 수치 (DEFAULT_RULES 위에 덮어쓴다) */
export const FIELD_RULES = Object.freeze({
  commanderHp: 40,
  unitAtkMult: 0.5,
  unitHpMult: 1.25,
  vanguardSlots: 0,
  unitCap: 8, // 한 플레이어가 필드에 둘 수 있는 유닛 수. 가득 차면 기존 유닛 하나를 대체한다.
  baseRadius: 1, // 본진(지휘관)의 크기
  nearRange: 1.7, // 수호·집결이 닿는 거리
  pierceReach: 1.4, // 관통이 표적 뒤로 닿는 거리
  blastRadius: 2.2, // 화염술사 필살기: 표적 주변
  slamRadius: 3.2, // 거신 필살기: 자기 주변
  // 본진을 지키는 범위. 그 팀의 유닛이 본진에서 이 거리 안에 하나라도 있으면 본진을 칠 수 없다.
  // 필드 전체라서, 유닛이 하나라도 살아 있으면 본진을 못 친다 (지나치기 없음).
  baseGuardRange: Infinity,
  meleeRadius: 10, // 난투장 필드의 반지름
  // 난투장(중앙 점령)
  captureRadius: 3, // 한가운데 점령 원의 반지름
  captureGoal: 20, // 이 점수에 먼저 닿으면 바로 끝난다. 원 안에 유닛이 가장 많은 사람만 1초에 1점 (처치 점수는 아래)
  captureHold: 0.7, // 싸울 상대가 없으면 원 반지름의 이 비율 안쪽까지 걸어 들어가서 버틴다
  captureAggro: 4.5, // 이 거리 안에 들어온 적만 상대한다 (멀리 있는 적을 쫓아 원을 비우지 않는다)
  // 처치 점수: 적 유닛을 쓰러뜨리면 한 기에 killScore 점 (작은 복제는 절반). 원 안에서 쓰러졌으면 × killZoneMult.
  // 같은 순간에 여럿이 함께 쓰러뜨렸으면 나눠 갖는다. 0이면 처치 점수가 없다.
  // killPerMana가 0보다 크면 한 기에 일정한 점수 대신 "마나 비용 × killPerMana" 점을 준다 (비교 실험용. 싼 유닛이 더 유리해진다).
  killScore: 1,
  killPerMana: 0,
  killZoneMult: 2,
});

/** 전열·후열이 없어져서 뜻이 달라진 카드의 설명 */
export const FIELD_TEXT = Object.freeze({
  shield: '◆수호: 가까이 있는 아군이 받는 피해의 20%를 대신 받는다',
  dagger: '◆암살: 적 원거리 유닛부터 노린다',
  lancer: '◆관통: 표적 바로 뒤의 적에게도 50% 피해',
  pyro: '필살기(전조 1초): 표적 주변 범위에 피해 20',
  colossus: '받는 군중 제어 절반. 필살기(전조 1.2초): 자기 주변 넓은 범위에 피해 25',
  retreat: '내 유닛 하나를 내 배치 칸으로 옮기고 체력 5 회복',
  warcry: '근접 유닛 전체 공격 +2 (6초)',
  phalanx: '내 원거리 유닛이 3초간 받는 범위 피해 50% 감소',
});

export const fieldText = (id) => FIELD_TEXT[id] || CARDS[id].text || '';

const fail = (reason) => ({ ok: false, reason });
const OK = { ok: true };

// ─────────────────────────────────────────────────────────────
// 필드 모양
// ─────────────────────────────────────────────────────────────

/**
 * 형식별 필드와 자리.
 *   결투: 가로 10 × 세로 12 직사각형. 아래와 위에 본진.
 *   연합전: 가로 20 × 세로 12. 아래쪽에 한 팀의 본진 둘, 위쪽에 상대 팀의 본진 둘.
 *   난투장: 반지름 10인 원. 본진 넷이 둘레에 같은 간격으로 놓인다 (0번이 아래, 시계 방향).
 * 자리마다 본진 위치(bx, by)와 전진 방향(fx, fy)이 있다.
 */
export function makeArena(format, meleeRadius = 10) {
  const seat = (bx, by, fx, fy) => ({ bx, by, fx, fy, rx: fy, ry: -fx }); // (rx, ry)는 그 자리에서 본 오른쪽
  if (format === 'alliance') {
    return { shape: 'rect', w: 20, h: 12, seats: [seat(-5, -6, 0, 1), seat(5, -6, 0, 1), seat(-5, 6, 0, -1), seat(5, 6, 0, -1)] };
  }
  if (format === 'melee4') {
    const n = 4;
    const r = meleeRadius;
    const seats = [];
    for (let k = 0; k < n; k++) {
      const a = -Math.PI / 2 - (k * 2 * Math.PI) / n;
      const c = Math.round(Math.cos(a) * 1e9) / 1e9;
      const s = Math.round(Math.sin(a) * 1e9) / 1e9;
      seats.push(seat(c * r, s * r, -c, -s));
    }
    return { shape: 'circle', r, seats };
  }
  if (format !== 'duel') throw new Error(`모르는 형식: ${format}`);
  return { shape: 'rect', w: 10, h: 12, seats: [seat(0, -6, 0, 1), seat(0, 6, 0, -1)] };
}

/** 배치 칸의 중심. col 0~4는 왼쪽부터, row 0~2는 본진에서 가까운 줄부터. */
export function cellCenter(state, p, col, row) {
  const s = state.arena.seats[p];
  const forward = 1 + CELL * row;
  const side = CELL * (col - (DEPLOY_COLS - 1) / 2);
  return { x: s.bx + s.fx * forward + s.rx * side, y: s.by + s.fy * forward + s.ry * side };
}

export const cellIndex = (col, row) => row * DEPLOY_COLS + col;

/** 이 플레이어의 배치 칸 전부. free는 지금 놓을 수 있는지. */
export function deployCells(state, p) {
  const out = [];
  for (let row = 0; row < DEPLOY_ROWS; row++) {
    for (let col = 0; col < DEPLOY_COLS; col++) {
      const { x, y } = cellCenter(state, p, col, row);
      const blocked = state.battlefield === 'canyon' && (col === 0 || col === DEPLOY_COLS - 1); // 좁은 협곡: 양쪽 끝 줄을 못 쓴다
      const taken = state.units.some((u) => !u.dying && Math.hypot(u.x - x, u.y - y) < 0.9);
      out.push({ i: cellIndex(col, row), col, row, x, y, blocked, free: !blocked && !taken });
    }
  }
  return out;
}

function clampToArena(state, u) {
  const a = state.arena;
  if (a.shape === 'circle') {
    const d = Math.hypot(u.x, u.y);
    const max = a.r - u.radius;
    if (d > max) {
      u.x *= max / d;
      u.y *= max / d;
    }
    return;
  }
  const hx = a.w / 2 - u.radius;
  const hy = a.h / 2 - u.radius;
  u.x = Math.max(-hx, Math.min(hx, u.x));
  u.y = Math.max(-hy, Math.min(hy, u.y));
}

// ─────────────────────────────────────────────────────────────
// 만들기
// ─────────────────────────────────────────────────────────────

/**
 * @param {object} cfg
 * @param {number} cfg.seed
 * @param {'duel'|'melee4'|'alliance'} [cfg.format]  연합전은 0·1번이 한 팀, 2·3번이 한 팀. 난투장은 중앙 점령
 * @param {Array<{commander:string, deck:Array<{id:string,stars?:number,fuse?:string}>, name?:string, seed?:number,
 *   opening?:number[], bonus?:{startMana?:number,maxMana?:number,startHand?:number,openingPicks?:number}}>} cfg.players
 * @param {string|null} [cfg.battlefield]
 * @param {object} [cfg.rules]  FIELD_RULES에 덮어쓸 값
 * @param {boolean} [cfg.logEvents]
 */
export function createField(cfg) {
  const rules = { ...DEFAULT_RULES, ...FIELD_RULES, ...(cfg.rules || {}) };
  const seed = (cfg.seed ?? 1) >>> 0;
  const format = cfg.format || 'duel';
  const arena = makeArena(format, rules.meleeRadius);
  if (arena.seats.length !== cfg.players.length) throw new Error(`${format} 형식은 ${arena.seats.length}명이어야 한다`);
  const state = {
    mode: 'field',
    format,
    arena,
    rules,
    seed,
    timeMs: 0,
    over: false,
    result: null,
    battlefield: cfg.battlefield || null,
    // 난투장: 점령 원. holder는 지금 점수를 얻고 있는 플레이어(-1이면 없음), counts는 원 안의 유닛 수
    capture: format === 'melee4'
      ? { x: 0, y: 0, radius: rules.captureRadius, goal: rules.captureGoal, holder: -1, counts: cfg.players.map(() => 0) }
      : null,
    players: [],
    units: [],
    telegraphs: [],
    events: [],
    logEvents: cfg.logEvents !== false,
    nextId: 1,
    deferDeaths: false,
  };

  cfg.players.forEach((pc, idx) => {
    const bonus = pc.bonus || {};
    const s = arena.seats[idx];
    const P = {
      idx,
      team: format === 'alliance' ? Math.floor(idx / 2) : idx,
      dead: false,
      deadAt: null,
      isBoss: false,
      commander: pc.commander,
      name: pc.name || COMMANDERS[pc.commander].name,
      base: { x: s.bx, y: s.by },
      hp: rules.commanderHp,
      maxHp: rules.commanderHp,
      capMs: 0, // 난투장 점수 (1000이 1점) = 원을 차지한 시간 + 처치 점수
      mana: rules.startMana + (bonus.startMana || 0),
      maxMana: rules.startMaxMana + (bonus.maxMana || 0),
      maxManaBonus: bonus.maxMana || 0,
      manaTimer: 0,
      drawTimer: 0,
      redrawReadyAt: 0,
      deck: [],
      hand: [],
      discard: [],
      exiled: [],
      lastPlayAt: -Infinity,
      lastPlayed: null,
      unitDiscount: { count: 0, amount: 0 },
      phalanxUntil: 0,
      invested: false,
      rng: makeRng(pc.seed ?? hashSeed(seed, 'deck', idx)),
      stats: {
        cardsPlayed: 0, plays: {}, manaSpent: 0, manaWasted: 0, manaCapMs: 0, handFullMs: 0,
        handSizeSum: 0, ticks: 0, redraws: 0, unitDamage: 0, commanderDamage: 0, unitsLost: 0, drawn: 0, walked: 0,
        kills: 0, zoneScore: 0, killScore: 0, // 난투장 점수의 내역 (점)
      },
    };
    P.deck = pc.deck.map((c, i) => ({
      uid: `p${idx}c${i}`, order: i, id: c.id, stars: c.stars || 1, fuse: c.fuse || null, drawnAt: 0, zeroCost: false,
    }));
    state.players.push(P);
  });

  cfg.players.forEach((pc, idx) => {
    const P = state.players[idx];
    const bonus = pc.bonus || {};
    const startHand = Math.min(rules.handMax, rules.startHand + (bonus.startHand || 0));
    P.rng.shuffle(P.deck);
    const maxPicks = Math.min(startHand, rules.openingPicks + (bonus.openingPicks || 0));
    const picked = [...new Set(pc.opening || [])].slice(0, maxPicks).map((i) => P.deck.find((c) => c.order === i)).filter(Boolean);
    if (picked.length) P.deck = [...P.deck.filter((c) => !picked.includes(c)), ...[...picked].reverse()];
    for (let i = 0; i < startHand; i++) drawCard(state, P);
  });
  return state;
}

// ─────────────────────────────────────────────────────────────
// 조회
// ─────────────────────────────────────────────────────────────

export const isEnemy = (state, a, b) => a !== b && state.players[a].team !== state.players[b].team;

/** 아직 지휘관이 살아 있는 적 플레이어들 (내 자리에서 시계 방향 순서) */
export function enemiesOf(state, p) {
  const out = [];
  const n = state.players.length;
  for (let k = 1; k < n; k++) {
    const q = (p + k) % n;
    if (!state.players[q].dead && isEnemy(state, p, q)) out.push(q);
  }
  return out;
}

/** p의 자리에서 시계 방향으로 몇 번째 자리인가. 거리가 똑같은 표적 사이의 순서를 누구에게나 같은 기준으로 정할 때 쓴다. */
const turnFrom = (state, p, q) => (q - p + state.players.length) % state.players.length;

export const unitsOf = (state, p) => state.units.filter((u) => u.owner === p);
export const findUnit = (state, id) => state.units.find((u) => u.id === id) || null;
export const hasKw = (u, kw) => u.keywords.includes(kw);
export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

const fogActive = (state) => state.battlefield === 'fog' && state.timeMs < 5000;

/** 주문이나 공격의 표적이 될 수 있는가. 안개: 처음 5초 동안 원거리 유닛은 표적이 되지 않는다. */
export function targetable(state, u) {
  if (!u || u.dying) return false;
  if (u.ranged && fogActive(state)) return false;
  return true;
}

/** 가까이 있는 아군 (수호·집결) */
function nearbyAllies(state, u) {
  const reach = state.rules.nearRange;
  return state.units.filter((x) => x !== u && !x.dying && x.owner === u.owner && distance(x, u) <= reach);
}

export function overtimeMult(state) {
  const r = state.rules;
  if (state.timeMs <= r.overtimeMs) return 1;
  return 1 + r.overtimeAtkPerSec * Math.ceil((state.timeMs - r.overtimeMs) / 1000);
}

export function currentAtk(state, u) {
  let atk = u.atk;
  for (const b of u.buffs) if (b.kind === 'atk') atk += b.amount;
  if (hasKw(u, 'rally')) atk += state.rules.rallyAtk * nearbyAllies(state, u).length;
  return atk * overtimeMult(state);
}

export function effInterval(state, u) {
  const r = state.rules;
  const slow = Math.min(r.slowCap, u.slows.length * r.slowPerStack);
  let iv = u.interval * (1 + slow);
  if (state.battlefield === 'rain' && u.ranged) iv *= 1.2;
  return Math.round(iv);
}

export function effectiveCost(state, p, c) {
  const P = state.players[p];
  const def = CARDS[c.id];
  const r = state.rules;
  if (c.zeroCost) return 0;
  let cost = def.cost;
  if (def.keywords.includes('aging')) cost -= Math.floor((state.timeMs - c.drawnAt) / r.agingIntervalMs);
  if (def.type === 'unit' && P.unitDiscount.count > 0) cost -= P.unitDiscount.amount;
  if (c.fuse && P.commander === 'alchemist') cost -= 1;
  return Math.max(0, cost);
}

// ─────────────────────────────────────────────────────────────
// 표적
// ─────────────────────────────────────────────────────────────

/**
 * 표적 고르기.
 *   - 치고 있던 적이 아직 사거리 안에 있으면 계속 친다.
 *   - 아니면 가장 가까운 적 유닛. 암살은 원거리 유닛부터 노린다.
 *   - 본진(지휘관)은 지키는 유닛이 없을 때만 칠 수 있다. 그 팀의 유닛이 하나도 없어야 한다.
 *   - 난투장(중앙 점령)에서는 본진을 치지 않는다. 가까이(captureAggro) 온 적만 상대하고,
 *     상대할 적이 없으면 점령 원으로 걸어가서 버틴다 (zone). 암살은 원거리 유닛이면 멀리 있어도 쫓아간다.
 * @returns {{unit?:object, base?:number, zone?:boolean, x:number, y:number, d:number, reach:number, inRange:boolean} | null}
 */
export function chooseTarget(state, u) {
  const foes = enemiesOf(state, u.owner);
  const n = state.players.length;
  const cap = state.capture;
  const assassin = hasKw(u, 'assassin');
  const cands = [];
  for (const q of foes) {
    // 거리가 똑같을 때는 내 자리에서 시계 방향으로 가까운 상대부터 (누구에게나 같은 기준)
    const turn = (q - u.owner + n) % n;
    const theirs = state.units.filter((x) => x.owner === q && !x.dying);
    const b = state.players[q].base;
    const guardRange = state.rules.baseGuardRange;
    // 본진은 같은 팀의 유닛이 지킨다 (연합전에서는 팀원의 유닛도 내 본진을 지켜 준다)
    const team = state.players[q].team;
    const guards = guardRange <= 0 ? [] : state.units.filter((x) => !x.dying && state.players[x.owner].team === team);
    if (!cap && !guards.some((x) => distance(x, b) <= guardRange)) {
      cands.push({ base: q, x: b.x, y: b.y, d: distance(u, b), reach: u.range + state.rules.baseRadius, prio: 2, turn, id: q });
    }
    for (const x of theirs) {
      if (!targetable(state, x)) continue;
      // 몸집이 큰 표적은 그만큼 멀리서도 닿는다
      const d = distance(u, x);
      const reach = u.range + x.radius - 0.45;
      if (cap && q6(d) > q6(Math.max(reach, state.rules.captureAggro)) && !(assassin && x.ranged)) continue;
      cands.push({ unit: x, x: x.x, y: x.y, d, reach, prio: 1, turn, id: x.id });
    }
  }
  if (!cands.length) {
    if (!cap) return null;
    const d = Math.hypot(u.x - cap.x, u.y - cap.y);
    const reach = cap.radius * state.rules.captureHold;
    return { zone: true, x: cap.x, y: cap.y, d, reach, inRange: q6(d) <= q6(reach) };
  }
  const current = cands.find((c) => c.unit && c.unit.id === u.targetId);
  if (current && q6(current.d) <= q6(current.reach)) return { ...current, inRange: true };
  const rank = (c) => (assassin && c.unit && c.unit.ranged ? 0 : c.prio);
  // 거리는 소수점 아래 여섯 자리까지만 비교한다 (계산 오차로 순서가 갈리지 않게)
  const near = (c) => q6(c.d);
  cands.sort((a, b) => (assassin ? rank(a) - rank(b) : 0) || near(a) - near(b) || a.prio - b.prio || a.turn - b.turn || a.id - b.id);
  const best = cands[0];
  return { ...best, inRange: q6(best.d) <= q6(best.reach) };
}

// ─────────────────────────────────────────────────────────────
// 소환
// ─────────────────────────────────────────────────────────────

/** 카드로 유닛을 (x, y)에 소환한다. 테스트에서도 직접 쓴다. */
export function summonUnit(state, owner, x, y, c) {
  const def = CARDS[c.id];
  const r = state.rules;
  const fs = FIELD_STATS[c.id] || { range: def.ranged ? 6 : 1.3, speed: 4, radius: 0.45 };
  const mult = Math.pow(r.starMult, (c.stars || 1) - 1);
  const atkMult = mult * r.unitAtkMult;
  const baseHp = def.hp * mult * r.unitHpMult;
  // 전열·후열이 없어서, 전열 효과는 근접 유닛에 적용한다
  let hpMult = 1;
  if (!def.ranged) {
    if (state.players[owner].commander === 'general') hpMult += 0.1;
    if (state.battlefield === 'citadel') hpMult += 0.2;
  }
  const keywords = [...def.keywords];
  if (c.fuse && UNIT_DIAMONDS.includes(c.fuse) && !keywords.includes(c.fuse)) keywords.push(c.fuse);
  const u = {
    id: state.nextId++,
    owner,
    card: c.uid ? c : null,
    defId: def.id,
    name: cardLabel(c),
    stars: c.stars || 1,
    token: false,
    x,
    y,
    radius: fs.radius,
    range: fs.range,
    speed: fs.speed,
    atk: def.atk * atkMult,
    baseAtk: def.atk * atkMult,
    hp: baseHp * hpMult,
    maxHp: baseHp * hpMult,
    baseMaxHp: baseHp,
    interval: Math.round(def.interval * r.attackIntervalMult),
    ranged: def.ranged,
    keywords,
    ccResist: def.ccResist || 1,
    ult: def.ult ? { ...def.ult, damage: def.ult.damage ? def.ult.damage * atkMult : undefined } : null,
    gauge: 0,
    attackTimer: 0,
    targetId: null,
    moving: false,
    buffs: [],
    slows: [],
    silenceUntil: 0,
    ccLast: { slow: -Infinity, silence: -Infinity },
    tripleShot: false,
    telegraphing: false,
    dying: false,
    pendingHeal: 0,
    hitters: null,
    summonedAt: state.timeMs,
  };
  state.units.push(u);
  emit(state, { type: 'summon', p: owner, unitId: u.id, name: u.name, x, y });
  return u;
}

function summonToken(state, parent, x, y) {
  const u = {
    ...parent,
    id: state.nextId++,
    card: null,
    name: `작은 ${CARDS[parent.defId].name}`,
    token: true,
    x,
    y,
    radius: parent.radius * 0.8,
    atk: parent.baseAtk / 2,
    baseAtk: parent.baseAtk / 2,
    hp: parent.baseMaxHp / 2,
    maxHp: parent.baseMaxHp / 2,
    baseMaxHp: parent.baseMaxHp / 2,
    keywords: parent.keywords.filter((k) => k !== 'split'),
    ult: null,
    gauge: 0,
    attackTimer: 0,
    targetId: null,
    moving: false,
    buffs: [],
    slows: [],
    silenceUntil: 0,
    ccLast: { slow: -Infinity, silence: -Infinity },
    tripleShot: false,
    telegraphing: false,
    dying: false,
    pendingHeal: 0,
    hitters: null,
    summonedAt: state.timeMs,
  };
  state.units.push(u);
  emit(state, { type: 'summon', p: parent.owner, unitId: u.id, name: u.name, x, y, token: true });
  return u;
}

// ─────────────────────────────────────────────────────────────
// 피해·회복·상태
// ─────────────────────────────────────────────────────────────

function emit(state, ev) {
  if (!state.logEvents) return;
  ev.t = state.timeMs;
  state.events.push(ev);
}

function dealDamage(state, target, amount, opts = {}) {
  if (!target || target.dying || amount <= 0) return 0;
  const r = state.rules;
  // 방진: 내 원거리 유닛이 받는 범위 피해 감소
  if (opts.aoe && target.ranged && state.players[target.owner].phalanxUntil > state.timeMs) amount *= 0.5;

  let dealt = 0;
  if (!opts.noGuard) {
    const guard = nearbyAllies(state, target).filter((x) => hasKw(x, 'guard'))
      .sort((a, b) => distance(a, target) - distance(b, target) || a.id - b.id)[0];
    if (guard) {
      const share = amount * r.guardShare;
      amount -= share;
      dealt += dealDamage(state, guard, share, { ...opts, aoe: false, noGuard: true, guarded: true });
    }
  }
  target.hp -= amount;
  dealt += amount;
  if (opts.source && opts.source.owner !== target.owner) state.players[opts.source.owner].stats.unitDamage += amount;
  if (opts.source && isEnemy(state, opts.source.owner, target.owner)) {
    // 처치 점수용: 이 시각에 이 유닛을 친 플레이어들 (처리 순서와 상관없이 같은 시각이면 모두 함께 쓰러뜨린 것으로 친다)
    if (!target.hitters || target.hitters.t !== state.timeMs) target.hitters = { t: state.timeMs, owners: [] };
    if (!target.hitters.owners.includes(opts.source.owner)) target.hitters.owners.push(opts.source.owner);
  }
  if (target.ult && !target.telegraphing && state.timeMs >= target.silenceUntil) gainGauge(state, target, target.ult.gaugeHit);
  emit(state, { type: 'damage', p: target.owner, unitId: target.id, x: target.x, y: target.y, amount, guarded: !!opts.guarded, aoe: !!opts.aoe });
  // 같은 순간에 일어나는 공격들 사이에서는 죽음을 바로 확정하지 않는다 (먼저 처리된 쪽이 유리해지지 않게).
  if (target.hp <= EPS && !state.deferDeaths) target.dying = true;
  return dealt;
}

/** 여러 공격을 "동시에" 처리한다: 그 사이에 체력이 바닥난 유닛도 끝날 때까지는 서 있는 것으로 치고, 끝난 뒤에 한꺼번에 쓰러뜨린다. */
function simultaneously(state, fn) {
  state.deferDeaths = true;
  fn();
  state.deferDeaths = false;
  for (const u of state.units) if (u.hp <= EPS) u.dying = true;
}

function damageCommander(state, p, amount, source) {
  amount *= state.rules.commanderDamageMult;
  state.players[p].hp -= amount;
  if (source) state.players[source.owner].stats.commanderDamage += amount;
  emit(state, { type: 'commanderDamage', p, amount });
}

function gainGauge(state, u, amount) {
  if (!u.ult || !amount || u.telegraphing) return;
  if (state.timeMs < u.silenceUntil) return;
  if (state.battlefield === 'surge') amount *= 1.5;
  u.gauge = Math.min(state.rules.gaugeMax, u.gauge + amount);
}

function healUnit(state, u, amount) {
  if (u.dying || amount <= 0) return;
  const before = u.hp;
  u.hp = Math.min(u.maxHp, u.hp + amount);
  if (u.hp > before) emit(state, { type: 'heal', p: u.owner, unitId: u.id, x: u.x, y: u.y, amount: u.hp - before });
}

function ccDuration(state, u, kind, base) {
  let dur = base;
  if (state.timeMs - u.ccLast[kind] < state.rules.ccRepeatWindowMs) dur /= 2;
  dur *= u.ccResist;
  u.ccLast[kind] = state.timeMs;
  return dur;
}

function applySlow(state, u) {
  if (u.dying) return;
  const r = state.rules;
  u.slows.push(state.timeMs + ccDuration(state, u, 'slow', r.slowDurationMs));
  if (u.slows.length > r.slowMaxStacks) {
    u.slows.sort((a, b) => a - b);
    u.slows.shift();
  }
}

function applySilence(state, u, baseMs) {
  if (u.dying) return;
  const dur = ccDuration(state, u, 'silence', Math.min(state.rules.silenceMaxMs, baseMs));
  u.silenceUntil = Math.max(u.silenceUntil, state.timeMs + dur);
  emit(state, { type: 'silence', p: u.owner, unitId: u.id, durationMs: dur });
}

// ─────────────────────────────────────────────────────────────
// 덱·손패
// ─────────────────────────────────────────────────────────────

function drawCard(state, P) {
  const r = state.rules;
  if (P.hand.length >= r.handMax) return null;
  if (P.deck.length === 0) {
    if (P.discard.length === 0) return null;
    P.discard.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    P.deck = P.rng.shuffle(P.discard);
    P.discard = [];
  }
  const c = P.deck.pop();
  c.drawnAt = state.timeMs;
  P.hand.push(c);
  P.stats.drawn++;
  emit(state, { type: 'draw', p: P.idx });
  return c;
}

function tickPlayer(state, P, dt) {
  if (P.dead) return;
  const r = state.rules;
  const t = state.timeMs;
  P.maxMana = Math.min(r.maxManaCap, r.startMaxMana + Math.floor(t / r.maxManaIntervalMs)) + P.maxManaBonus;
  P.manaTimer += dt;
  while (P.manaTimer >= r.manaIntervalMs) {
    P.manaTimer -= r.manaIntervalMs;
    if (P.mana < P.maxMana) P.mana++;
    else P.stats.manaWasted++;
  }
  P.drawTimer += dt;
  if (P.drawTimer >= r.drawIntervalMs) {
    if (P.hand.length < r.handMax) {
      P.drawTimer -= r.drawIntervalMs;
      drawCard(state, P);
    } else P.drawTimer = r.drawIntervalMs;
  }
  const s = P.stats;
  s.ticks++;
  s.handSizeSum += P.hand.length;
  if (P.hand.length >= r.handMax) s.handFullMs += dt;
  if (P.mana >= P.maxMana) s.manaCapMs += dt;
}

// ─────────────────────────────────────────────────────────────
// 한 틱 진행
// ─────────────────────────────────────────────────────────────

export function step(state) {
  if (state.over) return;
  const r = state.rules;
  const dt = r.tickMs;
  state.timeMs += dt;
  const t = state.timeMs;

  for (const P of state.players) tickPlayer(state, P, dt);
  for (const u of state.units) {
    if (u.buffs.length) u.buffs = u.buffs.filter((b) => b.until === undefined || b.until > t);
    if (u.slows.length) u.slows = u.slows.filter((x) => x > t);
  }
  if (state.battlefield === 'volcano' && t % 10000 === 0) {
    for (const u of [...state.units]) dealDamage(state, u, u.maxHp * 0.05, { noGuard: true });
  }

  simultaneously(state, () => fireTelegraphs(state));

  // 이번 틱의 표적을 모두 먼저 정한다 (처리 순서에 따라 유불리가 생기지 않게)
  const plans = [];
  for (const u of state.units) {
    if (u.dying) continue;
    const tg = chooseTarget(state, u);
    u.targetId = tg && tg.unit ? tg.unit.id : null;
    plans.push({ u, tg });
  }

  // 공격: 사거리 안에 표적이 있는 유닛
  const ready = [];
  for (const { u, tg } of plans) {
    const iv = effInterval(state, u);
    if (u.attackTimer < iv) u.attackTimer += dt;
    if (tg && !tg.zone && tg.inRange && u.attackTimer >= iv) ready.push({ u, tg, iv });
  }
  simultaneously(state, () => attackAll(state, ready, dt));

  // 이동: 사거리 안에 표적이 없는 유닛은 표적 쪽으로 걷는다 (난투장에서 상대할 적이 없으면 점령 원으로).
  // 모두 같은 순간의 위치를 보고 움직인다.
  for (const { u, tg } of plans) {
    u.moving = false;
    if (u.dying || !tg || tg.inRange) continue;
    const gap = tg.d - tg.reach * 0.95; // 사거리에 살짝 들어올 만큼만 다가간다
    const walk = Math.min((u.speed * dt) / 1000, gap);
    if (walk <= 0 || tg.d < EPS) continue;
    u.x += ((tg.x - u.x) / tg.d) * walk;
    u.y += ((tg.y - u.y) / tg.d) * walk;
    u.moving = true;
    state.players[u.owner].stats.walked += walk;
  }
  separate(state);

  finishTick(state);
  scoreCapture(state);
  checkEnd(state);
}

/** 난투장: 점령 원 안에 유닛이 가장 많은 한 사람만 점수를 얻는다. 같으면 아무도 얻지 못한다. */
function scoreCapture(state) {
  const cap = state.capture;
  if (!cap) return;
  const counts = state.players.map(() => 0);
  for (const u of state.units) {
    if (!u.dying && q6(Math.hypot(u.x - cap.x, u.y - cap.y)) <= q6(cap.radius)) counts[u.owner]++;
  }
  const max = Math.max(...counts);
  const holder = max > 0 && counts.filter((c) => c === max).length === 1 ? counts.indexOf(max) : -1;
  if (holder !== cap.holder) emit(state, { type: 'capture', p: holder, from: cap.holder });
  cap.counts = counts;
  cap.holder = holder;
  if (holder >= 0) {
    state.players[holder].capMs += state.rules.tickMs;
    state.players[holder].stats.zoneScore += state.rules.tickMs / 1000;
  }
}

function attackAll(state, ready, dt) {
  for (const { u, tg, iv } of ready) {
    u.attackTimer = Math.min(u.attackTimer - iv, dt);
    const shots = u.tripleShot ? 3 : 1;
    u.tripleShot = false;
    const atk = currentAtk(state, u);
    emit(state, {
      type: 'attack', p: u.owner, unitId: u.id, x: u.x, y: u.y, ranged: u.ranged, shots,
      target: tg.unit ? { unitId: tg.unit.id, x: tg.x, y: tg.y } : { commander: tg.base, x: tg.x, y: tg.y },
    });
    for (let i = 0; i < shots; i++) {
      if (tg.unit) hitUnit(state, u, tg.unit, atk);
      else damageCommander(state, tg.base, atk, u);
    }
    gainGauge(state, u, u.ult ? u.ult.gaugeAtk : 0);
  }
}

/**
 * 유닛끼리 겹치지 않게 서로 밀어낸다. 싸우느라 서 있는 유닛은 덜 밀린다.
 * 한 번 돌 때 모두 같은 순간의 위치를 보고 밀려날 만큼을 모은 뒤에 한꺼번에 옮긴다 (처리 순서에 따라 결과가 달라지지 않게).
 */
function separate(state) {
  const us = state.units.filter((u) => !u.dying);
  for (let pass = 0; pass < 2; pass++) {
    const mx = us.map(() => 0);
    const my = us.map(() => 0);
    for (let i = 0; i < us.length; i++) {
      for (let j = i + 1; j < us.length; j++) {
        const a = us[i];
        const b = us[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        const min = a.radius + b.radius;
        if (d >= min) continue;
        if (d < 1e-6) {
          // 정확히 같은 자리에 있으면 번호로 정한 방향으로 벌린다
          const ang = ((a.id * 37 + b.id * 17) % 360) * (Math.PI / 180);
          dx = Math.cos(ang);
          dy = Math.sin(ang);
          d = 1;
        }
        const wa = a.moving ? 1 : 0.25;
        const wb = b.moving ? 1 : 0.25;
        const push = min - d;
        mx[i] -= (dx / d) * push * (wa / (wa + wb));
        my[i] -= (dy / d) * push * (wa / (wa + wb));
        mx[j] += (dx / d) * push * (wb / (wa + wb));
        my[j] += (dy / d) * push * (wb / (wa + wb));
      }
    }
    us.forEach((u, i) => {
      u.x += mx[i];
      u.y += my[i];
      clampToArena(state, u);
    });
  }
}

function hitUnit(state, u, target, atk) {
  const r = state.rules;
  let dealt = dealDamage(state, target, atk, { source: u });
  if (hasKw(u, 'pierce')) {
    // 관통: 표적 바로 뒤(공격한 방향)에 있는 적 하나에게도
    const d = distance(u, target) || 1;
    const px = target.x + ((target.x - u.x) / d) * r.pierceReach;
    const py = target.y + ((target.y - u.y) / d) * r.pierceReach;
    const behind = state.units
      .filter((x) => x !== target && !x.dying && isEnemy(state, u.owner, x.owner) && Math.hypot(x.x - px, x.y - py) <= r.pierceReach)
      .sort((a, b) => q6(Math.hypot(a.x - px, a.y - py)) - q6(Math.hypot(b.x - px, b.y - py)) || turnFrom(state, u.owner, a.owner) - turnFrom(state, u.owner, b.owner) || a.id - b.id)[0];
    if (behind) dealt += dealDamage(state, behind, atk * r.pierceShare, { source: u });
  }
  if (hasKw(u, 'lifesteal')) u.pendingHeal += dealt * r.lifesteal;
  if (!u.ranged && hasKw(target, 'thorns')) dealDamage(state, u, r.thornsDamage, { noGuard: true });
  if (hasKw(u, 'frost')) applySlow(state, target);
}

function fireTelegraphs(state) {
  const t = state.timeMs;
  const due = state.telegraphs.filter((g) => g.fireAt <= t);
  if (!due.length) return;
  state.telegraphs = state.telegraphs.filter((g) => g.fireAt > t);
  for (const g of due) {
    const caster = findUnit(state, g.unitId);
    emit(state, { type: 'ult', p: g.owner, unitId: g.unitId, kind: g.kind, x: g.x, y: g.y, radius: g.radius });
    for (const x of [...state.units]) {
      if (!isEnemy(state, g.owner, x.owner)) continue;
      if (q6(Math.hypot(x.x - g.x, x.y - g.y)) <= q6(g.radius + x.radius)) dealDamage(state, x, g.damage, { aoe: true, source: caster || { owner: g.owner } });
    }
  }
  // 같은 순간에 터진 필살기끼리는 순서가 없다: 모두 터진 뒤에야 전조 상태가 풀린다
  for (const g of due) {
    const caster = findUnit(state, g.unitId);
    if (caster) caster.telegraphing = false;
  }
}

function finishTick(state) {
  for (const u of state.units) {
    if (u.pendingHeal > 0) healUnit(state, u, u.pendingHeal);
    u.pendingHeal = 0;
  }
  resolveDeaths(state);
  for (const u of [...state.units]) {
    if (u.ult && !u.telegraphing && u.gauge >= state.rules.gaugeMax - EPS) triggerUlt(state, u);
  }
}

function resolveDeaths(state) {
  const dead = state.units.filter((u) => u.dying);
  for (const u of dead) removeUnit(state, u, true);
  for (const u of dead) {
    if (!hasKw(u, 'split')) continue;
    // 쓰러진 자리 양옆에 작은 복제 2개 (겹치면 서로 밀려난다)
    const s = state.arena.seats[u.owner];
    for (const side of [-1, 1]) {
      const t = summonToken(state, u, u.x + s.rx * 0.4 * side, u.y + s.ry * 0.4 * side);
      clampToArena(state, t);
    }
  }
}

function removeUnit(state, u, died) {
  state.units = state.units.filter((x) => x !== u);
  const P = state.players[u.owner];
  if (u.card) P.discard.push(u.card);
  if (u.telegraphing) state.telegraphs = state.telegraphs.filter((g) => g.unitId !== u.id);
  if (died) {
    P.stats.unitsLost++;
    emit(state, { type: 'death', p: u.owner, unitId: u.id, name: u.name, x: u.x, y: u.y });
    scoreKill(state, u);
  }
}

/** 이 유닛이 쓰러졌을 때 얻는 처치 점수 (난투장이 아니면 0) */
export function killValue(state, u) {
  const cap = state.capture;
  const r = state.rules;
  let v = r.killPerMana > 0 ? CARDS[u.defId].cost * u.stars * r.killPerMana : r.killScore;
  if (!cap || !(v > 0)) return 0;
  if (u.token) v /= 2;
  if (q6(Math.hypot(u.x - cap.x, u.y - cap.y)) <= q6(cap.radius)) v *= state.rules.killZoneMult;
  return v;
}

/** 난투장: 쓰러진 유닛의 처치 점수를 그 순간에 친 적들에게 나눠 준다 */
function scoreKill(state, u) {
  const h = u.hitters;
  if (!state.capture || !h || h.t !== state.timeMs || !h.owners.length) return;
  const v = killValue(state, u);
  if (v <= 0) return;
  const ms = Math.round((v * 1000) / h.owners.length);
  for (const q of h.owners) {
    const Q = state.players[q];
    if (Q.dead) continue;
    Q.capMs += ms;
    Q.stats.kills += 1 / h.owners.length;
    Q.stats.killScore += ms / 1000;
  }
  emit(state, { type: 'killScore', p: u.owner, unitId: u.id, by: [...h.owners], points: ms / 1000, x: u.x, y: u.y });
}

function triggerUlt(state, u) {
  const ult = u.ult;
  const r = state.rules;
  if (ult.kind === 'tripleShot') {
    u.tripleShot = true;
    u.gauge = 0;
    emit(state, { type: 'ultReady', p: u.owner, unitId: u.id, kind: ult.kind });
    return;
  }
  const tg = chooseTarget(state, u);
  if (!tg || !tg.unit || !tg.inRange) return; // 사거리 안에 칠 유닛이 없으면 게이지를 쥐고 기다린다
  // 범위는 전조가 시작될 때의 자리로 정해진다. 그 사이에 벗어나면 맞지 않는다.
  const g = ult.kind === 'cross'
    ? { x: tg.x, y: tg.y, radius: r.blastRadius } // 화염술사: 표적 주변
    : { x: u.x, y: u.y, radius: r.slamRadius }; // 거신: 자기 주변
  u.gauge = 0;
  u.telegraphing = true;
  state.telegraphs.push({
    id: state.nextId++, owner: u.owner, unitId: u.id, kind: ult.kind, ...g,
    startAt: state.timeMs, fireAt: state.timeMs + ult.telegraphMs, damage: ult.damage,
  });
  emit(state, { type: 'telegraph', p: u.owner, unitId: u.id, kind: ult.kind, ...g, fireAt: state.timeMs + ult.telegraphMs });
}

function checkEnd(state) {
  const t = state.timeMs;
  // 이번 틱에 지휘관이 쓰러진 플레이어: 유닛이 사라지고 더는 카드를 내지 못한다
  const fallen = state.players.filter((P) => !P.dead && P.hp <= EPS);
  for (const P of fallen) {
    P.dead = true;
    P.deadAt = t;
  }
  for (const P of fallen) {
    for (const u of unitsOf(state, P.idx)) removeUnit(state, u, false);
    state.telegraphs = state.telegraphs.filter((g) => g.owner !== P.idx);
    emit(state, { type: 'commanderDown', p: P.idx });
  }

  const teamsAlive = new Set(state.players.filter((P) => !P.dead).map((P) => P.team));
  const timeUp = t >= state.rules.battleMs;

  if (state.capture) {
    // 난투장: 목표 점수에 닿거나 시간이 다 되면 끝. 순위는 점수순이고 같으면 공동 순위.
    const reached = state.players.some((P) => P.capMs >= state.capture.goal * 1000);
    if (!reached && !timeUp) return;
    const byScore = [...state.players].sort((A, B) => B.capMs - A.capMs || A.idx - B.idx);
    const capRanks = new Array(state.players.length).fill(0);
    byScore.forEach((P, i) => {
      capRanks[P.idx] = i > 0 && byScore[i - 1].capMs === P.capMs ? capRanks[byScore[i - 1].idx] : i;
    });
    const first = byScore.filter((P) => capRanks[P.idx] === 0);
    const winner = first.length === 1 ? first[0].idx : -1;
    state.over = true;
    state.result = {
      winner,
      winnerTeam: winner,
      reason: reached ? 'capture' : 'time',
      timeMs: t,
      hp: state.players.map((P) => Math.max(0, P.hp)),
      survivors: state.players.map((P) => unitsOf(state, P.idx).length),
      ranks: capRanks,
      order: byScore.map((P) => P.idx),
      scores: state.players.map((P) => P.capMs / 1000),
    };
    emit(state, { type: 'end', winner, reason: state.result.reason });
    return;
  }
  if (teamsAlive.size > 1 && !timeUp) return;

  // 순위: 살아 있는 쪽이 위(지휘관 체력 비율 순), 쓰러진 쪽은 늦게 쓰러진 순. 같으면 공동 순위.
  const key = (P) => (P.dead ? [0, P.deadAt] : [1, P.hp / P.maxHp]);
  const cmp = (A, B) => {
    const a = key(A);
    const b = key(B);
    if (a[0] !== b[0]) return b[0] - a[0];
    return Math.abs(a[1] - b[1]) < EPS ? 0 : b[1] - a[1];
  };
  const order = [...state.players].sort((A, B) => cmp(A, B) || A.idx - B.idx);
  const ranks = new Array(state.players.length).fill(0);
  order.forEach((P, i) => {
    ranks[P.idx] = i > 0 && cmp(order[i - 1], P) === 0 ? ranks[order[i - 1].idx] : i;
  });
  const teamIds = [...new Set(state.players.map((P) => P.team))];
  const teamScore = (id) => state.players.filter((P) => P.team === id && !P.dead).reduce((s, P) => s + P.hp / P.maxHp, 0);
  let winnerTeam = -1;
  if (teamsAlive.size === 1) winnerTeam = [...teamsAlive][0];
  else if (teamsAlive.size > 1) {
    const sorted = teamIds.map((id) => [id, teamScore(id)]).sort((a, b) => b[1] - a[1]);
    if (sorted[0][1] - sorted[1][1] > EPS) winnerTeam = sorted[0][0];
  }
  const top = order.filter((P) => ranks[P.idx] === 0);
  state.over = true;
  state.result = {
    winner: top.length === 1 ? top[0].idx : -1,
    winnerTeam,
    reason: teamsAlive.size > 1 ? 'time' : 'commander',
    timeMs: t,
    hp: state.players.map((P) => Math.max(0, P.hp)),
    survivors: state.players.map((P) => unitsOf(state, P.idx).length),
    ranks,
    order: order.map((P) => P.idx),
  };
  emit(state, { type: 'end', winner: state.result.winner, reason: state.result.reason });
}

// ─────────────────────────────────────────────────────────────
// 플레이어 행동
// ─────────────────────────────────────────────────────────────

function basicPlayable(state, p, c) {
  if (state.over) return fail('전투가 끝났다');
  if (state.players[p].dead) return fail('지휘관이 쓰러졌다');
  const def = CARDS[c.id];
  if (def.meleeOnly) return fail('유닛 전투에는 아직 없는 카드');
  if (effectiveCost(state, p, c) > state.players[p].mana) return fail('마나가 모자라다');
  return OK;
}

const atCap = (state, p) => unitsOf(state, p).filter((u) => !u.dying).length >= state.rules.unitCap;

/**
 * 이 카드를 지금 낼 수 있는 표적 목록. 표적이 필요 없는 카드는 [null].
 *   유닛: { cell } 내 배치 칸 번호. 유닛이 가득 찼으면 { replace } 대체할 내 유닛의 번호.
 *   후퇴: { unitId, cell }
 */
export function legalTargets(state, p, uid) {
  const P = state.players[p];
  const c = P.hand.find((h) => h.uid === uid);
  if (!c || !basicPlayable(state, p, c).ok) return [];
  const def = CARDS[c.id];
  const mine = unitsOf(state, p).filter((u) => !u.dying);
  const free = () => deployCells(state, p).filter((x) => x.free);
  switch (def.target) {
    case 'slot':
      return atCap(state, p) ? mine.map((u) => ({ replace: u.id })) : free().map((x) => ({ cell: x.i }));
    case 'enemyUnit':
      return enemiesOf(state, p).flatMap((q) => unitsOf(state, q)).filter((u) => targetable(state, u)).map((u) => ({ unitId: u.id }));
    case 'allyUnit':
      return mine.map((u) => ({ unitId: u.id }));
    case 'allyUltUnit':
      return mine.filter((u) => u.ult).map((u) => ({ unitId: u.id }));
    case 'allyMove': {
      const cells = free();
      return mine.flatMap((u) => cells.map((x) => ({ unitId: u.id, cell: x.i })));
    }
    case 'handFused':
      return P.hand.filter((h) => h.uid !== uid && h.fuse && !h.zeroCost).map((h) => ({ uid: h.uid }));
    case 'none':
      return [null];
    default:
      return [];
  }
}

export function canPlay(state, p, uid, target) {
  const P = state.players[p];
  const c = P.hand.find((h) => h.uid === uid);
  if (!c) return fail('손패에 없는 카드');
  const basic = basicPlayable(state, p, c);
  if (!basic.ok) return basic;
  const def = CARDS[c.id];
  const t = target || {};
  const cell = (i) => deployCells(state, p).find((x) => x.i === i);
  switch (def.target) {
    case 'slot': {
      if (atCap(state, p)) {
        const u = findUnit(state, t.replace);
        if (!u || u.owner !== p || u.dying) return fail(`유닛은 ${state.rules.unitCap}기까지. 대체할 내 유닛을 골라야 한다`);
        return OK;
      }
      const x = cell(t.cell);
      if (!x) return fail('내 배치 칸에만 소환할 수 있다');
      if (x.blocked) return fail('쓸 수 없는 칸');
      if (!x.free) return fail('유닛이 서 있는 칸에는 놓을 수 없다');
      return OK;
    }
    case 'enemyUnit': {
      const u = findUnit(state, t.unitId);
      if (!u || !isEnemy(state, p, u.owner) || !targetable(state, u)) return fail('표적이 될 수 없는 유닛');
      return OK;
    }
    case 'allyUnit':
    case 'allyUltUnit': {
      const u = findUnit(state, t.unitId);
      if (!u || u.owner !== p || u.dying) return fail('내 유닛을 골라야 한다');
      if (def.target === 'allyUltUnit' && !u.ult) return fail('필살기가 있는 유닛만');
      return OK;
    }
    case 'allyMove': {
      const u = findUnit(state, t.unitId);
      if (!u || u.owner !== p || u.dying) return fail('내 유닛을 골라야 한다');
      const x = cell(t.cell);
      if (!x || !x.free) return fail('비어 있는 내 배치 칸을 골라야 한다');
      return OK;
    }
    case 'handFused': {
      const h = P.hand.find((x) => x.uid === t.uid);
      if (!h || h.uid === uid || !h.fuse || h.zeroCost) return fail('손패의 융합 카드를 골라야 한다');
      return OK;
    }
    case 'none':
      return OK;
    default:
      return fail('유닛 전투에는 아직 없는 카드');
  }
}

export function canRedraw(state, p) {
  const P = state.players[p];
  const r = state.rules;
  if (state.over) return fail('전투가 끝났다');
  if (P.dead) return fail('지휘관이 쓰러졌다');
  if (P.mana < r.redrawCost) return fail('마나가 모자라다');
  if (state.timeMs < P.redrawReadyAt) return fail('다시 뽑기 쿨다운');
  if (P.deck.length + P.discard.length === 0) return fail('뽑을 카드가 없다');
  return OK;
}

/** { type: 'play', uid, target } 또는 { type: 'redraw', uid } */
export function applyAction(state, p, action) {
  if (state.over) return fail('전투가 끝났다');
  if (!action) return fail('행동 없음');
  if (action.type === 'redraw') return doRedraw(state, p, action.uid);
  if (action.type === 'play') return doPlay(state, p, action.uid, action.target);
  return fail('알 수 없는 행동');
}

/**
 * 같은 순간에 여러 플레이어가 한 행동을 함께 처리한다. actions[p]는 그 플레이어의 행동이거나 null.
 * 주문으로 쓰러진 유닛도 모두의 행동이 끝날 때까지는 서 있는 것으로 친다 (번호가 앞선 플레이어가 유리해지지 않게).
 */
export function applyActions(state, actions) {
  const results = actions.map(() => null);
  simultaneously(state, () => {
    actions.forEach((a, p) => {
      if (a) results[p] = applyAction(state, p, a);
    });
  });
  resolveDeaths(state);
  return results;
}

function doRedraw(state, p, uid) {
  const P = state.players[p];
  const r = state.rules;
  const chk = canRedraw(state, p);
  if (!chk.ok) return chk;
  const i = P.hand.findIndex((h) => h.uid === uid);
  if (i < 0) return fail('손패에 없는 카드');
  const [c] = P.hand.splice(i, 1);
  P.mana -= r.redrawCost;
  P.stats.manaSpent += r.redrawCost;
  P.stats.redraws++;
  P.redrawReadyAt = state.timeMs + r.redrawCooldownMs;
  drawCard(state, P);
  c.zeroCost = false;
  P.discard.push(c);
  emit(state, { type: 'redraw', p });
  return OK;
}

function doPlay(state, p, uid, target) {
  const chk = canPlay(state, p, uid, target);
  if (!chk.ok) return chk;
  const P = state.players[p];
  const r = state.rules;
  const c = P.hand.find((h) => h.uid === uid);
  const def = CARDS[c.id];
  const t = state.timeMs;
  const cost = effectiveCost(state, p, c);
  const combo = t - P.lastPlayAt <= r.comboWindowMs;
  const sc = Math.pow(r.spellStarMult, c.stars - 1);
  const extra = c.stars - 1;
  const cellAt = (i) => deployCells(state, p).find((x) => x.i === i);

  P.mana -= cost;
  P.stats.manaSpent += cost;
  P.stats.cardsPlayed++;
  P.stats.plays[c.id] = (P.stats.plays[c.id] || 0) + 1;
  P.hand.splice(P.hand.indexOf(c), 1);
  c.zeroCost = false;
  emit(state, { type: 'play', p, cardId: c.id, name: cardLabel(c), cost, combo: combo && def.keywords.includes('combo') });

  if (def.type === 'unit') {
    if (P.unitDiscount.count > 0) P.unitDiscount.count--;
    let at;
    if (target.replace !== undefined) {
      const old = findUnit(state, target.replace);
      at = { x: old.x, y: old.y };
      removeUnit(state, old, false); // 대체된 유닛은 버린 더미로
    } else at = cellAt(target.cell);
    summonUnit(state, p, at.x, at.y, c);
  } else {
    switch (c.id) {
      case 'firebolt':
        dealDamage(state, findUnit(state, target.unitId), (combo ? def.comboDamage : def.damage) * sc, { source: { owner: p } });
        break;
      case 'retreat': {
        const u = findUnit(state, target.unitId);
        const x = cellAt(target.cell);
        u.x = x.x;
        u.y = x.y;
        u.targetId = null;
        emit(state, { type: 'teleport', p, unitId: u.id, x: u.x, y: u.y });
        healUnit(state, u, def.heal * sc);
        break;
      }
      case 'purify': {
        const u = findUnit(state, target.unitId);
        for (const b of u.buffs) {
          if (b.kind === 'armor') {
            u.maxHp -= b.amount;
            u.hp = Math.max(1, Math.min(u.hp, u.maxHp));
          }
        }
        u.buffs = [];
        break;
      }
      case 'chain': {
        // 처음 맞은 유닛에서 가까운 순서로 튄다 (누구의 유닛이든 적이면)
        const first = findUnit(state, target.unitId);
        const others = state.units
          .filter((x) => x !== first && isEnemy(state, p, x.owner) && targetable(state, x))
          .sort((a, b) => q6(distance(a, first)) - q6(distance(b, first)) || turnFrom(state, p, a.owner) - turnFrom(state, p, b.owner) || a.id - b.id);
        [first, ...others].slice(0, def.chainDamage.length)
          .forEach((u, i) => dealDamage(state, u, def.chainDamage[i] * sc, { source: { owner: p } }));
        break;
      }
      case 'warcry':
        // 전열 유닛 대신 근접 유닛 전체
        for (const u of unitsOf(state, p)) {
          if (!u.ranged && !u.dying) u.buffs.push({ kind: 'atk', amount: def.amount * sc, until: t + def.durationMs });
        }
        break;
      case 'awaken': {
        const u = findUnit(state, target.unitId);
        if (!u.telegraphing) u.gauge = Math.min(r.gaugeMax, u.gauge + def.amount * sc);
        break;
      }
      case 'armor': {
        const u = findUnit(state, target.unitId);
        const amount = def.amount * sc;
        u.maxHp += amount;
        u.hp += amount;
        u.buffs.push({ kind: 'armor', amount });
        break;
      }
      case 'phalanx':
        P.phalanxUntil = Math.max(P.phalanxUntil, t + def.durationMs * sc);
        break;
      case 'scout':
        for (let i = 0; i < def.draw + extra; i++) drawCard(state, P);
        break;
      case 'crystal':
        P.mana += Math.round(def.amount * sc);
        break;
      case 'supply':
        P.unitDiscount = { count: P.unitDiscount.count + def.count + extra, amount: def.amount };
        break;
      case 'muster':
        for (let i = 0; i < def.count + extra; i++) {
          if (P.hand.length >= r.handMax) break;
          let best = -1;
          for (let k = P.deck.length - 1; k >= 0; k--) {
            const d = CARDS[P.deck[k].id];
            if (d.type !== 'unit') continue;
            if (best < 0 || d.cost < CARDS[P.deck[best].id].cost) best = k;
          }
          if (best < 0) break;
          const [got] = P.deck.splice(best, 1);
          got.drawnAt = t;
          P.hand.push(got);
        }
        break;
      case 'stockpile':
        P.maxManaBonus += c.stars;
        P.maxMana += c.stars;
        break;
      case 'invest':
        P.invested = true;
        break;
      case 'catalyst':
        P.hand.find((x) => x.uid === target.uid).zeroCost = true;
        break;
      case 'disrupt':
        applySilence(state, findUnit(state, target.unitId), def.durationMs);
        break;
      default:
        break;
    }
    if (def.keywords.includes('once')) P.exiled.push(c);
    else P.discard.push(c);
  }

  if (def.keywords.includes('cycle') || c.fuse === 'cycle') drawCard(state, P);
  P.lastPlayAt = t;
  P.lastPlayed = { name: cardLabel(c), at: t };
  if (def.type !== 'unit') resolveDeaths(state);
  return OK;
}

/** 카드가 사라지거나 복제되지 않았는지 확인할 때 쓴다. */
export function countCards(state, p) {
  const P = state.players[p];
  return P.deck.length + P.hand.length + P.discard.length + P.exiled.length + unitsOf(state, p).filter((u) => u.card).length;
}
