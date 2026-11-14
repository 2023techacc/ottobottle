// 1:1 결투 전투 엔진.
// 난수는 덱 섞기에만 쓰고, 유닛끼리의 전투는 공개된 규칙대로만 진행한다.
// 같은 설정과 같은 입력(행동과 그 시각)이면 결과도 항상 같다.

import { makeRng, hashSeed } from './rng.js';
import { CARDS, COMMANDERS, UNIT_DIAMONDS, cardLabel } from './cards.js';
import { DEFAULT_RULES, FRONT, BACK, SLOTS } from './rules.js';

const EPS = 1e-9;
const ROWS = [FRONT, BACK];

// ─────────────────────────────────────────────────────────────
// 만들기
// ─────────────────────────────────────────────────────────────

/**
 * @param {object} cfg
 * @param {number} cfg.seed
 * @param {Array<{commander:string, deck:Array<{id:string,stars?:number,fuse?:string}>,
 *   vanguard?:Array<{index:number,row:number,slot:number}>, seed?:number,
 *   opening?:number[],  시작 손패에 반드시 넣을 카드 (덱 배열의 인덱스, rules.openingPicks 장까지)
 *   bonus?:{startMana?:number, maxMana?:number, startHand?:number, openingPicks?:number}}>} cfg.players
 *   bonus는 한쪽에만 주는 덧셈 보너스다 (상점 레벨 보상을 흉내 낼 때 쓴다).
 * @param {string|null} [cfg.battlefield]
 * @param {object} [cfg.rules]  DEFAULT_RULES에 덮어쓸 값
 * @param {boolean} [cfg.logEvents]  false면 이벤트 기록을 끈다 (대량 시뮬레이션용)
 */
export function createBattle(cfg) {
  const rules = { ...DEFAULT_RULES, ...(cfg.rules || {}) };
  const seed = (cfg.seed ?? 1) >>> 0;
  const state = {
    rules,
    seed,
    timeMs: 0,
    over: false,
    result: null,
    battlefield: cfg.battlefield || null,
    players: [],
    board: [emptyBoard(), emptyBoard()],
    telegraphs: [],
    events: [],
    logEvents: cfg.logEvents !== false,
    nextId: 1,
  };

  cfg.players.forEach((pc, idx) => {
    const rng = makeRng(pc.seed ?? hashSeed(seed, 'deck', idx));
    const bonus = pc.bonus || {};
    const P = {
      idx,
      commander: pc.commander,
      hp: rules.commanderHp,
      maxHp: rules.commanderHp,
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
      rng,
      stats: {
        cardsPlayed: 0, plays: {}, manaSpent: 0, manaWasted: 0, manaCapMs: 0, handFullMs: 0,
        handSizeSum: 0, ticks: 0, redraws: 0, unitDamage: 0, commanderDamage: 0, unitsLost: 0, drawn: 0,
      },
    };
    P.deck = pc.deck.map((c, i) => ({
      uid: `p${idx}c${i}`, order: i, id: c.id, stars: c.stars || 1, fuse: c.fuse || null, drawnAt: 0, zeroCost: false,
    }));
    state.players.push(P);
  });

  // 선봉: 무료로 놓이고 이번 전투에서는 덱에서 빠진다.
  cfg.players.forEach((pc, idx) => {
    const P = state.players[idx];
    const picks = (pc.vanguard || []).slice(0, rules.vanguardSlots);
    const chosen = [];
    for (const v of picks) {
      const c = P.deck[v.index];
      if (!c || CARDS[c.id].type !== 'unit' || chosen.includes(c)) continue;
      if (!slotUsable(state, v.row, v.slot) || state.board[idx][v.row][v.slot]) continue;
      chosen.push(c);
      c.vanguard = true;
      summonUnit(state, idx, v.row, v.slot, c);
    }
    P.deck = P.deck.filter((c) => !chosen.includes(c));
  });

  cfg.players.forEach((pc, idx) => {
    const P = state.players[idx];
    const bonus = pc.bonus || {};
    const startHand = Math.min(rules.handMax, rules.startHand + (bonus.startHand || 0));
    P.rng.shuffle(P.deck);
    // 시작 카드 고르기: 고른 카드를 덱 맨 위로 올려 시작 손패에 반드시 들어오게 한다.
    const maxPicks = Math.min(startHand, rules.openingPicks + (bonus.openingPicks || 0));
    const wanted = [...new Set(pc.opening || [])].slice(0, maxPicks);
    const picked = wanted.map((i) => P.deck.find((c) => c.order === i)).filter(Boolean);
    if (picked.length) P.deck = [...P.deck.filter((c) => !picked.includes(c)), ...[...picked].reverse()];
    P.opening = picked.map((c) => c.uid);
    P.openingCards = picked.map((c) => ({ id: c.id, stars: c.stars, fuse: c.fuse }));
    for (let i = 0; i < startHand; i++) drawCard(state, P);
  });

  // 첩보원: 상대가 고른 시작 카드를 미리 본다. 그 밖의 지휘관에게는 비공개다.
  for (const P of state.players) {
    const enemy = state.players[1 - P.idx];
    P.knownEnemyOpening = COMMANDERS[P.commander].seesOpening ? enemy.openingCards : null;
  }
  return state;
}

