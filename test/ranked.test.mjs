import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../engine/index.js';

test('티어는 레이팅 구간이다', () => {
  assert.equal(E.tierOf(500).id, 'bronze');
  assert.equal(E.tierOf(E.RANKED.start).id, E.tierOf(1000).id);
  assert.equal(E.tierOf(5000).id, 'master');
  const mins = E.TIERS.map((t) => t.min);
  assert.deepEqual(mins, [...mins].sort((a, b) => a - b), '구간이 차례대로');
});

test('1:1 레이팅: 보통 Elo. 같은 레이팅이면 이긴 쪽 +16, 진 쪽 −16. 배치 경기는 두 배', () => {
  assert.deepEqual(E.rateMatch([1000, 1000], [1, 2], [50, 50]), [16, -16]);
  assert.deepEqual(E.rateMatch([1000, 1000], [1, 2], [0, 50]), [32, -16]);
  const [up] = E.rateMatch([1000, 1400], [1, 2], [50, 50]);
  assert.ok(up > 28, '강한 상대를 이기면 많이 오른다');
  assert.deepEqual(E.rateMatch([1000, 1000], [1, 1], [50, 50]), [0, 0], '무승부');
});

test('8인 레이팅: 순위를 모든 상대와 견준다. 같은 레이팅이면 1위가 가장 많이 오르고 합은 0', () => {
  const ratings = new Array(8).fill(1000);
  const d = E.rateMatch(ratings, [1, 2, 3, 4, 5, 6, 7, 8], new Array(8).fill(50));
  assert.ok(d[0] > d[1] && d[3] > d[4] && d[6] > d[7]);
  assert.equal(d[0], 32);
  assert.equal(d[7], -32);
  assert.ok(Math.abs(d.reduce((a, b) => a + b, 0)) <= 4);
});

test('매칭: 레이팅이 비슷한 사람끼리 묶고, 남는 사람은 쉰다', () => {
  const pool = Array.from({ length: 19 }, (_, i) => ({ rating: i * 100 }));
  const groups = E.matchmake(pool, 8, E.makeRng(1), 0);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0], [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(new Set(groups.flat()).size, 16);
});

test('봇 난이도별 레이팅과 가장 가까운 난이도', () => {
  assert.deepEqual(Object.keys(E.BOT_LEVEL_RATING), Object.keys(E.BOT_LEVELS));
  for (const [id, r] of Object.entries(E.BOT_LEVEL_RATING)) assert.equal(E.botLevelForRating(r), id);
  assert.equal(E.botLevelForRating(-1000), 'beginner');
  assert.equal(E.botLevelForRating(9999), 'hard');
});
