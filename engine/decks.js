// 덱 만들기: 지휘관 시작 덱, 그리고 상점을 몇 라운드 거친 "중반 덱"을 흉내 낸 무작위 덱.
// 상점·경제는 아직 엔진에 없어서, 중반 덱은 등급 확률표로 카드를 뽑아 대신한다.

import { CARDS, COMMANDERS, POOL_CARD_IDS, UNIT_DIAMONDS } from './cards.js';

/** 상점 레벨별 등급 확률 (기획서 초안 표) */
export const SHOP_ODDS = {
  3: [75, 25, 0, 0, 0],
  4: [55, 30, 15, 0, 0],
  5: [40, 33, 22, 5, 0],
  6: [25, 35, 28, 10, 2],
  7: [18, 27, 33, 17, 5],
  8: [12, 20, 33, 25, 10],
};

export function startDeck(commander) {
  return COMMANDERS[commander].deck.map((id) => ({ id, stars: 1, fuse: null }));
}

function rollTier(rng, level) {
  const odds = SHOP_ODDS[level];
  let x = rng() * 100;
  for (let i = 0; i < odds.length; i++) {
    x -= odds[i];
    if (x < 0) return i + 1;
  }
  return 1;
}

/**
 * 시작 덱에 카드를 몇 장 사서 넣고, 같은 카드 3장은 합치고, 융합도 몇 번 한 덱.
 * @param {string} commander
 * @param {Function} rng  makeRng로 만든 난수
 * @param {{buys?:number, level?:number, fuseChance?:number}} [opts]
 */
export function randomMidDeck(commander, rng, opts = {}) {
  const level = opts.level ?? 5 + rng.int(3); // 상점 레벨 5~7
  const buys = opts.buys ?? 5 + rng.int(6); // 5~10장 구매
  const fuseChance = opts.fuseChance ?? 0.6;
  const deck = startDeck(commander);

  const byTier = {};
  for (const id of POOL_CARD_IDS) (byTier[CARDS[id].tier] ||= []).push(id);

  for (let i = 0; i < buys; i++) {
    let tier = rollTier(rng, level);
    while (!byTier[tier]) tier--;
    // 이미 가진 카드를 한 번 더 살 확률을 조금 높여서 강화가 나오게 한다
    const owned = deck.filter((c) => CARDS[c.id].tier === tier && !CARDS[c.id].commanderCard).map((c) => c.id);
    const id = owned.length && rng() < 0.35 ? rng.pick(owned) : rng.pick(byTier[tier]);
    deck.push({ id, stars: 1, fuse: null });
  }

  // 강화: 같은 카드(같은 별, 융합 없음) 3장 → 한 단계 위 1장
  for (let pass = 0; pass < 2; pass++) {
    const groups = {};
    for (const c of deck) if (!c.fuse) (groups[`${c.id}:${c.stars}`] ||= []).push(c);
    for (const g of Object.values(groups)) {
      if (g.length < 3) continue;
      for (const c of g.slice(1, 3)) deck.splice(deck.indexOf(c), 1);
      g[0].stars += 1;
    }
  }

  // 융합: 재료 카드의 ◆ 효과를 몸체 카드에 붙이고 재료는 사라진다
  const maxFusions = COMMANDERS[commander].fusions;
  for (let i = 0; i < maxFusions; i++) {
    if (rng() > fuseChance || deck.length <= 8) continue;
    const materials = deck.filter((c) => CARDS[c.id].diamond && !c.fuse && c.stars === 1);
    if (!materials.length) break;
    const mat = rng.pick(materials);
    const effect = CARDS[mat.id].diamond;
    const bodies = deck.filter((c) => {
      if (c === mat || c.fuse) return false;
      const def = CARDS[c.id];
      if (def.matchOnly) return false;
      if (UNIT_DIAMONDS.includes(effect)) return def.type === 'unit' && !def.keywords.includes(effect);
      return !def.keywords.includes(effect); // 순환은 어떤 카드에나 붙는다
    });
    if (!bodies.length) continue;
    const body = rng.pick(bodies);
    body.fuse = effect;
    deck.splice(deck.indexOf(mat), 1);
  }

  return deck;
}

/**
 * 시작 손패에 반드시 넣을 카드 고르기 (봇용).
 *   tempo  3마나 안에서 가장 센 유닛부터 (기본)
 *   cheap  싼 유닛부터
 *   big    비용과 상관없이 가장 센 유닛부터
 *   curve  1·2·3마나 유닛을 하나씩
 *   ops    정찰·마나 결정 같은 운영 카드부터
 *   random 아무거나
 * @returns {number[]} 덱 배열의 인덱스
 */
export function pickOpening(deck, n, policy = 'tempo', rng = null, startMana = 3) {
  if (n <= 0 || policy === 'none') return [];
  const all = deck
    .map((c, index) => ({ c, index, def: CARDS[c.id], power: CARDS[c.id].cost * (c.stars || 1) }))
    .filter((x) => !x.def.matchOnly);
  const units = all.filter((x) => x.def.type === 'unit');
  let order;
  switch (policy) {
    case 'cheap':
      order = [...units].sort((a, b) => a.def.cost - b.def.cost || b.power - a.power);
      break;
    case 'big':
      order = [...units].sort((a, b) => b.power - a.power);
      break;
    case 'curve': {
      order = [];
      for (const cost of [1, 2, 3, 1, 2, 3]) {
        const pick = units.filter((x) => x.def.cost === cost && !order.includes(x)).sort((a, b) => b.power - a.power)[0];
        if (pick) order.push(pick);
      }
      break;
    }
    case 'ops':
      order = [
        ...all.filter((x) => x.def.type === 'ops').sort((a, b) => a.def.cost - b.def.cost),
        ...units.filter((x) => x.def.cost <= startMana).sort((a, b) => b.power - a.power),
      ];
      break;
    case 'random':
      order = rng ? rng.shuffle([...all]) : all;
      break;
    case 'tempo':
    default:
      order = [
        ...units.filter((x) => x.def.cost <= startMana).sort((a, b) => b.power - a.power || a.index - b.index),
        ...units.filter((x) => x.def.cost > startMana).sort((a, b) => a.def.cost - b.def.cost),
      ];
      break;
  }
  return order.slice(0, n).map((x) => x.index);
}

export function deckSummary(deck) {
  const counts = {};
  for (const c of deck) {
    const key = `${c.id}|${c.stars || 1}|${c.fuse || ''}`;
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.entries(counts).map(([key, n]) => {
    const [id, stars, fuse] = key.split('|');
    return { id, stars: Number(stars), fuse: fuse || null, n };
  });
}