function emptyBoard() {
  return [new Array(SLOTS).fill(null), new Array(SLOTS).fill(null)];
}

// ─────────────────────────────────────────────────────────────
// 조회
// ─────────────────────────────────────────────────────────────

export function slotUsable(state, row, slot) {
  if (row !== FRONT && row !== BACK) return false;
  if (!Number.isInteger(slot) || slot < 0 || slot >= SLOTS) return false;
  if (state.battlefield === 'canyon' && row === FRONT) return slot === 1 || slot === 2;
  return true;
}

/** 처리 순서: 전열 → 후열, 같은 열에서는 칸 번호 순서, 같은 칸이면 플레이어 0 → 1 */
export function allUnits(state) {
  const out = [];
  for (const row of ROWS) {
    for (let slot = 0; slot < SLOTS; slot++) {
      for (let p = 0; p < 2; p++) {
        const u = state.board[p][row][slot];
        if (u) out.push(u);
      }
    }
  }
  return out;
}

export function unitsOf(state, p) {
  const out = [];
  for (const row of ROWS) {
    for (let slot = 0; slot < SLOTS; slot++) {
      const u = state.board[p][row][slot];
      if (u) out.push(u);
    }
  }
  return out;
}

export function findUnit(state, id) {
  for (let p = 0; p < 2; p++) {
    for (const row of ROWS) {
      for (let slot = 0; slot < SLOTS; slot++) {
        const u = state.board[p][row][slot];
        if (u && u.id === id) return u;
      }
    }
  }
  return null;
}

export function emptySlots(state, p) {
  const out = [];
  for (const row of ROWS) {
    for (let slot = 0; slot < SLOTS; slot++) {
      if (slotUsable(state, row, slot) && !state.board[p][row][slot]) out.push({ row, slot });
    }
  }
  return out;
}

export function hasKw(u, kw) {
  return u.keywords.includes(kw);
}

function fogActive(state) {
  return state.battlefield === 'fog' && state.timeMs < 5000;
}

/** 주문이나 공격의 표적이 될 수 있는가 */
export function targetable(state, u) {
  if (!u || u.dying) return false;
  if (u.row === BACK && fogActive(state)) return false;
  return true;
}

function adjacentAllies(state, u) {
  const b = state.board[u.owner];
  const out = [];
  const left = u.slot > 0 ? b[u.row][u.slot - 1] : null;
  const right = u.slot < SLOTS - 1 ? b[u.row][u.slot + 1] : null;
  const other = b[u.row === FRONT ? BACK : FRONT][u.slot];
  for (const x of [left, right, other]) if (x && !x.dying) out.push(x);
  return out;
}

export function overtimeMult(state) {
  const r = state.rules;
  if (state.timeMs <= r.overtimeMs) return 1;
  return 1 + r.overtimeAtkPerSec * Math.ceil((state.timeMs - r.overtimeMs) / 1000);
}

/** 지금 이 유닛이 한 번 때릴 때의 피해 */
export function currentAtk(state, u) {
  let atk = u.atk;
  for (const b of u.buffs) if (b.kind === 'atk') atk += b.amount;
  if (hasKw(u, 'rally')) atk += state.rules.rallyAtk * adjacentAllies(state, u).length;
  return atk * overtimeMult(state);
}

