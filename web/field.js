// 유닛 소환 전투 시제품의 플레이 화면. 규칙은 ../engine/field.js 에 있고, 여기는 그리기와 입력만 한다.
// 칸은 내 본진 앞의 배치 칸뿐이고, 유닛은 필드 위를 자유롭게 움직인다. 나는 항상 0번 자리(아래쪽)다.

import * as E from '../engine/index.js';

const F = E.Field;
const ME = 0;
const $ = (id) => document.getElementById(id);
const TYPE_NAMES = { unit: '유닛', spell: '주문', buff: '강화', ops: '운영' };
const FORMATS = {
  duel: { name: '결투 (1:1)', n: 2, maxWidth: 500 },
  melee4: { name: '난투장 (4인 · 중앙 점령)', n: 4, maxWidth: 640 },
  alliance: { name: '연합전 (2:2)', n: 4, maxWidth: 860 },
};
const COLORS = { me: '#4f9dff', ally: '#5fd08a', foes: ['#ff6b6b', '#f2a14e', '#c08bff'] };
const fmt = (x) => (Math.abs(x - Math.round(x)) < 0.05 ? String(Math.round(x)) : x.toFixed(1));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// 내 배치 칸을 가리키는 키: 화면에서 보이는 위치 그대로 (앞줄 QWERT, 가운뎃줄 ASDFG, 뒷줄 ZXCVB)
const KEY_ROWS = [
  ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT'],
  ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG'],
  ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB'],
];
const KEY_LETTERS = ['QWERT', 'ASDFG', 'ZXCVB'];
const SPEEDS = [0.5, 1, 2];

// ─────────────────────────────────────────────────────────────
// 설정
// ─────────────────────────────────────────────────────────────

const setup = { players: [], salt: 0 };

function fillSelect(el, options, value) {
  el.innerHTML = options.map(([v, label]) => `<option value="${esc(v)}">${esc(label)}</option>`).join('');
  if (value !== undefined) el.value = value;
}

function deckChips(deck) {
  return E.deckSummary(deck)
    .sort((a, b) => E.CARDS[a.id].cost - E.CARDS[b.id].cost || a.id.localeCompare(b.id))
    .map((d) => {
      const def = E.CARDS[d.id];
      return `<span class="chip ${def.type}" title="${esc(F.fieldText(d.id))}"><b>${def.cost}</b>${esc(E.cardLabel(d))}${d.n > 1 ? ` ×${d.n}` : ''}</span>`;
    })
    .join('');
}

/** 형식에 따른 자리별 역할: 나, 아군, 상대 */
function roleName(format, i) {
  if (i === ME) return '나';
  if (format === 'alliance') return i === 1 ? '아군' : `상대 ${i - 1}`;
  return FORMATS[format].n === 2 ? '상대' : `상대 ${i}`;
}

function refreshSetup() {
  const seed = $('seed').value;
  const format = $('format').value;
  const n = FORMATS[format].n;
  const rng = E.makeRng(E.hashSeed(seed, 'others', format, setup.salt));
  setup.players = [];
  for (let i = 0; i < n; i++) {
    let commander = i === ME ? $('myCommander').value : i === 1 ? $('opCommander').value : 'random';
    if (commander === 'random') commander = rng.pick(E.COMMANDER_IDS);
    const type = $(i === ME ? 'myDeckType' : 'opDeckType').value;
    const deck = type === 'start'
      ? E.startDeck(commander)
      : E.randomMidDeck(commander, E.makeRng(E.hashSeed(seed, 'deck', i, commander, setup.salt)));
    setup.players.push({ commander, deck });
  }
  const me = setup.players[ME];
  $('myPassive').textContent = `패시브: ${E.COMMANDERS[me.commander].passive}`;
  $('myDeck').innerHTML = deckChips(me.deck);
  $('opPassive').textContent = n > 2 ? `봇 ${n - 1}명. 지휘관 선택은 ${roleName(format, 1)}에게만 적용되고 나머지는 무작위다.` : `패시브: ${E.COMMANDERS[setup.players[1].commander].passive}`;
  $('opDeck').innerHTML = setup.players.slice(1).map((p, k) => `<div class="opp" style="width:100%"><small>${roleName(format, k + 1)} · ${E.COMMANDERS[p.commander].name}</small><div class="decklist">${deckChips(p.deck)}</div></div>`).join('');
}

