// 상점 봇: 카드마다 가치 점수를 매기고, 골드·덱 장수·유닛 비율을 보며 사고 빼고 합친다.
// 첩보원 봇은 상대가 고른 시작 카드를 보고, 내 시작 카드 후보들을 미리 몇 판씩 돌려 본 뒤 고른다.

import { CARDS, COMMANDERS, POOL_CARD_IDS, UNIT_DIAMONDS } from './cards.js';
import { pickOpening } from './decks.js';
import {
  buy, reroll, buyXp, removeCard, upgrade, fuse, setOpening, upgradable, canFuse, openingCount, rerollCostOf,
  claimReward, skipReward, draftPick, roundBattles,
} from './game.js';
import { hashSeed } from './rng.js';
import { runFieldBattle } from './fieldbot.js';
import { PERSONAS, likeOf } from './personas.js';

/** 시작 카드 후보를 만드는 방법들 (decks.js의 pickOpening) */
export const OPENING_POLICIES = ['tempo', 'cheap', 'big', 'curve', 'ops'];

/**
 * 상점 봇을 돌리는 순서: 첩보원을 맨 뒤에 둔다.
 * 첩보원 봇이 다른 사람들이 이번 라운드에 고른 시작 카드를 보고 고를 수 있게 한다 (사람 첩보원도 상점에서 그것을 본다).
 */
export function shopBotOrder(game) {
  const spy = (P) => (COMMANDERS[P.commander].seesOpening ? 1 : 0);
  return [...game.players].sort((A, B) => spy(A) - spy(B) || A.idx - B.idx).map((P) => P.idx);
}

/**
 * 첩보원의 빠른 대응 (미리 돌려 보지 않는다): 이번 라운드 상대들이 고른 시작 카드를 보고 카드마다 점수를 더해 고른다.
 * 상대가 원거리로 시작하면 암살, 싼 근접 유닛을 몰아 내면 범위 공격·가시, 비싼 유닛이면 화염탄·교란·포고,
 * 범위 주문으로 시작하면 체력이 높은 유닛. 기본 점수는 tempo(지금 마나로 낼 수 있는 유닛)와 같다.
 */
export function spyCounterOpening(game, p) {
  const P = game.players[p];
  const n = openingCount(game, p);
  if (n <= 0) return null;
  const battle = roundBattles(game).find((b) => b.sides.includes(p));
  if (!battle || battle.kind === 'practice' || battle.kind === 'boss') return null;
  const seat = battle.sides.indexOf(p);
  const team = (i) => (battle.kind === 'alliance' ? Math.floor(i / 2) : i);
  const seen = battle.cfg.players
    .filter((pc, i) => team(i) !== team(seat))
    .flatMap((pc) => (pc.opening || []).map((i) => pc.deck[i]).filter(Boolean))
    .map((c) => CARDS[c.id]);
  if (!seen.length) return null;
  const ranged = seen.filter((d) => d.type === 'unit' && d.ranged).length;
  const swarm = seen.filter((d) => d.type === 'unit' && !d.ranged && d.cost <= 2).length;
  const big = seen.filter((d) => d.type === 'unit' && d.cost >= 4).length;
  const aoe = seen.filter((d) => ['blizzard', 'chain', 'pyro'].includes(d.id)).length;
  const startMana = game.battleRules.startMana ?? 3;
  const scored = P.deck.map((c, index) => {
    const def = CARDS[c.id];
    if (def.matchOnly) return { index, s: -99 };
    let sc = def.type === 'unit' && def.cost <= startMana ? 5 + def.cost * (c.stars || 1) : 0;
    const kw = [...def.keywords, c.fuse].filter(Boolean);
    if (ranged && kw.includes('assassin')) sc += 4;
    if (swarm >= 2 && ['blizzard', 'chain', 'bomber', 'turtle'].includes(c.id)) sc += 5;
    if (swarm >= 2 && kw.includes('thorns')) sc += 2;
    if (big && ['firebolt', 'disrupt', 'decree'].includes(c.id)) sc += 4;
    if (aoe && def.type === 'unit' && def.hp >= 14) sc += 2;
    return { index, s: sc };
  });
  return scored.filter((x) => x.s > 0).sort((a, b) => b.s - a.s || a.index - b.index).slice(0, n).map((x) => x.index);
}