/** 지금 이 유닛의 공격 간격(ms) */
export function effInterval(state, u) {
  const r = state.rules;
  const slow = Math.min(r.slowCap, u.slows.length * r.slowPerStack);
  let iv = u.interval * (1 + slow);
  if (state.battlefield === 'rain' && u.ranged) iv *= 1.2;
  return Math.round(iv);
}

/** 카드의 현재 비용 (숙성·보급선·연금술사·촉매 반영) */
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
// 표적 규칙
// ─────────────────────────────────────────────────────────────

/**
 * 1. 같은 번호 칸의 적 전열 → 번호가 가장 가까운 전열 칸 → 전열이 비면 후열
 * 2. 원거리도 같은 순서 (사거리 무제한)
 * 3. 암살은 적 후열부터
 * 4. 거리가 같으면 번호가 낮은 칸
 * 적 보드에 유닛이 하나도 없으면 지휘관을 친다.
 */
export function pickTarget(state, u) {
  const enemy = 1 - u.owner;
  const order = hasKw(u, 'assassin') ? [BACK, FRONT] : [FRONT, BACK];
  let anyAlive = false;
  for (const row of ROWS) {
    for (let s = 0; s < SLOTS; s++) {
      const x = state.board[enemy][row][s];
      if (x && !x.dying) anyAlive = true;
    }
  }
  for (const row of order) {
    let best = null;
    let bestD = Infinity;
    for (let s = 0; s < SLOTS; s++) {
      const x = state.board[enemy][row][s];
      if (!targetable(state, x)) continue;
      const d = Math.abs(s - u.slot);
      if (d < bestD) {
        best = x;
        bestD = d;
      }
    }
    if (best) return { unit: best };
  }
  if (!anyAlive) return { commander: enemy };
  return null; // 안개에 가려진 유닛만 남은 경우
}

// ─────────────────────────────────────────────────────────────
// 유닛 소환
// ─────────────────────────────────────────────────────────────

/** 카드로 유닛을 놓는다. 테스트에서도 직접 쓴다. */
export function summonUnit(state, owner, row, slot, c) {
  const def = CARDS[c.id];
  const r = state.rules;
  const mult = Math.pow(r.starMult, (c.stars || 1) - 1);
  let hpMult = 1;
  if (row === FRONT) {
    if (state.players[owner].commander === 'general') hpMult += 0.1;
    if (state.battlefield === 'citadel') hpMult += 0.2;
  }
  const keywords = [...def.keywords];
  if (c.fuse && UNIT_DIAMONDS.includes(c.fuse) && !keywords.includes(c.fuse)) keywords.push(c.fuse);
  const atkMult = mult * r.unitAtkMult;
  const baseHp = def.hp * mult * r.unitHpMult;
  const maxHp = baseHp * hpMult;
  const u = {
    id: state.nextId++,
    owner,
    card: c.uid ? c : null,
    defId: def.id,
    name: cardLabel(c),
    stars: c.stars || 1,
    token: false,
    row,
    slot,
    atk: def.atk * atkMult,
    baseAtk: def.atk * atkMult,
    hp: maxHp,
    maxHp,
    baseMaxHp: baseHp,
    interval: Math.round(def.interval * r.attackIntervalMult),
    ranged: def.ranged,
    keywords,
    ccResist: def.ccResist || 1,
    ult: def.ult ? { ...def.ult, damage: def.ult.damage ? def.ult.damage * atkMult : undefined } : null,
    gauge: 0,
    attackTimer: 0,
    advanceTimer: 0,
    buffs: [],
    slows: [],
    silenceUntil: 0,
    ccLast: { slow: -Infinity, silence: -Infinity },
    tripleShot: false,
    telegraphing: false,
    dying: false,
    pendingHeal: 0,
    summonedAt: state.timeMs,
  };
  state.board[owner][row][slot] = u;
  emit(state, { type: 'summon', p: owner, unitId: u.id, name: u.name, row, slot });
  return u;
}

