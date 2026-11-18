// 카드·지휘관·전장 데이터. 기획서 "카드 예시" 표에서 시작해서, 유닛 소환 전투에 맞게 설명을 고치고 카드를 몇 장 더했다.
// 효과 처리 코드는 field.js에 있고, 여기는 수치만 둔다. 사거리·속도·몸집은 field.js의 FIELD_STATS에 있다.

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
  lastwords: '유언',
  knockback: '넉백',
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
  shield: unit('shield', '방패병', 1, 1, 2, 9, 1200, false, {
    keywords: ['guard'], diamond: 'guard', text: '◆수호: 가까이 있는 아군이 받는 피해의 20%를 대신 받는다',
  }),
  rats: unit('rats', '쥐 떼', 1, 1, 1, 4, 600, false, {
    keywords: ['split'], diamond: 'split', text: '◆분열: 쓰러지면 능력치가 절반인 복제 2개가 나온다',
  }),
  bat: unit('bat', '흡혈 박쥐', 1, 2, 3, 10, 900, false, {
    keywords: ['lifesteal'], diamond: 'lifesteal', text: '◆흡혈: 준 피해의 30%만큼 회복한다',
  }),
  archer: unit('archer', '견습 궁수', 1, 2, 3, 8, 1000, true, {
    text: '필살기: 다음 공격이 3발로 나간다',
    ult: { kind: 'tripleShot', gaugeAtk: 25, gaugeHit: 10 },
  }),
  dagger: unit('dagger', '그림자 단검', 2, 3, 5, 12, 1100, false, {
    keywords: ['assassin'], diamond: 'assassin', text: '◆암살: 적 원거리 유닛부터 노린다',
  }),
  frostwitch: unit('frostwitch', '서리 마녀', 2, 3, 4, 14, 1300, true, {
    keywords: ['frost'], text: '냉기: 공격한 대상의 공격 간격 +15% (2초, 2번까지 중첩)',
  }),
  lancer: unit('lancer', '창기병', 3, 4, 7, 22, 1500, false, {
    keywords: ['pierce'], diamond: 'pierce', text: '◆관통: 표적 바로 뒤의 적에게도 50% 피해',
  }),
  pyro: unit('pyro', '화염술사', 4, 4, 5, 20, 1400, true, {
    text: '필살기(전조 1초): 표적 주변 범위에 피해 28',
    ult: { kind: 'cross', damage: 28, telegraphMs: 1000, gaugeAtk: 20, gaugeHit: 10 },
  }),
  colossus: unit('colossus', '거신', 5, 6, 10, 70, 2200, false, {
    text: '받는 군중 제어 절반. 필살기(전조 1.2초): 자기 주변 넓은 범위에 피해 25',
    ccResist: 0.5,
    ult: { kind: 'slam', damage: 25, telegraphMs: 1200, gaugeAtk: 20, gaugeHit: 5 },
  }),

  // ── 2026-11-17에 더한 유닛 ──────────────────────────
  turtle: unit('turtle', '가시 거북', 2, 3, 2, 16, 1300, false, {
    keywords: ['thorns'], diamond: 'thorns', text: '◆가시: 근접 공격을 받을 때마다 공격자에게 피해 1',
  }),
  banner: unit('banner', '깃발병', 2, 2, 2, 10, 1000, false, {
    keywords: ['rally'], diamond: 'rally', text: '◆집결: 가까이 있는 아군 1기당 공격 +1',
  }),
  bomber: unit('bomber', '폭탄 고블린', 2, 2, 2, 7, 1000, false, {
    keywords: ['lastwords'], text: '유언: 쓰러질 때 주변(반지름 2)의 적 모두에게 피해 4',
    deathDamage: 8, deathRadius: 2,
  }),
  hammer: unit('hammer', '망치 기사', 3, 4, 6, 28, 1600, false, {
    keywords: ['knockback'], text: '넉백: 공격한 대상을 1.5만큼 밀어낸다',
    knockback: 1.5,
  }),

  // 보스 레이드의 보스. 풀에는 들어가지 않는다. 패턴은 공개돼 있다: 10초마다 전조 1.5초 뒤 자기 주변을 친다.
  boss: unit('boss', '고대 골렘', 5, 0, 8, 100000, 1500, false, {
    special: true,
    text: '보스. 쓰러지지 않고 움직이지 않는다. 10초마다 전조 1.5초 뒤 자기 주변 넓은 범위에 피해',
    ccResist: 0.5,
    ult: { kind: 'slam', damage: 16, telegraphMs: 1500, timerMs: 10000, gaugeAtk: 0, gaugeHit: 0 },
  }),

  // ── 주문 ─────────────────────────────────────────────
  firebolt: card('firebolt', '화염탄', 'spell', 1, 1, 'enemyUnit', '적 유닛 하나에 피해 7. 연계: 피해 12', {
    keywords: ['combo'], damage: 7, comboDamage: 12,
  }),
  retreat: card('retreat', '후퇴', 'spell', 1, 0, 'allyMove', '내 유닛 하나를 내 배치 칸으로 옮기고 체력 20 회복', {
    heal: 20,
  }),
  purify: card('purify', '정화', 'spell', 2, 1, 'enemyUnit', '적 유닛 하나의 강화를 모두 지우고 피해 7', {
    damage: 7,
  }),
  chain: card('chain', '연쇄 번개', 'spell', 3, 3, 'enemyUnit', '적 유닛 최대 3개에 차례로 피해 12/9/6', {
    chainDamage: [12, 9, 6],
  }),
  blizzard: card('blizzard', '눈보라', 'spell', 2, 2, 'enemyUnit', '적 유닛 하나와 그 주변(반지름 2.2)의 적 모두에게 피해 8, 감속', {
    damage: 8, radius: 2.2,
  }),

  // ── 강화 ─────────────────────────────────────────────
  warcry: card('warcry', '전투 함성', 'buff', 1, 1, 'none', '근접 유닛 전체 공격 +3 (8초)', {
    amount: 3, durationMs: 8000,
  }),
  awaken: card('awaken', '각성', 'buff', 2, 1, 'allyUltUnit', '유닛 하나의 필살기 게이지를 가득 채우고, 그 유닛의 공격 +2 (그 유닛이 쓰러질 때까지)', {
    amount: 100, atk: 2,
  }),
  armor: card('armor', '강철 갑옷', 'buff', 2, 2, 'allyUnit', '유닛 하나 체력 +25, 그 유닛이 쓰러질 때까지', {
    amount: 25,
  }),
  phalanx: card('phalanx', '방진', 'buff', 3, 2, 'none', '내 근접 유닛 전체 체력 +14, 그 유닛이 쓰러질 때까지', {
    amount: 14,
  }),

  // ── 운영 ─────────────────────────────────────────────
  scout: card('scout', '정찰', 'ops', 1, 0, 'none', '카드 2장 뽑기. 일회', {
    keywords: ['once'], draw: 2,
  }),
  crystal: card('crystal', '마나 결정', 'ops', 1, 1, 'none', '마나 +4. 숙성', {
    keywords: ['aging'], amount: 4,
  }),
  supply: card('supply', '보급선', 'ops', 2, 1, 'none', '다음에 내는 유닛 3장의 비용 −1. ◆순환', {
    keywords: ['cycle'], diamond: 'cycle', count: 3, amount: 1,
  }),
  muster: card('muster', '징집령', 'ops', 3, 1, 'none', '덱에서 비용이 가장 낮은 유닛 카드 2장을 손패로 가져온다', {
    count: 2,
  }),
  stockpile: card('stockpile', '비축', 'ops', 3, 2, 'none', '이번 전투의 마나 회복이 40% 빨라진다. 일회', {
    keywords: ['once'], amount: 0.4,
  }),

  // ── 지휘관 고유 카드 ─────────────────────────────────
  // matchOnly: 한 경기 안의 전투에서만 효과가 있다 (전투 한 판에서는 아무 일도 없다)
  invest: card('invest', '투자', 'ops', 1, 2, 'none', '이번 전투에서 이기면(난투장은 1위) 골드 +3. 일회', {
    keywords: ['once'], commanderCard: 'merchant', matchOnly: true,
  }),
  catalyst: card('catalyst', '촉매', 'ops', 1, 1, 'handFused', '손패의 융합 카드 하나의 비용이 0이 된다', {
    commanderCard: 'alchemist',
  }),
  disrupt: card('disrupt', '교란', 'spell', 2, 1, 'enemyUnit', '적 유닛 하나에 피해 6, 2초 동안 기절시키고(움직이지도 치지도 못한다) 필살기 게이지를 비운다', {
    commanderCard: 'spy', durationMs: 2000, damage: 6,
  }),
  decree: card('decree', '포고', 'ops', 2, 1, 'enemyUnit', '적 유닛 하나를 6초 동안 지목한다: 그 유닛이 받는 피해 +100%, 그 유닛이 사거리 안에 있는 내 유닛은 그 유닛부터 친다', {
    commanderCard: 'lord', durationMs: 6000, amount: 1,
  }),
};

