// 유닛 소환 전투 화면. 규칙은 ../engine/field.js 에 있고, 여기는 그리기와 입력만 한다.
// 유닛 전투 시제품(field.html)과 한 경기 모드(index.html)가 같이 쓴다. 나는 항상 0번 자리(아래쪽)다.
//
//   const view = createFieldView(document.getElementById('fbattle'), { onQuit });
//   view.start({ cfg, botOpts, label, onFinish });   // cfg는 Field.createField에 넘길 설정
//   document.addEventListener('keydown', (ev) => view.onKey(ev));

import * as E from '../engine/index.js';

const F = E.Field;
const ME = 0;
const TYPE_NAMES = { unit: '유닛', spell: '주문', buff: '강화', ops: '운영' };
/** 형식별 필드 최대 너비(px) */
const MAX_WIDTH = { duel: 500, boss: 500, melee4: 640, alliance: 860 };
const COLORS = { me: '#4f9dff', ally: '#5fd08a', foes: ['#ff6b6b', '#f2a14e', '#c08bff'], boss: '#b0894f' };
export const fmt = (x) => (Math.abs(x - Math.round(x)) < 0.05 ? String(Math.round(x)) : x.toFixed(1));
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// 내 배치 칸을 가리키는 키: 화면에서 보이는 위치 그대로 (앞줄 QWERT, 가운뎃줄 ASDFG, 뒷줄 ZXCVB)
const KEY_ROWS = [
  ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT'],
  ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG'],
  ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB'],
];
const KEY_LETTERS = ['QWERT', 'ASDFG', 'ZXCVB'];
const SPEEDS = [0.5, 1, 2];

export const FIELD_EFFECTS = {
  rain: '원거리 유닛의 공격 간격 +20%',
  canyon: '배치 칸의 양쪽 끝 줄을 쓸 수 없다',
  fog: '처음 5초 동안 원거리 유닛은 표적이 되지 않는다',
  citadel: '근접 유닛 체력 +20%',
  surge: '필살기 게이지 충전 +50%',
  volcano: '10초마다 모든 유닛이 최대 체력의 5% 피해를 받는다',
};

/** 전투가 끝난 까닭 */
export function endReason(state) {
  const res = state.result;
  if (res.reason === 'commander') return '지휘관이 쓰러졌다';
  if (res.reason === 'capture') return `점령 점수 ${state.capture.goal}점에 닿았다`;
  if (state.format === 'boss') return '40초를 채웠다';
  return state.capture ? '시간이 다 됐다 (점령 점수로 판정)' : '시간이 다 됐다 (지휘관 체력 비율로 판정)';
}

const TEMPLATE = `
  <header class="topbar">
    <div class="clock"><span data-f="clock">0.0</span><small>/ <span data-f="clockMax">40</span>초</small></div>
    <div class="timebar"><div class="timefill" data-f="timefill"></div><div class="overtimeMark" data-f="overtimeMark"></div></div>
    <div class="field" data-f="fieldInfo"></div>
    <div class="speed" data-f="speed">
      <button data-speed="0" title="스페이스">일시정지</button>
      <button data-speed="0.5">0.5×</button>
      <button data-speed="1" class="on">1×</button>
      <button data-speed="2">2×</button>
    </div>
    <button data-f="quit" type="button">그만두기</button>
  </header>
  <div class="arena">
    <div class="main">
      <div class="fplayers" data-f="players"></div>
      <div class="arenawrap"><div class="farena" data-f="arena"></div></div>
      <div class="commander me" data-f="cmd0"></div>
      <div class="hint" data-f="hint"></div>
      <div class="hand" data-f="hand"></div>
    </div>
    <aside class="log">
      <details class="keys" open>
        <summary>단축키</summary>
        <table>
          <tr><td><kbd>1</kbd>~<kbd>7</kbd></td><td>손패 카드 고르기</td></tr>
          <tr><td><kbd>Q</kbd><kbd>W</kbd><kbd>E</kbd><kbd>R</kbd><kbd>T</kbd></td><td>내 배치 칸 앞줄 1~5</td></tr>
          <tr><td><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><kbd>F</kbd><kbd>G</kbd></td><td>내 배치 칸 가운뎃줄</td></tr>
          <tr><td><kbd>Z</kbd><kbd>X</kbd><kbd>C</kbd><kbd>V</kbd><kbd>B</kbd></td><td>내 배치 칸 뒷줄 (본진 앞)</td></tr>
          <tr><td><kbd>\`</kbd></td><td>다시 뽑기 (누른 뒤 버릴 카드 번호)</td></tr>
          <tr><td><kbd>Esc</kbd></td><td>선택 취소</td></tr>
          <tr><td><kbd>Space</kbd>, <kbd>-</kbd> <kbd>=</kbd></td><td>일시정지, 느리게·빠르게</td></tr>
        </table>
        <p class="note">유닛(적이든 내 것이든)은 마우스로 눌러서 고른다.</p>
      </details>
      <h2>기록</h2>
      <ol data-f="log"></ol>
    </aside>
  </div>`;