function summonToken(state, parent, row, slot) {
  const u = {
    ...parent,
    id: state.nextId++,
    card: null,
    name: `작은 ${CARDS[parent.defId].name}`,
    token: true,
    row,
    slot,
    atk: parent.baseAtk / 2,
    baseAtk: parent.baseAtk / 2,
    hp: parent.baseMaxHp / 2,
    maxHp: parent.baseMaxHp / 2,
    baseMaxHp: parent.baseMaxHp / 2,
    keywords: parent.keywords.filter((k) => k !== 'split'),
    ult: null,
    gauge: 0,
    attackTimer: 0,
    advanceTimer: 0,
    buffs: [],
    slows: [],
    silenceUntil: 0,
    ccLast: { slow: -Infinity, silence: -Infinity },
    tripleShot: false,
    telegraphing: false,
    dying: false,
    pendingHeal: 0,
    summonedAt: state.timeMs,
  };
  state.board[parent.owner][row][slot] = u;
  emit(state, { type: 'summon', p: parent.owner, unitId: u.id, name: u.name, row, slot, token: true });
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

/**
 * 유닛에 피해를 준다. 수호가 대신 받은 몫까지 합친 "준 피해"를 돌려준다.
 * opts.aoe: 범위 피해 (방진 대상), opts.noGuard: 수호가 나눠 받지 않음
 */
function dealDamage(state, target, amount, opts = {}) {
  if (!target || target.dying || amount <= 0) return 0;
  const r = state.rules;
  const owner = state.players[target.owner];
  if (opts.aoe && target.row === BACK && owner.phalanxUntil > state.timeMs) amount *= 0.5;

  let dealt = 0;
  if (!opts.noGuard) {
    const guard = adjacentAllies(state, target).find((x) => hasKw(x, 'guard'));
    if (guard) {
      const share = amount * r.guardShare;
      amount -= share;
      dealt += dealDamage(state, guard, share, { ...opts, aoe: false, noGuard: true, guarded: true });
    }
  }

  target.hp -= amount;
  dealt += amount;
  if (opts.source && opts.source.owner !== target.owner) state.players[opts.source.owner].stats.unitDamage += amount;
  if (target.ult && !target.telegraphing && state.timeMs >= target.silenceUntil) gainGauge(state, target, target.ult.gaugeHit);
  emit(state, {
    type: 'damage', p: target.owner, unitId: target.id, row: target.row, slot: target.slot,
    amount, guarded: !!opts.guarded, aoe: !!opts.aoe,
  });
  if (target.hp <= EPS) target.dying = true;
  return dealt;
}

function damageCommander(state, p, amount, source) {
  const P = state.players[p];
  amount *= state.rules.commanderDamageMult;
  P.hp -= amount;
  if (source) state.players[source.owner].stats.commanderDamage += amount;
  emit(state, { type: 'commanderDamage', p, amount });
}

function gainGauge(state, u, amount) {
  if (!u.ult || !amount || u.telegraphing) return;
  if (state.timeMs < u.silenceUntil) return; // 침묵: 게이지가 멈춘다
  if (state.battlefield === 'surge') amount *= 1.5;
  u.gauge = Math.min(state.rules.gaugeMax, u.gauge + amount);
}

function healUnit(state, u, amount) {
  if (u.dying || amount <= 0) return;
  const before = u.hp;
  u.hp = Math.min(u.maxHp, u.hp + amount);
  if (u.hp > before) emit(state, { type: 'heal', p: u.owner, unitId: u.id, row: u.row, slot: u.slot, amount: u.hp - before });
}

/** 같은 효과가 3초 안에 다시 걸리면 지속 시간이 절반. 거신은 받는 군중 제어가 절반. */
function ccDuration(state, u, kind, base) {
  const r = state.rules;
  let dur = base;
  if (state.timeMs - u.ccLast[kind] < r.ccRepeatWindowMs) dur /= 2;
  dur *= u.ccResist;
  u.ccLast[kind] = state.timeMs;
  return dur;
}

function applySlow(state, u) {
  if (u.dying) return;
  const r = state.rules;
  const dur = ccDuration(state, u, 'slow', r.slowDurationMs);
  u.slows.push(state.timeMs + dur);
  if (u.slows.length > r.slowMaxStacks) {
    u.slows.sort((a, b) => a - b);
    u.slows.shift();
  }
}

function applySilence(state, u, baseMs) {
  if (u.dying) return;
  const r = state.rules;
  const dur = ccDuration(state, u, 'silence', Math.min(r.silenceMaxMs, baseMs));
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
    // 버린 순서와 상관없이 같은 결과가 나오도록 정렬한 뒤에 섞는다
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

  for (const u of allUnits(state)) {
    if (u.buffs.length) u.buffs = u.buffs.filter((b) => b.until === undefined || b.until > t);
    if (u.slows.length) u.slows = u.slows.filter((x) => x > t);
  }

  if (state.battlefield === 'volcano' && t % 10000 === 0) {
    for (const u of allUnits(state)) dealDamage(state, u, u.maxHp * 0.05, { noGuard: true });
  }

  advanceMelee(state, dt);
  fireTelegraphs(state);
  resolveAttacks(state, dt);
  finishTick(state);
  checkEnd(state);
}

function tickPlayer(state, P, dt) {
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
    } else {
      P.drawTimer = r.drawIntervalMs; // 손패가 가득 차면 자동 뽑기가 멈춘다
    }
  }

  const s = P.stats;
  s.ticks++;
  s.handSizeSum += P.hand.length;
  if (P.hand.length >= r.handMax) s.handFullMs += dt;
  if (P.mana >= P.maxMana) s.manaCapMs += dt;
}

