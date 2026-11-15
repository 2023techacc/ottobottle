// 한 경기(1:1): 사전 선택 → [상점 → 전투] 반복 → 한쪽 HP가 0이 되면 끝.
// 여기에는 상점·경제·라운드 진행만 있고, 전투는 battle.js가 맡는다.
// 난수는 상점에 무엇이 뜨는지에만 쓴다. 같은 시드와 같은 행동이면 결과도 같다.

import { makeRng, hashSeed } from './rng.js';
import { CARDS, COMMANDERS, POOL_CARD_IDS, COPIES_BY_TIER, BATTLEFIELD_IDS, UNIT_DIAMONDS } from './cards.js';
import { SHOP_ODDS } from './decks.js';
import { PRESETS } from './rules.js';

export const DEFAULT_ECON = Object.freeze({
  // 1:1 모드
  playerHp: 40,
  picks: 8, // 사전에 고르는 픽 카드 수
  maxTier5Picks: 1,
  pickCopyBonus: 0.5, // 누가 고른 카드는 한 명당 풀 장수 +50%

  // 수입
  baseIncome: 5,
  interestPer: 10,
  interestMax: 3,
  streakBonus: [[4, 2], [2, 1]], // [연속 횟수, 보너스]
  practiceRounds: 2, // 1~2라운드는 중립 몬스터와 연습
  practiceWinGold: 2,
  investGold: 3,

  // 상점
  shopSlots: 5,
  signatureSlots: 1,
  rerollCost: 2,
  removeCost: 2,
  removesPerRound: 1,
  shopSeconds: 30,

  // 상점 레벨. 경험치 필요량은 기획서에 없어서 정했다.
  startLevel: 3,
  maxLevel: 8,
  xpCost: 4,
  xpPerBuy: 4,
  xpPerRound: 2,
  xpToNext: { 3: 6, 4: 10, 5: 16, 6: 24, 7: 36 },
  // 레벨 보상: 선봉 칸 수(1·1·2·2·3·3)를 "고르는 시작 카드 장수"로 바꿨다.
  openingByLevel: { 3: 1, 4: 1, 5: 2, 6: 2, 7: 3, 8: 3 },

  // 덱
  deckMin: 8,
  deckMax: 30,

  // 패배 피해: 기본 피해(라운드에 따라 2 → 8) + 승자 보드에 남은 유닛 수
  damageMin: 2,
  damageMax: 8,
});

/** 연습 라운드의 중립 몬스터 덱 */
/** 중립 몬스터는 느리게 반응하고 가끔 엉뚱한 카드를 낸다 */
export const MONSTER_BOT = Object.freeze({ reactMin: 1500, reactMax: 3000, mistake: 0.3 });

export const MONSTER_DECKS = {
  1: ['rats', 'rats', 'rats', 'rats', 'shield', 'shield', 'archer', 'archer'],
  2: ['rats', 'rats', 'shield', 'shield', 'bat', 'archer', 'dagger', 'lancer'],
};

const fail = (reason) => ({ ok: false, reason });
const OK = { ok: true };

// ─────────────────────────────────────────────────────────────
// 만들기
// ─────────────────────────────────────────────────────────────

export function validatePicks(picks, econ = DEFAULT_ECON) {
  if (!Array.isArray(picks)) return fail('픽 카드 목록이 없다');
  if (picks.length !== econ.picks) return fail(`픽 카드는 ${econ.picks}종을 골라야 한다`);
  if (new Set(picks).size !== picks.length) return fail('같은 카드를 두 번 고를 수 없다');
  if (picks.some((id) => !POOL_CARD_IDS.includes(id))) return fail('고를 수 없는 카드가 있다');
  if (picks.filter((id) => CARDS[id].tier === 5).length > econ.maxTier5Picks) return fail(`5등급은 최대 ${econ.maxTier5Picks}종`);
  return OK;
}

/**
 * @param {object} cfg
 * @param {number} cfg.seed
 * @param {Array<{commander:string, picks:string[], name?:string}>} cfg.players  2명
 * @param {object} [cfg.econ]         DEFAULT_ECON에 덮어쓸 값
 * @param {object} [cfg.battleRules]  전투 규칙 (기본: PRESETS.cards)
 */
