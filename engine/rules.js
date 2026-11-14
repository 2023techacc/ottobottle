// 전투 규칙 수치. 시뮬레이션에서 값을 바꿔 가며 돌릴 수 있게 한곳에 모았다.
// 시간은 모두 밀리초, 엔진은 tickMs 단위로 진행한다.

export const DEFAULT_RULES = Object.freeze({
  tickMs: 100,

  // 전투 시간
  battleMs: 40000,
  overtimeMs: 30000, // 과열 시작
  overtimeAtkPerSec: 0.1, // 과열 중 매초 공격력 +10%

  // 지휘관
  commanderHp: 30,

  // 마나
  startMana: 3,
  manaIntervalMs: 1500,
  startMaxMana: 3,
  maxManaCap: 8,
  maxManaIntervalMs: 8000,

  // 뽑기
  startHand: 4,
  drawIntervalMs: 3000,
  handMax: 7,
  redrawCost: 1,
  redrawCooldownMs: 4000,

  // 카드 키워드
  comboWindowMs: 3000, // 연계
  agingIntervalMs: 5000, // 숙성

  // 군중 제어
  slowPerStack: 0.15, // 냉기 1중첩
  slowMaxStacks: 2,
  slowDurationMs: 2000,
  slowCap: 0.5,
  silenceMaxMs: 2000,
  ccRepeatWindowMs: 3000, // 이 안에 같은 효과가 다시 걸리면 지속 시간 절반

  // 유닛 키워드
  guardShare: 0.2,
  lifesteal: 0.3,
  pierceShare: 0.5,
  thornsDamage: 2,
  rallyAtk: 2,

  // 강화(별)
  starMult: 1.8, // 유닛 공격·체력
  spellStarMult: 1.5, // 그 밖의 카드 효과 수치

  // 선봉
  vanguardSlots: 1,

  // 시작 카드 고르기: 시작 손패 중 이만큼을 덱에서 직접 고른다 (기획서에 없다. 선봉을 대신하는 실험 규칙)
  openingPicks: 0,

  // 후열에 선 근접 유닛이 빈 전열 칸으로 나오는 데 걸리는 시간 (기획서에 없는 가정)
  meleeAdvanceMs: 1000,

  // 필살기 게이지
  gaugeMax: 100,

  // ── 조정용 배율 (기획서에는 없다. 전투 길이를 맞춰 보려고 넣은 손잡이) ──
  unitHpMult: 1, // 모든 유닛 체력
  unitAtkMult: 1, // 모든 유닛 공격력과 필살기 피해
  attackIntervalMult: 1, // 모든 유닛 공격 간격
  commanderDamageMult: 1, // 유닛이 지휘관에게 주는 피해
  vanguardMaxCost: 99, // 선봉으로 세울 수 있는 유닛의 최대 마나 비용
});

/**
 * 전투 길이 조정안. sim/tune.mjs 로 찾은 값이다 (README의 "전투 길이 조정" 참고).
 * 기획서 수치는 base, 나머지는 30~45초 목표에 맞춘 후보다.
 */
export const PRESETS = Object.freeze({
  base: { name: '기획서 기본', rules: {} },
  siege: { name: 'A. 지휘관 체력 250', rules: { commanderHp: 250 } },
  softHits: { name: 'B. 유닛 공격 ×0.35 · 지휘관 60', rules: { unitAtkMult: 0.35, commanderHp: 60 } },
  mixed: { name: 'C. 유닛 공격 ×0.5 · 체력 ×1.5 · 지휘관 90', rules: { unitAtkMult: 0.5, unitHpMult: 1.5, commanderHp: 90 } },
  recommended: {
    name: 'D. 추천: 공격 ×0.5 · 체력 ×1.5 · 지휘관 60 · 선봉 3마나 이하',
    rules: { unitAtkMult: 0.5, unitHpMult: 1.5, commanderHp: 60, vanguardMaxCost: 3 },
  },
  cards: {
    name: 'E. 카드 위주: 선봉 없음 · 시작 카드 고르기',
    rules: { unitAtkMult: 0.5, unitHpMult: 1.25, commanderHp: 60, vanguardSlots: 0, openingPicks: 2 },
  },
});

export const FRONT = 0;
export const BACK = 1;
export const SLOTS = 4;