/** 후열에 선 근접 유닛은 공격하지 못하고, 빈 전열 칸이 생기면 앞으로 나온다. */
function advanceMelee(state, dt) {
  const r = state.rules;
  for (let p = 0; p < 2; p++) {
    const b = state.board[p];
    for (let slot = 0; slot < SLOTS; slot++) {
      const u = b[BACK][slot];
      if (!u || u.ranged || u.dying) continue;
      let dest = -1;
      let bestD = Infinity;
      for (let s = 0; s < SLOTS; s++) {
        if (!slotUsable(state, FRONT, s) || b[FRONT][s]) continue;
        const d = Math.abs(s - slot);
        if (d < bestD) {
          dest = s;
          bestD = d;
        }
      }
      if (dest < 0) {
        u.advanceTimer = 0;
        continue;
      }
      u.advanceTimer += dt;
      if (u.advanceTimer >= r.meleeAdvanceMs) {
        u.advanceTimer = 0;
        b[BACK][slot] = null;
        b[FRONT][dest] = u;
        u.row = FRONT;
        u.slot = dest;
        emit(state, { type: 'move', p, unitId: u.id, row: FRONT, slot: dest });
      }
    }
  }
}

function fireTelegraphs(state) {
  const t = state.timeMs;
  const due = state.telegraphs.filter((g) => g.fireAt <= t);
  if (!due.length) return;
  state.telegraphs = state.telegraphs.filter((g) => g.fireAt > t);
  for (const g of due) {
    const caster = findUnit(state, g.unitId);
    if (caster) caster.telegraphing = false;
    emit(state, { type: 'ult', p: g.owner, unitId: g.unitId, kind: g.kind, cells: g.cells });
    for (const cell of g.cells) {
      const x = state.board[g.side][cell.row][cell.slot];
      if (x) dealDamage(state, x, g.damage, { aoe: true, source: caster || { owner: g.owner } });
    }
  }
}

function resolveAttacks(state, dt) {
  // 이번 틱에 공격할 유닛과 표적을 틱 시작 시점 기준으로 먼저 정한 뒤 차례로 처리한다.
  // 같은 틱에 서로 쓰러뜨리는 두 유닛은 둘 다 공격을 마친다.
  const ready = [];
  for (const u of allUnits(state)) {
    if (u.dying) continue;
    const iv = effInterval(state, u);
    if (u.attackTimer < iv) u.attackTimer += dt;
    if (u.attackTimer < iv) continue;
    if (!u.ranged && u.row === BACK) continue; // 근접은 전열에서만 공격
    const tg = pickTarget(state, u);
    if (tg) ready.push({ u, tg, iv });
  }
  for (const { u, tg, iv } of ready) {
    u.attackTimer = Math.min(u.attackTimer - iv, dt);
    const shots = u.tripleShot ? 3 : 1;
    u.tripleShot = false;
    const atk = currentAtk(state, u);
    emit(state, {
      type: 'attack', p: u.owner, unitId: u.id, row: u.row, slot: u.slot, shots,
      target: tg.unit ? { unitId: tg.unit.id, row: tg.unit.row, slot: tg.unit.slot } : { commander: tg.commander },
    });
    for (let i = 0; i < shots; i++) {
      if (tg.unit) hitUnit(state, u, tg.unit, atk);
      else damageCommander(state, tg.commander, atk, u);
    }
    gainGauge(state, u, u.ult ? u.ult.gaugeAtk : 0);
  }
}

