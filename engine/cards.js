// 카드·지휘관·전장 데이터. 기획서 "카드 예시" 표를 그대로 옮겼다.
// 효과 처리 코드는 battle.js에 있고, 여기는 수치만 둔다.

/** ◆ 효과 이름 (융합으로 옮겨 붙일 수 있는 것) */
export const KEYWORD_NAMES = {
  guard: '수호',
  lifesteal: '흡혈',
  assassin: '암살',
  pierce: '관통',
  split: '분열',
  thorns: '가시',
  rally: '집결',
  frost: '냉기',
  cycle: '순환',
  combo: '연계',
  once: '일회',
  aging: '숙성',
};

/** 유닛에 붙는 ◆ 키워드 */
export const UNIT_DIAMONDS = ['guard', 'lifesteal', 'assassin', 'pierce', 'split', 'thorns', 'rally'];

const unit = (id, name, tier, cost, atk, hp, interval, ranged, extra = {}) => ({
  id, name, type: 'unit', tier, cost, atk, hp, interval, ranged, keywords: [], target: 'slot', ...extra,
});
const card = (id, name, type, tier, cost, target, text, extra = {}) => ({
  id, name, type, tier, cost, target, text, keywords: [], ...extra,
});

export const CARDS = {
  // ── 유닛 ─────────────────────────────────────────────
  shield: unit('shield', '방패병', 1, 1, 2, 14, 1200, false, {
    keywords: ['guard'], diamond: 'guard', text: '◆수호: 인접한 아군이 받는 피해의 20%를 대신 받는다',
  }),
  rats: unit('rats', '쥐 떼', 1, 1, 1, 4, 600, false, {
    keywords: ['split'], diamond: 'split', text: '◆분열: 쓰러지면 능력치가 절반인 복제 2개가 나온다',
  }),
  bat: unit('bat', '흡혈 박쥐', 1, 2, 3, 8, 900, false, {
    keywords: ['lifesteal'], diamond: 'lifesteal', text: '◆흡혈: 준 피해의 30%만큼 회복한다',
  }),
  archer: unit('archer', '견습 궁수', 1, 2, 3, 6, 1000, true, {
    text: '필살기: 다음 공격이 3발로 나간다',
    ult: { kind: 'tripleShot', gaugeAtk: 25, gaugeHit: 10 },
  }),
  dagger: unit('dagger', '그림자 단검', 2, 3, 5, 9, 1100, false, {
    keywords: ['assassin'], diamond: 'assassin', text: '◆암살: 적 후열부터 노린다',
  }),
  frostwitch: unit('frostwitch', '서리 마녀', 2, 3, 3, 10, 1300, true, {
    keywords: ['frost'], text: '냉기: 공격한 대상의 공격 간격 +15% (2초, 2번까지 중첩)',
  }),
  lancer: unit('lancer', '창기병', 3, 4, 6, 18, 1500, false, {
    keywords: ['pierce'], diamond: 'pierce', text: '◆관통: 표적 뒤 칸의 적에게도 50% 피해',
  }),
  pyro: unit('pyro', '화염술사', 4, 5, 4, 16, 1400, true, {
    text: '필살기(전조 1초): 십자 범위 피해 20',
    ult: { kind: 'cross', damage: 20, telegraphMs: 1000, gaugeAtk: 20, gaugeHit: 10 },
  }),
  colossus: unit('colossus', '거신', 5, 8, 10, 60, 2200, false, {
    text: '받는 군중 제어 절반. 필살기(전조 1.2초): 적 전열 전체에 피해 25',
    ccResist: 0.5,
    ult: { kind: 'frontRow', damage: 25, telegraphMs: 1200, gaugeAtk: 20, gaugeHit: 5 },
  }),

  // 보스 레이드의 보스. 풀에는 들어가지 않는다. 패턴은 공개돼 있다: 10초마다 전조 1.5초 뒤 전열 전체를 친다.
  boss: unit('boss', '고대 골렘', 5, 0, 8, 100000, 1500, false, {
    special: true,
    text: '보스. 10초마다 전조 1.5초 뒤 전열 전체에 피해',
    ccResist: 0.5,
    ult: { kind: 'frontRow', damage: 16, telegraphMs: 1500, timerMs: 10000, gaugeAtk: 0, gaugeHit: 0 },
  }),

  // ── 주문 ─────────────────────────────────────────────
  firebolt: card('firebolt', '화염탄', 'spell', 1, 1, 'enemyUnit', '적 유닛 하나에 피해 6. 연계: 피해 10', {
    keywords: ['combo'], damage: 6, comboDamage: 10,
  }),
  retreat: card('retreat', '후퇴', 'spell', 1, 1, 'allyMove', '내 유닛 하나를 빈칸으로 옮기고 체력 5 회복', {
    heal: 5,
  }),
  purify: card('purify', '정화', 'spell', 2, 2, 'enemyUnit', '적 유닛 하나의 강화를 모두 지운다'),
  chain: card('chain', '연쇄 번개', 'spell', 3, 4, 'enemyUnit', '적 유닛 최대 3개에 차례로 피해 10/7/5', {
    chainDamage: [10, 7, 5],
  }),

  // ── 강화 ─────────────────────────────────────────────
  warcry: card('warcry', '전투 함성', 'buff', 1, 2, 'none', '전열 유닛 전체 공격 +2 (6초)', {
    amount: 2, durationMs: 6000,
  }),
  awaken: card('awaken', '각성', 'buff', 2, 3, 'allyUltUnit', '유닛 하나의 필살기 게이지 +60%', {
    amount: 60,
  }),
  armor: card('armor', '강철 갑옷', 'buff', 2, 3, 'allyUnit', '유닛 하나 체력 +12, 그 유닛이 쓰러질 때까지', {
    amount: 12,
  }),
  phalanx: card('phalanx', '방진', 'buff', 3, 4, 'none', '내 후열 전체가 3초간 받는 범위 피해 50% 감소', {
    amount: 0.5, durationMs: 3000,
  }),

  // ── 운영 ─────────────────────────────────────────────
  scout: card('scout', '정찰', 'ops', 1, 0, 'none', '카드 2장 뽑기. 일회', {
    keywords: ['once'], draw: 2,
  }),
  crystal: card('crystal', '마나 결정', 'ops', 1, 1, 'none', '마나 +3. 숙성', {
    keywords: ['aging'], amount: 3,
  }),
  supply: card('supply', '보급선', 'ops', 2, 2, 'none', '다음에 내는 유닛 2장의 비용 −1. ◆순환', {
    keywords: ['cycle'], diamond: 'cycle', count: 2, amount: 1,
  }),
  muster: card('muster', '징집령', 'ops', 3, 3, 'none', '덱에서 비용이 가장 낮은 유닛 카드 2장을 손패로 가져온다', {
    count: 2,
  }),
  stockpile: card('stockpile', '비축', 'ops', 3, 2, 'none', '이번 전투의 마나 최대치 +1. 일회', {
    keywords: ['once'], amount: 1,
  }),

  // ── 지휘관 고유 카드 ─────────────────────────────────
  invest: card('invest', '투자', 'ops', 1, 2, 'none', '이번 전투에서 이기면 골드 +3. 일회', {
    keywords: ['once'], commanderCard: 'merchant', duelInert: true,
  }),
  catalyst: card('catalyst', '촉매', 'ops', 1, 1, 'handFused', '손패의 융합 카드 하나의 비용이 0이 된다', {
    commanderCard: 'alchemist',
  }),
  disrupt: card('disrupt', '교란', 'spell', 2, 3, 'enemyUnit', '적 유닛 하나를 2초간 침묵', {
    commanderCard: 'spy', durationMs: 2000,
  }),
  decree: card('decree', '포고', 'ops', 2, 3, 'column', '이번 난전에서 내 칸 하나의 표적 방향을 바꾼다', {
    commanderCard: 'lord', duelInert: true, meleeOnly: true,
  }),
};

