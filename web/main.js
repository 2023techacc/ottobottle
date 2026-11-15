// 플레이 테스트 화면. 규칙은 전부 ../engine 에 있고, 여기는 그리기와 입력만 한다.

import * as E from '../engine/index.js';

const { FRONT, BACK } = E;
const ME = 0;
const OP = 1;
const $ = (id) => document.getElementById(id);
const TYPE_NAMES = { unit: '유닛', spell: '주문', buff: '강화', ops: '운영' };
const ROW_NAMES = ['전열', '후열'];

const fmt = (x) => (Math.abs(x - Math.round(x)) < 0.05 ? String(Math.round(x)) : x.toFixed(1));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ─────────────────────────────────────────────────────────────
// 설정 화면
// ─────────────────────────────────────────────────────────────

const setup = { decks: [null, null], deckSalt: 0, opening: [] };

function fillSelect(el, options, value) {
  el.innerHTML = options.map(([v, label]) => `<option value="${esc(v)}">${esc(label)}</option>`).join('');
  if (value !== undefined) el.value = value;
}

function initSetup() {
  const cmds = E.COMMANDER_IDS.map((id) => [id, E.COMMANDERS[id].name]);
  fillSelect($('myCommander'), cmds, 'general');
  fillSelect($('opCommander'), [['random', '무작위'], ...cmds], 'random');
  fillSelect($('battlefield'), [
    ['none', '없음'],
    ['random', '무작위'],
    ...E.BATTLEFIELD_IDS.map((id) => [id, `${E.BATTLEFIELDS[id].name} — ${E.BATTLEFIELDS[id].text}`]),
  ], 'none');
  const slots = [];
  for (const row of [FRONT, BACK]) for (let s = 0; s < 4; s++) slots.push([`${row}:${s}`, `${ROW_NAMES[row]} ${s + 1}번`]);
  fillSelect($('myVanguardSlot'), [['auto', '자동'], ...slots], 'auto');
  fillSelect($('preset'), Object.entries(E.PRESETS).map(([id, p]) => [id, p.name]), 'cards');
  $('seed').value = String(1 + Math.floor(Math.random() * 99999));

  for (const id of ['myCommander', 'myDeckType', 'opCommander', 'opDeckType', 'seed', 'preset']) {
    $(id).addEventListener('change', refreshSetup);
  }
  $('reroll').addEventListener('click', () => {
    setup.deckSalt++;
    refreshSetup();
  });
  $('start').addEventListener('click', () => startBattle());
  // 시작 카드 고르기: 내 덱의 카드를 눌러 고르거나 뺀다
  $('myDeck').addEventListener('click', (ev) => {
    const chip = ev.target.closest('.chip.pickable');
    if (!chip) return;
    const index = Number(chip.dataset.index);
    const max = fullRules().openingPicks;
    if (setup.opening.includes(index)) setup.opening = setup.opening.filter((i) => i !== index);
    else {
      setup.opening.push(index);
      while (setup.opening.length > max) setup.opening.shift();
    }
    renderMyDeck();
  });
  refreshSetup();
}

function resolveCommander(side) {
  const v = $(side === ME ? 'myCommander' : 'opCommander').value;
  if (v !== 'random') return v;
  const rng = E.makeRng(E.hashSeed($('seed').value, 'opCommander', setup.deckSalt));
  return rng.pick(E.COMMANDER_IDS);
}

function buildDeck(side, commander) {
  const type = $(side === ME ? 'myDeckType' : 'opDeckType').value;
  if (type === 'start') return E.startDeck(commander);
  const rng = E.makeRng(E.hashSeed($('seed').value, 'deck', side, commander, setup.deckSalt));
  return E.randomMidDeck(commander, rng);
}

function presetRules() {
  return E.PRESETS[$('preset').value].rules;
}

function fullRules() {
  return { ...E.DEFAULT_RULES, ...presetRules() };
}

function describeRules(rules) {
  const r = { ...E.DEFAULT_RULES, ...rules };
  const parts = [`지휘관 체력 ${r.commanderHp}`];
  if (r.unitAtkMult !== 1) parts.push(`유닛 공격 ×${r.unitAtkMult}`);
  if (r.unitHpMult !== 1) parts.push(`유닛 체력 ×${r.unitHpMult}`);
  if (r.vanguardSlots === 0) parts.push('선봉 없음');
  else if (r.vanguardMaxCost < 99) parts.push(`선봉은 ${r.vanguardMaxCost}마나 이하`);
  if (r.openingPicks > 0) parts.push(`시작 손패 ${r.startHand}장 중 ${r.openingPicks}장을 직접 고름`);
  return parts.join(' · ');
}

function deckChips(deck) {
  return E.deckSummary(deck)
    .sort((a, b) => E.CARDS[a.id].cost - E.CARDS[b.id].cost || a.id.localeCompare(b.id))
    .map((d) => {
      const def = E.CARDS[d.id];
      return `<span class="chip ${def.type}" title="${esc(def.text || '')}"><b>${def.cost}</b>${esc(E.cardLabel(d))}${d.n > 1 ? ` ×${d.n}` : ''}</span>`;
    })
    .join('');
}

/** 내 덱. 시작 카드를 고르는 규칙이면 카드를 한 장씩 따로 보여 주고 누를 수 있게 한다. */
function renderMyDeck() {
  const deck = setup.decks[ME];
  const max = fullRules().openingPicks;
  if (max <= 0) {
    $('pickHint').textContent = '';
    $('myDeck').innerHTML = deckChips(deck);
    return;
  }
  $('pickHint').textContent = `시작 손패에 반드시 넣을 카드를 고른다 (${setup.opening.length}/${max}). 덱의 카드를 눌러 바꾼다.`;
  $('myDeck').innerHTML = deck
    .map((c, index) => ({ c, index, def: E.CARDS[c.id] }))
    .sort((a, b) => a.def.cost - b.def.cost || a.c.id.localeCompare(b.c.id) || a.index - b.index)
    .map(({ c, index, def }) => {
      const picked = setup.opening.includes(index);
      return `<span class="chip ${def.type} pickable${picked ? ' picked' : ''}" data-index="${index}" role="button" title="${esc(def.text || '')}"><b>${def.cost}</b>${esc(E.cardLabel(c))}${picked ? ' ✓' : ''}</span>`;
    })
    .join('');
}