function hitUnit(state, u, target, atk) {
  const r = state.rules;
  let dealt = dealDamage(state, target, atk, { source: u });
  if (hasKw(u, 'pierce') && target.row === FRONT) {
    const behind = state.board[target.owner][BACK][target.slot];
    if (behind) dealt += dealDamage(state, behind, atk * r.pierceShare, { source: u });
  }
  if (hasKw(u, 'lifesteal')) u.pendingHeal += dealt * r.lifesteal;
  if (!u.ranged && hasKw(target, 'thorns')) dealDamage(state, u, r.thornsDamage, { noGuard: true });
  if (hasKw(u, 'frost')) applySlow(state, target);
}

function finishTick(state) {
  // 회복은 그 틱의 공격이 모두 끝난 뒤에 들어간다 (처리 순서에 따라 결과가 달라지지 않게)
  for (const u of allUnits(state)) {
    if (u.pendingHeal > 0) healUnit(state, u, u.pendingHeal);
    u.pendingHeal = 0;
  }

  resolveDeaths(state);

  for (const u of allUnits(state)) {
    if (u.ult && !u.telegraphing && u.gauge >= state.rules.gaugeMax - EPS) triggerUlt(state, u);
  }
}

function resolveDeaths(state) {
  const dead = allUnits(state).filter((u) => u.dying);
  for (const u of dead) removeUnit(state, u, true);
  for (const u of dead) {
    if (!hasKw(u, 'split')) continue;
    const spots = [];
    const b = state.board[u.owner];
    if (slotUsable(state, u.row, u.slot) && !b[u.row][u.slot]) spots.push({ row: u.row, slot: u.slot });
    const rest = emptySlots(state, u.owner)
      .filter((c) => !(c.row === u.row && c.slot === u.slot))
      .sort((a, c) => (a.row === u.row ? 0 : 10) + Math.abs(a.slot - u.slot) - ((c.row === u.row ? 0 : 10) + Math.abs(c.slot - u.slot)));
    spots.push(...rest);
    for (const spot of spots.slice(0, 2)) summonToken(state, u, spot.row, spot.slot);
  }
}

function removeUnit(state, u, died) {
  state.board[u.owner][u.row][u.slot] = null;
  const P = state.players[u.owner];
  if (u.card) {
    if (u.card.vanguard) P.exiled.push(u.card);
    else P.discard.push(u.card);
  }
  if (u.telegraphing) state.telegraphs = state.telegraphs.filter((g) => g.unitId !== u.id);
  if (died) {
    P.stats.unitsLost++;
    emit(state, { type: 'death', p: u.owner, unitId: u.id, name: u.name, row: u.row, slot: u.slot });
  }
}

function triggerUlt(state, u) {
  const ult = u.ult;
  const enemy = 1 - u.owner;
  if (ult.kind === 'tripleShot') {
    u.tripleShot = true;
    u.gauge = 0;
    emit(state, { type: 'ultReady', p: u.owner, unitId: u.id, kind: ult.kind });
    return;
  }
  let cells;
  if (ult.kind === 'cross') {
    const tg = pickTarget(state, u);
    if (!tg || !tg.unit) return; // 칠 유닛이 없으면 게이지를 쥐고 기다린다
    const { row, slot } = tg.unit;
    cells = [{ row, slot }];
    if (slot > 0) cells.push({ row, slot: slot - 1 });
    if (slot < SLOTS - 1) cells.push({ row, slot: slot + 1 });
    cells.push({ row: row === FRONT ? BACK : FRONT, slot });
  } else if (ult.kind === 'frontRow') {
    if (!unitsOf(state, enemy).some((x) => x.row === FRONT)) return;
    cells = [];
    for (let s = 0; s < SLOTS; s++) cells.push({ row: FRONT, slot: s });
  } else {
    return;
  }
  u.gauge = 0;
  u.telegraphing = true;
  const g = {
    id: state.nextId++, owner: u.owner, side: enemy, unitId: u.id, kind: ult.kind, cells,
    startAt: state.timeMs, fireAt: state.timeMs + ult.telegraphMs, damage: ult.damage,
  };
  state.telegraphs.push(g);
  emit(state, { type: 'telegraph', p: u.owner, unitId: u.id, kind: ult.kind, cells, fireAt: g.fireAt });
}