/** 공용 풀에 들어가는 카드 (지휘관 고유 카드 제외) */
export const POOL_CARD_IDS = Object.values(CARDS).filter((c) => !c.commanderCard && !c.special).map((c) => c.id);

/** 등급별 풀 장수 */
export const COPIES_BY_TIER = { 1: 12, 2: 10, 3: 8, 4: 6, 5: 4 };

export const COMMANDERS = {
  general: {
    id: 'general', name: '장군', passive: '전열 유닛 체력 +10%', card: 'phalanx',
    deck: ['shield', 'shield', 'shield', 'lancer', 'lancer', 'archer', 'warcry', 'phalanx'],
    fusions: 3,
  },
  merchant: {
    id: 'merchant', name: '상인', passive: '라운드당 골드 +1, 라운드 첫 리롤 무료', card: 'invest',
    deck: ['rats', 'rats', 'shield', 'bat', 'archer', 'scout', 'crystal', 'invest'],
    fusions: 3,
  },
  alchemist: {
    id: 'alchemist', name: '연금술사', passive: '융합 5회, 융합 카드 비용 −1', card: 'catalyst',
    deck: ['firebolt', 'firebolt', 'archer', 'archer', 'shield', 'scout', 'crystal', 'catalyst'],
    fusions: 5,
  },
  spy: {
    id: 'spy', name: '첩보원', passive: '상대가 고른 시작 카드를 미리 본다, 시그니처 칸 2개', card: 'disrupt',
    seesOpening: true,
    signatureSlots: 2,
    deck: ['dagger', 'dagger', 'bat', 'shield', 'firebolt', 'firebolt', 'retreat', 'disrupt'],
    fusions: 3,
  },
  lord: {
    id: 'lord', name: '군주', passive: '난전 형식에서 받는 HP 피해 −30% (1:1에는 영향 없음)', card: 'decree',
    deck: ['shield', 'shield', 'lancer', 'bat', 'archer', 'armor', 'warcry', 'decree'],
    fusions: 3,
  },
};

export const COMMANDER_IDS = Object.keys(COMMANDERS);

/** 전장 효과. '축제'는 전개 카드가 아직 없어서 넣지 않았다. */
export const BATTLEFIELDS = {
  rain: { id: 'rain', name: '폭우', text: '원거리 유닛의 공격 간격 +20%' },
  canyon: { id: 'canyon', name: '좁은 협곡', text: '전열이 가운데 2칸으로 줄어든다' },
  fog: { id: 'fog', name: '안개', text: '처음 5초 동안 후열 유닛은 표적이 되지 않는다' },
  citadel: { id: 'citadel', name: '성채', text: '전열 유닛 체력 +20%' },
  surge: { id: 'surge', name: '마력 폭주', text: '필살기 게이지 충전 +50%' },
  volcano: { id: 'volcano', name: '화산', text: '10초마다 모든 유닛이 최대 체력의 5% 피해를 받는다' },
};

export const BATTLEFIELD_IDS = Object.keys(BATTLEFIELDS);

/** 카드 한 장(별·융합 포함)의 표시 이름 */
export function cardLabel(inst) {
  const def = CARDS[inst.id];
  let s = def.name;
  if (inst.fuse) s = `${KEYWORD_NAMES[inst.fuse]} ${s}`;
  if ((inst.stars || 1) > 1) s += '★'.repeat(inst.stars);
  return s;
}