function refreshSetup() {
  const commanders = [resolveCommander(ME), resolveCommander(OP)];
  setup.commanders = commanders;
  setup.decks = [buildDeck(ME, commanders[ME]), buildDeck(OP, commanders[OP])];
  $('myPassive').textContent = `패시브: ${E.COMMANDERS[commanders[ME]].passive}`;
  $('opPassive').textContent = `${E.COMMANDERS[commanders[OP]].name} — 패시브: ${E.COMMANDERS[commanders[OP]].passive}`;
  const full = fullRules();
  // 봇이 고를 만한 카드로 미리 채워 둔다 (바로 시작해도 되게)
  setup.opening = E.pickOpening(setup.decks[ME], full.openingPicks, 'tempo', null, full.startMana);
  renderMyDeck();
  $('opDeck').innerHTML = deckChips(setup.decks[OP]);
  $('vanguardBox').hidden = full.vanguardSlots === 0;

  // 첩보원: 상대가 고른 시작 카드를 미리 본다 (그걸 보고 내 시작 카드를 바꿀 수 있다)
  setup.opOpening = E.pickOpening(setup.decks[OP], full.openingPicks, 'tempo', null, full.startMana);
  let spyNote = '';
  if (full.openingPicks > 0) {
    const names = setup.opOpening.map((i) => E.cardLabel(setup.decks[OP][i])).join(', ') || '없음';
    if (E.COMMANDERS[commanders[ME]].seesOpening) spyNote = `첩보원 패시브로 본 상대의 시작 카드: ${names}`;
    else if (E.COMMANDERS[commanders[OP]].seesOpening) spyNote = '상대 첩보원이 내 시작 카드를 미리 본다.';
  }
  $('opPicks').textContent = spyNote;

  const rules = presetRules();
  const maxCost = rules.vanguardMaxCost ?? 99;
  $('presetNote').textContent = describeRules(rules);
  const deck = setup.decks[ME];
  const auto = E.pickVanguard(deck, 1, { maxCost })[0];
  const units = deck
    .map((c, index) => ({ c, index }))
    .filter((x) => E.CARDS[x.c.id].type === 'unit' && E.CARDS[x.c.id].cost <= maxCost)
    .sort((a, b) => E.CARDS[b.c.id].cost - E.CARDS[a.c.id].cost);
  fillSelect($('myVanguard'), [
    ['none', '없음'],
    ...units.map((x) => [String(x.index), `${E.cardLabel(x.c)} (${E.CARDS[x.c.id].cost})`]),
  ], auto ? String(auto.index) : 'none');
}

// ─────────────────────────────────────────────────────────────
// 전투
// ─────────────────────────────────────────────────────────────

let game = null;

function startBattle(sameSeed = false) {
  if (!sameSeed && game) {
    // "새 시드로 다시": 시드만 바꾸고 나머지 설정은 유지
  }
  const seed = Number($('seed').value) || 1;
  const rules = presetRules();
  const commanders = setup.commanders;
  const decks = setup.decks;

  let battlefield = $('battlefield').value;
  if (battlefield === 'none') battlefield = null;
  else if (battlefield === 'random') battlefield = E.makeRng(E.hashSeed(seed, 'field')).pick(E.BATTLEFIELD_IDS);

  const full = fullRules();
  const vIndex = $('myVanguard').value;
  let myVanguard = [];
  if (full.vanguardSlots > 0 && vIndex !== 'none') {
    const index = Number(vIndex);
    const auto = E.pickVanguard([decks[ME][index]], 1)[0];
    let row = auto.row;
    let slot = auto.slot;
    const chosen = $('myVanguardSlot').value;
    if (chosen !== 'auto') [row, slot] = chosen.split(':').map(Number);
    if (battlefield === 'canyon' && row === FRONT && (slot === 0 || slot === 3)) slot = slot === 0 ? 1 : 2;
    myVanguard = [{ index, row, slot }];
  }

  launchBattle({
    cfg: {
      seed,
      battlefield,
      rules,
      players: [
        { commander: commanders[ME], deck: decks[ME], vanguard: myVanguard, opening: setup.opening },
        {
          commander: commanders[OP],
          deck: decks[OP],
          vanguard: E.pickVanguard(decks[OP], full.vanguardSlots, { maxCost: full.vanguardMaxCost }),
          opening: setup.opOpening,
        },
      ],
    },
    botOpts: { seed: E.hashSeed(seed, 'bot'), ...E.BOT_LEVELS[$('botLevel').value] },
  });
}

/** 지금 보이는 화면을 바꾼다 */
function showScreen(name) {
  for (const id of ['lobby', 'setup', 'shop', 'battle']) $(id).hidden = id !== name;
  $('modeTabs').hidden = name !== 'lobby' && name !== 'setup';
  $('result').hidden = true;
  $('roundResult').hidden = true;
  if (name === 'lobby' || name === 'setup') {
    for (const b of $('modeTabs').querySelectorAll('button')) b.classList.toggle('on', b.dataset.mode === name);
  }
}

/**
 * 전투 화면을 띄운다.
 * onFinish가 있으면 전투가 끝났을 때 결과 창 대신 그것을 부른다 (한 경기 모드).
 */
function launchBattle({ cfg, botOpts, onFinish = null, label = '' }) {
  const state = E.createBattle(cfg);
  game = {
    state,
    bot: E.createBot(botOpts),
    speed: 1,
    timer: null,
    sel: null, // { mode: 'play'|'redraw', uid, unitId }
    cache: new Map(),
    onFinish,
  };

  showScreen('battle');
  const battlefield = state.battlefield;
  $('clockMax').textContent = String(state.rules.battleMs / 1000);
  $('overtimeMark').style.left = `${(state.rules.overtimeMs / state.rules.battleMs) * 100}%`;
  $('fieldInfo').textContent = (label ? `${label} · ` : '')
    + (battlefield ? `전장: ${E.BATTLEFIELDS[battlefield].name} — ${E.BATTLEFIELDS[battlefield].text}` : '전장: 없음');
  $('log').innerHTML = '';
  const known = state.players[ME].knownEnemyOpening;
  if (known && known.length) logLine(0, ME, `<b>첩보원</b> 상대의 시작 카드: ${esc(known.map((c) => E.cardLabel(c)).join(', '))}`);
  buildBoard();
  setSpeed(1);
  consumeEvents();
  render();
  schedule();
}

function stopBattle() {
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
  const action = game.bot.decide(state, OP);
  if (action) E.applyAction(state, OP, action);
  E.step(state);
  consumeEvents();
  render();
  if (state.over) {
    if (game.onFinish) game.onFinish(state);
    else showResult();
  } else schedule();
}

function setSpeed(v) {
  if (!game) return;
  game.speed = v;
  for (const b of $('speed').querySelectorAll('button')) b.classList.toggle('on', Number(b.dataset.speed) === v);
  schedule();
}

// ─────────────────────────────────────────────────────────────
// 보드 그리기
// ─────────────────────────────────────────────────────────────

const cellKey = (side, row, slot) => `${side}:${row}:${slot}`;
const cells = new Map();

function buildBoard() {
  const board = $('board');
  board.innerHTML = '';
  cells.clear();
  // 위에서부터: 상대 후열, 상대 전열, 내 전열, 내 후열
  const layout = [[OP, BACK], [OP, FRONT], [ME, FRONT], [ME, BACK]];
  layout.forEach(([side, row], i) => {
    const rowEl = document.createElement('div');
    rowEl.className = `boardrow${i === 2 ? ' split' : ''}`;
    const label = document.createElement('div');
    label.className = 'rowlabel';
    label.textContent = `${side === ME ? '내' : '적'} ${ROW_NAMES[row]}`;
    rowEl.append(label);
    for (let slot = 0; slot < 4; slot++) {
      const cell = document.createElement('div');
      cell.className = `cell side${side}`;
      cell.dataset.side = side;
      cell.dataset.row = row;
      cell.dataset.slot = slot;
      cell.innerHTML = `<span class="slotno">${slot + 1}</span><div class="content"></div><div class="fx"></div>`;
      rowEl.append(cell);
      cells.set(cellKey(side, row, slot), cell);
    }
    board.append(rowEl);
  });
}