function initSetup() {
  const cmds = E.COMMANDER_IDS.map((id) => [id, E.COMMANDERS[id].name]);
  fillSelect($('myCommander'), cmds, 'general');
  fillSelect($('opCommander'), [['random', '무작위'], ...cmds], 'random');
  fillSelect($('format'), Object.entries(FORMATS).map(([id, f]) => [id, f.name]), 'duel');
  fillSelect($('battlefield'), [
    ['none', '없음'],
    ['random', '무작위'],
    ...E.BATTLEFIELD_IDS.map((id) => [id, E.BATTLEFIELDS[id].name]),
  ], 'none');
  $('seed').value = String(1 + Math.floor(Math.random() * 99999));
  for (const id of ['myCommander', 'myDeckType', 'opCommander', 'opDeckType', 'seed', 'format']) $(id).addEventListener('change', refreshSetup);
  $('reroll').addEventListener('click', () => {
    setup.salt++;
    refreshSetup();
  });
  $('start').addEventListener('click', () => startBattle());
  const r = F.FIELD_RULES;
  $('rulesNote').textContent = `지휘관 체력 ${r.commanderHp} · 유닛 공격 ×${r.unitAtkMult} · 유닛 체력 ×${r.unitHpMult} · 유닛은 ${r.unitCap}기까지 · 난투장은 본진을 치지 않고, 가운데 원 안에 유닛이 가장 많은 사람이 1초에 1점씩 얻어 ${r.captureGoal}점에 먼저 닿으면 이긴다`;
  $('statTable').innerHTML = `<div class="decklist">${Object.entries(F.FIELD_STATS).map(([id, s]) => {
    const def = E.CARDS[id];
    return `<span class="chip unit" title="${esc(F.fieldText(id))}"><b>${def.cost}</b>${esc(def.name)} · ${def.ranged ? '원거리' : '근접'} · 사거리 ${s.range} · 속도 ${s.speed}</span>`;
  }).join('')}</div>`;
  refreshSetup();
}

// ─────────────────────────────────────────────────────────────
// 전투
// ─────────────────────────────────────────────────────────────

let game = null;

function fieldEffectText(id) {
  return {
    rain: '원거리 유닛의 공격 간격 +20%',
    canyon: '배치 칸의 양쪽 끝 줄을 쓸 수 없다',
    fog: '처음 5초 동안 원거리 유닛은 표적이 되지 않는다',
    citadel: '근접 유닛 체력 +20%',
    surge: '필살기 게이지 충전 +50%',
    volcano: '10초마다 모든 유닛이 최대 체력의 5% 피해를 받는다',
  }[id];
}

function colorOf(state, i) {
  if (i === ME) return COLORS.me;
  if (!F.isEnemy(state, ME, i)) return COLORS.ally;
  const foes = state.players.map((P) => P.idx).filter((q) => F.isEnemy(state, ME, q));
  return COLORS.foes[foes.indexOf(i) % COLORS.foes.length];
}

function startBattle() {
  const seed = Number($('seed').value) || 1;
  const format = $('format').value;
  let battlefield = $('battlefield').value;
  if (battlefield === 'none') battlefield = null;
  else if (battlefield === 'random') battlefield = E.makeRng(E.hashSeed(seed, 'field')).pick(E.BATTLEFIELD_IDS);
  const state = F.createField({
    seed,
    format,
    battlefield,
    players: setup.players.map((p, i) => ({ ...p, name: roleName(format, i) })),
  });
  game = {
    state,
    bots: state.players.map((P, i) => (i === ME ? null : E.createFieldBot({ seed: E.hashSeed(seed, 'bot', i), ...E.BOT_LEVELS[$('botLevel').value] }))),
    speed: 1,
    timer: null,
    sel: null, // { mode: 'play'|'redraw', uid, unitId }
    cache: new Map(),
    unitEls: new Map(),
    teleEls: new Map(),
    jumped: new Set(), // 이번 그리기에서 순간이동한 유닛 (부드럽게 잇지 않는다)
  };
  $('fsetup').hidden = true;
  $('tabs').hidden = true;
  $('result').hidden = true;
  $('fbattle').hidden = false;
  $('clockMax').textContent = String(state.rules.battleMs / 1000);
  $('overtimeMark').style.left = `${(state.rules.overtimeMs / state.rules.battleMs) * 100}%`;
  $('fieldInfo').textContent = `${FORMATS[format].name} · ${battlefield ? `전장: ${E.BATTLEFIELDS[battlefield].name} — ${fieldEffectText(battlefield)}` : '전장: 없음'}`;
  $('log').innerHTML = '';
  buildArena();
  setSpeed(1);
  consumeEvents();
  render();
}