/** 이 전투에서 자리 i의 점수 (이기면 1, 지면 0. 난투장은 순위에 따라) */
function battleScore(state, i) {
  const r = state.result;
  if (state.format === 'alliance') return r.winnerTeam === -1 ? 0.5 : r.winnerTeam === state.players[i].team ? 1 : 0;
  const n = state.players.length;
  if (n > 2) return (n - 1 - r.ranks[i]) / (n - 1);
  return r.winner === -1 ? 0.5 : r.winner === i ? 1 : 0;
}

/**
 * 첩보원의 시작 카드: 이번 라운드 상대들의 공개된 덱과 이미 고른 시작 카드로 후보마다 sims판씩 돌려 보고,
 * 가장 많이 이긴 후보를 고른다. 연습·보스 라운드나 고를 장수가 없으면 null.
 * 비슷하게 잘하면 기본(tempo)을 고른다.
 */
export function spyOpening(game, p, sims = 6) {
  const P = game.players[p];
  const n = openingCount(game, p);
  if (n <= 0) return null;
  const battle = roundBattles(game).find((b) => b.sides.includes(p));
  if (!battle || battle.kind === 'practice' || battle.kind === 'boss') return null;
  const seat = battle.sides.indexOf(p);
  const deck = P.deck.map((c) => ({ id: c.id, stars: c.stars, fuse: c.fuse }));
  const startMana = game.battleRules.startMana ?? 3;
  const seen = new Set();
  let best = null;
  for (const policy of OPENING_POLICIES) {
    const picks = pickOpening(deck, n, policy, null, startMana);
    const key = [...picks].sort((a, b) => a - b).join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    let score = 0;
    for (let k = 0; k < sims; k++) {
      const players = battle.cfg.players.map((pc, i) => (i === seat ? { ...pc, opening: picks } : pc));
      const { state } = runFieldBattle({ ...battle.cfg, players, seed: hashSeed(battle.cfg.seed, 'spy', game.round, k) });
      score += battleScore(state, seat);
    }
    if (!best || score > best.score + 0.5) best = { score, picks };
  }
  return best.picks;
}

/**
 * 카드 가치 (대략 0~10). 2026-11-18 밸런스 조정 뒤 sim/fieldswap.mjs로 잰 지수(세 형식 평균)에서 정했다:
 * 가치 ≈ (지수 − 60) ÷ 4. 지휘관 고유 카드는 상점에 뜨지 않아서 대략 값이다.
 */
export const CARD_VALUE = {
  shield: 7, rats: 9, bat: 7, archer: 5, dagger: 5, frostwitch: 4, lancer: 6, pyro: 9, colossus: 5,
  turtle: 5, banner: 6, bomber: 4, hammer: 6,
  firebolt: 6, retreat: 6, purify: 4, chain: 5, blizzard: 4,
  warcry: 5, awaken: 7, armor: 5, phalanx: 3,
  scout: 9, crystal: 5, supply: 8, muster: 4, stockpile: 5,
  invest: 4, catalyst: 3, disrupt: 5, decree: 4,
};

/** 성향: 저축형은 이자를 챙기고, 소비형은 바로 쓴다 */
export const SHOP_STYLES = {
  eco: { reserve: 20, maxRerolls: 1, targetSize: 13 },
  balanced: { reserve: 10, maxRerolls: 2, targetSize: 14 },
  spend: { reserve: 0, maxRerolls: 4, targetSize: 15 },
};

