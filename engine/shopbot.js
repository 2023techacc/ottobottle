// 상점 봇: 카드마다 가치 점수를 매기고, 골드·덱 장수·유닛 비율을 보며 사고 빼고 합친다.
// 수치는 일단 돌아가게 하는 임시값이다. 밸런스를 볼 때 다시 손본다.

import { CARDS, POOL_CARD_IDS, UNIT_DIAMONDS } from './cards.js';
import { pickOpening } from './decks.js';
import {
  buy, reroll, buyXp, removeCard, upgrade, fuse, setOpening, upgradable, canFuse, openingCount, rerollCostOf,
} from './game.js';

/** 카드 가치 (대략 0~10) */
export const CARD_VALUE = {
  shield: 6, rats: 4, bat: 5, archer: 5, dagger: 8, frostwitch: 6, lancer: 8, pyro: 8, colossus: 5,
  firebolt: 6, retreat: 4, purify: 2, chain: 5,
  warcry: 4, awaken: 2, armor: 4, phalanx: 2,
  scout: 5, crystal: 5, supply: 3, muster: 3, stockpile: 3,
  invest: 3, catalyst: 2, disrupt: 5, decree: 0,
};

/** 성향: 저축형은 이자를 챙기고, 소비형은 바로 쓴다 */
export const SHOP_STYLES = {
  eco: { reserve: 20, maxRerolls: 1, targetSize: 13 },
  balanced: { reserve: 10, maxRerolls: 2, targetSize: 14 },
  spend: { reserve: 0, maxRerolls: 4, targetSize: 15 },
};

/** 사전 선택: 가치가 높은 카드 위주로 8종 (약간의 무작위) */
export function botPicks(rng, econ) {
  const n = econ ? econ.picks : 8;
  const maxT5 = econ ? econ.maxTier5Picks : 1;
  const scored = POOL_CARD_IDS.map((id) => ({ id, s: (CARD_VALUE[id] || 3) + rng() * 4 })).sort((a, b) => b.s - a.s);
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

function valueOf(c) {
  const def = CARDS[c.id];
  let v = CARD_VALUE[c.id] ?? 3;
  if (def.meleeOnly) v = 0;
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
  const e = game.econ;
  const style = SHOP_STYLES[opts.style || 'balanced'];
  // 초반이거나 HP가 위험하면 아끼지 않는다
  const reserve = game.round < 4 || P.hp <= 15 ? 0 : style.reserve;
  let rerolls = 0;

  const scoreSlot = (s) => {
    const def = CARDS[s.id];
    let score = CARD_VALUE[s.id] ?? 3;
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

  // 융합: 남는 싼 재료 하나를 가장 좋은 유닛에 붙인다
  if (P.fusionsLeft > 0 && P.deck.length >= e.deckMin + 3) {
    const materials = P.deck
      .filter((c) => CARDS[c.id].diamond && !c.fuse && c.stars === 1 && valueOf(c) <= 5)
      .filter((c) => P.deck.filter((x) => x.id === c.id && x.stars === 1).length === 1)
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

  // 시작 카드 고르기
  const deck = P.deck.map((c) => ({ id: c.id, stars: c.stars, fuse: c.fuse }));
  const picks = pickOpening(deck, openingCount(game, p), opts.openingPolicy || 'tempo', null, game.battleRules.startMana ?? 3);
  setOpening(game, p, picks.map((i) => P.deck[i].key));
}