function unitHtml(state, u) {
  const iv = E.effInterval(state, u);
  const atk = E.currentAtk(state, u);
  const tags = [];
  for (const k of u.keywords) tags.push(`<span class="tag kw">${E.KEYWORD_NAMES[k] || k}</span>`);
  if (u.ranged) tags.push('<span class="tag">원거리</span>');
  if (!u.ranged && u.row === BACK) tags.push('<span class="tag bad">대기</span>');
  if (u.slows.length) tags.push(`<span class="tag bad">감속×${u.slows.length}</span>`);
  if (u.silenceUntil > state.timeMs) tags.push('<span class="tag bad">침묵</span>');
  for (const b of u.buffs) {
    if (b.kind === 'atk') tags.push(`<span class="tag good">공+${fmt(b.amount)}</span>`);
    if (b.kind === 'armor') tags.push('<span class="tag good">갑옷</span>');
  }
  if (u.tripleShot) tags.push('<span class="tag ult">3연사 준비</span>');
  if (u.telegraphing) tags.push('<span class="tag ult">필살기 시전 중</span>');
  const gauge = u.ult
    ? `<div class="bar gauge${u.telegraphing ? ' casting' : ''}" title="필살기 게이지"><i style="width:${u.telegraphing ? 100 : u.gauge}%"></i></div>`
    : '';
  return `<div class="unit">
    <div class="uname" title="${esc(E.CARDS[u.defId].text || '')}">${esc(u.name)}</div>
    <div class="stats"><span class="atk${atk > u.baseAtk + 0.01 ? ' up' : ''}">공 ${fmt(atk)}</span><span>체 ${fmt(Math.max(0, u.hp))}/${fmt(u.maxHp)}</span></div>
    <div class="bar hp"><i style="width:${Math.max(0, (u.hp / u.maxHp) * 100)}%"></i></div>
    <div class="bar cd" title="다음 공격"><i style="width:${Math.min(100, (u.attackTimer / iv) * 100)}%"></i></div>
    ${gauge}
    <div class="tags">${tags.join('')}</div>
  </div>`;
}

function patch(key, el, html) {
  if (game.cache.get(key) === html) return;
  game.cache.set(key, html);
  el.innerHTML = html;
}

function commanderHtml(state, side) {
  const P = state.players[side];
  const c = E.COMMANDERS[P.commander];
  const pips = [];
  const shown = Math.max(P.maxMana, P.mana);
  for (let i = 0; i < shown; i++) pips.push(`<i class="pip${i < P.mana ? (i >= P.maxMana ? ' over' : ' full') : ''}"></i>`);
  const last = P.lastPlayed && state.timeMs - P.lastPlayed.at < 4000 ? `낸 카드: ${esc(P.lastPlayed.name)}` : '';
  const redraw = side === ME ? '' : '';
  return `<span class="name">${side === ME ? '나' : '상대'} · ${esc(P.name || c.name)}</span>
    <div class="hpbar"><i style="width:${Math.max(0, (P.hp / P.maxHp) * 100)}%"></i><span>${fmt(Math.max(0, P.hp))} / ${P.maxHp}</span></div>
    <div class="pips" title="마나 ${P.mana} / ${P.maxMana}">${pips.join('')}</div>
    <span class="meta">마나 <b>${P.mana}/${P.maxMana}</b> · 손패 <b>${P.hand.length}</b> · 덱 <b>${P.deck.length}</b> · 버림 <b>${P.discard.length}</b></span>
    <span class="lastplay">${last}</span>${redraw}`;
}

function targetCells() {
  // 지금 선택한 카드로 누를 수 있는 칸
  const out = new Set();
  if (!game || !game.sel || game.sel.mode !== 'play') return out;
  const { state, sel } = game;
  const c = state.players[ME].hand.find((h) => h.uid === sel.uid);
  if (!c) return out;
  const def = E.CARDS[c.id];
  for (const t of E.legalTargets(state, ME, sel.uid)) {
    if (!t) continue;
    if (def.target === 'slot') out.add(cellKey(ME, t.row, t.slot));
    else if (def.target === 'allyMove') {
      if (!sel.unitId) {
        const u = E.findUnit(state, t.unitId);
        if (u) out.add(cellKey(ME, u.row, u.slot));
      } else if (t.unitId === sel.unitId) out.add(cellKey(ME, t.row, t.slot));
    } else if (t.unitId) {
      const u = E.findUnit(state, t.unitId);
      if (u) out.add(cellKey(u.owner, u.row, u.slot));
    }
  }
  return out;
}

function render() {
  const { state, sel } = game;
  const r = state.rules;
  const t = state.timeMs;

  $('clock').textContent = (t / 1000).toFixed(1);
  const fill = $('timefill');
  fill.style.width = `${Math.min(100, (t / r.battleMs) * 100)}%`;
  fill.classList.toggle('overtime', t > r.overtimeMs);

  patch('cmd0', $('cmd0'), commanderHtml(state, ME));
  patch('cmd1', $('cmd1'), commanderHtml(state, OP));

  const targets = targetCells();
  const danger = new Map();
  for (const g of state.telegraphs) {
    for (const c of g.cells) danger.set(cellKey(g.side, c.row, c.slot), Math.max(0, g.fireAt - t));
  }
  for (const [key, cell] of cells) {
    const [side, row, slot] = key.split(':').map(Number);
    const u = state.board[side][row][slot];
    const content = cell.querySelector('.content');
    const left = danger.get(key);
    const html = (u ? unitHtml(state, u) : '') + (left !== undefined ? `<span class="countdown">${(left / 1000).toFixed(1)}</span>` : '');
    patch(key, content, html);
    cell.classList.toggle('blocked', !E.slotUsable(state, row, slot));
    cell.classList.toggle('target', targets.has(key));
    cell.classList.toggle('danger', left !== undefined);
  }

  renderHand();
  renderHint();
}

