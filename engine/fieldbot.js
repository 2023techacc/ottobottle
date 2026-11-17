// 유닛 소환 전투(field.js)용 카드 사용 봇과, 봇끼리 한 판을 끝까지 돌리는 함수.
// 자기 손패와 공개 정보(필드, 게이지, 전조)만 보고 판단하고, 반응 지연을 둔다.

import { CARDS } from './cards.js';
import { makeRng, hashSeed } from './rng.js';
import {
  createField, step, applyActions, legalTargets, effectiveCost, unitsOf, deployCells, canRedraw, targetable,
  enemiesOf, isEnemy, distance,
} from './field.js';

/** 봇 난이도: 반응 지연(밀리초)과 엉뚱한 카드를 낼 확률 */
export const BOT_LEVELS = {
  easy: { reactMin: 800, reactMax: 1600, mistake: 0.3 },
  normal: { reactMin: 300, reactMax: 1000, mistake: 0.05 },
  hard: { reactMin: 100, reactMax: 300, mistake: 0 },
};

/**
 * @param {{style?:'smart'|'random', seed?:number, reactMin?:number, reactMax?:number, mistake?:number}} [opts]
 */
export function createFieldBot(opts = {}) {
  const o = { style: 'smart', ...BOT_LEVELS.normal, ...opts };
  const rng = makeRng(o.seed ?? 1);
  let pending = null;
  return {
    decide(state, p) {
      if (state.over || state.players[p].dead) return null;
      if (pending) {
        if (state.timeMs < pending.at) return null;
        const a = pending.action;
        pending = null;
        return a;
      }
      const action = o.style === 'random' ? thinkRandom(state, p, rng) : thinkSmart(state, p, rng, o);
      if (action) pending = { at: state.timeMs + rng.range(o.reactMin, o.reactMax), action };
      return null;
    },
  };
}

function thinkRandom(state, p, rng) {
  const P = state.players[p];
  if (rng() < 0.3) return null;
  const options = [];
  for (const c of P.hand) {
    if (CARDS[c.id].matchOnly && !state.stakes) continue;
    for (const target of legalTargets(state, p, c.uid)) options.push({ type: 'play', uid: c.uid, target });
  }
  if (!options.length) {
    if (P.hand.length && rng() < 0.1 && canRedraw(state, p).ok) return { type: 'redraw', uid: rng.pick(P.hand).uid };
    return null;
  }
  return rng.pick(options);
}

/** 체력을 견줄 때는 소수점 아래 여섯 자리까지만 본다. 같으면 시계 방향으로 가까운 상대의 유닛이 앞선다 (theirs의 순서). */
const hp6 = (u) => Math.round(u.hp * 1e6);

/**
 * 견제할 상대: 난투장에서 나보다 점수가 높은 상대 중 1위. 없으면 -1.
 * 점수가 같으면 시계 방향으로 가까운 상대 (어느 자리에서나 같은 기준).
 */
export function leaderOf(state, p) {
  if (!state.capture) return -1;
  const me = state.players[p].capMs;
  let best = -1;
  for (const q of enemiesOf(state, p)) {
    const Q = state.players[q];
    if (Q.capMs <= me) continue;
    if (best < 0 || Q.capMs > state.players[best].capMs) best = q;
  }
  return best;
}

