// 카드 사용 봇. 자기 손패와 공개 정보(보드, 게이지, 전조)만 보고 판단한다.
// 사람과 같은 조건이 되도록 판단한 뒤 반응 지연(기본 0.3~1초)을 두고 행동한다.

import { CARDS } from './cards.js';
import { makeRng } from './rng.js';
import { FRONT, BACK } from './rules.js';
import {
  legalTargets, effectiveCost, unitsOf, emptySlots, canRedraw, targetable, hasKw, enemiesOf,
} from './battle.js';

export const BOT_LEVELS = {
  easy: { reactMin: 800, reactMax: 1600, mistake: 0.3 },
  normal: { reactMin: 300, reactMax: 1000, mistake: 0.05 },
  hard: { reactMin: 100, reactMax: 300, mistake: 0 },
};

/**
 * @param {{style?:'smart'|'random', seed?:number, reactMin?:number, reactMax?:number, mistake?:number}} [opts]
 * @returns {{decide:(state:object, p:number)=>object|null}}
 */
export function createBot(opts = {}) {
  const o = { style: 'smart', ...BOT_LEVELS.normal, ...opts };
  const rng = makeRng(o.seed ?? 1);
  let pending = null;
  return {
    decide(state, p) {
      if (state.over) return null;
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

// ─────────────────────────────────────────────────────────────
// 무작위 봇 (비교 기준)
// ─────────────────────────────────────────────────────────────

function thinkRandom(state, p, rng) {
  const P = state.players[p];
  if (P.dead) return null;
  if (rng() < 0.3) return null;
  const options = [];
  for (const c of P.hand) {
    if (CARDS[c.id].duelInert) continue;
    for (const target of legalTargets(state, p, c.uid)) options.push({ type: 'play', uid: c.uid, target });
  }
  if (!options.length) {
    if (P.hand.length && rng() < 0.1 && canRedraw(state, p).ok) return { type: 'redraw', uid: rng.pick(P.hand).uid };
    return null;
  }
  return rng.pick(options);
}

// ─────────────────────────────────────────────────────────────
// 판단하는 봇
// ─────────────────────────────────────────────────────────────

function thinkSmart(state, p, rng, o) {
  const P = state.players[p];
  const r = state.rules;
  const t = state.timeMs;
  if (P.dead) return null;
  const mine = unitsOf(state, p).filter((u) => !u.dying);
  // 난전·연합전에서는 살아 있는 모든 적의 유닛을 본다
  const theirs = enemiesOf(state, p).flatMap((q) => unitsOf(state, q)).filter((u) => targetable(state, u));
  const incoming = state.telegraphs.filter((g) => g.side === p);
  const threatened = (row, slot) => incoming.some((g) => g.cells.some((c) => c.row === row && c.slot === slot));
  const cost = (c) => effectiveCost(state, p, c);
  const cands = [];
  const add = (score, c, target) => {
    if (score > 0) cands.push({ score, action: { type: 'play', uid: c.uid, target } });
  };

  // 조금만 기다리면 낼 수 있는 큰 유닛이 있으면 싼 유닛을 아낀다
  let waitingFor = 0;
  if (o.patience !== false && P.mana < P.maxMana && mine.length >= theirs.length) {
    for (const c of P.hand) {
      const def = CARDS[c.id];
      const k = cost(c);
      if (def.type === 'unit' && k > P.mana && k <= P.maxMana && (k - P.mana) * r.manaIntervalMs <= 2000) {
        waitingFor = Math.max(waitingFor, k);
      }
    }
  }

  for (const c of P.hand) {
    const def = CARDS[c.id];
    const k = cost(c);
    if (k > P.mana || def.meleeOnly || def.duelInert) continue;

    if (def.type === 'unit') {
      const place = bestSlot(state, p, c, mine, theirs, threatened);
      if (!place) continue;
      let score = place.replace ? 4 + k : 10 + k * 1.5;
      if (mine.length < theirs.length) score += 3;
      if (waitingFor >= k + 2) score = 0;
      add(score, c, { row: place.row, slot: place.slot });
      continue;
    }

    switch (c.id) {
      case 'firebolt': {
        if (!theirs.length) break;
        const combo = t - P.lastPlayAt <= r.comboWindowMs;
        const dmg = combo ? def.comboDamage : def.damage;
        const kills = theirs.filter((u) => u.hp <= dmg).sort((a, b) => b.hp - a.hp);
        if (kills.length) add(12 + kills[0].maxHp / 4, c, { unitId: kills[0].id });
        else if (combo || P.mana >= P.maxMana - 1) {
          const low = [...theirs].sort((a, b) => a.hp - b.hp)[0];
          add(combo ? 5 : 3, c, { unitId: low.id });
        }
        break;
      }
      case 'chain': {
        if (theirs.length < 2) break;
        const under = theirs.filter((u) => u.hp <= def.chainDamage[0]).sort((a, b) => b.hp - a.hp);
        const first = under[0] || [...theirs].sort((a, b) => a.hp - b.hp)[0];
        add(7 + (theirs.length >= 3 ? 3 : 0) + (under.length ? 2 : 0), c, { unitId: first.id });
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
          .sort((a, b) => (b.ult.damage || 0) - (a.ult.damage || 0))[0];
        if (best) add(5 + (best.ult.damage ? 4 : 0), c, { unitId: best.id });
        break;
      }
      case 'retreat': {
        const empties = emptySlots(state, p).filter((e) => !threatened(e.row, e.slot));
        if (!empties.length) break;
        const inDanger = mine.filter((u) => threatened(u.row, u.slot)).sort((a, b) => b.maxHp - a.maxHp)[0];
        if (inDanger) {
          const wantRow = inDanger.ranged ? BACK : FRONT;
          const dest = empties.find((e) => e.row === wantRow) || empties[0];
          add(14, c, { unitId: inDanger.id, row: dest.row, slot: dest.slot });
          break;
        }
        const frontCount = mine.filter((u) => u.row === FRONT).length;
        const hurt = mine
          .filter((u) => !u.token && u.row === FRONT && u.hp / u.maxHp < 0.35)
          .sort((a, b) => b.maxHp - a.maxHp)[0];
        const back = empties.find((e) => e.row === BACK);
        if (hurt && back && frontCount >= 2) add(5, c, { unitId: hurt.id, row: back.row, slot: back.slot });
        break;
      }
      case 'warcry': {
        const n = mine.filter((u) => u.row === FRONT).length;
        if (n >= 2) add(2 + 2 * n, c, null);
        break;
      }
      case 'awaken': {
        const best = mine
          .filter((u) => u.ult && !u.telegraphing && u.gauge <= 40)
          .sort((a, b) => (b.ult.damage || 0) - (a.ult.damage || 0))[0];
        if (best) add(6 + (best.ult.damage ? 2 : 0), c, { unitId: best.id });
        break;
      }
      case 'armor': {
        const best = mine
          .filter((u) => !u.token && !u.buffs.some((b) => b.kind === 'armor'))
          .sort((a, b) => (a.row - b.row) || (b.atk - a.atk))[0];
        if (best) add(6, c, { unitId: best.id });
        break;
      }
      case 'phalanx': {
        const n = mine.filter((u) => u.row === BACK && threatened(u.row, u.slot)).length;
        if (n >= 1) add(10 + 2 * n, c, null);
        break;
      }
      case 'scout':
        if (P.hand.length <= r.handMax - 1) add(20, c, null);
        break;
      case 'crystal': {
        const after = P.mana - k + def.amount;
        const unlocks = P.hand.some((h) => h !== c && cost(h) > P.mana && cost(h) <= after && !CARDS[h.id].duelInert);
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
      case 'stockpile':
        if (t <= 25000) add(9 - t / 5000, c, null);
        break;
      case 'catalyst': {
        const best = P.hand
          .filter((h) => h !== c && h.fuse && !h.zeroCost && cost(h) >= 2)
          .sort((a, b) => cost(b) - cost(a))[0];
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

  // 낼 것이 없으면 다시 뽑기로 손패를 돌린다
  if (P.hand.length && canRedraw(state, p).ok) {
    const dud = P.hand.find((c) => CARDS[c.id].duelInert || CARDS[c.id].meleeOnly);
    if (dud) return { type: 'redraw', uid: dud.uid };
    // 곧 낼 수 있는 유닛을 위해 마나를 모으는 중이 아니라면 손패를 돌린다
    const saving = P.mana < P.maxMana && P.hand.some((c) => {
      const k = cost(c);
      return CARDS[c.id].type === 'unit' && k > P.mana && k <= P.maxMana;
    });
    if (!saving) {
      const sorted = [...P.hand].sort((a, b) => redrawPriority(state, p, b) - redrawPriority(state, p, a));
      return { type: 'redraw', uid: sorted[0].uid };
    }
  }
  return null;
}

/** 버릴 우선순위: 지금 최대 마나로도 못 내는 카드 > 상황이 맞아야 하는 카드 > 나머지 */
function redrawPriority(state, p, c) {
  const P = state.players[p];
  const def = CARDS[c.id];
  const k = effectiveCost(state, p, c);
  if (def.duelInert || def.meleeOnly) return 100;
  if (k > P.maxMana) return 50 + k;
  if (def.type !== 'unit') return 20 - k;
  return k;
}

/** 유닛을 놓을 칸 고르기 */
function bestSlot(state, p, c, mine, theirs, threatened) {
  const def = CARDS[c.id];
  const empties = emptySlots(state, p);
  if (!empties.length) {
    // 보드가 가득 차면 가장 값싼 유닛을 대체한다 (충분히 더 좋은 카드일 때만)
    const value = (u) => (u.card ? CARDS[u.defId].cost * u.stars : 0) + u.hp / u.maxHp;
    const weakest = [...mine].sort((a, b) => value(a) - value(b))[0];
    if (!weakest) return null;
    if (def.cost * (c.stars || 1) < value(weakest) + 2) return null;
    return { row: weakest.row, slot: weakest.slot, replace: true };
  }

  const board = state.board[p];
  const keywords = [...def.keywords, c.fuse].filter(Boolean);
  const wantsNeighbors = keywords.includes('guard') || keywords.includes('rally');
  const enemyHasAoe = theirs.some((u) => u.ult && u.ult.kind === 'cross');
  const enemyFront = theirs.filter((u) => u.row === FRONT);
  const focusPool = enemyFront.length ? enemyFront : theirs;
  const focus = focusPool.length ? [...focusPool].sort((a, b) => a.hp - b.hp || a.slot - b.slot)[0] : null;

  let best = null;
  for (const e of empties) {
    let s = 0;
    const neighbors = [
      e.slot > 0 ? board[e.row][e.slot - 1] : null,
      e.slot < 3 ? board[e.row][e.slot + 1] : null,
      board[e.row === FRONT ? BACK : FRONT][e.slot],
    ].filter(Boolean).length;
    if (def.ranged) {
      s += e.row === BACK ? 10 : 0;
      if (e.row === BACK && board[FRONT][e.slot]) s += 2;
      if (enemyHasAoe) s -= neighbors;
    } else {
      s += e.row === FRONT ? 10 : 0;
      s -= focus ? Math.abs(e.slot - focus.slot) : Math.abs(e.slot - 1.5);
    }
    if (wantsNeighbors) s += 2 * neighbors;
    if (threatened(e.row, e.slot)) s -= 20;
    if (!best || s > best.s) best = { s, row: e.row, slot: e.slot };
  }
  return best;
}