function renderHand() {
  const { state, sel } = game;
  const P = state.players[ME];
  const picking = sel && sel.mode === 'play' && E.CARDS[(P.hand.find((h) => h.uid === sel.uid) || {}).id || 'scout'].target === 'handFused';
  const pickable = picking ? new Set(E.legalTargets(state, ME, sel.uid).map((x) => x.uid)) : new Set();
  const html = P.hand.map((c, i) => {
    const def = E.CARDS[c.id];
    const cost = E.effectiveCost(state, ME, c);
    const playable = E.legalTargets(state, ME, c.uid).length > 0;
    const cls = ['card', def.type];
    if (!playable && !(sel && sel.mode === 'redraw')) cls.push('off');
    if (sel && sel.uid === c.uid) cls.push('sel');
    if (pickable.has(c.uid) || (sel && sel.mode === 'redraw')) cls.push('pick');
    const star = state.rules.starMult ** (c.stars - 1);
    const stat = def.type === 'unit'
      ? `${fmt(def.atk * star * state.rules.unitAtkMult)}/${fmt(def.hp * star * state.rules.unitHpMult)}/${(def.interval * state.rules.attackIntervalMult) / 1000}초 · ${def.ranged ? '원거리' : '근접'}`
      : '';
    const fuse = c.fuse ? ` · ◆${E.KEYWORD_NAMES[c.fuse]}` : '';
    return `<div class="${cls.join(' ')}" data-uid="${c.uid}" role="button" tabindex="0">
      <span class="cost${cost < def.cost ? ' cheap' : ''}">${cost}</span><span class="key">${i + 1}</span>
      <span class="cname">${esc(E.cardLabel(c))}</span>
      <span class="ctype">${TYPE_NAMES[def.type]}${stat ? ` · ${stat}` : ''}${fuse}</span>
      <span class="ctext">${esc(def.text || '')}</span>
    </div>`;
  });
  const rd = E.canRedraw(state, ME);
  const cdLeft = Math.max(0, P.redrawReadyAt - state.timeMs);
  html.push(`<div class="card redraw-btn${rd.ok ? ' on' : ' off'}${sel && sel.mode === 'redraw' ? ' sel' : ''}" data-redraw="1" role="button" tabindex="0">
    다시 뽑기 (R)<br><small>마나 1 · ${cdLeft > 0 ? `${(cdLeft / 1000).toFixed(1)}초 뒤` : '준비됨'}</small></div>`);
  patch('hand', $('hand'), html.join(''));
}