function toSetup() {
  if (game && game.timer) clearTimeout(game.timer);
  game = null;
  $('result').hidden = true;
  $('fbattle').hidden = true;
  $('fsetup').hidden = false;
  $('tabs').hidden = false;
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
  // 봇들이 같은 순간의 상태를 보고 판단한 뒤에 차례로 적용한다
  F.applyActions(state, game.bots.map((bot, i) => (bot ? bot.decide(state, i) : null)));
  F.step(state);
  consumeEvents();
  render();
  if (state.over) showResult();
  else schedule();
}

function setSpeed(v) {
  if (!game) return;
  game.speed = v;
  for (const b of $('speed').querySelectorAll('button')) b.classList.toggle('on', Number(b.dataset.speed) === v);
  schedule();
}

// ─────────────────────────────────────────────────────────────
// 필드 그리기
// ─────────────────────────────────────────────────────────────

/** 필드의 크기(게임 단위)와 화면 배율 */
function view() {
  const a = game.state.arena;
  const w = a.shape === 'circle' ? a.r * 2 : a.w;
  const h = a.shape === 'circle' ? a.r * 2 : a.h;
  return { w, h, scale: $('arena').clientWidth / w };
}

/** 필드 좌표(가운데가 0, 위가 +y) → 화면 좌표 */
function toPx(x, y) {
  const v = view();
  return [(x + v.w / 2) * v.scale, (v.h / 2 - y) * v.scale];
}