function checkEnd(state) {
  const [a, b] = state.players;
  const aDead = a.hp <= EPS;
  const bDead = b.hp <= EPS;
  let winner = null;
  let reason = null;
  if (aDead || bDead) {
    winner = aDead && bDead ? -1 : aDead ? 1 : 0;
    reason = 'commander';
  } else if (state.timeMs >= state.rules.battleMs) {
    const ra = a.hp / a.maxHp;
    const rb = b.hp / b.maxHp;
    winner = Math.abs(ra - rb) < EPS ? -1 : ra > rb ? 0 : 1;
    reason = 'time';
  }
  if (winner === null) return;
  state.over = true;
  state.result = {
    winner,
    reason,
    timeMs: state.timeMs,
    hp: [Math.max(0, a.hp), Math.max(0, b.hp)],
    survivors: [unitsOf(state, 0).length, unitsOf(state, 1).length],
  };
  emit(state, { type: 'end', winner, reason });
}

// ─────────────────────────────────────────────────────────────
// 플레이어 행동
// ─────────────────────────────────────────────────────────────

const fail = (reason) => ({ ok: false, reason });
const OK = { ok: true };

function basicPlayable(state, p, c) {
  if (state.over) return fail('전투가 끝났다');
  const P = state.players[p];
  const def = CARDS[c.id];
  if (def.meleeOnly) return fail('난전에서만 쓸 수 있다');
  if (effectiveCost(state, p, c) > P.mana) return fail('마나가 모자라다');
  return OK;
}