function renderHint() {
  const { state, sel } = game;
  let text = '';
  if (game.speed === 0) text = '일시정지. 멈춘 동안에도 카드를 낼 수 있다. ';
  if (sel && sel.mode === 'redraw') text += '버릴 카드를 고른다. (Esc: 취소)';
  else if (sel) {
    const c = state.players[ME].hand.find((h) => h.uid === sel.uid);
    const def = c ? E.CARDS[c.id] : null;
    if (def) {
      const how = {
        slot: E.emptySlots(state, ME).length ? '놓을 칸을 고른다.' : '보드가 가득 찼다. 대체할 유닛을 고른다.',
        enemyUnit: '적 유닛을 고른다.',
        allyUnit: '내 유닛을 고른다.',
        allyUltUnit: '필살기가 있는 내 유닛을 고른다.',
        allyMove: sel.unitId ? '옮길 빈칸을 고른다.' : '옮길 내 유닛을 고른다.',
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

function floatText(el, text, cls = '') {
  const f = document.createElement('span');
  f.className = `float ${cls}`;
  f.textContent = text;
  f.style.marginLeft = `${Math.round(Math.random() * 30 - 15)}px`;
  el.append(f);
  setTimeout(() => f.remove(), 750);
}

function logLine(t, p, html, cls = '') {
  const li = document.createElement('li');
  li.className = `p${p} ${cls}`;
  li.innerHTML = `<time>${(t / 1000).toFixed(1)}</time>${html}`;
  const log = $('log');
  log.prepend(li);
  while (log.children.length > 60) log.lastChild.remove();
}

function consumeEvents() {
  const { state } = game;
  const who = (p) => `<b>${p === ME ? '나' : '상대'}</b>`;
  const dmg = new Map();
  for (const e of state.events) {
    switch (e.type) {
      case 'play':
        logLine(e.t, e.p, `${who(e.p)} ${esc(e.name)} <small>(${e.cost})</small>${e.combo ? ' · 연계' : ''}`);
        break;
      case 'redraw':
        logLine(e.t, e.p, `${who(e.p)} 다시 뽑기`);
        break;
      case 'death':
        logLine(e.t, e.p, `${who(e.p)}의 ${esc(e.name)} 쓰러짐`);
        break;
      case 'telegraph':
        logLine(e.t, e.p, `${who(e.p)} 필살기 전조 (${e.kind === 'cross' ? '십자 범위' : '전열 전체'})`, 'warn');
        break;
      case 'ult':
        logLine(e.t, e.p, `${who(e.p)} 필살기 발동`, 'warn');
        break;
      case 'ultReady':
        logLine(e.t, e.p, `${who(e.p)} 견습 궁수 3연사 준비`);
        break;
      case 'silence':
        logLine(e.t, 1 - e.p, `${who(e.p)}의 유닛 침묵 ${(e.durationMs / 1000).toFixed(1)}초`);
        break;
      case 'damage': {
        const key = cellKey(e.p, e.row, e.slot);
        dmg.set(key, (dmg.get(key) || 0) + e.amount);
        break;
      }
      case 'heal': {
        const cell = cells.get(cellKey(e.p, e.row, e.slot));
        if (cell && e.amount >= 0.5) floatText(cell.querySelector('.fx'), `+${fmt(e.amount)}`, 'heal');
        break;
      }
      case 'commanderDamage': {
        const el = $(`cmd${e.p}`);
        el.classList.remove('shake');
        void el.offsetWidth;
        el.classList.add('shake');
        break;
      }
      default:
        break;
    }
  }
  for (const [key, amount] of dmg) {
    const cell = cells.get(key);
    if (!cell) continue;
    floatText(cell.querySelector('.fx'), `-${fmt(amount)}`);
    cell.classList.remove('hit');
    void cell.offsetWidth;
    cell.classList.add('hit');
  }
  state.events.length = 0;
}

// ─────────────────────────────────────────────────────────────
// 입력
// ─────────────────────────────────────────────────────────────

function act(action) {
  const res = E.applyAction(game.state, ME, action);
  if (!res.ok) $('hint').textContent = `낼 수 없다: ${res.reason}`;
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
  // 촉매: 손패의 융합 카드를 고르는 중
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
  const targets = E.legalTargets(state, ME, uid);
  if (!targets.length) {
    game.sel = null;
    render();
    const chk = E.canPlay(state, ME, uid, null);
    $('hint').textContent = `${E.cardLabel(c)}: 지금은 낼 수 없다${chk.reason && E.effectiveCost(state, ME, c) > P.mana ? ' (마나 부족)' : ' (쓸 대상이 없다)'}`;
    return;
  }
  if (E.CARDS[c.id].target === 'none') {
    act({ type: 'play', uid });
    return;
  }
  game.sel = { mode: 'play', uid, unitId: null };
  render();
}

function clickCell(side, row, slot) {
  const { state, sel } = game;
  if (!sel || sel.mode !== 'play' || state.over) return;
  const c = state.players[ME].hand.find((h) => h.uid === sel.uid);
  if (!c) return;
  const def = E.CARDS[c.id];
  const u = state.board[side][row][slot];
  switch (def.target) {
    case 'slot':
      if (side === ME) act({ type: 'play', uid: sel.uid, target: { row, slot } });
      break;
    case 'enemyUnit':
      if (side === OP && u) act({ type: 'play', uid: sel.uid, target: { unitId: u.id } });
      break;
    case 'allyUnit':
    case 'allyUltUnit':
      if (side === ME && u) act({ type: 'play', uid: sel.uid, target: { unitId: u.id } });
      break;
    case 'allyMove':
      if (side !== ME) break;
      if (u) {
        sel.unitId = u.id;
        render();
      } else if (sel.unitId) act({ type: 'play', uid: sel.uid, target: { unitId: sel.unitId, row, slot } });
      break;
    default:
      break;
  }
}

function toggleRedraw() {
  if (!game || game.state.over) return;
  if (game.sel && game.sel.mode === 'redraw') game.sel = null;
  else if (E.canRedraw(game.state, ME).ok) game.sel = { mode: 'redraw' };
  else $('hint').textContent = `다시 뽑기 불가: ${E.canRedraw(game.state, ME).reason}`;
  render();
}

function initInput() {
  // 틱마다 내용이 다시 그려져도 눌림이 씹히지 않도록 pointerdown을 쓴다
  $('board').addEventListener('pointerdown', (ev) => {
    const cell = ev.target.closest('.cell');
    if (!cell || !game) return;
    clickCell(Number(cell.dataset.side), Number(cell.dataset.row), Number(cell.dataset.slot));
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
  $('quit').addEventListener('click', () => {
    stopBattle();
    game = null;
    const back = match ? 'lobby' : 'setup';
    endMatch();
    showScreen(back);
  });
  $('again').addEventListener('click', () => {
    $('seed').value = String(1 + Math.floor(Math.random() * 99999));
    refreshSetup();
    startBattle();
  });
  $('replay').addEventListener('click', () => startBattle(true));
  $('toSetup').addEventListener('click', () => {
    stopBattle();
    game = null;
    showScreen('setup');
  });
  document.addEventListener('keydown', (ev) => {
    if (!game || $('battle').hidden) return;
    if (ev.target.matches('input, select, textarea')) return;
    if (ev.key >= '1' && ev.key <= '9') {
      const c = game.state.players[ME].hand[Number(ev.key) - 1];
      if (c) selectCard(c.uid);
    } else if (ev.key === 'r' || ev.key === 'R' || ev.key === 'ㄱ') toggleRedraw();
    else if (ev.key === 'Escape') {
      game.sel = null;
      render();
    } else if (ev.key === ' ') {
      ev.preventDefault();
      setSpeed(game.speed === 0 ? 1 : 0);
    }
  });
}

// ─────────────────────────────────────────────────────────────
// 결과
// ─────────────────────────────────────────────────────────────

function showResult() {
  const { state } = game;
  const res = state.result;
  const title = $('resultTitle');
  title.className = res.winner === ME ? 'win' : res.winner === OP ? 'lose' : '';
  title.textContent = res.winner === ME ? '승리' : res.winner === OP ? '패배' : '무승부';
  const why = res.reason === 'commander' ? '지휘관이 쓰러졌다' : '시간이 다 됐다 (지휘관 체력 비율로 판정)';
  $('resultDetail').textContent = `${(res.timeMs / 1000).toFixed(1)}초 · ${why} · 시드 ${state.seed}`;
  const [a, b] = state.players.map((P) => P.stats);
  const row = (label, f) => `<tr><td>${label}</td><td>${f(a, state.players[0])}</td><td>${f(b, state.players[1])}</td></tr>`;
  $('resultStats').innerHTML = `<tr><th></th><th>나</th><th>상대</th></tr>${[
    row('남은 지휘관 체력', (s, P) => fmt(Math.max(0, P.hp))),
    row('낸 카드', (s) => s.cardsPlayed),
    row('쓴 마나', (s) => s.manaSpent),
    row('넘쳐서 버린 마나', (s) => s.manaWasted),
    row('다시 뽑기', (s) => s.redraws),
    row('유닛에 준 피해', (s) => fmt(s.unitDamage)),
    row('지휘관에 준 피해', (s) => fmt(s.commanderDamage)),
    row('잃은 유닛', (s) => s.unitsLost),
    row('손패가 가득 찼던 시간', (s) => `${(s.handFullMs / 1000).toFixed(1)}초`),
  ].join('')}`;
  $('result').hidden = false;
}

initSetup();
initInput();

// 자동 검증과 디버깅용
window.__game = () => game;
window.__engine = E;

// ═════════════════════════════════════════════════════════════
// 한 경기 모드: 사전 선택 → [상점 → 전투] 반복
// 규칙은 ../engine/game.js 에 있고, 여기는 화면만 다룬다.
// ═════════════════════════════════════════════════════════════

let match = null; // { game, botLevel, botStyle, shopSeconds, sel, fuseBody, timerId, deadline, hint }
const lobby = { picks: [] };
const STYLE_NAMES = { eco: '저축형', balanced: '균형형', spend: '소비형' };
const FORMAT_NAMES = { practice: '연습 (중립 몬스터)', duel: '결투' };

function initMatch() {
  const cmds = E.COMMANDER_IDS.map((id) => [id, E.COMMANDERS[id].name]);
  fillSelect($('mCommander'), cmds, 'general');
  fillSelect($('mOpCommander'), [['random', '무작위'], ...cmds], 'random');
  $('mSeed').value = String(1 + Math.floor(Math.random() * 99999));
  lobby.picks = E.botPicks(E.makeRng(7));

  $('modeTabs').addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (b) showScreen(b.dataset.mode);
  });
  $('mCommander').addEventListener('change', renderLobby);
  $('mPicks').addEventListener('click', (ev) => {
    const chip = ev.target.closest('.chip');
    if (!chip) return;
    const id = chip.dataset.id;
    if (lobby.picks.includes(id)) lobby.picks = lobby.picks.filter((x) => x !== id);
    else if (lobby.picks.length < E.DEFAULT_ECON.picks) {
      const t5 = lobby.picks.filter((x) => E.CARDS[x].tier === 5).length;
      if (E.CARDS[id].tier === 5 && t5 >= E.DEFAULT_ECON.maxTier5Picks) return;
      lobby.picks.push(id);
    }
    renderLobby();
  });
  $('mAutoPicks').addEventListener('click', () => {
    lobby.picks = E.botPicks(E.makeRng(Math.floor(Math.random() * 1e9)));
    renderLobby();
  });
  $('mClearPicks').addEventListener('click', () => {
    lobby.picks = [];
    renderLobby();
  });
  $('mStart').addEventListener('click', startMatch);

  // 상점 화면
  $('sShop').addEventListener('click', (ev) => {
    const el = ev.target.closest('.card[data-slot]');
    if (el && match) shopAct(() => E.buy(match.game, ME, Number(el.dataset.slot)));
  });
  $('sShopButtons').addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b || !match) return;
    if (b.dataset.act === 'reroll') shopAct(() => E.reroll(match.game, ME));
    if (b.dataset.act === 'lock') shopAct(() => E.toggleLock(match.game, ME));
    if (b.dataset.act === 'xp') shopAct(() => E.buyXp(match.game, ME));
  });
  $('sDeck').addEventListener('click', (ev) => {
    const chip = ev.target.closest('.chip');
    if (!chip || !match) return;
    const key = Number(chip.dataset.key);
    if (match.fuseBody && match.fuseBody !== key) {
      const body = match.fuseBody;
      match.fuseBody = null;
      shopAct(() => E.fuse(match.game, ME, body, key));
      return;
    }
    match.fuseBody = null;
    match.sel = match.sel === key ? null : key;
    renderShop();
  });
  $('sDeckActions').addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b || !match) return;
    const { game } = match;
    const P = game.players[ME];
    const key = match.sel;
    switch (b.dataset.act) {
      case 'opening': {
        let keys = [...P.opening];
        if (keys.includes(key)) keys = keys.filter((k) => k !== key);
        else {
          keys.push(key);
          while (keys.length > E.openingCount(game, ME)) keys.shift();
        }
        E.setOpening(game, ME, keys);
        renderShop();
        break;
      }
      case 'remove':
        shopAct(() => {
          const res = E.removeCard(game, ME, key);
          if (res.ok) match.sel = null;
          return res;
        });
        break;
      case 'fuse':
        match.fuseBody = key;
        renderShop();
        break;
      case 'cancelFuse':
        match.fuseBody = null;
        renderShop();
        break;
      case 'upgrade':
        shopAct(() => E.upgrade(game, ME, b.dataset.id, Number(b.dataset.stars)));
        break;
      default:
        break;
    }
  });
  $('sReady').addEventListener('click', goBattle);
  $('sQuit').addEventListener('click', () => {
    endMatch();
    showScreen('lobby');
  });
  document.addEventListener('keydown', (ev) => {
    if (!match || $('shop').hidden || ev.target.matches('input, select, textarea')) return;
    if (ev.key === 'd' || ev.key === 'D' || ev.key === 'ㅇ') shopAct(() => E.reroll(match.game, ME));
    else if (ev.key === 'f' || ev.key === 'F' || ev.key === 'ㄹ') shopAct(() => E.buyXp(match.game, ME));
    else if (ev.key === 'Escape') {
      match.sel = null;
      match.fuseBody = null;
      renderShop();
    }
  });

  renderLobby();
  showScreen('lobby');
}

