// 봇 성격: 좋아하는 지휘관, 상점 성향, 좋아하는 카드, 전투에서의 버릇.
// 상점 봇(shopbot.js)과 전투 봇(fieldbot.js)이 이 값을 읽는다. 규칙(엔진)에는 아무 영향이 없다.
//
// likes: 카드마다 더하는 점수. 상점·드래프트·픽에서는 그대로, 전투에서는 절반만 더한다.
// battle: 전투 봇 옵션에 덮어쓴다.
//   unitBias / spellBias  유닛 카드 / 그 밖의 카드 점수에 더한다
//   front                 근접 유닛을 놓을 줄: +면 더 앞으로, −면 본진 가까이
//   saveMs                더 좋은 카드를 위해 마나를 모으며 기다리는 시간 (0이면 안 모은다)

import { BOT_LEVELS } from './fieldbot.js';

export const PERSONAS = Object.freeze({
  rusher: {
    name: '돌격대장',
    text: '싼 근접 유닛을 쏟아붓고 앞으로 밀어붙인다. 마나를 모으지 않는다',
    commanders: ['general', 'lord'],
    shop: 'spend',
    likes: { rats: 3, bat: 3, banner: 3, bomber: 2, dagger: 2, shield: 1, warcry: 3, colossus: -3, pyro: -2, stockpile: -3 },
    battle: { unitBias: 2, front: 2, saveMs: 0 },
  },
  wall: {
    name: '철벽',
    text: '튼튼한 유닛으로 본진 앞을 지키고 갑옷을 두른다',
    commanders: ['general', 'lord'],
    shop: 'balanced',
    likes: { shield: 3, turtle: 3, hammer: 2, armor: 3, phalanx: 2, retreat: 2, rats: -2, dagger: -2 },
    battle: { front: -3 },
  },
  caster: {
    name: '주문술사',
    text: '화염탄·번개·눈보라로 적 유닛을 지운다',
    commanders: ['alchemist', 'spy'],
    shop: 'balanced',
    likes: { firebolt: 3, chain: 3, blizzard: 3, purify: 2, crystal: 2, awaken: 1, rats: -2, turtle: -1 },
    battle: { spellBias: 3 },
  },
  sniper: {
    name: '저격수',
    text: '궁수·마녀·화염술사를 방패병 뒤에 세워 멀리서 쏜다',
    commanders: ['alchemist', 'spy'],
    shop: 'balanced',
    likes: { archer: 3, frostwitch: 3, pyro: 3, shield: 2, awaken: 2, dagger: -2, bomber: -2 },
    battle: { front: -1 },
  },
  big: {
    name: '큰손',
    text: '창기병·망치 기사·거신 같은 비싼 유닛을 모아서 한 번에 낸다',
    commanders: ['merchant', 'alchemist'],
    shop: 'eco',
    likes: { lancer: 3, hammer: 3, pyro: 2, colossus: 3, supply: 2, crystal: 2, rats: -3, bat: -1 },
    battle: { saveMs: 4500, front: 1 },
  },
  trader: {
    name: '장사꾼',
    text: '골드와 카드를 굴린다. 정찰·보급선·징집령으로 손패를 채운다',
    commanders: ['merchant'],
    shop: 'eco',
    likes: { scout: 3, supply: 3, muster: 3, crystal: 2, stockpile: 2 },
    battle: {},
  },
});

export const PERSONA_IDS = Object.keys(PERSONAS);

/** 성격이 좋아하는 카드 점수 (성격이 없으면 0) */
export function likeOf(persona, id) {
  const P = persona && PERSONAS[persona];
  return (P && P.likes[id]) || 0;
}

/** 성격에 맞는 지휘관: 70%는 좋아하는 지휘관 중에서, 나머지는 아무나 */
export function personaCommander(rng, persona, all) {
  const P = PERSONAS[persona];
  if (P && rng() < 0.7) return rng.pick(P.commanders);
  return rng.pick(all);
}

/** 전투 봇 옵션: 난이도 위에 성격의 버릇과 좋아하는 카드를 얹는다 */
export function personaBot(level = 'normal', persona = null) {
  const P = persona && PERSONAS[persona];
  return { ...BOT_LEVELS[level], ...(P ? { ...P.battle, likes: P.likes } : {}) };
}

/**
 * 한 라운드의 전투 목록(roundBattles)에서 플레이어(와 그 유령) 자리에 전투 봇을 정해 준다.
 * 중립 몬스터·보스처럼 이미 봇이 정해진 자리는 그대로 둔다.
 * @param {(p:number)=>string} levelOf  플레이어 번호 → 난이도
 */
export function assignBattleBots(game, battles, levelOf = () => 'normal') {
  for (const b of battles) {
    b.cfg.players.forEach((pc, i) => {
      if (pc.bot || pc.boss) return;
      const who = b.sides[i] ?? b.ghosts[i];
      if (who === null || who === undefined) return;
      pc.bot = personaBot(levelOf(who), game.players[who].persona);
    });
  }
  return battles;
}