/** 공용 풀에 들어가는 카드 (지휘관 고유 카드 제외) */
export const POOL_CARD_IDS = Object.values(CARDS).filter((c) => !c.commanderCard && !c.special).map((c) => c.id);

/** 등급별 풀 장수 */
export const COPIES_BY_TIER = { 1: 12, 2: 10, 3: 8, 4: 6, 5: 4 };

export const COMMANDERS = {
  general: {
    id: 'general', name: '장군', passive: '근접 유닛 체력 +5%', card: 'phalanx',
    meleeHp: 0.05,
    deck: ['shield', 'shield', 'shield', 'lancer', 'lancer', 'archer', 'warcry', 'phalanx'],
    fusions: 3,
  },
  merchant: {
    id: 'merchant', name: '상인', passive: '라운드당 골드 +2', card: 'invest',
    goldPerRound: 2,
    deck: ['rats', 'rats', 'shield', 'bat', 'archer', 'scout', 'crystal', 'invest'],
    fusions: 3,
  },
  alchemist: {
    id: 'alchemist', name: '연금술사', passive: '융합 카드 비용 −1', card: 'catalyst',
    deck: ['firebolt', 'firebolt', 'archer', 'archer', 'shield', 'scout', 'crystal', 'catalyst'],
    fusions: 3,
  },
  spy: {
    id: 'spy', name: '첩보원', passive: '상대가 고른 시작 카드를 미리 본다, 전투 시작 손패 +1 · 마나 +1, 시그니처 칸 2개', card: 'disrupt',
    seesOpening: true,
    startHand: 1,
    startMana: 1,
    signatureSlots: 2,
    deck: ['dagger', 'dagger', 'bat', 'shield', 'firebolt', 'firebolt', 'retreat', 'disrupt'],
    fusions: 3,
  },
  lord: {
    id: 'lord', name: '군주', passive: '받는 HP 피해 −25% (1:1은 −40%)', card: 'decree',
    deck: ['shield', 'shield', 'lancer', 'bat', 'archer', 'armor', 'warcry', 'decree'],
    fusions: 3,
  },
};

export const COMMANDER_IDS = Object.keys(COMMANDERS);

/** 전장 효과 (유닛 전투 기준). '축제'는 전개 카드가 아직 없어서 넣지 않았다. */
export const BATTLEFIELDS = {
  rain: { id: 'rain', name: '폭우', text: '원거리 유닛의 공격 간격 +20%' },
  canyon: { id: 'canyon', name: '좁은 협곡', text: '배치 칸의 양쪽 끝 줄을 쓸 수 없다' },
  fog: { id: 'fog', name: '안개', text: '처음 5초 동안 원거리 유닛은 표적이 되지 않는다' },
  citadel: { id: 'citadel', name: '성채', text: '근접 유닛 체력 +20%' },
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