// ───────────────────────── 사전 선택 ─────────────────────────

function renderLobby() {
  const c = E.COMMANDERS[$('mCommander').value];
  $('mPassive').textContent = `패시브: ${c.passive} · 시작 덱: ${c.deck.map((id) => E.CARDS[id].name).join(', ')}`;
  const need = E.DEFAULT_ECON.picks;
  $('mPickHint').textContent = `픽 카드 ${need}종을 고른다 (${lobby.picks.length}/${need}). 고른 카드는 풀에 더 많이 들어가고, 상점 한 칸은 내 픽에서만 뜬다. 5등급은 1종까지.`;
  $('mPicks').innerHTML = [...E.POOL_CARD_IDS]
    .sort((a, b) => E.CARDS[a].tier - E.CARDS[b].tier || E.CARDS[a].cost - E.CARDS[b].cost)
    .map((id) => {
      const def = E.CARDS[id];
      const on = lobby.picks.includes(id);
      return `<span class="chip ${def.type} pickable${on ? ' picked' : ''}" data-id="${id}" role="button" title="${esc(def.text || '')}"><b>${def.tier}등급</b>${esc(def.name)}${on ? ' ✓' : ''}</span>`;
    })
    .join('');
  $('mStart').disabled = lobby.picks.length !== need;
}

function startMatch() {
  if (!E.validatePicks(lobby.picks).ok) return;
  const seed = Number($('mSeed').value) || 1;
  const rng = E.makeRng(E.hashSeed(seed, 'opponent'));
  let opCommander = $('mOpCommander').value;
  if (opCommander === 'random') opCommander = rng.pick(E.COMMANDER_IDS);
  let botStyle = $('mBotStyle').value;
  if (botStyle === 'random') botStyle = rng.pick(Object.keys(E.SHOP_STYLES));
  const g = E.createGame({
    seed,
    players: [
      { commander: $('mCommander').value, picks: lobby.picks },
      { commander: opCommander, picks: E.botPicks(rng) },
    ],
  });
  match = {
    game: g,
    botLevel: $('mBotLevel').value,
    botStyle,
    shopSeconds: Number($('mShopTime').value),
    sel: null,
    fuseBody: null,
    timerId: null,
    deadline: 0,
    hint: '',
  };
  beginShop();
}

function endMatch() {
  if (match && match.timerId) clearInterval(match.timerId);
  match = null;
}

// ───────────────────────── 상점 ─────────────────────────

function beginShop() {
  const { game } = match;
  // 봇이 먼저 상점을 본다. 첩보원이면 그 뒤에 상대의 시작 카드를 볼 수 있다.
  E.runShopBot(game, OP, { style: match.botStyle });
  fillOpening();
  match.sel = null;
  match.fuseBody = null;
  match.hint = '';
  showScreen('shop');
  if (match.timerId) clearInterval(match.timerId);
  match.timerId = null;
  if (match.shopSeconds > 0) {
    match.deadline = Date.now() + match.shopSeconds * 1000;
    match.timerId = setInterval(tickShopTimer, 200);
  }
  renderShop();
  tickShopTimer();
}

/** 고른 시작 카드가 허용 장수보다 적으면 추천 카드로 채운다 */
function fillOpening() {
  const { game } = match;
  const P = game.players[ME];
  const max = E.openingCount(game, ME);
  const keys = P.opening.filter((k) => P.deck.some((c) => c.key === k));
  if (keys.length < max) {
    const order = E.pickOpening(P.deck, P.deck.length, 'tempo', null, game.battleRules.startMana ?? 3).map((i) => P.deck[i].key);
    for (const k of order) {
      if (keys.length >= max) break;
      if (!keys.includes(k)) keys.push(k);
    }
  }
  E.setOpening(game, ME, keys);
}

function tickShopTimer() {
  if (!match) return;
  const el = $('sTimer');
  if (match.shopSeconds <= 0) {
    el.textContent = '';
    return;
  }
  const left = Math.max(0, match.deadline - Date.now());
  el.textContent = `${Math.ceil(left / 1000)}초`;
  el.classList.toggle('low', left <= 10000);
  if (left <= 0) goBattle();
}

function shopAct(fn) {
  if (!match || match.game.phase !== 'shop') return;
  const res = fn();
  match.hint = res.ok ? '' : `할 수 없다: ${res.reason}`;
  fillOpening();
  renderShop();
}

