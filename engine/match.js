// 봇 대 봇 한 판을 끝까지 돌린다. 시뮬레이터와 테스트가 같이 쓴다.

import { createBattle, step, applyAction } from './battle.js';
import { createBot } from './bot.js';
import { pickVanguard, pickOpening } from './decks.js';
import { hashSeed, makeRng } from './rng.js';
import { DEFAULT_RULES } from './rules.js';

/**
 * @param {object} cfg
 * @param {number} cfg.seed
 * @param {Array<{commander:string, deck:Array, bot?:object, vanguard?:Array, seed?:number,
 *   opening?:number[], openingPolicy?:string, bonus?:object}>} cfg.players
 * @param {string|null} [cfg.battlefield]
 * @param {object} [cfg.rules]
 * @param {(state:object)=>void} [cfg.onTick]  틱마다 불린다 (중간 상태를 재고 싶을 때)
 * @param {boolean} [cfg.logEvents]
 * @returns {{state:object, result:object, rejected:number}}
 */
export function runBattle(cfg) {
  const R = { ...DEFAULT_RULES, ...(cfg.rules || {}) };
  const state = createBattle({
    seed: cfg.seed,
    battlefield: cfg.battlefield,
    rules: cfg.rules,
    logEvents: cfg.logEvents === true,
    players: cfg.players.map((pc, i) => ({
      commander: pc.commander,
      deck: pc.deck,
      seed: pc.seed,
      bonus: pc.bonus,
      vanguard: pc.vanguard ?? pickVanguard(pc.deck, R.vanguardSlots, { maxCost: R.vanguardMaxCost }),
      opening: pc.opening ?? pickOpening(
        pc.deck,
        R.openingPicks + ((pc.bonus && pc.bonus.openingPicks) || 0),
        pc.openingPolicy || 'tempo',
        makeRng(hashSeed(cfg.seed, 'opening', i)),
        R.startMana + ((pc.bonus && pc.bonus.startMana) || 0),
      ),
    })),
  });
  const bots = cfg.players.map((pc, i) => createBot({ seed: hashSeed(cfg.seed, 'bot', i), ...(pc.bot || {}) }));
  let rejected = 0;
  const maxTicks = Math.ceil(state.rules.battleMs / state.rules.tickMs) + 10;
  for (let i = 0; i < maxTicks && !state.over; i++) {
    // 두 봇이 같은 순간의 상태를 보고 판단한 뒤에 차례로 적용한다
    const actions = bots.map((bot, p) => bot.decide(state, p));
    actions.forEach((a, p) => {
      if (a && !applyAction(state, p, a).ok) rejected++;
    });
    step(state);
    if (cfg.onTick) cfg.onTick(state);
  }
  return { state, result: state.result, rejected };
}
