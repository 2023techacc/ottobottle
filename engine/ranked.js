// 랭크전: 레이팅(Elo 방식), 티어, 레이팅이 비슷한 사람끼리 묶는 매칭.
// 경기 규칙(game.js)과는 따로 논다. 경기가 끝난 뒤 순위만 받아서 레이팅을 고친다.

/**
 * 봇 난이도별 레이팅: 랭크전에서 봇의 실력을 내 레이팅에 맞춰 고를 때와, 봇과 싸운 결과로 내 레이팅을 고칠 때 쓴다.
 * 봇 리그 시뮬레이션(sim/ranked.mjs)에서 난이도마다 모인 평균 레이팅 (README "랭크전").
 */
export const BOT_LEVEL_RATING = Object.freeze({ beginner: 730, easy: 930, normal: 1055, hard: 1150 });

/** 이 레이팅에 가장 가까운 봇 난이도 */
export function botLevelForRating(rating) {
  let best = null;
  for (const [id, r] of Object.entries(BOT_LEVEL_RATING)) if (!best || Math.abs(r - rating) < Math.abs(BOT_LEVEL_RATING[best] - rating)) best = id;
  return best;
}

/** 레이팅 설정 */
export const RANKED = Object.freeze({
  start: 1000, // 처음 레이팅
  k: 32, // 한 경기에 움직이는 크기 (1:1 기준)
  placementGames: 10, // 처음 몇 경기는 더 크게 움직인다 (배치)
  placementK: 64,
  floor: 0,
});

/**
 * 티어: 레이팅 구간. 봇 리그 시뮬레이션(sim/ranked.mjs)에서 실력별 레이팅이 모이는 자리를 보고 정했다
 * (README "랭크전").
 */
export const TIERS = Object.freeze([
  { id: 'bronze', name: '브론즈', min: -Infinity },
  { id: 'silver', name: '실버', min: 900 },
  { id: 'gold', name: '골드', min: 1000 },
  { id: 'platinum', name: '플래티넘', min: 1100 },
  { id: 'diamond', name: '다이아몬드', min: 1200 },
  { id: 'master', name: '마스터', min: 1300 },
]);

export function tierOf(rating) {
  let t = TIERS[0];
  for (const x of TIERS) if (rating >= x.min) t = x;
  return t;
}

/** a가 b를 이길 기대 확률 */
export function expectedScore(a, b) {
  return 1 / (1 + 10 ** ((b - a) / 400));
}

/** 이번 경기의 K (배치 경기는 크게) */
export function kFactor(gamesPlayed = Infinity) {
  return gamesPlayed < RANKED.placementGames ? RANKED.placementK : RANKED.k;
}

/**
 * 한 경기의 레이팅 변화. 여럿이면 순위를 모든 상대와 1:1로 견준다 (먼저 탈락하면 진 것, 같은 순위면 비긴 것).
 * 1:1이면 보통 Elo와 같다. 8인이면 한 판에 움직이는 크기가 1:1과 비슷하도록 상대 수로 나눈다.
 * @param {number[]} ratings  자리마다 경기 전 레이팅
 * @param {number[]} places   자리마다 순위 (1이 1위)
 * @param {number[]} [games]  자리마다 지금까지 치른 랭크 경기 수 (배치 경기 판정)
 * @returns {number[]} 자리마다 레이팅 변화 (반올림)
 */
export function rateMatch(ratings, places, games = []) {
  const n = ratings.length;
  return ratings.map((ra, i) => {
    let sum = 0;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const actual = places[i] < places[j] ? 1 : places[i] === places[j] ? 0.5 : 0;
      sum += actual - expectedScore(ra, ratings[j]);
    }
    const scale = n > 2 ? 2 / (n - 1) : 1; // 8인: 상대 7명과의 견줌을 합쳐 1:1 두 판쯤의 크기로
    return Math.round(kFactor(games[i]) * scale * sum);
  });
}

/**
 * 매칭: 레이팅에 조금 흔들림을 더해 줄 세운 뒤 size명씩 묶는다. 남는 사람은 이번에 쉰다.
 * @param {Array<{rating:number}>} pool
 * @param {number} size
 * @param {()=>number} rng
 * @param {number} [jitter]  레이팅에 더하는 흔들림의 크기 (같은 사람끼리만 계속 붙지 않게)
 * @returns {number[][]} pool 번호 묶음
 */
export function matchmake(pool, size, rng, jitter = 60) {
  const order = pool
    .map((p, i) => ({ i, key: p.rating + (rng() * 2 - 1) * jitter }))
    .sort((a, b) => a.key - b.key)
    .map((x) => x.i);
  const groups = [];
  for (let k = 0; k + size <= order.length; k += size) groups.push(order.slice(k, k + size));
  return groups;
}
