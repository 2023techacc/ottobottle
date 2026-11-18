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

  // 시작 카드 고르기: 시작 손패 중 이만큼을 덱에서 직접 고른다 (기획서에 없다. 선봉을 대신하는 실험 규칙)
  openingPicks: 0,

  // 필살기 게이지
  gaugeMax: 100,

  // ── 조정용 배율 (기획서에는 없다. 전투 길이를 맞춰 보려고 넣은 손잡이) ──
  unitHpMult: 1, // 모든 유닛 체력
  unitAtkMult: 1, // 모든 유닛 공격력과 필살기 피해
  attackIntervalMult: 1, // 모든 유닛 공격 간격
  commanderDamageMult: 1, // 유닛이 지휘관에게 주는 피해
});
