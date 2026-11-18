// 한 경기(1:1 또는 8인): 사전 선택 → [상점 → 전투] 반복 → 한 명이 남으면 끝.
// 여기에는 상점·경제·라운드 진행만 있고, 전투는 유닛 전투(field.js)가 맡는다.
// 난수는 상점에 무엇이 뜨는지에만 쓴다. 같은 시드와 같은 행동이면 결과도 같다.

import { makeRng, hashSeed } from './rng.js';
import { CARDS, COMMANDERS, POOL_CARD_IDS, COPIES_BY_TIER, BATTLEFIELD_IDS, UNIT_DIAMONDS } from './cards.js';
import { SHOP_ODDS } from './decks.js';
import { DEFAULT_RULES } from './rules.js';
import { runFieldBattle } from './fieldbot.js';
import { FIELD_RULES } from './field.js';

/** 게임 모드. 인원과 HP·픽 수가 다르다. */
export const MODES = Object.freeze({
  duel: { name: '1:1 랭크', players: 2, econ: { playerHp: 40, picks: 8 } },
  // 8인은 기획서 목표(약 15라운드)에 맞춰 피해가 빨리 오른다: 기본 피해 3에서 라운드마다 +1(최대 20), 남은 유닛 한 기당 3
  rank8: { name: '8인 랭크', players: 8, econ: { playerHp: 100, picks: 5, damageMin: 3, damageEvery: 1, damageMax: 20, survivorDamage: 3 } },
});

/** 8인 로테이션 (기획서 예시). 1~2라운드는 연습, 15라운드부터는 남은 인원에 맞춘다. */
export const ROTATION = Object.freeze({
  3: 'duel', 4: 'duel', 5: 'melee4', 6: 'duel', 7: 'alliance', 8: 'duel', 9: 'boss',
  10: 'melee4', 11: 'duel', 12: 'melee4', 13: 'duel', 14: 'melee4',
});

export const FORMAT_SIZE = Object.freeze({ duel: 2, melee4: 4, alliance: 4 });

/** 난전에서 순위별로 받는 피해 비율 (결투 피해 기준) */
export const MELEE_DAMAGE = Object.freeze({ melee4: [0, 0.3, 0.7, 1] });