/** 사전 선택: 가치가 높은 카드 위주로 8종 (약간의 무작위) */
export function botPicks(rng, econ, persona = null) {
  const n = econ ? econ.picks : 8;
  const maxT5 = econ ? econ.maxTier5Picks : 1;
  // 성격이 좋아하는 카드는 더 고른다
  const scored = POOL_CARD_IDS.map((id) => ({ id, s: (CARD_VALUE[id] || 3) + likeOf(persona, id) + rng() * 4 })).sort((a, b) => b.s - a.s);
  const out = [];
  let t5 = 0;
  for (const { id } of scored) {
    if (out.length >= n) break;
    if (CARDS[id].tier === 5) {
      if (t5 >= maxT5) continue;
      t5++;
    }
    out.push(id);
  }
  return out;
}

/** 시작 덱 드래프트를 끝까지 고른다: 가치가 높은 카드 위주로, 유닛이 모자라면 유닛을 먼저 */
export function runDraftBot(game, p) {
  const P = game.players[p];
  const persona = P.persona;
  for (let guard = 0; guard < 60 && game.phase === 'draft' && P.draft && P.draft.left > 0; guard++) {
    const units = P.deck.filter((c) => CARDS[c.id].type === 'unit').length;
    const big = P.deck.filter((c) => CARDS[c.id].cost >= 4).length;
    let best = 0;
    let bestScore = -Infinity;
    P.draft.options.forEach((id, i) => {
      const def = CARDS[id];
      let score = (CARD_VALUE[id] ?? 3) + likeOf(persona, id);
      if (def.type === 'unit' && units < 5) score += 3;
      if (def.type !== 'unit' && P.deck.length - units >= 3) score -= 3;
      if (def.cost >= 4 && big >= 1) score -= 3;
      if (P.deck.some((c) => c.id === id)) score += 1;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
    draftPick(game, p, best);
  }
}

function valueOf(c) {
  let v = CARD_VALUE[c.id] ?? 3;
  v += (c.stars - 1) * 5;
  if (c.fuse) v += 2;
  return v;
}

// ─────────────────────────────────────────────────────────────
// 장기 전략 (opts.plan): 덱 방향, HP와 남은 목숨에 맞춘 경제, 남이 모으는 카드 피하기
// ─────────────────────────────────────────────────────────────

/** 덱 방향: 카드마다 그 방향에 얼마나 맞는지 (0~3) */
export const DIRECTIONS = Object.freeze({
  swarm: { name: '물량', cards: { rats: 3, bat: 2, banner: 3, bomber: 2, dagger: 2, shield: 1, warcry: 3, muster: 2, supply: 1 } },
  wall: { name: '전열', cards: { shield: 3, turtle: 3, hammer: 3, lancer: 2, armor: 3, phalanx: 3, retreat: 2, banner: 1 } },
  ranged: { name: '원거리', cards: { archer: 3, frostwitch: 3, pyro: 3, shield: 2, turtle: 1, awaken: 3, armor: 1 } },
  spell: { name: '주문', cards: { firebolt: 3, chain: 3, blizzard: 3, purify: 2, crystal: 2, disrupt: 2, scout: 1, stockpile: 1 } },
  big: { name: '큰 유닛', cards: { lancer: 2, hammer: 3, colossus: 3, pyro: 2, crystal: 2, supply: 2, stockpile: 2, armor: 1 } },
});
export const DIRECTION_IDS = Object.keys(DIRECTIONS);

/** 장기 전략의 기능들. plan: true면 모두 켠다 */
export const PLAN_FEATURES = Object.freeze({ direction: true, economy: true, contest: true });

/** 상점 봇 난이도별 장기 전략 (전투 봇 난이도와 같은 이름) */
export const SHOP_PLAN_BY_LEVEL = Object.freeze({ beginner: false, easy: false, normal: true, hard: true });

// 봇이 기억하는 덱 방향. 규칙 상태(game)에는 넣지 않는다.
const memory = new WeakMap();

const fitOf = (dir, id) => (dir && DIRECTIONS[dir].cards[id]) || 0;

/**
 * 덱이 각 방향에 얼마나 가까운지 (강화한 카드는 장수만큼).
 * crowd면 3명 이상인 경기에서 남들이 이미 많이 가져간 방향을 덜 친다.
 */
function directionScores(game, p, crowd) {
  const P = game.players[p];
  const many = crowd && game.players.length > 2;
  const out = {};
  for (const d of DIRECTION_IDS) {
    let s = 0;
    for (const c of P.deck) s += fitOf(d, c.id) * (c.parts ? c.parts.length : 1);
    for (const [id, w] of Object.entries(DIRECTIONS[d].cards)) {
      s += Math.max(0, likeOf(P.persona, id)) * w * 0.3;
      if (many) s -= w * takenShare(game, p, id) * 2;
    }
    out[d] = s;
  }
  return out;
}

/**
 * 덱 방향을 정한다. 3라운드에 처음 정하고, 6라운드까지는 다른 방향이 훨씬 앞서면 바꾼다. 그 뒤로는 그대로 간다.
 * @returns {string|null}
 */
export function deckDirection(game, p, crowd = false) {
  const P = game.players[p];
  const mem = memory.get(P) || {};
  if (game.round < 3) return null;
  if (mem.dir && game.round > 6) return mem.dir;
  const scores = directionScores(game, p, crowd);
  const best = DIRECTION_IDS.reduce((a, b) => (scores[b] > scores[a] ? b : a));
  if (!mem.dir || scores[best] > scores[mem.dir] * 1.3) mem.dir = best;
  memory.set(P, mem);
  return mem.dir;
}

/** 이 라운드쯤 한 번 지면 받을 HP 피해 (남은 유닛 3기를 친다) */
function expectedLoss(game, P) {
  const e = game.econ;
  const n = Math.max(1, game.round + 1 - e.practiceRounds);
  const base = Math.min(e.damageMax, e.damageMin + Math.floor((n - 1) / e.damageEvery));
  const dmg = base + 3 * e.survivorDamage;
  return P.commander === 'lord' ? Math.ceil(dmg * e.lordDamage) : dmg;
}

/**
 * 형편: 몇 번 더 지면 탈락하는지와 다른 사람들과 견준 HP로 정한다.
 *   allin  위험하다: 골드를 남기지 않고 다시 뽑기를 더 해서 지금 강해진다
 *   greed  넉넉하다: 이자를 꽉 채우고 레벨을 올려 나중을 준비한다
 *   steady 그 사이: 상점 성향대로
 */
export function shopOutlook(game, p) {
  const P = game.players[p];
  if (game.round < 3) return 'steady';
  const lives = P.hp / expectedLoss(game, P);
  const others = game.players.filter((Q) => Q.alive && Q !== P);
  const below = others.filter((Q) => Q.hp < P.hp).length / Math.max(1, others.length); // 나보다 HP가 낮은 사람 비율
  if (lives <= 2.5) return 'allin';
  if (lives >= 5 && below >= 0.5) return 'greed';
  return 'steady';
}

/** 이 카드 가운데 다른 살아 있는 사람들이 가져간 비율 (남들 덱 ÷ (남들 덱 + 풀)) */
function takenShare(game, p, id) {
  let n = 0;
  for (const Q of game.players) {
    if (!Q.alive || Q.idx === p) continue;
    for (const c of Q.deck) if (c.id === id) n += c.parts ? c.parts.length : 1;
  }
  return n / Math.max(1, n + game.pool[id]);
}

/**
 * 한 라운드의 상점을 끝까지 본다. 행동은 game에 바로 적용된다.
 * @param {{style?:'eco'|'balanced'|'spend', level?:string, plan?:boolean|{direction?:boolean,economy?:boolean,contest?:boolean}}} [opts]
 *   plan: 장기 전략. 주지 않으면 level(SHOP_PLAN_BY_LEVEL)을 따르고, level도 없으면 끈다.
 */
export function runShopBot(game, p, opts = {}) {
  const P = game.players[p];
  if (!P.alive || game.phase !== 'shop') return;
  const e = game.econ;
  const persona = P.persona;
  // 상점 성향: 따로 주지 않으면 성격의 성향, 그것도 없으면 균형형
  const style = SHOP_STYLES[opts.style || (persona && PERSONAS[persona].shop) || 'balanced'];

  // 보스 보상: 가치가 가장 높은 카드를 받는다
  if (P.reward) {
    const best = P.reward.options
      .map((id, i) => ({ i, v: game.pool[id] > 0 ? (CARD_VALUE[id] ?? 3) + likeOf(persona, id) : -1 }))
      .sort((a, b) => b.v - a.v)[0];
    if (!best || best.v < 0 || !claimReward(game, p, best.i).ok) skipReward(game, p);
  }
  // 장기 전략
  const planOpt = opts.plan ?? (opts.level ? SHOP_PLAN_BY_LEVEL[opts.level] : false);
  const plan = planOpt ? { ...PLAN_FEATURES, ...(planOpt === true ? {} : planOpt) } : null;
  const dir = plan && plan.direction ? deckDirection(game, p, plan.contest) : null;
  const outlook = plan && plan.economy ? shopOutlook(game, p) : null;

  // 초반이거나 HP가 위험하면 아끼지 않는다. 장기 전략이 있으면 형편을 따른다:
  //   위험하면 다 쓰고 다시 뽑기를 더 하고, 넉넉하면 이자를 꽉 채운다(30골드)
  let reserve = game.round < 4 || P.hp <= 15 ? 0 : style.reserve;
  let maxRerolls = style.maxRerolls;
  let buyAt = 6;
  if (outlook === 'allin') {
    reserve = 0;
    maxRerolls += 3;
    buyAt = 5;
  } else if (outlook === 'greed') {
    reserve = Math.max(reserve, e.interestPer * e.interestMax);
  }
  let rerolls = 0;

  const scoreSlot = (s) => {
    const def = CARDS[s.id];
    let score = (CARD_VALUE[s.id] ?? 3) + likeOf(persona, s.id);
    const same = P.deck.filter((c) => c.id === s.id && c.stars === 1).length;
    if (same === 1) score += 2;
    if (same >= 2) score += 5; // 3장이 되면 강화
    const units = P.deck.filter((c) => CARDS[c.id].type === 'unit').length;
    const share = units / P.deck.length;
    if (def.type === 'unit' && share < 0.55) score += 2;
    if (def.type !== 'unit' && share < 0.5) score -= 3;
    if (P.deck.length >= style.targetSize && same < 2) score -= 3;
    if (def.cost >= 5 && P.deck.filter((c) => CARDS[c.id].cost >= 5).length >= 2) score -= 3;
    if (dir) {
      // 덱 방향에 맞는 카드는 더, 맞지 않는 새 카드는 덜
      const fit = fitOf(dir, s.id);
      score += fit * 0.8;
      if (!fit && same === 0) score -= 1;
    }
    if (plan && plan.contest && same < 2) {
      // 남들이 대부분 가져간 카드는 3장을 채우기 어렵다 (풀이 마른다)
      const left = game.pool[s.id] - 1; // 이 카드를 사고 나서 풀에 남는 장수
      if (same === 0 && takenShare(game, p, s.id) >= 0.6) score -= 2;
      if (left < 2 - same) score -= 2;
    }
    return { score, same };
  };

  for (let guard = 0; guard < 40; guard++) {
    for (const u of upgradable(game, p)) upgrade(game, p, u.id, u.stars);

    let best = null;
    P.shop.forEach((s, i) => {
      if (!s || s.sold || game.pool[s.id] <= 0) return;
      const { score, same } = scoreSlot(s);
      const cost = CARDS[s.id].tier;
      const keep = same >= 2 ? 0 : reserve;
      if (score >= buyAt && P.gold - cost >= keep && P.deck.length < e.deckMax && (!best || score > best.score)) best = { i, score };
    });
    if (best && buy(game, p, best.i).ok) continue;

    if (P.level < e.maxLevel && game.round >= 3) {
      const short = e.xpToNext[P.level] - P.xp; // 다음 레벨까지 남은 경험치
      // 장기 전략: 한 번에 레벨이 오르면 아낀 골드를 조금 깨서라도 올린다 (위험할 때는 시작 카드가 느는 레벨업만)
      const finish = plan && plan.economy && short <= e.xpPerBuy && P.gold - e.xpCost >= reserve - 4;
      const normal = outlook !== 'allin' && P.gold - e.xpCost >= reserve + (outlook === 'greed' ? 0 : 2);
      if ((finish || normal) && buyXp(game, p).ok) continue;
    }

    const rc = rerollCostOf(game, p);
    if (rerolls < maxRerolls && (rc === 0 || P.gold - rc >= reserve + 3)) {
      rerolls++;
      if (reroll(game, p).ok) continue;
    }
    break;
  }

  // 가장 쓸모없는 카드 하나를 뺀다. 덱 방향이 있으면 방향에 맞지 않는 약한 카드도 뺀다.
  const keepValue = (c) => valueOf(c) + fitOf(dir, c.id);
  const cutAt = dir ? 4 : 2;
  if (P.removesLeft > 0 && P.deck.length > Math.max(e.deckMin, 9) && P.gold >= e.removeCost + (reserve ? 2 : 0)) {
    const worst = [...P.deck]
      .filter((c) => P.deck.filter((x) => x.id === c.id && x.stars === c.stars).length < 2)
      .sort((a, b) => keepValue(a) - keepValue(b))[0];
    if (worst && keepValue(worst) <= cutAt && (!dir || !fitOf(dir, worst.id))) removeCard(game, p, worst.key);
  }

  // 융합: 남는 재료 하나를 가장 좋은 유닛에 붙인다. 강화(3장)를 노리는 2장짜리 카드는 재료로 쓰지 않는다.
  if (P.fusionsLeft > 0 && P.deck.length >= e.deckMin + 2) {
    const materials = P.deck
      .filter((c) => CARDS[c.id].diamond && !c.fuse && c.stars === 1 && valueOf(c) <= 7)
      .filter((c) => P.deck.filter((x) => x.id === c.id && x.stars === 1).length !== 2)
      .sort((a, b) => valueOf(a) - valueOf(b));
    const bodies = [...P.deck].filter((c) => CARDS[c.id].type === 'unit' && !c.fuse).sort((a, b) => valueOf(b) - valueOf(a));
    outer: for (const mat of materials) {
      for (const body of bodies) {
        if (body === mat || valueOf(body) <= valueOf(mat)) continue;
        if (!UNIT_DIAMONDS.includes(CARDS[mat.id].diamond) && CARDS[body.id].type === 'unit') continue; // 순환은 아껴 둔다
        if (canFuse(game, p, body.key, mat.key).ok) {
          fuse(game, p, body.key, mat.key);
          break outer;
        }
      }
    }
  }

  for (const u of upgradable(game, p)) upgrade(game, p, u.id, u.stars);

  // 시작 카드 고르기. 첩보원은 상대가 고른 시작 카드를 보고 고른다:
  //   기본은 빠른 대응(spyCounterOpening), spyInfo: true면 미리 돌려 보기(spyOpening, 6~7배 느리다), spyInfo: false면 쓰지 않는다.
  const deck = P.deck.map((c) => ({ id: c.id, stars: c.stars, fuse: c.fuse }));
  let picks = pickOpening(deck, openingCount(game, p), opts.openingPolicy || 'tempo', null, game.battleRules.startMana ?? 3);
  setOpening(game, p, picks.map((i) => P.deck[i].key));
  if (COMMANDERS[P.commander].seesOpening && opts.spyInfo !== false) {
    picks = (opts.spyInfo === true ? spyOpening(game, p, opts.spySims ?? 6) : spyCounterOpening(game, p)) || picks;
    setOpening(game, p, picks.map((i) => P.deck[i].key));
  }
}