function buildArena() {
  const { state } = game;
  const arena = $('arena');
  const a = state.arena;
  arena.innerHTML = '<svg id="shots"></svg>';
  arena.classList.toggle('circle', a.shape === 'circle');
  const v0 = { w: a.shape === 'circle' ? a.r * 2 : a.w, h: a.shape === 'circle' ? a.r * 2 : a.h };
  arena.style.aspectRatio = `${v0.w} / ${v0.h}`;
  // 필드와 손패가 한 화면에 들어오도록, 필드 높이를 화면 높이의 60%쯤으로 묶는다
  arena.style.width = `min(100%, ${FORMATS[state.format].maxWidth}px, ${(60 * v0.w) / v0.h}vh)`;
  game.unitEls.clear();
  game.teleEls.clear();
  game.cellEls = [];
  game.baseEls = [];
  const v = view();

  // 배치 칸: 내 칸은 누를 수 있고, 다른 사람의 칸은 흐리게만 보인다
  state.players.forEach((P, p) => {
    for (const c of F.deployCells(state, p)) {
      const el = document.createElement('div');
      el.className = `dcell${p === ME ? ' mine' : ''}${c.blocked ? ' blocked' : ''}`;
      const [px, py] = toPx(c.x, c.y);
      const size = F.CELL * v.scale - 4;
      Object.assign(el.style, { left: `${px}px`, top: `${py}px`, width: `${size}px`, height: `${size}px` });
      if (p === ME) {
        el.dataset.cell = c.i;
        el.innerHTML = `<span class="keyhint">${KEY_LETTERS[F.DEPLOY_ROWS - 1 - c.row][c.col]}</span>`;
        game.cellEls[c.i] = el;
      } else el.style.borderColor = `${colorOf(state, p)}55`;
      arena.append(el);
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

  // 본진
  state.players.forEach((P, p) => {
    const el = document.createElement('div');
    el.className = 'fbase';
    el.style.setProperty('--c', colorOf(state, p));
    const [px, py] = toPx(P.base.x, P.base.y);
    const size = state.rules.baseRadius * 2 * v.scale;
    Object.assign(el.style, { left: `${px}px`, top: `${py}px`, width: `${size}px`, height: `${size}px` });
    arena.append(el);
    game.baseEls[p] = el;
  });

  // 다른 플레이어들의 상태
  $('players').innerHTML = state.players.map((P, p) => (p === ME ? '' : `<div class="fplayer" id="fp${p}" style="--c:${colorOf(state, p)}"></div>`)).join('');
}

function patch(key, el, html) {
  if (game.cache.get(key) === html) return;
  game.cache.set(key, html);
  el.innerHTML = html;
}

function unitTitle(state, u) {
  const tags = [u.ranged ? `사거리 ${u.range}` : '근접', ...u.keywords.map((k) => E.KEYWORD_NAMES[k] || k)];
  if (u.slows.length) tags.push(`감속×${u.slows.length}`);
  if (u.silenceUntil > state.timeMs) tags.push('침묵');
  for (const b of u.buffs) tags.push(b.kind === 'atk' ? `공+${fmt(b.amount)}` : '갑옷');
  if (u.tripleShot) tags.push('3연사 준비');
  return `${u.name} · 공 ${fmt(F.currentAtk(state, u))} · 체 ${fmt(Math.max(0, u.hp))}/${fmt(u.maxHp)} · ${tags.join(', ')}`;
}

function renderUnits(targets) {
  const { state } = game;
  const arena = $('arena');
  const v = view();
  const alive = new Set();
  for (const u of state.units) {
    alive.add(u.id);
    let el = game.unitEls.get(u.id);
    const size = Math.max(22, u.radius * 2 * v.scale);
    if (!el) {
      el = document.createElement('div');
      el.className = `funit${u.ranged ? ' ranged' : ''}`;
      el.dataset.id = u.id;
      el.style.setProperty('--c', colorOf(state, u.owner));
      Object.assign(el.style, { width: `${size}px`, height: `${size}px` });
      const base = E.CARDS[u.defId].name;
      const label = `${u.token ? '·' : ''}${size >= 44 ? base : base.slice(0, 2)}${u.stars > 1 ? `<br>${'★'.repeat(u.stars)}` : ''}`;
      el.innerHTML = `<span>${label}</span><div class="gz"${u.ult ? '' : ' hidden'}><i></i></div><div class="hp"><i></i></div>`;
      arena.append(el);
      game.unitEls.set(u.id, el);
      game.jumped.add(u.id); // 처음 나타날 때는 그 자리에 바로 놓는다
    }
    const [px, py] = toPx(u.x, u.y);
    el.style.transition = game.jumped.has(u.id) || game.speed === 0 ? 'none' : `transform ${state.rules.tickMs / game.speed}ms linear`;
    el.style.transform = `translate(${px - size / 2}px, ${py - size / 2}px)`;
    el.querySelector('.hp i').style.width = `${Math.max(0, (u.hp / u.maxHp) * 100)}%`;
    if (u.ult) el.querySelector('.gz i').style.width = `${u.telegraphing ? 100 : u.gauge}%`;
    el.classList.toggle('casting', u.telegraphing);
    el.classList.toggle('target', targets.units.has(u.id));
    el.title = unitTitle(state, u);
  }
  game.jumped.clear();
  for (const [id, el] of game.unitEls) {
    if (alive.has(id)) continue;
    el.remove();
    game.unitEls.delete(id);
  }

  // 필살기 전조 범위
  const live = new Set();
  for (const g of state.telegraphs) {
    live.add(g.id);
    let el = game.teleEls.get(g.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'ftele';
      const [px, py] = toPx(g.x, g.y);
      const size = g.radius * 2 * v.scale;
      Object.assign(el.style, { left: `${px}px`, top: `${py}px`, width: `${size}px`, height: `${size}px` });
      arena.append(el);
      game.teleEls.set(g.id, el);
    }
    el.textContent = (Math.max(0, g.fireAt - state.timeMs) / 1000).toFixed(1);
  }
  for (const [id, el] of game.teleEls) {
    if (live.has(id)) continue;
    el.remove();
    game.teleEls.delete(id);
  }
}

/** 결투·연합전은 지휘관 체력, 난투장은 점령 점수 */
function barHtml(state, P) {
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
  const last = P.lastPlayed && state.timeMs - P.lastPlayed.at < 4000 ? ` · 낸 카드: ${esc(P.lastPlayed.name)}` : '';
  return `<div><b>${esc(P.name)}</b> <small>${esc(E.COMMANDERS[P.commander].name)}${P.dead ? ' · 쓰러짐' : ` · 유닛 ${F.unitsOf(state, p).length} · 손패 ${P.hand.length} · 마나 ${P.mana}/${P.maxMana}${last}`}</small></div>
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
  const { state } = game;
  const r = state.rules;
  const t = state.timeMs;
  $('clock').textContent = (t / 1000).toFixed(1);
  const fill = $('timefill');
  fill.style.width = `${Math.min(100, (t / r.battleMs) * 100)}%`;
  fill.classList.toggle('overtime', t > r.overtimeMs);

  patch('cmd0', $('cmd0'), commanderHtml(state));
  state.players.forEach((P, p) => {
    if (p !== ME) {
      patch(`fp${p}`, $(`fp${p}`), playerHtml(state, p));
      $(`fp${p}`).classList.toggle('dead', P.dead);
    }
    game.baseEls[p].textContent = state.capture ? `${Math.floor(P.capMs / 1000)}점` : P.dead ? '✕' : fmt(Math.max(0, P.hp));
    game.baseEls[p].classList.toggle('dead', P.dead);
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
    const el = game.cellEls[c.i];
    el.classList.toggle('free', c.free);
    el.classList.toggle('target', targets.cells.has(c.i));
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
  patch('hand', $('hand'), html.join(''));
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
  $('hint').textContent = text;
}

// ─────────────────────────────────────────────────────────────
// 이벤트 → 기록·효과
// ─────────────────────────────────────────────────────────────

function floatAt(x, y, text, cls = '') {
  const f = document.createElement('span');
  f.className = `ffloat ${cls}`;
  f.textContent = text;
  const [px, py] = toPx(x, y);
  Object.assign(f.style, { left: `${px + Math.round(Math.random() * 16 - 8)}px`, top: `${py - 22}px` });
  $('arena').append(f);
  setTimeout(() => f.remove(), 750);
}

function shotLine(from, to, color) {
  const svg = $('shots');
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
  const log = $('log');
  log.prepend(li);
  while (log.children.length > 60) log.lastChild.remove();
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
        const el = e.p === ME ? $('cmd0') : $(`fp${e.p}`);
        if (el) {
          el.classList.remove('shake');
          void el.offsetWidth;
          el.classList.add('shake');
        }
        break;
      }
      default: break;
    }
  }
  for (const [id, d] of dmg) {
    floatAt(d.x, d.y, `-${fmt(d.amount)}`);
    const el = game.unitEls.get(id);
    if (el) {
      el.classList.remove('hit');
      void el.offsetWidth;
      el.classList.add('hit');
    }
  }
  state.events.length = 0;
}

// ─────────────────────────────────────────────────────────────
// 입력
// ─────────────────────────────────────────────────────────────

function act(action) {
  const res = F.applyAction(game.state, ME, action);
  game.sel = null;
  consumeEvents();
  render();
  if (!res.ok) $('hint').textContent = `낼 수 없다: ${res.reason}`;
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
    $('hint').textContent = `${E.cardLabel(c)}: 지금은 낼 수 없다${F.effectiveCost(state, ME, c) > P.mana ? ' (마나 부족)' : ' (쓸 대상이 없다)'}`;
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
  else $('hint').textContent = `다시 뽑기 불가: ${F.canRedraw(game.state, ME).reason}`;
  render();
}

function onKey(ev) {
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
  if (ev.target instanceof Element && ev.target.matches('input, select, textarea')) return;
  if (!$('result').hidden) {
    if (ev.code === 'Enter' || ev.code === 'NumpadEnter') {
      $('again').click();
      ev.preventDefault();
    }
    return;
  }
  if (!game || $('fbattle').hidden) return;
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
}

function initInput() {
  $('arena').addEventListener('pointerdown', (ev) => {
    if (!game) return;
    const unit = ev.target.closest('.funit');
    if (unit) {
      clickUnit(Number(unit.dataset.id));
      return;
    }
    const cell = ev.target.closest('.dcell.mine');
    if (cell) clickCell(Number(cell.dataset.cell));
  });
  $('hand').addEventListener('pointerdown', (ev) => {
    if (!game) return;
    const el = ev.target.closest('.card');
    if (!el) return;
    if (el.dataset.redraw) toggleRedraw();
    else selectCard(el.dataset.uid);
  });
  $('speed').addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (b) setSpeed(Number(b.dataset.speed));
  });
  $('quit').addEventListener('click', toSetup);
  $('toSetup').addEventListener('click', toSetup);
  $('again').addEventListener('click', () => {
    $('seed').value = String(1 + Math.floor(Math.random() * 99999));
    refreshSetup();
    startBattle();
  });
  $('replay').addEventListener('click', () => startBattle());
  document.addEventListener('keydown', onKey);
  // 창 크기가 바뀌면 필드를 다시 그린다 (배율이 달라진다)
  window.addEventListener('resize', () => {
    if (!game || $('fbattle').hidden) return;
    buildArena();
    game.cache.clear();
    render();
  });
}

function showResult() {
  const { state } = game;
  const res = state.result;
  const n = state.players.length;
  const title = $('resultTitle');
  const myRank = res.ranks[ME];
  if (state.format === 'alliance') {
    const myTeam = state.players[ME].team;
    title.className = res.winnerTeam === myTeam ? 'win' : res.winnerTeam === -1 ? '' : 'lose';
    title.textContent = res.winnerTeam === myTeam ? '팀 승리' : res.winnerTeam === -1 ? '무승부' : '팀 패배';
  } else if (n > 2) {
    const shared = res.ranks.filter((r) => r === myRank).length > 1;
    title.className = myRank === 0 ? 'win' : myRank === n - 1 ? 'lose' : '';
    title.textContent = `${shared ? '공동 ' : ''}${myRank + 1}위`;
  } else {
    title.className = res.winner === ME ? 'win' : res.winner === -1 ? '' : 'lose';
    title.textContent = res.winner === ME ? '승리' : res.winner === -1 ? '무승부' : '패배';
  }
  const why = res.reason === 'commander' ? '지휘관이 쓰러졌다'
    : res.reason === 'capture' ? `점령 점수 ${state.capture.goal}점에 닿았다`
      : state.capture ? '시간이 다 됐다 (점령 점수로 판정)' : '시간이 다 됐다 (지휘관 체력 비율로 판정)';
  $('resultDetail').textContent = `${FORMATS[state.format].name} · ${(res.timeMs / 1000).toFixed(1)}초 · ${why} · 시드 ${state.seed}`;
  const order = [...state.players].sort((A, B) => res.ranks[A.idx] - res.ranks[B.idx] || A.idx - B.idx);
  const cap = !!state.capture;
  $('resultStats').innerHTML = `<tr><th></th><th>순위</th><th>${cap ? '점령 점수' : '지휘관 체력'}</th><th>낸 카드</th><th>유닛에 준 피해</th>${cap ? '' : '<th>지휘관에 준 피해</th>'}<th>걸은 거리</th></tr>${order.map((P) => `
    <tr class="${P.idx === ME ? 'mine' : ''}"><td>${esc(P.name)}</td><td>${res.ranks[P.idx] + 1}</td><td>${cap ? fmt(res.scores[P.idx]) : fmt(Math.max(0, P.hp))}</td>
    <td>${P.stats.cardsPlayed}</td><td>${fmt(P.stats.unitDamage)}</td>${cap ? '' : `<td>${fmt(P.stats.commanderDamage)}</td>`}<td>${fmt(P.stats.walked)}</td></tr>`).join('')}`;
  $('result').hidden = false;
}

initSetup();
initInput();

// 자동 검증과 디버깅용
window.__game = () => game;
window.__engine = E;
window.__render = () => {
  if (game) {
    consumeEvents();
    render();
    if (game.state.over && $('result').hidden) showResult();
  }
};