function shopCardHtml(game, P, s, i) {
  if (!s) return '<div class="card empty">비어 있음</div>';
  const def = E.CARDS[s.id];
  const cost = def.tier;
  const own = P.deck.filter((c) => c.id === s.id && c.stars === 1).length;
  const soldOut = game.pool[s.id] <= 0;
  const cls = ['card', def.type];
  if (s.sold) cls.push('sold');
  else if (soldOut || P.gold < cost) cls.push('off');
  const r = game.battleRules;
  const stat = def.type === 'unit'
    ? `${fmt(def.atk * (r.unitAtkMult ?? 1))}/${fmt(def.hp * (r.unitHpMult ?? 1))}/${def.interval / 1000}초 · ${def.ranged ? '원거리' : '근접'}`
    : '';
  const state = s.sold ? '구매함' : soldOut ? '품절' : own >= 2 ? `보유 ${own}장 → 사면 강화 가능` : own === 1 ? '보유 1장' : '';
  return `<div class="${cls.join(' ')}"${s.sold ? '' : ` data-slot="${i}"`} role="button" tabindex="0">
    <span class="cost gold">${cost}</span>
    <span class="cname">${esc(def.name)}</span>
    <span class="ctype">${s.signature ? '<b class="sig">시그니처</b> · ' : ''}${TYPE_NAMES[def.type]} · ${def.tier}등급 · 마나 ${def.cost}${stat ? ` · ${stat}` : ''}</span>
    <span class="ctext">${esc(def.text || '')}</span>
    <span class="own">${state}</span>
  </div>`;
}

function renderShop() {
  if (!match) return;
  const { game } = match;
  const P = game.players[ME];
  const O = game.players[OP];
  const e = game.econ;
  const info = E.roundInfo(game);

  $('sRound').innerHTML = `${game.round}<small>라운드</small>`;
  const field = info.battlefield ? `전장: ${E.BATTLEFIELDS[info.battlefield].name} — ${E.BATTLEFIELDS[info.battlefield].text}` : '전장: 없음';
  $('sInfo').textContent = `다음 전투: ${FORMAT_NAMES[info.format]} · ${field}${info.format === 'duel' ? ` · 지면 HP −${info.baseDamage} − 상대에게 남은 유닛 수` : ' · HP 피해 없음, 이기면 골드 +2'}`;

  // 내 상태
  const inc = E.incomePreview(game, ME);
  const need = e.xpToNext[P.level];
  const streak = P.streak >= 2 ? `${P.streak}연승` : P.streak <= -2 ? `${-P.streak}연패` : '';
  $('sMe').innerHTML = `
    <span><span class="big">HP ${Math.max(0, P.hp)}</span> <small>/ ${P.maxHp}</small></span>
    <span><span class="big gold">${P.gold}골드</span> <small>다음 라운드 +${inc.total} (기본 ${inc.base}${inc.interest ? ` · 이자 ${inc.interest}` : ''}${inc.streak ? ` · 연속 ${inc.streak}` : ''}${inc.commander ? ` · 지휘관 ${inc.commander}` : ''})</small></span>
    <span><span class="big">레벨 ${P.level}</span> <small>${P.level >= e.maxLevel ? '최대' : `경험치 ${P.xp}/${need}`}</small>${P.level >= e.maxLevel ? '' : `<span class="xpbar"><i style="width:${(P.xp / need) * 100}%"></i></span>`}</span>
    <span><small>고르는 시작 카드</small> ${E.openingCount(game, ME)}장</span>
    <span><small>융합</small> ${P.fusionsLeft}회 남음</span>
    ${streak ? `<span class="gold">${streak}</span>` : ''}`;

  // 상점
  $('sShop').innerHTML = P.shop.map((s, i) => shopCardHtml(game, P, s, i)).join('');
  const rc = E.rerollCostOf(game, ME);
  $('sShopButtons').innerHTML = `
    <button type="button" data-act="reroll"${P.gold < rc ? ' disabled' : ''}>리롤 (${rc === 0 ? '무료' : `${rc}골드`}) <small>D</small></button>
    <button type="button" data-act="lock" class="${P.locked ? 'on' : ''}">${P.locked ? '잠금 해제' : '잠금'} <small>다음 라운드에도 유지</small></button>
    <button type="button" data-act="xp"${P.gold < e.xpCost || P.level >= e.maxLevel ? ' disabled' : ''}>경험치 +${e.xpPerBuy} (${e.xpCost}골드) <small>F</small></button>`;

  // 내 덱
  $('sDeckInfo').textContent = `${P.deck.length}장 (최소 ${e.deckMin}, 최대 ${e.deckMax}) · ✓ 표시는 시작 손패에 반드시 들어오는 카드`;
  const fuseBody = match.fuseBody ? P.deck.find((c) => c.key === match.fuseBody) : null;
  $('sDeck').innerHTML = [...P.deck]
    .sort((a, b) => E.CARDS[a.id].cost - E.CARDS[b.id].cost || a.id.localeCompare(b.id) || a.key - b.key)
    .map((c) => {
      const def = E.CARDS[c.id];
      const cls = ['chip', def.type, 'pickable'];
      if (P.opening.includes(c.key)) cls.push('picked');
      if (match.sel === c.key) cls.push('selected');
      if (fuseBody && c !== fuseBody) cls.push(E.canFuse(game, ME, fuseBody.key, c.key).ok ? 'fusable' : 'dim');
      const diamond = def.diamond && !c.fuse ? ` ◆${E.KEYWORD_NAMES[def.diamond]}` : '';
      return `<span class="${cls.join(' ')}" data-key="${c.key}" role="button" title="${esc(def.text || '')}${diamond}"><b>${def.cost}</b>${esc(E.cardLabel(c))}${P.opening.includes(c.key) ? ' ✓' : ''}</span>`;
    })
    .join('');

  // 고른 카드에 할 수 있는 일
  const actions = [];
  for (const u of E.upgradable(game, ME)) {
    actions.push(`<button type="button" data-act="upgrade" data-id="${u.id}" data-stars="${u.stars}" class="primary">${esc(E.CARDS[u.id].name)}${'★'.repeat(u.stars - 1)} 3장 → ${'★'.repeat(u.stars + 1)}로 합치기</button>`);
  }
  const sel = P.deck.find((c) => c.key === match.sel);
  let hint = match.hint;
  if (fuseBody) {
    hint = `${E.cardLabel(fuseBody)}에 붙일 재료 카드를 누른다. 보라색 테두리가 쓸 수 있는 재료다. 재료 카드는 사라진다.`;
    actions.push('<button type="button" data-act="cancelFuse">융합 취소</button>');
  } else if (sel) {
    const isOpening = P.opening.includes(sel.key);
    if (E.openingCount(game, ME) > 0) actions.push(`<button type="button" data-act="opening">${isOpening ? '시작 카드에서 빼기' : '시작 카드로 고르기'}</button>`);
    const canRemove = P.removesLeft > 0 && P.gold >= e.removeCost && P.deck.length > e.deckMin;
    actions.push(`<button type="button" data-act="remove"${canRemove ? '' : ' disabled'}>덱에서 빼기 (${e.removeCost}골드${P.removesLeft > 0 ? '' : ', 이번 라운드는 이미 뺌'})</button>`);
    const canBody = P.fusionsLeft > 0 && !sel.fuse && P.deck.length > e.deckMin;
    actions.push(`<button type="button" data-act="fuse"${canBody ? '' : ' disabled'}>융합: 이 카드에 효과 붙이기</button>`);
    if (!hint) hint = `${E.cardLabel(sel)}: ${E.CARDS[sel.id].text || ''}`;
  } else if (!hint) {
    hint = '덱의 카드를 누르면 시작 카드 지정, 빼기, 융합을 할 수 있다.';
  }
  $('sHint').textContent = hint;
  $('sDeckActions').innerHTML = actions.join('');

  // 상대 (공개 정보)
  const oc = E.COMMANDERS[O.commander];
  const oStreak = O.streak >= 2 ? ` · ${O.streak}연승` : O.streak <= -2 ? ` · ${-O.streak}연패` : '';
  const spy = E.COMMANDERS[P.commander].seesOpening
    ? `<div class="pickhint">첩보원 패시브로 본 상대의 시작 카드: ${esc(O.opening.map((k) => E.cardLabel(O.deck.find((c) => c.key === k))).join(', ') || '없음')}</div>`
    : oc.seesOpening ? '<div><small>상대 첩보원이 내 시작 카드를 미리 본다.</small></div>' : '';
  $('sOp').innerHTML = `
    <div><b>${esc(oc.name)}</b> · HP ${Math.max(0, O.hp)}/${O.maxHp} · 레벨 ${O.level}${oStreak}</div>
    <div><small>패시브: ${esc(oc.passive)} · 상점 성향: ${STYLE_NAMES[match.botStyle]}</small></div>
    ${spy}
    <div><small>덱 ${O.deck.length}장</small><div class="decklist">${deckChips(O.deck)}</div></div>
    <div><small>픽 카드</small><div class="decklist">${O.picks.map((id) => `<span class="chip ${E.CARDS[id].type}">${esc(E.CARDS[id].name)}</span>`).join('')}</div></div>`;

  // 풀
  $('sPool').innerHTML = `<table>${[...E.POOL_CARD_IDS]
    .sort((a, b) => E.CARDS[a].tier - E.CARDS[b].tier || E.CARDS[a].cost - E.CARDS[b].cost)
    .map((id) => `<tr class="${P.picks.includes(id) ? 'mine' : ''}"><td>${E.CARDS[id].tier}등급 ${esc(E.CARDS[id].name)}${P.picks.includes(id) ? ' (내 픽)' : ''}</td><td>${game.pool[id]} / ${game.poolStart[id]}</td></tr>`)
    .join('')}</table>`;

  // 지난 라운드
  $('sHistory').innerHTML = [...game.history].reverse().map((h) => {
    const mine = h.results.find((r) => r.p === ME);
    const what = mine.won === null ? '무승부' : mine.won ? '승리' : '패배';
    const tail = h.format === 'practice' ? (mine.gold ? ` · 골드 +${mine.gold}` : '') : ` · HP ${h.hp[ME]} : ${h.hp[OP]}`;
    return `<li class="${mine.won ? 'p0' : 'p1'}"><time>${h.round}R</time><b>${what}</b> ${h.format === 'practice' ? '연습' : '결투'}${tail}</li>`;
  }).join('');
}