export function createGame(cfg) {
  const econ = { ...DEFAULT_ECON, ...(cfg.econ || {}) };
  const seed = (cfg.seed ?? 1) >>> 0;
  const game = {
    seed,
    econ,
    // 한 경기에서는 선봉이 없고, 고르는 시작 카드 장수는 상점 레벨이 정한다.
    battleRules: { ...(cfg.battleRules || PRESETS.cards.rules), vanguardSlots: 0, openingPicks: 0 },
    round: 0,
    phase: 'shop', // 'shop' | 'over'
    pool: {},
    poolStart: {},
    players: [],
    nextKey: 1,
    winner: null,
    history: [],
  };

  for (const pc of cfg.players) {
    const chk = validatePicks(pc.picks, econ);
    if (!chk.ok) throw new Error(chk.reason);
  }

  // 공용 풀: 기본 중립 카드(지금은 카드 목록 전체) + 고른 사람 수만큼 장수 증가
  for (const id of POOL_CARD_IDS) {
    const pickers = cfg.players.filter((pc) => pc.picks.includes(id)).length;
    game.pool[id] = Math.round(COPIES_BY_TIER[CARDS[id].tier] * (1 + econ.pickCopyBonus * pickers));
  }
  game.poolStart = { ...game.pool };

  cfg.players.forEach((pc, idx) => {
    const c = COMMANDERS[pc.commander];
    const P = {
      idx,
      name: pc.name || c.name,
      commander: pc.commander,
      picks: [...pc.picks],
      hp: econ.playerHp,
      maxHp: econ.playerHp,
      gold: 0,
      level: econ.startLevel,
      xp: 0,
      deck: [],
      shop: [],
      locked: false,
      streak: 0, // 양수면 연승, 음수면 연패
      removesLeft: econ.removesPerRound,
      freeReroll: false,
      fusionsLeft: c.fusions,
      opening: [],
      lastIncome: null,
      rng: makeRng(hashSeed(seed, 'shop', idx)),
      stats: { bought: {}, spent: 0, earned: 0, rerolls: 0, xpBought: 0, removed: 0, fused: 0, upgraded: 0 },
    };
    P.deck = c.deck.map((id) => newCard(game, id, 'start'));
    game.players.push(P);
  });

  startRound(game);
  return game;
}

function newCard(game, id, origin) {
  // parts: 이 카드에 들어간 "풀에서 온 카드"들. 덱에서 빼면 전부 풀로 돌아간다.
  return { key: game.nextKey++, id, stars: 1, fuse: null, origin, parts: origin === 'pool' ? [id] : [] };
}

// ─────────────────────────────────────────────────────────────
// 조회
// ─────────────────────────────────────────────────────────────

/** 이번 라운드의 형식·전장·기본 피해. 상점 단계에서 미리 공개된다. */
export function roundInfo(game, round = game.round) {
  const e = game.econ;
  const practice = round <= e.practiceRounds;
  const n = round - e.practiceRounds;
  return {
    round,
    format: practice ? 'practice' : 'duel',
    battlefield: practice ? null : makeRng(hashSeed(game.seed, 'field', round)).pick(BATTLEFIELD_IDS),
    baseDamage: practice ? 0 : Math.min(e.damageMax, e.damageMin + Math.floor((n - 1) / 2)),
  };
}

export function openingCount(game, p) {
  return game.econ.openingByLevel[game.players[p].level] || 0;
}

export function interestOf(game, gold) {
  return Math.min(game.econ.interestMax, Math.floor(gold / game.econ.interestPer));
}

export function streakBonusOf(game, streak) {
  const n = Math.abs(streak);
  for (const [need, bonus] of game.econ.streakBonus) if (n >= need) return bonus;
  return 0;
}

/** 다음 라운드에 들어올 골드의 내역 (지금 가진 골드 기준) */
export function incomePreview(game, p) {
  const P = game.players[p];
  const e = game.econ;
  const parts = {
    base: e.baseIncome,
    interest: interestOf(game, P.gold),
    streak: streakBonusOf(game, P.streak),
    commander: P.commander === 'merchant' ? 1 : 0,
  };
  parts.total = parts.base + parts.interest + parts.streak + parts.commander;
  return parts;
}

export function rerollCostOf(game, p) {
  return game.players[p].freeReroll ? 0 : game.econ.rerollCost;
}

/** 합칠 수 있는 카드 묶음 (같은 카드·같은 별 3장) */
export function upgradable(game, p) {
  const P = game.players[p];
  const groups = {};
  for (const c of P.deck) (groups[`${c.id}:${c.stars}`] ||= []).push(c);
  const out = [];
  for (const g of Object.values(groups)) {
    if (g.length >= 3 && g[0].stars < 3 && P.deck.length - 2 >= game.econ.deckMin) out.push({ id: g[0].id, stars: g[0].stars, count: g.length });
  }
  return out;
}

