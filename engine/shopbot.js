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

/**
 * 한 라운드의 상점을 끝까지 본다. 행동은 game에 바로 적용된다.
 * @param {{style?:'eco'|'balanced'|'spend'}} [opts]
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
  // 초반이거나 HP가 위험하면 아끼지 않는다
  const reserve = game.round < 4 || P.hp <= 15 ? 0 : style.reserve;
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
      if (score >= 6 && P.gold - cost >= keep && P.deck.length < e.deckMax && (!best || score > best.score)) best = { i, score };
    });
    if (best && buy(game, p, best.i).ok) continue;

    if (P.level < e.maxLevel && game.round >= 3 && P.gold - e.xpCost >= reserve + 2 && buyXp(game, p).ok) continue;

    const rc = rerollCostOf(game, p);
    if (rerolls < style.maxRerolls && (rc === 0 || P.gold - rc >= reserve + 3)) {
      rerolls++;
      if (reroll(game, p).ok) continue;
    }
    break;
  }

  // 가장 쓸모없는 카드 하나를 뺀다
  if (P.removesLeft > 0 && P.deck.length > Math.max(e.deckMin, 9) && P.gold >= e.removeCost + (reserve ? 2 : 0)) {
    const worst = [...P.deck]
      .filter((c) => P.deck.filter((x) => x.id === c.id && x.stars === c.stars).length < 2)
      .sort((a, b) => valueOf(a) - valueOf(b))[0];
    if (worst && valueOf(worst) <= 2) removeCard(game, p, worst.key);
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