/** 이 카드를 지금 낼 수 있는 표적 목록. 표적이 필요 없는 카드는 [null]. */
export function legalTargets(state, p, uid) {
  const P = state.players[p];
  const c = P.hand.find((h) => h.uid === uid);
  if (!c || !basicPlayable(state, p, c).ok) return [];
  const def = CARDS[c.id];
  const enemy = 1 - p;
  switch (def.target) {
    case 'slot': {
      const empties = emptySlots(state, p);
      if (empties.length) return empties;
      return unitsOf(state, p).map((u) => ({ row: u.row, slot: u.slot })); // 칸이 다 차면 대체
    }
    case 'enemyUnit':
      return unitsOf(state, enemy).filter((u) => targetable(state, u)).map((u) => ({ unitId: u.id }));
    case 'allyUnit':
      return unitsOf(state, p).filter((u) => !u.dying).map((u) => ({ unitId: u.id }));
    case 'allyUltUnit':
      return unitsOf(state, p).filter((u) => !u.dying && u.ult).map((u) => ({ unitId: u.id }));
    case 'allyMove': {
      const empties = emptySlots(state, p);
      const out = [];
      for (const u of unitsOf(state, p)) {
        if (u.dying) continue;
        for (const e of empties) out.push({ unitId: u.id, row: e.row, slot: e.slot });
      }
      return out;
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
  const enemy = 1 - p;
  const t = target || {};
  switch (def.target) {
    case 'slot': {
      if (!slotUsable(state, t.row, t.slot)) return fail('놓을 수 없는 칸');
      if (state.board[p][t.row][t.slot] && emptySlots(state, p).length > 0) return fail('빈칸이 있을 때는 대체할 수 없다');
      return OK;
    }
    case 'enemyUnit': {
      const u = findUnit(state, t.unitId);
      if (!u || u.owner !== enemy || !targetable(state, u)) return fail('표적이 될 수 없는 유닛');
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
      if (!slotUsable(state, t.row, t.slot) || state.board[p][t.row][t.slot]) return fail('빈칸을 골라야 한다');
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
      return fail('알 수 없는 카드');
  }
}

/**
 * 행동을 적용한다.
 *   { type: 'play', uid, target }
 *   { type: 'redraw', uid }   마나 1을 내고 손패 1장을 버린 뒤 새로 뽑는다
 */
export function applyAction(state, p, action) {
  if (state.over) return fail('전투가 끝났다');
  if (!action) return fail('행동 없음');
  if (action.type === 'redraw') return doRedraw(state, p, action.uid);
  if (action.type === 'play') return doPlay(state, p, action.uid, action.target);
  return fail('알 수 없는 행동');
}

export function canRedraw(state, p) {
  const P = state.players[p];
  const r = state.rules;
  if (state.over) return fail('전투가 끝났다');
  if (P.mana < r.redrawCost) return fail('마나가 모자라다');
  if (state.timeMs < P.redrawReadyAt) return fail('다시 뽑기 쿨다운');
  if (P.deck.length + P.discard.length === 0) return fail('뽑을 카드가 없다');
  return OK;
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
  // 방금 버린 카드를 곧바로 다시 뽑지 않도록, 새 카드를 뽑은 뒤에 버린 더미에 넣는다.
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

  P.mana -= cost;
  P.stats.manaSpent += cost;
  P.stats.cardsPlayed++;
  P.stats.plays[c.id] = (P.stats.plays[c.id] || 0) + 1;
  P.hand.splice(P.hand.indexOf(c), 1);
  c.zeroCost = false;
  emit(state, { type: 'play', p, cardId: c.id, name: cardLabel(c), cost, combo: combo && def.keywords.includes('combo') });

  if (def.type === 'unit') {
    if (P.unitDiscount.count > 0) P.unitDiscount.count--;
    const old = state.board[p][target.row][target.slot];
    if (old) removeUnit(state, old, false); // 대체된 유닛은 버린 더미로
    summonUnit(state, p, target.row, target.slot, c);
  } else {
    const enemy = 1 - p;
    switch (c.id) {
      case 'firebolt': {
        const u = findUnit(state, target.unitId);
        dealDamage(state, u, (combo ? def.comboDamage : def.damage) * sc, { source: { owner: p } });
        break;
      }
      case 'retreat': {
        const u = findUnit(state, target.unitId);
        state.board[p][u.row][u.slot] = null;
        u.row = target.row;
        u.slot = target.slot;
        u.advanceTimer = 0;
        state.board[p][u.row][u.slot] = u;
        emit(state, { type: 'move', p, unitId: u.id, row: u.row, slot: u.slot });
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
        const first = findUnit(state, target.unitId);
        const others = unitsOf(state, enemy)
          .filter((x) => x !== first && targetable(state, x))
          .sort((a, b) => chainDist(first, a) - chainDist(first, b));
        const hits = [first, ...others].slice(0, def.chainDamage.length);
        hits.forEach((u, i) => dealDamage(state, u, def.chainDamage[i] * sc, { source: { owner: p } }));
        break;
      }
      case 'warcry': {
        for (const u of unitsOf(state, p)) {
          if (u.row === FRONT && !u.dying) u.buffs.push({ kind: 'atk', amount: def.amount * sc, until: t + def.durationMs });
        }
        break;
      }
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
        P.mana += Math.round(def.amount * sc); // 최대치를 넘겨서 쥘 수 있다 (가정)
        break;
      case 'supply':
        P.unitDiscount = { count: P.unitDiscount.count + def.count + extra, amount: def.amount };
        break;
      case 'muster': {
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
      }
      case 'stockpile':
        P.maxManaBonus += c.stars;
        P.maxMana += c.stars;
        break;
      case 'invest':
        P.invested = true;
        break;
      case 'catalyst': {
        const h = P.hand.find((x) => x.uid === target.uid);
        h.zeroCost = true;
        break;
      }
      case 'disrupt': {
        const u = findUnit(state, target.unitId);
        applySilence(state, u, def.durationMs);
        break;
      }
      default:
        break;
    }
    if (def.keywords.includes('once')) P.exiled.push(c);
    else P.discard.push(c);
  }

  // ◆순환: 내면 카드 1장을 뽑는다 (원래 가진 카드, 또는 융합으로 붙인 카드)
  if (def.keywords.includes('cycle') || c.fuse === 'cycle') drawCard(state, P);

  P.lastPlayAt = t;
  P.lastPlayed = { name: cardLabel(c), at: t };

  // 주문으로 쓰러진 유닛은 바로 치운다 (다음 틱까지 남겨 두지 않는다)
  if (def.type !== 'unit') resolveDeaths(state);
  return OK;
}

function chainDist(a, b) {
  return (a.row === b.row ? 0 : 10) + Math.abs(a.slot - b.slot);
}

// ─────────────────────────────────────────────────────────────
// 검증용
// ─────────────────────────────────────────────────────────────

/** 카드가 사라지거나 복제되지 않았는지 확인할 때 쓴다. */
export function countCards(state, p) {
  const P = state.players[p];
  const onBoard = unitsOf(state, p).filter((u) => u.card).length;
  return P.deck.length + P.hand.length + P.discard.length + P.exiled.length + onBoard;
}