export function canFuse(game, p, bodyKey, materialKey) {
  const P = game.players[p];
  if (game.phase !== 'shop') return fail('상점 단계가 아니다');
  if (P.fusionsLeft <= 0) return fail('융합 횟수를 다 썼다');
  const body = P.deck.find((c) => c.key === bodyKey);
  const mat = P.deck.find((c) => c.key === materialKey);
  if (!body || !mat || body === mat) return fail('몸체와 재료 카드를 골라야 한다');
  const effect = CARDS[mat.id].diamond;
  if (!effect) return fail('재료 카드에 ◆ 효과가 없다');
  if (mat.fuse) return fail('이미 융합한 카드는 재료로 쓸 수 없다');
  if (body.fuse) return fail('한 카드에 붙일 수 있는 효과는 하나다');
  const bodyDef = CARDS[body.id];
  if (bodyDef.keywords.includes(effect)) return fail('이미 가진 효과다');
  if (UNIT_DIAMONDS.includes(effect) && bodyDef.type !== 'unit') return fail('유닛 키워드는 유닛 카드에만 붙는다');
  if (P.deck.length - 1 < game.econ.deckMin) return fail(`덱은 최소 ${game.econ.deckMin}장`);
  return OK;
}

/** 풀과 덱에 있는 "풀에서 온 카드"의 합. 경기 내내 변하지 않아야 한다. */
export function poolTotal(game) {
  let n = 0;
  for (const id of POOL_CARD_IDS) n += game.pool[id];
  for (const P of game.players) for (const c of P.deck) n += c.parts.length;
  return n;
}

// ─────────────────────────────────────────────────────────────
// 라운드 시작
// ─────────────────────────────────────────────────────────────

function startRound(game) {
  const e = game.econ;
  game.round++;
  game.phase = 'shop';
  for (const P of game.players) {
    const inc = game.round === 1
      ? { base: e.baseIncome, interest: 0, streak: 0, commander: P.commander === 'merchant' ? 1 : 0 }
      : incomePreview(game, P.idx);
    inc.total = inc.base + inc.interest + inc.streak + inc.commander;
    P.gold += inc.total;
    P.stats.earned += inc.total;
    P.lastIncome = inc;
    if (game.round > 1) gainXp(game, P, e.xpPerRound);
    P.removesLeft = e.removesPerRound;
    P.freeReroll = P.commander === 'merchant';
    if (P.locked) P.locked = false; // 잠근 상점은 한 라운드 유지된다
    else rollShop(game, P);
  }
}