// ───────────────────────── 전투와 라운드 결과 ─────────────────────────

function goBattle() {
  if (!match || match.game.phase !== 'shop' || !$('roundResult').hidden) return;
  if (match.timerId) clearInterval(match.timerId);
  match.timerId = null;
  const { game } = match;
  const info = E.roundInfo(game);
  const hpBefore = game.players.map((P) => P.hp);
  const goldBefore = game.players.map((P) => P.gold);
  const battles = E.roundBattles(game);
  const mine = battles.find((b) => b.sides[0] === ME);
  // 내가 끼지 않는 전투(연습 라운드의 상대 쪽)는 바로 계산한다
  for (const b of battles) if (b !== mine) b.state = E.runBattle(b.cfg).state;
  launchBattle({
    cfg: mine.cfg,
    // 연습 라운드의 중립 몬스터는 엔진이 정한 느린 봇을 쓴다
    botOpts: { seed: E.hashSeed(game.seed, 'bot', game.round), ...(mine.cfg.players[1].bot || E.BOT_LEVELS[match.botLevel]) },
    label: `${game.round}라운드 ${info.format === 'practice' ? '연습' : '결투'}`,
    onFinish(state) {
      mine.state = state;
      const summary = E.finishRound(game, battles);
      showRoundResult(summary, state, hpBefore, goldBefore);
    },
  });
}

function showRoundResult(summary, state, hpBefore, goldBefore) {
  const { game } = match;
  const mine = summary.results.find((r) => r.p === ME);
  const theirs = summary.results.find((r) => r.p === OP);
  const over = game.phase === 'over';
  const title = $('rrTitle');
  if (over) {
    title.className = game.winner === ME ? 'win' : game.winner === OP ? 'lose' : '';
    title.textContent = game.winner === ME ? '경기 승리' : game.winner === OP ? '경기 패배' : '경기 무승부';
  } else {
    title.className = mine.won ? 'win' : mine.won === false ? 'lose' : '';
    title.textContent = `${summary.round}라운드 ${mine.won === null ? '무승부' : mine.won ? '승리' : '패배'}`;
  }
  const why = state.result.reason === 'commander' ? '지휘관이 쓰러졌다' : '시간이 다 됐다 (지휘관 체력 비율로 판정)';
  $('rrDetail').textContent = `${summary.format === 'practice' ? '연습 (HP 피해 없음)' : '결투'} · ${(state.result.timeMs / 1000).toFixed(1)}초 · ${why}`;
  const [P, O] = game.players;
  const hp = (i, r) => `${Math.max(0, hpBefore[i])} → ${Math.max(0, game.players[i].hp)}${r.damage ? ` (−${r.damage})` : ''}`;
  const gold = (i) => `${goldBefore[i]} → ${game.players[i].gold}`;
  const streak = (X) => (X.streak >= 2 ? `${X.streak}연승` : X.streak <= -2 ? `${-X.streak}연패` : '-');
  const rows = [
    ['플레이어 HP', hp(ME, mine), hp(OP, theirs)],
    ['전투에 남은 유닛', state.result.survivors[0], summary.format === 'practice' ? '-' : state.result.survivors[1]],
    ['연속', streak(P), streak(O)],
    ['상점 레벨', P.level, O.level],
  ];
  if (!over) rows.splice(1, 0, ['골드 (다음 라운드 수입 포함)', gold(ME), gold(OP)]);
  $('rrStats').innerHTML = `<tr><th></th><th>나</th><th>상대</th></tr>${rows.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('')}`;
  $('rrButtons').innerHTML = over
    ? '<button type="button" class="primary" data-act="lobby">새 경기</button>'
    : '<button type="button" class="primary" data-act="next">다음 라운드 (상점)</button>';
  $('rrButtons').onclick = (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    stopBattle();
    game.phase === 'over' ? (endMatch(), showScreen('lobby')) : beginShop();
  };
  $('roundResult').hidden = false;
}

window.__match = () => match;

// 위의 let/const가 준비된 뒤에 시작한다
initMatch();
