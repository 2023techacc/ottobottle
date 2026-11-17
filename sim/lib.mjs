// 시뮬레이션 공용 도구: 집계, CSV 쓰기

import fs from 'node:fs';
import path from 'node:path';

/** 승 1, 무 0.5, 패 0 */
export function score(result, p) {
  if (result.winner === -1) return 0.5;
  return result.winner === p ? 1 : 0;
}

export class Tally {
  constructor() {
    this.rows = new Map();
  }
  add(key, fields) {
    let row = this.rows.get(key);
    if (!row) {
      row = {};
      this.rows.set(key, row);
    }
    for (const [k, v] of Object.entries(fields)) row[k] = (row[k] || 0) + v;
    return row;
  }
  entries() {
    return [...this.rows.entries()];
  }
}

export function percentile(sorted, q) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
}

/** 여러 판의 결과를 모아 전투 흐름 지표를 낸다. */
export class PaceStats {
  constructor() {
    this.lens = [];
    this.n = 0;
    this.timeouts = 0;
    this.overtime = 0;
    this.draws = 0;
    this.p0 = 0;
    this.sides = 0;
    this.sum = { cardsPlayed: 0, redraws: 0, manaSpent: 0, manaWasted: 0, handFullMs: 0, manaCapMs: 0, handSize: 0, totalMs: 0, maxManaEnd: 0 };
  }
  add(state) {
    const r = state.result;
    this.n++;
    this.sides += state.players.length;
    this.lens.push(r.timeMs / 1000);
    if (r.reason === 'time') this.timeouts++;
    if (r.timeMs > state.rules.overtimeMs) this.overtime++;
    if (r.winner === -1) this.draws++;
    this.p0 += score(r, 0);
    for (const P of state.players) {
      const s = P.stats;
      this.sum.cardsPlayed += s.cardsPlayed;
      this.sum.redraws += s.redraws;
      this.sum.manaSpent += s.manaSpent;
      this.sum.manaWasted += s.manaWasted;
      this.sum.handFullMs += s.handFullMs;
      this.sum.manaCapMs += s.manaCapMs;
      this.sum.handSize += s.handSizeSum / Math.max(1, s.ticks);
      this.sum.totalMs += r.timeMs;
      this.sum.maxManaEnd += P.maxMana;
    }
  }
  summary() {
    const lens = [...this.lens].sort((a, b) => a - b);
    const sides = this.sides;
    const s = this.sum;
    return {
      games: this.n,
      len_p10: percentile(lens, 0.1),
      len_median: percentile(lens, 0.5),
      len_p90: percentile(lens, 0.9),
      len_mean: round(lens.reduce((a, b) => a + b, 0) / Math.max(1, lens.length), 1),
      overtime_pct: pct(this.overtime / this.n),
      timeout_pct: pct(this.timeouts / this.n),
      draw_pct: pct(this.draws / this.n),
      seat0_win_pct: pct(this.p0 / this.n),
      cards_played: round(s.cardsPlayed / sides, 1),
      redraws: round(s.redraws / sides, 2),
      mana_spent: round(s.manaSpent / sides, 1),
      mana_wasted: round(s.manaWasted / sides, 2),
      hand_avg: round(s.handSize / sides, 2),
      hand_full_pct: pct(s.handFullMs / Math.max(1, s.totalMs)),
      mana_capped_pct: pct(s.manaCapMs / Math.max(1, s.totalMs)),
      max_mana_end: round(s.maxManaEnd / sides, 1),
    };
  }
}

export const round = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d;
export const pct = (x) => round(x * 100, 1);

/** 승률의 95% 신뢰 구간 반폭(%p) */
export function ci95(p, n) {
  if (!n) return 0;
  return round(196 * Math.sqrt((p * (1 - p)) / n), 1);
}

export function writeCsv(file, rows) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // 엑셀에서 한글이 깨지지 않도록 BOM을 붙인다
  fs.writeFileSync(file, '﻿' + lines.join('\n') + '\n', 'utf8');
}

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}