function thinkSmart(state, p, rng, o) {
  const P = state.players[p];
  const r = state.rules;
  const t = state.timeMs;
  const mine = unitsOf(state, p).filter((u) => !u.dying);
  const theirs = enemiesOf(state, p).flatMap((q) => unitsOf(state, q)).filter((u) => targetable(state, u));
  // 나를 노리는 전조 범위
  const incoming = state.telegraphs.filter((g) => isEnemy(state, p, g.owner));
  const threatened = (x, y, radius = 0.45) => incoming.some((g) => Math.hypot(g.x - x, g.y - y) <= g.radius + radius);
  const cost = (c) => effectiveCost(state, p, c);
  // 1위 견제: 주문은 앞서는 상대의 유닛을 먼저 노린다
  const lead = leaderOf(state, p);
  const pri = (u) => (u.owner === lead ? 1 : 0);
  const bonus = (u) => (u && u.owner === lead ? 3 : 0);
  const value = (u) => (u.token ? 0.5 : CARDS[u.defId].cost * u.stars);
  const cands = [];
  const add = (score, c, target) => {
    if (score > 0) cands.push({ score, action: { type: 'play', uid: c.uid, target } });
  };

  for (const c of P.hand) {
    const def = CARDS[c.id];
    const k = cost(c);
    if (k > P.mana) continue;
    if (def.matchOnly && !state.stakes) continue;

    if (def.type === 'unit') {
      const place = bestSpot(state, p, c, mine, theirs, threatened);
      if (!place) continue;
      let score = place.replace !== undefined ? 4 + k : 10 + k * 1.5;
      if (mine.length < theirs.length) score += 3;
      add(score, c, place.replace !== undefined ? { replace: place.replace } : { cell: place.cell });
      continue;
    }

    switch (c.id) {
      case 'firebolt': {
        if (!theirs.length) break;
        const combo = t - P.lastPlayAt <= r.comboWindowMs;
        const dmg = combo ? def.comboDamage : def.damage;
        const kills = theirs.filter((u) => u.hp <= dmg).sort((a, b) => pri(b) - pri(a) || hp6(b) - hp6(a));
        if (kills.length) add(12 + kills[0].maxHp / 4 + bonus(kills[0]), c, { unitId: kills[0].id });
        else if (combo || P.mana >= P.maxMana - 1) add(combo ? 5 : 3, c, { unitId: [...theirs].sort((a, b) => pri(b) - pri(a) || hp6(a) - hp6(b))[0].id });
        break;
      }
      case 'chain': {
        if (theirs.length < 2) break;
        const under = theirs.filter((u) => u.hp <= def.chainDamage[0]).sort((a, b) => pri(b) - pri(a) || hp6(b) - hp6(a));
        const first = under[0] || [...theirs].sort((a, b) => pri(b) - pri(a) || hp6(a) - hp6(b))[0];
        add(7 + (theirs.length >= 3 ? 3 : 0) + (under.length ? 2 : 0) + bonus(first), c, { unitId: first.id });
        break;
      }
      case 'blizzard': {
        // 적이 가장 많이 몰린 곳 (앞서는 상대의 유닛은 더 쳐준다)
        let best = null;
        for (const u of theirs) {
          const hit = theirs.filter((x) => x === u || Math.hypot(x.x - u.x, x.y - u.y) <= def.radius + x.radius);
          const sc = hit.length + hit.filter((x) => x.owner === lead).length * 0.5;
          if (!best || sc > best.sc + 1e-9) best = { sc, u, n: hit.length };
        }
        if (best && best.n >= 2) add(4 + 3 * best.sc, c, { unitId: best.u.id });
        break;
      }
      case 'decree': {
        // 내 유닛이 둘 이상일 때, 가장 비싼 적 유닛을 지목한다 (앞서는 상대의 유닛을 먼저)
        if (mine.length < 2 || !theirs.length) break;
        if (P.decree && P.decree.until > t) break;
        const target = [...theirs].sort((a, b) => pri(b) - pri(a) || value(b) - value(a) || hp6(b) - hp6(a))[0];
        add(4 + mine.length + Math.min(4, value(target)) + bonus(target), c, { unitId: target.id });
        break;
      }
      case 'purify': {
        const armored = theirs.find((u) => u.buffs.some((b) => b.kind === 'armor'));
        const buffed = theirs.find((u) => u.buffs.length);
        if (armored) add(6, c, { unitId: armored.id });
        else if (buffed) add(3, c, { unitId: buffed.id });
        break;
      }
      case 'disrupt': {
        const best = theirs
          .filter((u) => u.ult && !u.telegraphing && u.gauge >= 50 && u.silenceUntil <= t)
          .sort((a, b) => pri(b) - pri(a) || (b.ult.damage || 0) - (a.ult.damage || 0))[0];
        if (best) add(5 + (best.ult.damage ? 4 : 0) + bonus(best), c, { unitId: best.id });
        break;
      }
      case 'retreat': {
        const cells = deployCells(state, p).filter((x) => x.free && !threatened(x.x, x.y)).sort((a, b) => a.row - b.row);
        if (!cells.length) break;
        const safe = cells[0]; // 본진에서 가장 가까운 줄
        const inDanger = mine.filter((u) => threatened(u.x, u.y, u.radius)).sort((a, b) => b.maxHp - a.maxHp)[0];
        if (inDanger) {
          add(14, c, { unitId: inDanger.id, cell: safe.i });
          break;
        }
        const hurt = mine.filter((u) => !u.token && u.hp / u.maxHp < 0.35).sort((a, b) => b.maxHp - a.maxHp)[0];
        if (hurt && mine.length >= 2) add(5, c, { unitId: hurt.id, cell: safe.i });
        break;
      }
      case 'warcry': {
        const n = mine.filter((u) => !u.ranged).length;
        if (n >= 2) add(2 + 2 * n, c, null);
        break;
      }
      case 'awaken': {
        const best = mine.filter((u) => u.ult && !u.telegraphing && u.gauge <= 40).sort((a, b) => (b.ult.damage || 0) - (a.ult.damage || 0))[0];
        if (best) add(6 + (best.ult.damage ? 2 : 0), c, { unitId: best.id });
        break;
      }
      case 'armor': {
        const best = mine.filter((u) => !u.token && !u.buffs.some((b) => b.kind === 'armor'))
          .sort((a, b) => (a.ranged - b.ranged) || (b.atk - a.atk))[0];
        if (best) add(6, c, { unitId: best.id });
        break;
      }
      case 'phalanx': {
        const n = mine.filter((u) => u.ranged && threatened(u.x, u.y, u.radius)).length;
        if (n >= 1) add(10 + 2 * n, c, null);
        break;
      }
      case 'scout':
        if (P.hand.length <= r.handMax - 1) add(20, c, null);
        break;
      case 'crystal': {
        const after = P.mana - k + def.amount;
        const unlocks = P.hand.some((h) => h !== c && cost(h) > P.mana && cost(h) <= after && !(CARDS[h.id].matchOnly && !state.stakes));
        if (unlocks) add(8, c, null);
        else if (k === 0 && P.hand.length > 1) add(4, c, null);
        break;
      }
      case 'supply': {
        const n = P.hand.filter((h) => CARDS[h.id].type === 'unit' && CARDS[h.id].cost >= 1).length;
        if (n >= 1) add(5 + 2 * Math.min(n, 2), c, null);
        break;
      }
      case 'muster':
        if (P.hand.length <= r.handMax - 2 && P.deck.some((d) => CARDS[d.id].type === 'unit')) add(7, c, null);
        break;
      case 'invest':
        // 한 경기 안의 전투에서만: 이기면 골드 +3. 일찍 낼수록 좋다
        add(8 - t / 5000, c, null);
        break;
      case 'stockpile':
        if (t <= 25000) add(9 - t / 5000, c, null);
        break;
      case 'catalyst': {
        const best = P.hand.filter((h) => h !== c && h.fuse && !h.zeroCost && cost(h) >= 2).sort((a, b) => cost(b) - cost(a))[0];
        if (best) add(4 + cost(best), c, { uid: best.uid });
        break;
      }
      default:
        break;
    }
  }

  if (cands.length) {
    if (o.mistake && rng() < o.mistake) return rng.pick(cands).action;
    cands.sort((a, b) => b.score - a.score);
    return cands[0].action;
  }

  if (P.hand.length && canRedraw(state, p).ok) {
    const dud = P.hand.find((c) => CARDS[c.id].matchOnly && !state.stakes);
    if (dud) return { type: 'redraw', uid: dud.uid };
    const saving = P.mana < P.maxMana && P.hand.some((c) => CARDS[c.id].type === 'unit' && cost(c) > P.mana && cost(c) <= P.maxMana);
    if (!saving) {
      const prio = (c) => {
        const def = CARDS[c.id];
        const k = cost(c);
        if (k > P.maxMana) return 50 + k;
        return def.type !== 'unit' ? 20 - k : k;
      };
      return { type: 'redraw', uid: [...P.hand].sort((a, b) => prio(b) - prio(a))[0].uid };
    }
  }
  return null;
}