export const DEFAULT_ECON = Object.freeze({
  // 아래 두 값은 모드(MODES)가 덮어쓴다
  playerHp: 40,
  picks: 8, // 사전에 고르는 픽 카드 수

  // 보스 레이드 보상: 순위 상위 25%는 카드 4장 중 1장 + 5골드, 그다음 37.5%는 3장 중 1장, 나머지는 2골드
  bossTop: { share: 0.25, options: 4, gold: 5 },
  bossMid: { share: 0.625, options: 3, gold: 0 },
  bossLowGold: 2,
  lordMeleeDamage: 0.7, // 군주: 난전에서 받는 HP 피해 −30%
  maxTier5Picks: 1,
  pickCopyBonus: 0.5, // 누가 고른 카드는 한 명당 풀 장수 +50%

  // 시작 덱 드래프트: 지휘관 고유 카드 1장 + 3장 중 1장 고르기를 7번
  // 후보 한 장은 내 픽에서, 나머지는 공용 풀(중립 카드 + 모두의 픽) 전체에서 뜬다.
  draftPicks: 7,
  draftOptions: 3,
  draftOdds: [60, 30, 10, 0, 0], // 등급 1~5가 뜰 확률(%)

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
  damageEvery: 2, // 기본 피해가 1 오르는 라운드 간격
  survivorDamage: 1, // 남은 유닛 한 기당 피해
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
 * @param {Array<{commander:string, picks:string[], name?:string}>} cfg.players  2~8명
 * @param {'duel'|'rank8'} [cfg.mode]  기본: 2명이면 duel, 그보다 많으면 rank8
 * @param {'draft'|'commander'} [cfg.startDecks]  시작 덱을 정하는 방법. 기본은 draft.
 *   draft: 지휘관 고유 카드 1장만 들고 시작해서 draftPick으로 나머지를 고른다 (다 고르면 1라운드 상점이 열린다).
 *   commander: 지휘관마다 정해진 시작 덱 8장 (예전 방식)
 * @param {object} [cfg.econ]         DEFAULT_ECON에 덮어쓸 값
 * @param {object} [cfg.battleRules]  전투 규칙(FIELD_RULES)에 덮어쓸 값
 */
export function createGame(cfg) {
  const mode = cfg.mode || (cfg.players.length === 2 ? 'duel' : 'rank8');
  const econ = { ...DEFAULT_ECON, ...MODES[mode].econ, ...(cfg.econ || {}) };
  const seed = (cfg.seed ?? 1) >>> 0;
  const game = {
    seed,
    mode,
    startDecks: cfg.startDecks || 'draft',
    econ,
    groups: [], // 이번 라운드의 조 편성 (상점 단계에서 미리 공개)
    eliminated: [], // 탈락한 순서
    placements: [], // 경기가 끝나면 1위부터
    // 한 경기에서는 선봉이 없고, 고르는 시작 카드 장수는 상점 레벨이 정한다.
    // FIELD_RULES가 기본이라 덮어쓸 값만 둔다. 고르는 시작 카드 장수는 상점 레벨이 정한다.
    battleRules: { ...(cfg.battleRules || {}), openingPicks: 0 },
    round: 0,
    phase: 'shop', // 'draft' | 'shop' | 'over'
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
      alive: true,
      place: null,
      eliminatedRound: null,
      ghost: null, // 탈락할 때의 덱 (유령 보드용)
      reward: null, // 보스 보상으로 고를 카드 { options: [id] }
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
    P.deck = game.startDecks === 'draft' ? [newCard(game, c.card, 'start')] : c.deck.map((id) => newCard(game, id, 'start'));
    P.draft = null;
    game.players.push(P);
  });

  if (game.startDecks === 'draft' && econ.draftPicks > 0) {
    game.phase = 'draft';
    for (const P of game.players) {
      P.draft = { left: econ.draftPicks, options: [] };
      rollDraftOptions(game, P);
    }
  } else startRound(game);
  return game;
}

function newCard(game, id, origin) {
  // parts: 이 카드에 들어간 "풀에서 온 카드"들. 덱에서 빼면 전부 풀로 돌아간다.
  return { key: game.nextKey++, id, stars: 1, fuse: null, origin, parts: origin === 'pool' ? [id] : [] };
}

// ─────────────────────────────────────────────────────────────
// 조회
// ─────────────────────────────────────────────────────────────

/** 이 경기의 전투에 실제로 적용되는 규칙 전체 (카드 수치를 보여 줄 때 쓴다) */
export function fullBattleRules(game) {
  return { ...DEFAULT_RULES, ...FIELD_RULES, ...game.battleRules };
}

export function aliveCount(game) {
  return game.players.filter((P) => P.alive).length;
}

/** 이 라운드의 전투 형식 */
export function formatOf(game, round = game.round) {
  const e = game.econ;
  if (round <= e.practiceRounds) return 'practice';
  const alive = aliveCount(game);
  if (game.mode === 'duel' || alive <= 2) return 'duel';
  const scheduled = ROTATION[round] || (round % 2 === 1 ? 'duel' : 'melee4'); // 15라운드부터 결투와 난투장을 번갈아
  if (scheduled === 'boss') return 'boss';
  if (alive === 3) return 'duel'; // 3명이 남으면 매 라운드 결투 (한 명은 유령 보드와 붙는다)
  return scheduled;
}

/** 이번 라운드의 형식·전장·기본 피해. 상점 단계에서 미리 공개된다. */
export function roundInfo(game, round = game.round) {
  const e = game.econ;
  const format = formatOf(game, round);
  const quiet = format === 'practice' || format === 'boss'; // 전장 효과도 HP 피해도 없다
  const n = round - e.practiceRounds;
  return {
    round,
    format,
    battlefield: quiet ? null : makeRng(hashSeed(game.seed, 'field', round)).pick(BATTLEFIELD_IDS),
    baseDamage: quiet ? 0 : Math.min(e.damageMax, e.damageMin + Math.floor((n - 1) / e.damageEvery)),
  };
}

/** 이번 라운드에 p가 속한 조 */
export function groupOf(game, p) {
  return game.groups.find((g) => g.some((m) => m.p === p)) || null;
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
  if (!P.alive) return fail('탈락했다');
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
  // 탈락한 플레이어의 카드는 풀로 돌아갔으므로 세지 않는다
  for (const P of game.players) if (P.alive) for (const c of P.deck) n += c.parts.length;
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
    if (!P.alive) continue;
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
  game.groups = makeGroups(game);
}

/**
 * 조 편성. 살아 있는 플레이어를 섞어 형식의 인원수대로 나누고, 모자란 자리는 유령 보드로 채운다.
 * 유령은 가장 최근에 탈락한 플레이어의 마지막 덱이고, 탈락자가 없으면 다른 조의 플레이어를 복제한다.
 * 조원: { p: 플레이어 번호 | null, ghostOf: 복제한 플레이어 번호 | null }
 */
function makeGroups(game) {
  const format = formatOf(game);
  const alive = game.players.filter((P) => P.alive).map((P) => P.idx);
  const size = FORMAT_SIZE[format];
  if (!size) return alive.map((p) => [{ p, ghostOf: null }]); // 연습·보스: 각자
  const rng = makeRng(hashSeed(game.seed, 'groups', game.round));
  // 둘만 남으면 번호 순서 그대로 (섞을 필요가 없다)
  const order = alive.length <= 2 ? alive : rng.shuffle([...alive]);
  const groups = [];
  for (let i = 0; i < order.length; i += size) groups.push(order.slice(i, i + size).map((p) => ({ p, ghostOf: null })));
  const last = groups[groups.length - 1];
  const recent = [...game.eliminated].reverse();
  while (last.length < size) {
    const used = last.map((m) => m.ghostOf ?? m.p);
    let src = recent.find((q) => !used.includes(q));
    if (src === undefined) {
      const others = alive.filter((q) => !used.includes(q));
      src = others.length ? rng.pick(others) : (recent[0] ?? alive[0]);
    }
    last.push({ p: null, ghostOf: src });
  }
  return groups;
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
  return rollTierFrom(rng, SHOP_ODDS[level]);
}

function rollTierFrom(rng, odds) {
  let x = rng() * 100;
  for (let i = 0; i < odds.length; i++) {
    x -= odds[i];
    if (x < 0) return i + 1;
  }
  return 1;
}

function rollSlot(game, P, signature, odds = null) {
  const tier = odds ? rollTierFrom(P.rng, odds) : rollTier(P.rng, P.level);
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
// 시작 덱 드래프트
// ─────────────────────────────────────────────────────────────

/** 드래프트 후보: 첫 장은 내 픽에서, 나머지는 공용 풀 전체에서. 되도록 서로 다른 카드가 뜬다. */
function rollDraftOptions(game, P) {
  const e = game.econ;
  const out = [];
  for (let i = 0; i < e.draftOptions; i++) {
    let pick = null;
    for (let tries = 0; tries < 8; tries++) {
      const s = rollSlot(game, P, i === 0, e.draftOdds);
      if (!s) break;
      pick = s.id;
      if (!out.includes(pick)) break;
    }
    if (pick) out.push(pick);
  }
  P.draft.options = out;
}

/** 드래프트 후보 중 하나를 시작 덱에 넣는다. 모두가 다 고르면 1라운드 상점이 열린다. */
export function draftPick(game, p, index) {
  if (game.phase !== 'draft') return fail('드래프트 단계가 아니다');
  const P = game.players[p];
  if (!P.draft || P.draft.left <= 0) return fail('이미 다 골랐다');
  const id = P.draft.options[index];
  if (!id) return fail('고를 수 없는 카드');
  if (game.pool[id] <= 0) {
    rollDraftOptions(game, P); // 다른 사람이 먼저 다 가져갔다
    return fail('품절');
  }
  game.pool[id]--;
  const c = newCard(game, id, 'pool');
  P.deck.push(c);
  P.draft.left--;
  if (P.draft.left > 0) rollDraftOptions(game, P);
  else P.draft.options = [];
  if (game.players.every((Q) => Q.draft.left <= 0)) startRound(game);
  return { ok: true, card: c };
}

// ─────────────────────────────────────────────────────────────
// 상점 행동
// ─────────────────────────────────────────────────────────────

const inShop = (game, p) => {
  if (game.phase !== 'shop') return fail('상점 단계가 아니다');
  if (p !== undefined && !game.players[p].alive) return fail('탈락했다');
  return OK;
};

export function buy(game, p, slot) {
  const chk = inShop(game, p);
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
  const chk = inShop(game, p);
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
  const chk = inShop(game, p);
  if (!chk.ok) return chk;
  const P = game.players[p];
  P.locked = !P.locked;
  return OK;
}

export function buyXp(game, p) {
  const chk = inShop(game, p);
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
  const chk = inShop(game, p);
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
  const chk = inShop(game, p);
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

/** 유령 보드: 탈락자는 마지막 덱, 살아 있는 플레이어는 지금 덱을 복제한다. 봇이 대신 싸운다. */
function ghostConfig(game, q) {
  const Q = game.players[q];
  const base = Q.alive ? sideConfig(game, Q) : Q.ghost;
  return { ...base, name: `${Q.name}의 유령` };
}

/**
 * 이번 라운드에 치를 전투 목록 (game.groups 순서).
 *   kind: 'practice' | 'boss' | 'duel' | 'melee4' | 'alliance'
 *   sides: 전투의 자리마다 플레이어 번호. 유령·중립 몬스터·보스 자리는 null.
 *   ghosts: 자리마다 복제한 플레이어 번호 (유령이 아니면 null)
 * 봇끼리 돌릴 때는 runRoundBattle(b)에 넘기고, 직접 띄울 때는 cfg를 Field.createField에 그대로 넘긴다.
 * 연합전은 앞의 두 자리와 뒤의 두 자리가 한 팀이다.
 */
export function runRoundBattle(b) {
  return runFieldBattle(b.cfg);
}

export function roundBattles(game) {
  const info = roundInfo(game);
  const base = { battlefield: info.battlefield, rules: game.battleRules, stakes: true };
  return game.groups.map((group, gi) => {
    const first = group[0].p;
    if (info.format === 'practice') {
      const monster = MONSTER_DECKS[Math.min(game.round, 2)].map((id) => ({ id }));
      return {
        kind: 'practice',
        sides: [first, null],
        ghosts: [null, null],
        cfg: {
          ...base,
          seed: hashSeed(game.seed, 'battle', game.round, first),
          players: [sideConfig(game, game.players[first]), { commander: 'merchant', name: '중립 몬스터', deck: monster, opening: [], bot: MONSTER_BOT }],
        },
      };
    }
    if (info.format === 'boss') {
      return {
        kind: 'boss',
        sides: [first, null],
        ghosts: [null, null],
        cfg: {
          ...base,
          format: 'boss',
          // 모두 같은 보스와 싸우므로 시드에는 라운드만 넣는다 (덱 섞기는 플레이어 자리마다 다르다)
          seed: hashSeed(game.seed, 'battle', game.round, first),
          players: [sideConfig(game, game.players[first]), { commander: 'merchant', name: '고대 골렘', deck: [], opening: [], boss: true }],
        },
      };
    }
    return {
      kind: info.format,
      sides: group.map((m) => m.p),
      ghosts: group.map((m) => m.ghostOf),
      cfg: {
        ...base,
        format: info.format,
        seed: hashSeed(game.seed, 'battle', game.round, gi),
        players: group.map((m) => (m.p !== null ? sideConfig(game, game.players[m.p]) : ghostConfig(game, m.ghostOf))),
      },
    };
  });
}

function addGold(P, gold) {
  P.gold += gold;
  P.stats.earned += gold;
}

function bumpStreak(P, won) {
  if (won === true) P.streak = P.streak > 0 ? P.streak + 1 : 1;
  else if (won === false) P.streak = P.streak < 0 ? P.streak - 1 : -1;
}

/** 보스 보상으로 고를 카드 후보: 상점과 같은 등급 확률로, 서로 다른 카드 n장 */
function rollRewardOptions(game, P, n) {
  const out = [];
  for (let tries = 0; tries < n * 6 && out.length < n; tries++) {
    const s = rollSlot(game, P, false);
    if (s && !out.includes(s.id)) out.push(s.id);
  }
  return out;
}

/** 보스 보상 카드를 받는다 (무료). 덱이 가득 찼거나 품절이면 받을 수 없다. */
export function claimReward(game, p, index) {
  const P = game.players[p];
  if (!P.reward) return fail('받을 보상이 없다');
  const id = P.reward.options[index];
  if (!id) return fail('고를 수 없는 카드');
  if (P.deck.length >= game.econ.deckMax) return fail(`덱은 최대 ${game.econ.deckMax}장`);
  if (game.pool[id] <= 0) return fail('품절');
  game.pool[id]--;
  const c = newCard(game, id, 'pool');
  P.deck.push(c);
  P.reward = null;
  return { ok: true, card: c };
}

export function skipReward(game, p) {
  game.players[p].reward = null;
  return OK;
}

/**
 * 전투 결과를 반영하고 다음 라운드로 넘어간다.
 * @param {Array<{kind:string, sides:Array<number|null>, state:object}>} battles  roundBattles의 항목에 끝난 전투 state를 붙인 것
 * @returns {object} 이번 라운드 요약 (game.history에도 쌓인다)
 */
export function finishRound(game, battles) {
  const e = game.econ;
  const info = roundInfo(game);
  const summary = { round: game.round, format: info.format, battlefield: info.battlefield, results: [], groups: game.groups };
  const out = (r) => summary.results.push(r);
  const hit = (P, damage) => {
    P.hp -= damage;
    return damage;
  };

  battles.forEach((b, gi) => {
    const res = b.state.result;
    const bs = b.state.players; // 전투 안의 플레이어 (자리 순서)

    if (b.kind === 'practice') {
      const P = game.players[b.sides[0]];
      const won = res.winner === 0;
      let gold = 0;
      if (won) gold += e.practiceWinGold;
      if (won && bs[0].invested) gold += e.investGold;
      addGold(P, gold);
      out({ p: P.idx, kind: 'practice', group: gi, won, damage: 0, gold, timeMs: res.timeMs });
      return;
    }

    if (b.kind === 'boss') {
      const P = game.players[b.sides[0]];
      out({ p: P.idx, kind: 'boss', group: gi, won: null, damage: 0, gold: 0, timeMs: res.timeMs, bossDamage: res.bossDamage[0] });
      return;
    }

    if (b.kind === 'duel') {
      if (res.winner === -1) {
        const dmg = Math.ceil(info.baseDamage / 2);
        b.sides.forEach((p) => {
          if (p === null) return; // 유령은 피해를 받지 않는다
          const P = game.players[p];
          hit(P, dmg);
          P.streak = 0;
          out({ p, kind: 'duel', group: gi, won: null, damage: dmg, gold: 0, timeMs: res.timeMs });
        });
        return;
      }
      const w = res.winner;
      const l = 1 - w;
      const dmg = info.baseDamage + Math.round(res.survivors[w] * e.survivorDamage);
      if (b.sides[w] !== null) {
        const W = game.players[b.sides[w]];
        bumpStreak(W, true);
        const gold = bs[w].invested ? e.investGold : 0;
        addGold(W, gold);
        out({ p: W.idx, kind: 'duel', group: gi, won: true, damage: 0, gold, timeMs: res.timeMs });
      }
      if (b.sides[l] !== null) {
        const L = game.players[b.sides[l]];
        hit(L, dmg);
        bumpStreak(L, false);
        out({ p: L.idx, kind: 'duel', group: gi, won: false, damage: dmg, gold: 0, timeMs: res.timeMs });
      }
      return;
    }

    if (b.kind === 'alliance') {
      // 진 팀의 두 명이 각자 결투 피해의 절반을 받는다. 남은 유닛은 이긴 팀 전원의 것을 센다.
      const teamOf = (i) => Math.floor(i / 2);
      const wt = res.winnerTeam;
      const winnersUnits = wt < 0 ? 0 : res.survivors.reduce((sum, n, i) => (teamOf(i) === wt ? sum + n : sum), 0);
      b.sides.forEach((p, i) => {
        if (p === null) return;
        const P = game.players[p];
        const won = wt < 0 ? null : teamOf(i) === wt;
        let dmg = 0;
        if (won === null) dmg = Math.ceil(info.baseDamage / 4);
        else if (!won) dmg = Math.ceil((info.baseDamage + winnersUnits * e.survivorDamage) / 2);
        hit(P, dmg);
        if (won === null) P.streak = 0;
        else bumpStreak(P, won);
        const gold = won && bs[i].invested ? e.investGold : 0;
        addGold(P, gold);
        out({ p, kind: 'alliance', group: gi, won, damage: dmg, gold, timeMs: res.timeMs, rank: res.ranks[i], team: teamOf(i) });
      });
      return;
    }

    // 난전: 순위에 따라 결투 피해의 일부를 받는다. 남은 유닛은 살아남은 상대 전원의 것을 센다.
    const pctTable = MELEE_DAMAGE[b.kind];
    const lastRank = Math.max(...res.ranks);
    b.sides.forEach((p, i) => {
      if (p === null) return;
      const P = game.players[p];
      const rank = res.ranks[i];
      const foes = res.survivors.reduce((sum, n, j) => (j !== i && !bs[j].dead ? sum + n : sum), 0);
      let dmg = Math.ceil((info.baseDamage + foes * e.survivorDamage) * pctTable[rank]);
      if (P.commander === 'lord') dmg = Math.ceil(dmg * e.lordMeleeDamage);
      hit(P, dmg);
      const won = rank === 0 ? true : rank === lastRank ? false : null;
      bumpStreak(P, won);
      const gold = rank === 0 && bs[i].invested ? e.investGold : 0;
      addGold(P, gold);
      out({ p, kind: b.kind, group: gi, won, damage: dmg, gold, timeMs: res.timeMs, rank });
    });
  });

  // 보스 레이드: 보스에게 준 피해 순위로 보상
  if (info.format === 'boss') {
    const ranked = summary.results.filter((r) => r.kind === 'boss').sort((a, b) => b.bossDamage - a.bossDamage || a.p - b.p);
    const n = ranked.length;
    ranked.forEach((r, i) => {
      const P = game.players[r.p];
      r.rank = i;
      if (i < Math.ceil(n * e.bossTop.share)) {
        P.reward = { options: rollRewardOptions(game, P, e.bossTop.options) };
        r.gold = e.bossTop.gold;
      } else if (i < Math.ceil(n * e.bossMid.share)) {
        P.reward = { options: rollRewardOptions(game, P, e.bossMid.options) };
        r.gold = e.bossMid.gold;
      } else {
        r.gold = e.bossLowGold;
      }
      r.rewardOptions = P.reward ? P.reward.options.length : 0;
      addGold(P, r.gold);
    });
  }

  // 탈락: 이번 라운드에 HP가 0이 된 플레이어. 여럿이면 HP가 더 많이 남은 쪽이 순위가 높다.
  const before = game.players.filter((P) => P.alive);
  const out0 = before.filter((P) => P.hp <= 0).sort((A, B) => B.hp - A.hp || A.idx - B.idx);
  const survivors = before.length - out0.length;
  out0.forEach((P, i) => {
    P.place = survivors + 1 + i;
    P.eliminatedRound = game.round;
    P.ghost = sideConfig(game, P);
    P.alive = false;
    P.reward = null;
    for (const c of P.deck) for (const id of c.parts) game.pool[id]++; // 카드는 풀로 돌아간다 (덱 목록은 기록으로 남긴다)
    game.eliminated.push(P.idx);
  });
  summary.hp = game.players.map((P) => Math.max(0, P.hp));
  summary.eliminated = out0.map((P) => P.idx);
  game.history.push(summary);

  if (survivors <= 1) {
    const left = game.players.find((P) => P.alive);
    if (left) left.place = 1;
    game.phase = 'over';
    game.placements = [...game.players].sort((A, B) => A.place - B.place || A.idx - B.idx).map((P) => P.idx);
    // 마지막 남은 사람이 이긴다. 남은 사람들이 한꺼번에 쓰러졌으면 HP가 더 많이 남은 쪽, 그것도 같으면 무승부(-1).
    if (left) game.winner = left.idx;
    else game.winner = out0.length >= 2 && out0[0].hp === out0[1].hp ? -1 : out0[0].idx;
    summary.over = true;
    return summary;
  }
  startRound(game);
  return summary;
}