function gainXp(game, P, amount) {
  const e = game.econ;
  P.xp += amount;
  while (P.level < e.maxLevel && P.xp >= e.xpToNext[P.level]) {
    P.xp -= e.xpToNext[P.level];
    P.level++;
  }
  if (P.level >= e.maxLevel) P.xp = 0;
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

function rollSlot(game, P, signature) {
  const tier = rollTier(P.rng, P.level);
  const source = signature ? P.picks : POOL_CARD_IDS;
  // 해당 등급에 카드가 없으면 가장 가까운 낮은 등급, 그것도 없으면 높은 등급
  const order = [];
  for (let t = tier; t >= 1; t--) order.push(t);
  for (let t = tier + 1; t <= 5; t++) order.push(t);
  for (const t of order) {
    const ids = source.filter((id) => CARDS[id].tier === t && game.pool[id] > 0);
    if (!ids.length) continue;
    let x = P.rng() * ids.reduce((s, id) => s + game.pool[id], 0);
    for (const id of ids) {
      x -= game.pool[id];
      if (x < 0) return { id, signature, sold: false };
    }
    return { id: ids[ids.length - 1], signature, sold: false };
  }
  return null;
}

function rollShop(game, P) {
  const e = game.econ;
  const sig = COMMANDERS[P.commander].signatureSlots || e.signatureSlots;
  P.shop = [];
  for (let i = 0; i < e.shopSlots; i++) P.shop.push(rollSlot(game, P, i < sig));
}

// ─────────────────────────────────────────────────────────────
// 상점 행동
// ─────────────────────────────────────────────────────────────

const inShop = (game) => (game.phase === 'shop' ? OK : fail('상점 단계가 아니다'));

export function buy(game, p, slot) {
  const chk = inShop(game);
  if (!chk.ok) return chk;
  const P = game.players[p];
  const s = P.shop[slot];
  if (!s || s.sold) return fail('살 수 없는 칸');
  const cost = CARDS[s.id].tier;
  if (P.gold < cost) return fail('골드가 모자라다');
  if (P.deck.length >= game.econ.deckMax) return fail(`덱은 최대 ${game.econ.deckMax}장`);
  if (game.pool[s.id] <= 0) return fail('품절'); // 상대가 먼저 다 사 갔다
  game.pool[s.id]--;
  P.gold -= cost;
  P.stats.spent += cost;
  P.stats.bought[s.id] = (P.stats.bought[s.id] || 0) + 1;
  s.sold = true;
  const c = newCard(game, s.id, 'pool');
  P.deck.push(c);
  return { ok: true, card: c };
}

export function reroll(game, p) {
  const chk = inShop(game);
  if (!chk.ok) return chk;
  const P = game.players[p];
  const cost = rerollCostOf(game, p);
  if (P.gold < cost) return fail('골드가 모자라다');
  P.gold -= cost;
  P.stats.spent += cost;
  P.stats.rerolls++;
  P.freeReroll = false;
  P.locked = false;
  rollShop(game, P);
  return OK;
}

export function toggleLock(game, p) {
  const chk = inShop(game);
  if (!chk.ok) return chk;
  const P = game.players[p];
  P.locked = !P.locked;
  return OK;
}

export function buyXp(game, p) {
  const chk = inShop(game);
  if (!chk.ok) return chk;
  const P = game.players[p];
  const e = game.econ;
  if (P.level >= e.maxLevel) return fail('최대 레벨');
  if (P.gold < e.xpCost) return fail('골드가 모자라다');
  P.gold -= e.xpCost;
  P.stats.spent += e.xpCost;
  P.stats.xpBought++;
  gainXp(game, P, e.xpPerBuy);
  return OK;
}

export function removeCard(game, p, key) {
  const chk = inShop(game);
  if (!chk.ok) return chk;
  const P = game.players[p];
  const e = game.econ;
  const i = P.deck.findIndex((c) => c.key === key);
  if (i < 0) return fail('덱에 없는 카드');
  if (P.removesLeft <= 0) return fail('카드 빼기는 라운드당 1번');
  if (P.gold < e.removeCost) return fail('골드가 모자라다');
  if (P.deck.length - 1 < e.deckMin) return fail(`덱은 최소 ${e.deckMin}장`);
  const [c] = P.deck.splice(i, 1);
  for (const id of c.parts) game.pool[id]++; // 융합·강화한 카드는 들어간 카드가 모두 돌아간다
  P.gold -= e.removeCost;
  P.stats.spent += e.removeCost;
  P.stats.removed++;
  P.removesLeft--;
  P.opening = P.opening.filter((k) => k !== key);
  return OK;
}

/** 같은 카드·같은 별 3장을 한 단계 위 1장으로 합친다. 붙인 융합 효과는 남는다. */
export function upgrade(game, p, id, stars) {
  const chk = inShop(game);
  if (!chk.ok) return chk;
  const P = game.players[p];
  if (stars >= 3) return fail('3성이 최대다');
  // 융합 효과가 있는 카드를 앞에 둬서 효과가 남게 한다
  const same = P.deck.filter((c) => c.id === id && c.stars === stars).sort((a, b) => (b.fuse ? 1 : 0) - (a.fuse ? 1 : 0) || a.key - b.key);
  if (same.length < 3) return fail('같은 카드 3장이 필요하다');
  if (P.deck.length - 2 < game.econ.deckMin) return fail(`덱은 최소 ${game.econ.deckMin}장`);
  const [keep, a, b] = same;
  keep.stars++;
  keep.parts.push(...a.parts, ...b.parts);
  // 버려지는 융합 효과에 들어간 재료는 parts에 남아 있으므로 풀 장수는 보존된다
  P.deck = P.deck.filter((c) => c !== a && c !== b);
  P.opening = P.opening.filter((k) => k !== a.key && k !== b.key);
  P.stats.upgraded++;
  return { ok: true, card: keep };
}

/** 재료 카드의 ◆ 효과를 몸체 카드에 붙인다. 재료 카드는 사라진다. */
export function fuse(game, p, bodyKey, materialKey) {
  const chk = canFuse(game, p, bodyKey, materialKey);
  if (!chk.ok) return chk;
  const P = game.players[p];
  const body = P.deck.find((c) => c.key === bodyKey);
  const mat = P.deck.find((c) => c.key === materialKey);
  body.fuse = CARDS[mat.id].diamond;
  body.parts.push(...mat.parts);
  P.deck = P.deck.filter((c) => c !== mat);
  P.opening = P.opening.filter((k) => k !== mat.key);
  P.fusionsLeft--;
  P.stats.fused++;
  return { ok: true, card: body };
}

/** 시작 손패에 반드시 넣을 카드를 정한다 (덱 카드의 key). 레벨이 허용하는 장수까지. */
export function setOpening(game, p, keys) {
  const P = game.players[p];
  const max = openingCount(game, p);
  P.opening = [...new Set(keys)].filter((k) => P.deck.some((c) => c.key === k)).slice(0, max);
  return OK;
}

// ─────────────────────────────────────────────────────────────
// 전투로 넘기기와 결과 반영
// ─────────────────────────────────────────────────────────────

function sideConfig(game, P) {
  const deck = P.deck.map((c) => ({ id: c.id, stars: c.stars, fuse: c.fuse }));
  const opening = P.opening.map((k) => P.deck.findIndex((c) => c.key === k)).filter((i) => i >= 0);
  return { commander: P.commander, name: P.name, deck, opening, bonus: { openingPicks: openingCount(game, P.idx) } };
}

/**
 * 이번 라운드에 치를 전투 목록.
 *   연습 라운드: 플레이어마다 중립 몬스터와 한 판씩 (sides: [p, null])
 *   결투: 두 플레이어가 한 판 (sides: [0, 1])
 * cfg는 createBattle / runBattle에 그대로 넘기면 된다.
 */
export function roundBattles(game) {
  const info = roundInfo(game);
  const base = { battlefield: info.battlefield, rules: game.battleRules };
  if (info.format === 'practice') {
    const monster = MONSTER_DECKS[Math.min(game.round, 2)].map((id) => ({ id }));
    return game.players.map((P) => ({
      kind: 'practice',
      sides: [P.idx, null],
      cfg: {
        ...base,
        seed: hashSeed(game.seed, 'battle', game.round, P.idx),
        players: [sideConfig(game, P), { commander: 'merchant', name: '중립 몬스터', deck: monster, opening: [], bot: MONSTER_BOT }],
      },
    }));
  }
  return [{
    kind: 'duel',
    sides: [0, 1],
    cfg: { ...base, seed: hashSeed(game.seed, 'battle', game.round), players: game.players.map((P) => sideConfig(game, P)) },
  }];
}

/**
 * 전투 결과를 반영하고 다음 라운드로 넘어간다.
 * @param {Array<{kind:string, sides:Array<number|null>, state:object}>} battles  roundBattles의 항목에 끝난 전투 state를 붙인 것
 * @returns {object} 이번 라운드 요약 (game.history에도 쌓인다)
 */
export function finishRound(game, battles) {
  const e = game.econ;
  const info = roundInfo(game);
  const summary = { round: game.round, format: info.format, battlefield: info.battlefield, results: [] };

  for (const b of battles) {
    const res = b.state.result;
    if (b.kind === 'practice') {
      const P = game.players[b.sides[0]];
      const won = res.winner === 0;
      let gold = 0;
      if (won) gold += e.practiceWinGold;
      if (won && b.state.players[0].invested) gold += e.investGold;
      P.gold += gold;
      P.stats.earned += gold;
      summary.results.push({ p: P.idx, kind: 'practice', won, damage: 0, gold, timeMs: res.timeMs });
      continue;
    }
    const [A, B] = game.players;
    if (res.winner === -1) {
      const dmg = Math.ceil(info.baseDamage / 2);
      for (const P of [A, B]) {
        P.hp -= dmg;
        P.streak = 0;
        summary.results.push({ p: P.idx, kind: 'duel', won: null, damage: dmg, gold: 0, timeMs: res.timeMs });
      }
    } else {
      const W = game.players[res.winner];
      const L = game.players[1 - res.winner];
      const dmg = info.baseDamage + res.survivors[res.winner];
      L.hp -= dmg;
      W.streak = W.streak > 0 ? W.streak + 1 : 1;
      L.streak = L.streak < 0 ? L.streak - 1 : -1;
      const gold = b.state.players[res.winner].invested ? e.investGold : 0;
      W.gold += gold;
      W.stats.earned += gold;
      summary.results.push({ p: W.idx, kind: 'duel', won: true, damage: 0, gold, timeMs: res.timeMs });
      summary.results.push({ p: L.idx, kind: 'duel', won: false, damage: dmg, gold: 0, timeMs: res.timeMs });
    }
  }
  summary.hp = game.players.map((P) => Math.max(0, P.hp));
  game.history.push(summary);

  const [A, B] = game.players;
  if (A.hp <= 0 || B.hp <= 0) {
    game.phase = 'over';
    game.winner = A.hp === B.hp ? -1 : A.hp > B.hp ? 0 : 1;
    summary.over = true;
    return summary;
  }
  startRound(game);
  return summary;
}