/** 유닛을 소환할 배치 칸. 근접은 앞줄에서 적과 가까운 쪽, 원거리는 뒷줄. */
function bestSpot(state, p, c, mine, theirs, threatened) {
  const def = CARDS[c.id];
  if (mine.length >= state.rules.unitCap) {
    const value = (u) => (u.card ? CARDS[u.defId].cost * u.stars : 0) + u.hp / u.maxHp;
    const weakest = [...mine].sort((a, b) => value(a) - value(b))[0];
    if (!weakest || def.cost * (c.stars || 1) < value(weakest) + 2) return null;
    return { replace: weakest.id };
  }
  const cells = deployCells(state, p).filter((x) => x.free);
  if (!cells.length) return null;

  const keywords = [...def.keywords, c.fuse].filter(Boolean);
  const wantsNeighbors = keywords.includes('guard') || keywords.includes('rally');
  const base = state.players[p].base;
  // 내 본진에 가장 가까이 온 적 유닛 쪽을 막는다. 적 유닛이 없으면 가장 가까운 적 본진 쪽.
  // 거리는 소수점 여섯 자리까지만 비교한다. 똑같으면 시계 방향으로 가까운 상대 쪽 (어느 자리에서나 같은 기준이 되게)
  const far = (o) => Math.round(distance(o, base) * 1e6);
  const lead = [...theirs].sort((a, b) => far(a) - far(b) || a.id - b.id)[0];
  const foeBase = enemiesOf(state, p).map((q) => state.players[q].base).sort((a, b) => far(a) - far(b))[0];
  // 난투장(중앙 점령)에서는 가운데 원 쪽으로 놓는다
  const focus = state.capture || lead || foeBase || { x: 0, y: 0 };

  let best = null;
  for (const e of cells) {
    const near = mine.filter((u) => distance(u, e) <= state.rules.nearRange).length;
    const foeClose = theirs.some((u) => distance(u, e) <= 2.5);
    let s = 0;
    if (def.ranged) {
      s += e.row === 0 ? 8 : e.row === 1 ? 6 : 0;
      s -= distance(e, focus) * 0.15;
      if (foeClose) s -= 6;
    } else {
      s += e.row * 4; // 앞줄일수록 좋다
      s -= distance(e, focus) * 0.5;
    }
    if (wantsNeighbors) s += 2 * near;
    if (threatened(e.x, e.y)) s -= 20;
    if (!best || s > best.s + 1e-6) best = { s, cell: e.i };
  }
  return best;
}

/**
 * 봇 대 봇 한 판.
 * @param {{seed:number, format?:string, players:Array<{commander:string, deck:Array, bot?:object, opening?:number[], bonus?:object, seed?:number}>,
 *   battlefield?:string|null, rules?:object, logEvents?:boolean, onTick?:(state:object)=>void}} cfg
 */
export function runFieldBattle(cfg) {
  const state = createField({ ...cfg, logEvents: cfg.logEvents === true });
  const bots = cfg.players.map((pc, i) => createFieldBot({ seed: hashSeed(cfg.seed, 'bot', i), ...(pc.bot || {}) }));
  let rejected = 0;
  const maxTicks = Math.ceil(state.rules.battleMs / state.rules.tickMs) + 10;
  for (let i = 0; i < maxTicks && !state.over; i++) {
    // 봇들이 같은 순간의 상태를 보고 판단하고, 그 행동도 동시에 처리한다
    const actions = bots.map((bot, p) => bot.decide(state, p));
    rejected += applyActions(state, actions).filter((res) => res && !res.ok).length;
    step(state);
    if (cfg.onTick) cfg.onTick(state);
  }
  return { state, result: state.result, rejected };
}