/**
 * @param {HTMLElement} root  전투 화면을 그릴 곳 (안의 내용은 이 함수가 만든다)
 * @param {{onQuit?:()=>void}} [opts]  "그만두기"를 눌렀을 때
 */
export function createFieldView(root, opts = {}) {
  root.classList.add('fview');
  root.innerHTML = TEMPLATE;
  const q = (name) => root.querySelector(`[data-f="${name}"]`);
  const el = {
    clock: q('clock'), clockMax: q('clockMax'), timefill: q('timefill'), overtimeMark: q('overtimeMark'), fieldInfo: q('fieldInfo'),
    speed: q('speed'), quit: q('quit'), players: q('players'), arena: q('arena'), cmd0: q('cmd0'), hint: q('hint'), hand: q('hand'), log: q('log'),
  };
  const fp = (p) => root.querySelector(`[data-fp="${p}"]`);

  let game = null;

  // ───────────────────────── 시작·진행 ─────────────────────────

  /**
   * @param {object} o
   * @param {object} o.cfg  Field.createField 설정. 0번 자리가 나다.
   * @param {object|((seat:number)=>object)} o.botOpts  상대 봇 설정 (자리마다 다르게 주려면 함수)
   * @param {string} [o.label]  위쪽에 보일 형식 이름
   * @param {(state:object)=>void} o.onFinish  전투가 끝나면 불린다
   */
  function start({ cfg, botOpts, label = '', onFinish }) {
    stop();
    const state = F.createField(cfg);
    const optsFor = (i) => (typeof botOpts === 'function' ? botOpts(i) : { ...botOpts, seed: E.hashSeed(botOpts.seed ?? cfg.seed ?? 1, 'bot', i) });
    game = {
      state,
      bots: state.players.map((P, i) => (i === ME ? null : E.createFieldBot(optsFor(i)))),
      onFinish,
      speed: 1,
      timer: null,
      finished: false,
      sel: null, // { mode: 'play'|'redraw', uid, unitId }
      cache: new Map(),
      unitEls: new Map(),
      teleEls: new Map(),
      jumped: new Set(), // 이번 그리기에서 순간이동한 유닛 (부드럽게 잇지 않는다)
    };
    el.clockMax.textContent = String(state.rules.battleMs / 1000);
    el.overtimeMark.style.left = `${(state.rules.overtimeMs / state.rules.battleMs) * 100}%`;
    const bf = state.battlefield;
    el.fieldInfo.textContent = `${label ? `${label} · ` : ''}${bf ? `전장: ${E.BATTLEFIELDS[bf].name} — ${FIELD_EFFECTS[bf]}` : '전장: 없음'}`;
    el.log.innerHTML = '';
    buildArena();
    setSpeed(1);
    consumeEvents();
    render();
    return state;
  }

  function stop() {
    if (game && game.timer) clearTimeout(game.timer);
    if (game) game.timer = null;
  }

  function schedule() {
    if (!game || game.state.over) return;
    clearTimeout(game.timer);
    if (game.speed === 0) return;
    game.timer = setTimeout(tick, game.state.rules.tickMs / game.speed);
  }

  function tick() {
    if (!game) return;
    const { state } = game;
    // 봇들이 같은 순간의 상태를 보고 판단하고, 그 행동도 동시에 처리한다
    F.applyActions(state, game.bots.map((bot, i) => (bot ? bot.decide(state, i) : null)));
    F.step(state);
    consumeEvents();
    render();
    if (state.over) finish();
    else schedule();
  }

  function finish() {
    if (!game || game.finished) return;
    game.finished = true;
    if (game.onFinish) game.onFinish(game.state);
  }

  function setSpeed(v) {
    if (!game) return;
    game.speed = v;
    for (const b of el.speed.querySelectorAll('button')) b.classList.toggle('on', Number(b.dataset.speed) === v);
    schedule();
  }

  // ───────────────────────── 필드 그리기 ─────────────────────────

  function colorOf(state, i) {
    if (i === ME) return COLORS.me;
    if (state.players[i].isBoss) return COLORS.boss;
    if (!F.isEnemy(state, ME, i)) return COLORS.ally;
    const foes = state.players.map((P) => P.idx).filter((x) => F.isEnemy(state, ME, x));
    return COLORS.foes[foes.indexOf(i) % COLORS.foes.length];
  }

  /** 필드의 크기(게임 단위)와 화면 배율 */
  function view() {
    const a = game.state.arena;
    const w = a.shape === 'circle' ? a.r * 2 : a.w;
    const h = a.shape === 'circle' ? a.r * 2 : a.h;
    return { w, h, scale: el.arena.clientWidth / w };
  }

  /** 필드 좌표(가운데가 0, 위가 +y) → 화면 좌표 */
  function toPx(x, y) {
    const v = view();
    return [(x + v.w / 2) * v.scale, (v.h / 2 - y) * v.scale];
  }

  function buildArena() {
    const { state } = game;
    const arena = el.arena;
    const a = state.arena;
    arena.innerHTML = '<svg class="shots"></svg>';
    arena.classList.toggle('circle', a.shape === 'circle');
    const v0 = { w: a.shape === 'circle' ? a.r * 2 : a.w, h: a.shape === 'circle' ? a.r * 2 : a.h };
    arena.style.aspectRatio = `${v0.w} / ${v0.h}`;
    // 필드와 손패가 한 화면에 들어오도록, 필드 높이를 화면 높이의 60%쯤으로 묶는다
    arena.style.width = `min(100%, ${MAX_WIDTH[state.format] || 640}px, ${(60 * v0.w) / v0.h}vh)`;
    game.unitEls.clear();
    game.teleEls.clear();
    game.cellEls = [];
    game.baseEls = [];
    const v = view();

    // 배치 칸: 내 칸은 누를 수 있고, 다른 사람의 칸은 흐리게만 보인다 (보스는 칸이 없다)
    state.players.forEach((P, p) => {
      if (P.isBoss) return;
      for (const c of F.deployCells(state, p)) {
        const d = document.createElement('div');
        d.className = `dcell${p === ME ? ' mine' : ''}${c.blocked ? ' blocked' : ''}`;
        const [px, py] = toPx(c.x, c.y);
        const size = F.CELL * v.scale - 4;
        Object.assign(d.style, { left: `${px}px`, top: `${py}px`, width: `${size}px`, height: `${size}px` });
        if (p === ME) {
          d.dataset.cell = c.i;
          d.innerHTML = `<span class="keyhint">${KEY_LETTERS[F.DEPLOY_ROWS - 1 - c.row][c.col]}</span>`;
          game.cellEls[c.i] = d;
        } else d.style.borderColor = `${colorOf(state, p)}55`;
        arena.append(d);
      }
    });

    // 난투장: 가운데 점령 원
    game.zoneEl = null;
    if (state.capture) {
      const z = document.createElement('div');
      z.className = 'fzone';
      const [zx, zy] = toPx(state.capture.x, state.capture.y);
      const zs = state.capture.radius * 2 * v.scale;
      Object.assign(z.style, { left: `${zx}px`, top: `${zy}px`, width: `${zs}px`, height: `${zs}px` });
      arena.append(z);
      game.zoneEl = z;
    }

    // 본진 (보스는 본진 대신 보스 유닛이 있다)
    state.players.forEach((P, p) => {
      if (P.isBoss) return;
      const b = document.createElement('div');
      b.className = 'fbase';
      b.style.setProperty('--c', colorOf(state, p));
      const [px, py] = toPx(P.base.x, P.base.y);
      const size = state.rules.baseRadius * 2 * v.scale;
      Object.assign(b.style, { left: `${px}px`, top: `${py}px`, width: `${size}px`, height: `${size}px` });
      arena.append(b);
      game.baseEls[p] = b;
    });

    // 다른 플레이어들의 상태
    el.players.innerHTML = state.players.map((P, p) => (p === ME ? '' : `<div class="fplayer" data-fp="${p}" style="--c:${colorOf(state, p)}"></div>`)).join('');
  }

  function patch(key, node, html) {
    if (game.cache.get(key) === html) return;
    game.cache.set(key, html);
    node.innerHTML = html;
  }

  function unitTitle(state, u) {
    if (u.defId === 'boss') return `${u.name} · 공 ${fmt(F.currentAtk(state, u))} · 받은 피해 ${fmt(u.damageTaken || 0)} · ${F.fieldText('boss')}`;
    const tags = [u.ranged ? `사거리 ${u.range}` : '근접', ...u.keywords.map((k) => E.KEYWORD_NAMES[k] || k)];
    if (u.slows.length) tags.push(`감속×${u.slows.length}`);
    if (u.silenceUntil > state.timeMs) tags.push('침묵');
    for (const b of u.buffs) tags.push(b.kind === 'atk' ? `공+${fmt(b.amount)}` : '갑옷');
    if (u.tripleShot) tags.push('3연사 준비');
    return `${u.name} · 공 ${fmt(F.currentAtk(state, u))} · 체 ${fmt(Math.max(0, u.hp))}/${fmt(u.maxHp)} · ${tags.join(', ')}`;
  }

  function renderUnits(targets) {
    const { state } = game;
    const v = view();
    const alive = new Set();
    for (const u of state.units) {
      alive.add(u.id);
      let node = game.unitEls.get(u.id);
      const size = Math.max(22, u.radius * 2 * v.scale);
      const boss = u.defId === 'boss';
      if (!node) {
        node = document.createElement('div');
        node.className = `funit${u.ranged ? ' ranged' : ''}${boss ? ' boss' : ''}`;
        node.dataset.id = u.id;
        node.style.setProperty('--c', colorOf(state, u.owner));
        Object.assign(node.style, { width: `${size}px`, height: `${size}px` });
        const base = E.CARDS[u.defId].name;
        const label = `${u.token ? '·' : ''}${size >= 44 ? base : base.slice(0, 2)}${u.stars > 1 ? `<br>${'★'.repeat(u.stars)}` : ''}`;
        node.innerHTML = `<span>${label}</span><div class="gz"${u.ult ? '' : ' hidden'}><i></i></div><div class="hp"${boss ? ' hidden' : ''}><i></i></div>`;
        el.arena.append(node);
        game.unitEls.set(u.id, node);
        game.jumped.add(u.id); // 처음 나타날 때는 그 자리에 바로 놓는다
      }
      const [px, py] = toPx(u.x, u.y);
      node.style.transition = game.jumped.has(u.id) || game.speed === 0 ? 'none' : `transform ${state.rules.tickMs / game.speed}ms linear`;
      node.style.transform = `translate(${px - size / 2}px, ${py - size / 2}px)`;
      node.querySelector('.hp i').style.width = `${Math.max(0, (u.hp / u.maxHp) * 100)}%`;
      if (u.ult) node.querySelector('.gz i').style.width = `${u.telegraphing ? 100 : u.gauge}%`;
      node.classList.toggle('casting', u.telegraphing);
      node.classList.toggle('target', targets.units.has(u.id));
      node.title = unitTitle(state, u);
    }
    game.jumped.clear();
    for (const [id, node] of game.unitEls) {
      if (alive.has(id)) continue;
      node.remove();
      game.unitEls.delete(id);
    }

    // 필살기 전조 범위
    const live = new Set();
    for (const g of state.telegraphs) {
      live.add(g.id);
      let node = game.teleEls.get(g.id);
      if (!node) {
        node = document.createElement('div');
        node.className = 'ftele';
        const [px, py] = toPx(g.x, g.y);
        const size = g.radius * 2 * v.scale;
        Object.assign(node.style, { left: `${px}px`, top: `${py}px`, width: `${size}px`, height: `${size}px` });
        el.arena.append(node);
        game.teleEls.set(g.id, node);
      }
      node.textContent = (Math.max(0, g.fireAt - state.timeMs) / 1000).toFixed(1);
    }
    for (const [id, node] of game.teleEls) {
      if (live.has(id)) continue;
      node.remove();
      game.teleEls.delete(id);
    }
  }

  /** 보스에게 준 피해 (보스 레이드) */
  function bossDamage(state) {
    return state.units.filter((u) => u.defId === 'boss').reduce((s, u) => s + (u.damageTaken || 0), 0);
  }

  /** 결투·연합전은 지휘관 체력, 난투장은 점령 점수, 보스 레이드는 보스에게 준 피해 */
  function barHtml(state, P) {
    if (state.format === 'boss') {
      if (P.isBoss) return '<div class="hpbar score"><i style="width:100%"></i><span>쓰러지지 않는다 · 10초마다 주변을 친다</span></div>';
      return `<div class="hpbar score"><i style="width:${Math.min(100, bossDamage(state) / 4)}%"></i><span>보스에게 준 피해 ${fmt(bossDamage(state))}</span></div>`;
    }
    if (!state.capture) return `<div class="hpbar"><i style="width:${Math.max(0, (P.hp / P.maxHp) * 100)}%"></i><span>${fmt(Math.max(0, P.hp))} / ${P.maxHp}</span></div>`;
    const score = Math.floor(P.capMs / 1000);
    const holding = state.capture.holder === P.idx;
    return `<div class="hpbar score${holding ? ' holding' : ''}"><i style="width:${Math.min(100, (P.capMs / (state.capture.goal * 1000)) * 100)}%"></i><span>${score} / ${state.capture.goal}점 · 원 안에 ${state.capture.counts[P.idx]}기${holding ? ' · 점령 중' : ''}</span></div>`;
  }

  function commanderHtml(state) {
    const P = state.players[ME];
    const pips = [];
    const shown = Math.max(P.maxMana, P.mana);
    for (let i = 0; i < shown; i++) pips.push(`<i class="pip${i < P.mana ? (i >= P.maxMana ? ' over' : ' full') : ''}"></i>`);
    const last = P.lastPlayed && state.timeMs - P.lastPlayed.at < 4000 ? `낸 카드: ${esc(P.lastPlayed.name)}` : '';
    return `<span class="name">나 · ${esc(E.COMMANDERS[P.commander].name)}</span>
      ${barHtml(state, P)}
      <div class="pips" title="마나 ${P.mana} / ${P.maxMana}">${pips.join('')}</div>
      <span class="meta">마나 <b>${P.mana}/${P.maxMana}</b> · 손패 <b>${P.hand.length}</b> · 덱 <b>${P.deck.length}</b> · 유닛 <b>${F.unitsOf(state, ME).length}/${state.rules.unitCap}</b></span>
      <span class="lastplay">${P.dead ? '지휘관이 쓰러졌다' : last}</span>`;
  }

  function playerHtml(state, p) {
    const P = state.players[p];
    if (P.isBoss) return `<div><b>${esc(P.name)}</b> <small>보스</small></div>${barHtml(state, P)}`;
    const last = P.lastPlayed && state.timeMs - P.lastPlayed.at < 4000 ? ` · 낸 카드: ${esc(P.lastPlayed.name)}` : '';
    const role = state.format === 'alliance' && !F.isEnemy(state, ME, p) ? '아군 · ' : '';
    return `<div><b>${esc(P.name)}</b> <small>${role}${esc(E.COMMANDERS[P.commander].name)}${P.dead ? ' · 쓰러짐' : ` · 유닛 ${F.unitsOf(state, p).length} · 손패 ${P.hand.length} · 마나 ${P.mana}/${P.maxMana}${last}`}</small></div>
      ${barHtml(state, P)}`;
  }

  /** 지금 고른 카드로 누를 수 있는 배치 칸과 유닛 */
  function currentTargets() {
    const out = { cells: new Set(), units: new Set() };
    if (!game || !game.sel || game.sel.mode !== 'play') return out;
    const { state, sel } = game;
    const c = state.players[ME].hand.find((h) => h.uid === sel.uid);
    if (!c) return out;
    const def = E.CARDS[c.id];
    for (const t of F.legalTargets(state, ME, sel.uid)) {
      if (!t) continue;
      if (def.target === 'slot') {
        if (t.cell !== undefined) out.cells.add(t.cell);
        else out.units.add(t.replace);
      } else if (def.target === 'allyMove') {
        if (!sel.unitId) out.units.add(t.unitId);
        else if (t.unitId === sel.unitId) out.cells.add(t.cell);
      } else if (t.unitId) out.units.add(t.unitId);
    }
    return out;
  }

  function render() {
    if (!game) return;
    const { state } = game;
    const r = state.rules;
    const t = state.timeMs;
    el.clock.textContent = (t / 1000).toFixed(1);
    el.timefill.style.width = `${Math.min(100, (t / r.battleMs) * 100)}%`;
    el.timefill.classList.toggle('overtime', t > r.overtimeMs);

    patch('cmd0', el.cmd0, commanderHtml(state));
    state.players.forEach((P, p) => {
      if (p !== ME) {
        const node = fp(p);
        patch(`fp${p}`, node, playerHtml(state, p));
        node.classList.toggle('dead', P.dead);
      }
      const b = game.baseEls[p];
      if (!b) return;
      b.textContent = state.capture ? `${Math.floor(P.capMs / 1000)}점` : P.dead ? '✕' : state.format === 'boss' ? '' : fmt(Math.max(0, P.hp));
      b.classList.toggle('dead', P.dead);
    });
    if (game.zoneEl) {
      const cap = state.capture;
      const contested = cap.holder < 0 && cap.counts.filter((c) => c > 0).length > 1;
      game.zoneEl.style.setProperty('--c', cap.holder >= 0 ? colorOf(state, cap.holder) : '#8892a6');
      game.zoneEl.classList.toggle('held', cap.holder >= 0);
      game.zoneEl.textContent = cap.holder >= 0 ? `${state.players[cap.holder].name} 점령 중` : contested ? '경합' : '비어 있다';
    }

    const targets = currentTargets();
    for (const c of F.deployCells(state, ME)) {
      const node = game.cellEls[c.i];
      node.classList.toggle('free', c.free);
      node.classList.toggle('target', targets.cells.has(c.i));
    }
    renderUnits(targets);
    renderHand();
    renderHint();
  }

  function renderHand() {
    const { state, sel } = game;
    const P = state.players[ME];
    const selCard = sel && sel.mode === 'play' ? P.hand.find((h) => h.uid === sel.uid) : null;
    const picking = selCard && E.CARDS[selCard.id].target === 'handFused';
    const pickable = picking ? new Set(F.legalTargets(state, ME, sel.uid).map((x) => x.uid)) : new Set();
    const html = P.hand.map((c, i) => {
      const def = E.CARDS[c.id];
      const cost = F.effectiveCost(state, ME, c);
      const playable = F.legalTargets(state, ME, c.uid).length > 0;
      const cls = ['card', def.type];
      if (!playable && !(sel && sel.mode === 'redraw')) cls.push('off');
      if (sel && sel.uid === c.uid) cls.push('sel');
      if (pickable.has(c.uid) || (sel && sel.mode === 'redraw')) cls.push('pick');
      const star = state.rules.starMult ** (c.stars - 1);
      const fs = F.FIELD_STATS[c.id];
      const stat = def.type === 'unit'
        ? `${fmt(def.atk * star * state.rules.unitAtkMult)}/${fmt(def.hp * star * state.rules.unitHpMult)}/${def.interval / 1000}초 · ${def.ranged ? `사거리 ${fs.range}` : '근접'} · 속도 ${fs.speed}`
        : '';
      const fuse = c.fuse ? ` · ◆${E.KEYWORD_NAMES[c.fuse]}` : '';
      return `<div class="${cls.join(' ')}" data-uid="${c.uid}" role="button" tabindex="0">
        <span class="cost${cost < def.cost ? ' cheap' : ''}">${cost}</span><span class="key">${i + 1}</span>
        <span class="cname">${esc(E.cardLabel(c))}</span>
        <span class="ctype">${TYPE_NAMES[def.type]}${stat ? ` · ${stat}` : ''}${fuse}</span>
        <span class="ctext">${esc(F.fieldText(c.id))}</span>
      </div>`;
    });
    const rd = F.canRedraw(state, ME);
    const cdLeft = Math.max(0, P.redrawReadyAt - state.timeMs);
    html.push(`<div class="card redraw-btn${rd.ok ? ' on' : ' off'}${sel && sel.mode === 'redraw' ? ' sel' : ''}" data-redraw="1" role="button" tabindex="0">
      다시 뽑기 (\`)<br><small>마나 1 · ${cdLeft > 0 ? `${(cdLeft / 1000).toFixed(1)}초 뒤` : '준비됨'}</small></div>`);
    patch('hand', el.hand, html.join(''));
  }

  function renderHint() {
    const { state, sel } = game;
    let text = game.speed === 0 ? '일시정지. 멈춘 동안에도 카드를 낼 수 있다. ' : '';
    if (sel && sel.mode === 'redraw') text += '버릴 카드를 고른다. (Esc: 취소)';
    else if (sel) {
      const c = state.players[ME].hand.find((h) => h.uid === sel.uid);
      const def = c ? E.CARDS[c.id] : null;
      if (def) {
        const full = F.unitsOf(state, ME).length >= state.rules.unitCap;
        const how = {
          slot: full ? '유닛이 가득 찼다. 대체할 내 유닛을 누른다.' : '내 배치 칸(본진 앞의 점선 칸)을 고른다.',
          enemyUnit: '적 유닛을 누른다.',
          allyUnit: '내 유닛을 누른다.',
          allyUltUnit: '필살기가 있는 내 유닛을 누른다.',
          allyMove: sel.unitId ? '옮길 배치 칸을 고른다.' : '옮길 내 유닛을 누른다.',
          handFused: '손패의 융합 카드를 고른다.',
        }[def.target] || '';
        text += `${E.cardLabel(c)}: ${how} (Esc: 취소)`;
      }
    }
    el.hint.textContent = text;
  }

  // ───────────────────────── 이벤트 → 기록·효과 ─────────────────────────

  function floatAt(x, y, text, cls = '') {
    const f = document.createElement('span');
    f.className = `ffloat ${cls}`;
    f.textContent = text;
    const [px, py] = toPx(x, y);
    Object.assign(f.style, { left: `${px + Math.round(Math.random() * 16 - 8)}px`, top: `${py - 22}px` });
    el.arena.append(f);
    setTimeout(() => f.remove(), 750);
  }

  function shotLine(from, to, color) {
    const svg = el.arena.querySelector('.shots');
    if (!svg) return;
    const [x1, y1] = toPx(from.x, from.y);
    const [x2, y2] = toPx(to.x, to.y);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    for (const [k, v] of Object.entries({ x1, y1, x2, y2, stroke: color, class: 'shot' })) line.setAttribute(k, v);
    svg.append(line);
    setTimeout(() => line.remove(), 260);
  }

  function logLine(t, p, html, cls = '') {
    const li = document.createElement('li');
    li.className = `p${p === ME ? 0 : 1} ${cls}`;
    li.innerHTML = `<time>${(t / 1000).toFixed(1)}</time>${html}`;
    el.log.prepend(li);
    while (el.log.children.length > 60) el.log.lastChild.remove();
  }

  function consumeEvents() {
    const { state } = game;
    const who = (p) => `<b style="color:${colorOf(state, p)}">${esc(state.players[p].name)}</b>`;
    const dmg = new Map();
    for (const e of state.events) {
      switch (e.type) {
        case 'play': logLine(e.t, e.p, `${who(e.p)} ${esc(e.name)} <small>(${e.cost})</small>${e.combo ? ' · 연계' : ''}`); break;
        case 'redraw': logLine(e.t, e.p, `${who(e.p)} 다시 뽑기`); break;
        case 'death': logLine(e.t, e.p, `${who(e.p)}의 ${esc(e.name)} 쓰러짐`); break;
        case 'telegraph': logLine(e.t, e.p, `${who(e.p)} 필살기 전조`, 'warn'); break;
        case 'ult': logLine(e.t, e.p, `${who(e.p)} 필살기 발동`, 'warn'); break;
        case 'commanderDown': logLine(e.t, e.p, `${who(e.p)}의 지휘관이 쓰러졌다`, 'warn'); break;
        case 'capture':
          if (e.p >= 0) logLine(e.t, e.p, `${who(e.p)} 원을 차지했다`, 'warn');
          else logLine(e.t, e.from, `${who(e.from)} 원을 놓쳤다`);
          break;
        case 'killScore':
          // 난투장 처치 점수: 쓰러진 자리에 금색으로 띄운다 (원 안이면 2배)
          floatAt(e.x, e.y + 0.6, `+${fmt(e.points)}점`, `score${e.by.includes(ME) ? ' mine' : ''}`);
          break;
        case 'teleport': game.jumped.add(e.unitId); break;
        case 'damage': {
          const d = dmg.get(e.unitId) || { x: e.x, y: e.y, amount: 0 };
          d.amount += e.amount;
          dmg.set(e.unitId, d);
          break;
        }
        case 'heal': if (e.amount >= 0.5) floatAt(e.x, e.y, `+${fmt(e.amount)}`, 'heal'); break;
        case 'attack':
          // 원거리 공격과 본진을 치는 공격은 선으로 보여 준다
          if (e.ranged || e.target.commander !== undefined) shotLine(e, e.target, colorOf(state, e.p));
          break;
        case 'commanderDamage': {
          const node = e.p === ME ? el.cmd0 : fp(e.p);
          if (node) {
            node.classList.remove('shake');
            void node.offsetWidth;
            node.classList.add('shake');
          }
          break;
        }
        default: break;
      }
    }
    for (const [id, d] of dmg) {
      floatAt(d.x, d.y, `-${fmt(d.amount)}`);
      const node = game.unitEls.get(id);
      if (node) {
        node.classList.remove('hit');
        void node.offsetWidth;
        node.classList.add('hit');
      }
    }
    state.events.length = 0;
  }

  // ───────────────────────── 입력 ─────────────────────────

  function act(action) {
    const res = F.applyAction(game.state, ME, action);
    game.sel = null;
    consumeEvents();
    render();
    if (!res.ok) el.hint.textContent = `낼 수 없다: ${res.reason}`;
    if (game.state.over) finish();
    return res.ok;
  }

  function selectCard(uid) {
    const { state, sel } = game;
    if (state.over) return;
    const P = state.players[ME];
    const c = P.hand.find((h) => h.uid === uid);
    if (!c) return;
    if (sel && sel.mode === 'redraw') {
      act({ type: 'redraw', uid });
      return;
    }
    if (sel && sel.mode === 'play' && sel.uid !== uid) {
      const selCard = P.hand.find((h) => h.uid === sel.uid);
      if (selCard && E.CARDS[selCard.id].target === 'handFused') {
        act({ type: 'play', uid: sel.uid, target: { uid } });
        return;
      }
    }
    if (sel && sel.uid === uid) {
      game.sel = null;
      render();
      return;
    }
    if (!F.legalTargets(state, ME, uid).length) {
      game.sel = null;
      render();
      el.hint.textContent = `${E.cardLabel(c)}: 지금은 낼 수 없다${F.effectiveCost(state, ME, c) > P.mana ? ' (마나 부족)' : ' (쓸 대상이 없다)'}`;
      return;
    }
    if (E.CARDS[c.id].target === 'none') {
      act({ type: 'play', uid });
      return;
    }
    game.sel = { mode: 'play', uid, unitId: null };
    render();
  }

  function selectedDef() {
    const { state, sel } = game;
    if (!sel || sel.mode !== 'play' || state.over) return null;
    const c = state.players[ME].hand.find((h) => h.uid === sel.uid);
    return c ? E.CARDS[c.id] : null;
  }

  function clickCell(i) {
    const def = selectedDef();
    if (!def) return;
    const { sel } = game;
    if (def.target === 'slot') act({ type: 'play', uid: sel.uid, target: { cell: i } });
    else if (def.target === 'allyMove' && sel.unitId) act({ type: 'play', uid: sel.uid, target: { unitId: sel.unitId, cell: i } });
  }

  function clickUnit(id) {
    const def = selectedDef();
    if (!def) return;
    const { state, sel } = game;
    const u = F.findUnit(state, id);
    if (!u) return;
    const mine = u.owner === ME;
    switch (def.target) {
      case 'slot': if (mine) act({ type: 'play', uid: sel.uid, target: { replace: id } }); break;
      case 'enemyUnit': if (F.isEnemy(state, ME, u.owner)) act({ type: 'play', uid: sel.uid, target: { unitId: id } }); break;
      case 'allyUnit':
      case 'allyUltUnit': if (mine) act({ type: 'play', uid: sel.uid, target: { unitId: id } }); break;
      case 'allyMove':
        if (mine) {
          sel.unitId = id;
          render();
        }
        break;
      default: break;
    }
  }

  function toggleRedraw() {
    if (!game || game.state.over) return;
    if (game.sel && game.sel.mode === 'redraw') game.sel = null;
    else if (F.canRedraw(game.state, ME).ok) game.sel = { mode: 'redraw' };
    else el.hint.textContent = `다시 뽑기 불가: ${F.canRedraw(game.state, ME).reason}`;
    render();
  }

  const visible = () => game && !root.hidden && root.offsetParent !== null;

  /** 전투 화면이 보이는 동안의 단축키. 처리했으면 true. */
  function onKey(ev) {
    if (!visible() || game.state.over) return false;
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return false;
    if (ev.target instanceof Element && ev.target.matches('input, select, textarea')) return false;
    let handled = true;
    const m = /^(?:Digit|Numpad)(\d)$/.exec(ev.code);
    if (m) {
      const c = game.state.players[ME].hand[Number(m[1]) - 1];
      if (c) selectCard(c.uid);
    } else if (ev.code === 'Backquote') toggleRedraw();
    else if (ev.code === 'Escape') {
      game.sel = null;
      render();
    } else if (ev.code === 'Space') setSpeed(game.speed === 0 ? 1 : 0);
    else if (ev.code === 'Minus' || ev.code === 'Equal') {
      const i = SPEEDS.indexOf(game.speed === 0 ? 1 : game.speed);
      setSpeed(SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, i + (ev.code === 'Equal' ? 1 : -1)))]);
    } else {
      handled = false;
      KEY_ROWS.forEach((row, vr) => {
        const col = row.indexOf(ev.code);
        if (col >= 0) {
          clickCell(F.cellIndex(col, F.DEPLOY_ROWS - 1 - vr));
          handled = true;
        }
      });
    }
    if (handled) ev.preventDefault();
    return handled;
  }

  el.arena.addEventListener('pointerdown', (ev) => {
    if (!game) return;
    const unit = ev.target.closest('.funit');
    if (unit) {
      clickUnit(Number(unit.dataset.id));
      return;
    }
    const cell = ev.target.closest('.dcell.mine');
    if (cell) clickCell(Number(cell.dataset.cell));
  });
  el.hand.addEventListener('pointerdown', (ev) => {
    if (!game) return;
    const card = ev.target.closest('.card');
    if (!card) return;
    if (card.dataset.redraw) toggleRedraw();
    else selectCard(card.dataset.uid);
  });
  el.speed.addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (b) setSpeed(Number(b.dataset.speed));
  });
  el.quit.addEventListener('click', () => {
    stop();
    if (opts.onQuit) opts.onQuit();
  });
  // 창 크기가 바뀌면 필드를 다시 그린다 (배율이 달라진다)
  window.addEventListener('resize', () => {
    if (!visible()) return;
    buildArena();
    game.cache.clear();
    render();
  });

  return {
    start,
    stop,
    onKey,
    get state() {
      return game ? game.state : null;
    },
    /** 엔진을 직접 움직인 뒤에 화면을 맞춘다 (자동 검증용). 끝났으면 onFinish도 부른다. */
    refresh() {
      if (!game) return;
      consumeEvents();
      render();
      if (game.state.over) finish();
    },
  };
}
