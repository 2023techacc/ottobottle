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
  for (const id of ['lobby', 'setup', 'draft', 'shop', 'battle']) $(id).hidden = id !== name;
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
  // botOpts: 모든 상대에게 쓸 설정, 또는 자리 번호를 받아 설정을 돌려주는 함수
  const optsFor = (i) => (typeof botOpts === 'function' ? botOpts(i) : { ...botOpts, seed: E.hashSeed(botOpts.seed ?? 1, 'seat', i) });
  game = {
    state,
    bots: state.players.map((P, i) => (i === ME ? null : E.createBot(optsFor(i)))),
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
  // 봇들이 같은 순간의 상태를 보고 판단한 뒤에 차례로 적용한다
  const actions = game.bots.map((bot, i) => (bot ? bot.decide(state, i) : null));
  actions.forEach((a, i) => {
    if (a) E.applyAction(state, i, a);
  });
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

/** 화면에 놓을 보드 순서. 위쪽은 상대들, 아래쪽은 나(와 아군). 나는 항상 0번 자리다. */
function boardLayout(state) {
  switch (state.format) {
    case 'alliance': return { top: [2, 3], bottom: [0, 1] };
    case 'melee3': return { top: [1, 2], bottom: [0] };
    case 'melee4': return { top: [1, 2, 3], bottom: [0] };
    default: return { top: [1], bottom: [0] };
  }
}

/** 이 자리의 플레이어가 나에게 무엇인가 */
function roleOf(state, i) {
  if (i === ME) return '나';
  if (!E.isEnemy(state, ME, i)) return '아군';
  if (state.format === 'melee3') return i === 1 ? '왼쪽 상대' : '오른쪽 상대';
  if (state.format === 'melee4') return ['', '왼쪽 상대', '정면 상대', '오른쪽 상대'][i];
  if (state.format === 'alliance') return i === 2 ? '왼쪽 상대' : '오른쪽 상대';
  return '상대';
}

function nameOf(state, i) {
  const P = state.players[i];
  const c = E.COMMANDERS[P.commander];
  if (P.isBoss || P.name === '중립 몬스터') return P.name;
  if (i === ME || !P.name || P.name === c.name) return c.name;
  return `${P.name} (${c.name})`;
}

function buildBoard() {
  const { state } = game;
  const board = $('board');
  board.innerHTML = '';
  cells.clear();
  const layout = boardLayout(state);
  board.classList.toggle('multi', state.players.length > 2);
  const makeBlock = (p, top) => {
    const block = document.createElement('div');
    block.className = `pboard ${p === ME ? 'mine' : E.isEnemy(state, ME, p) ? 'foe' : 'ally'}`;
    block.id = `pboard${p}`;
    const head = document.createElement('div');
    head.className = `commander ${E.isEnemy(state, ME, p) ? 'enemy' : 'me'}`;
    head.id = `cmd${p}`;
    const rows = (top ? [BACK, FRONT] : [FRONT, BACK]).map((row) => {
      const rowEl = document.createElement('div');
      rowEl.className = 'boardrow';
      for (let slot = 0; slot < 4; slot++) {
        const cell = document.createElement('div');
        cell.className = `cell side${E.isEnemy(state, ME, p) ? 1 : 0}`;
        cell.dataset.side = p;
        cell.dataset.row = row;
        cell.dataset.slot = slot;
        cell.innerHTML = `<span class="slotno">${row === FRONT ? '전' : '후'}${slot + 1}</span><div class="content"></div><div class="fx"></div>`;
        rowEl.append(cell);
        cells.set(cellKey(p, row, slot), cell);
      }
      return rowEl;
    });
    // 위쪽 보드는 지휘관이 맨 위, 아래쪽 보드는 맨 아래
    if (top) block.append(head, ...rows);
    else block.append(...rows, head);
    return block;
  };
  for (const [list, top] of [[layout.top, true], [layout.bottom, false]]) {
    const wrap = document.createElement('div');
    wrap.className = `pboards ${top ? 'top' : 'bottom'}`;
    wrap.style.setProperty('--n', list.length);
    for (const p of list) wrap.append(makeBlock(p, top));
    board.append(wrap);
  }
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
    <div class="stats"><span class="atk${atk > u.baseAtk + 0.01 ? ' up' : ''}">공 ${fmt(atk)}</span><span>${u.defId === 'boss' ? `받은 피해 ${fmt(u.damageTaken || 0)}` : `체 ${fmt(Math.max(0, u.hp))}/${fmt(u.maxHp)}`}</span></div>
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
  if (P.dead) return `<span class="name">${roleOf(state, side)} · ${esc(nameOf(state, side))}</span><span class="meta">지휘관이 쓰러졌다</span>`;
  if (P.isBoss) {
    const boss = E.unitsOf(state, side)[0];
    return `<span class="name">${esc(P.name)}</span><span class="meta">보스에게 준 피해 <b>${fmt(boss ? boss.damageTaken || 0 : 0)}</b> · 10초마다 전열 전체를 친다</span>`;
  }
  const redraw = '';
  return `<span class="name">${roleOf(state, side)} · ${esc(nameOf(state, side))}</span>
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
    else if (def.target === 'column') {
      out.add(cellKey(ME, FRONT, t.slot));
      out.add(cellKey(ME, BACK, t.slot));
    }
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

  const melee = state.format.startsWith('melee');
  state.players.forEach((P, i) => {
    patch(`cmd${i}`, $(`cmd${i}`), commanderHtml(state, i));
    $(`pboard${i}`).classList.toggle('dead', P.dead);
  });
  // 난전에서는 내 칸마다 어느 상대를 치는지 적어 둔다 (포고로 바뀔 수 있다)
  if (melee) {
    for (let slot = 0; slot < 4; slot++) {
      const q = E.targetPlayer(state, ME, slot);
      const where = q < 0 ? '' : roleOf(state, q).replace(' 상대', '');
      for (const row of [FRONT, BACK]) {
        const label = `${row === FRONT ? '전' : '후'}${slot + 1}${where ? ` <b>→${where}</b>` : ''}`;
        patch(`slotno${row}${slot}`, cells.get(cellKey(ME, row, slot)).querySelector('.slotno'), label);
      }
    }
  }

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
        column: '표적 방향을 바꿀 내 칸을 고른다.',
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
  li.className = `p${p === ME ? 0 : 1} ${cls}`;
  li.innerHTML = `<time>${(t / 1000).toFixed(1)}</time>${html}`;
  const log = $('log');
  log.prepend(li);
  while (log.children.length > 60) log.lastChild.remove();
}

function consumeEvents() {
  const { state } = game;
  const who = (p) => `<b>${p === ME ? '나' : state.players.length > 2 ? esc(`${roleOf(state, p)}`) : '상대'}</b>`;
  const dmg = new Map();
  for (const e of state.events) {
    switch (e.type) {
      case 'play':
        logLine(e.t, e.p, `${who(e.p)} ${esc(e.name)} <small>(${e.cost})</small>${e.combo ? ' · 연계' : ''}`);
        break;
      case 'redraw':
        logLine(e.t, e.p, `${who(e.p)} 다시 뽑기`);
        break;
      case 'commanderDown':
        logLine(e.t, e.p, `${who(e.p)}의 지휘관이 쓰러졌다`, 'warn');
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
      if (E.isEnemy(state, ME, side) && u) act({ type: 'play', uid: sel.uid, target: { unitId: u.id } });
      break;
    case 'column':
      if (side === ME) act({ type: 'play', uid: sel.uid, target: { slot } });
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
// 한 경기 모드 (1:1 또는 8인): 사전 선택 → [상점 → 전투] 반복
// 규칙은 ../engine/game.js 에 있고, 여기는 화면만 다룬다. 나는 항상 0번 플레이어다.
// ═════════════════════════════════════════════════════════════

let match = null; // { game, botLevel, styles, shopSeconds, sel, fuseBody, timerId, deadline, hint }
const lobby = { picks: [] };
const STYLE_NAMES = { eco: '저축형', balanced: '균형형', spend: '소비형' };
const FORMAT_NAMES = {
  practice: '연습 (중립 몬스터)', duel: '결투', melee3: '삼파전 (3인 난전)', melee4: '난투장 (4인 난전)', alliance: '연합전 (2:2)', boss: '보스 레이드',
};
const FORMAT_SHORT = { practice: '연습', duel: '결투', melee3: '삼파전', melee4: '난투장', alliance: '연합전', boss: '보스' };

const lobbyMode = () => $('mMode').value;
const lobbyEcon = () => ({ ...E.DEFAULT_ECON, ...E.MODES[lobbyMode()].econ });
const streakText = (P) => (P.streak >= 2 ? `${P.streak}연승` : P.streak <= -2 ? `${-P.streak}연패` : '');
const playerLabel = (P) => (P.name === E.COMMANDERS[P.commander].name ? P.name : `${P.name} (${E.COMMANDERS[P.commander].name})`);

function initMatch() {
  const cmds = E.COMMANDER_IDS.map((id) => [id, E.COMMANDERS[id].name]);
  fillSelect($('mMode'), Object.entries(E.MODES).map(([id, m]) => [id, `${m.name} (${m.players}명, HP ${m.econ.playerHp}, 픽 ${m.econ.picks}종)`]), 'rank8');
  fillSelect($('mCommander'), cmds, 'general');
  fillSelect($('mOpCommander'), [['random', '무작위'], ...cmds], 'random');
  $('mSeed').value = String(1 + Math.floor(Math.random() * 99999));
  lobby.picks = E.botPicks(E.makeRng(7), lobbyEcon());

  $('modeTabs').addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (b) showScreen(b.dataset.mode);
  });
  $('mCommander').addEventListener('change', renderLobby);
  $('mMode').addEventListener('change', () => {
    lobby.picks = E.botPicks(E.makeRng(7), lobbyEcon());
    renderLobby();
  });
  $('mPicks').addEventListener('click', (ev) => {
    const chip = ev.target.closest('.chip');
    if (!chip) return;
    const id = chip.dataset.id;
    const econ = lobbyEcon();
    if (lobby.picks.includes(id)) lobby.picks = lobby.picks.filter((x) => x !== id);
    else if (lobby.picks.length < econ.picks) {
      const t5 = lobby.picks.filter((x) => E.CARDS[x].tier === 5).length;
      if (E.CARDS[id].tier === 5 && t5 >= econ.maxTier5Picks) return;
      lobby.picks.push(id);
    }
    renderLobby();
  });
  $('mAutoPicks').addEventListener('click', () => {
    lobby.picks = E.botPicks(E.makeRng(Math.floor(Math.random() * 1e9)), lobbyEcon());
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
  $('sReward').addEventListener('click', (ev) => {
    if (!match) return;
    const card = ev.target.closest('.card[data-reward]');
    if (card) shopAct(() => E.claimReward(match.game, ME, Number(card.dataset.reward)));
    else if (ev.target.closest('button[data-act=skipReward]')) shopAct(() => E.skipReward(match.game, ME));
  });
  $('sShopButtons').addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b || !match) return;
    if (b.dataset.act === 'reroll') shopAct(() => E.reroll(match.game, ME));
    if (b.dataset.act === 'lock') shopAct(() => E.toggleLock(match.game, ME));
    if (b.dataset.act === 'xp') shopAct(() => E.buyXp(match.game, ME));
    if (b.dataset.act === 'removeMode') {
      match.removeMode = !match.removeMode;
      match.sel = null;
      match.fuseBody = null;
      match.hint = '';
      renderShop();
    }
  });
  $('sDeck').addEventListener('click', (ev) => {
    const chip = ev.target.closest('.chip');
    if (!chip || !match) return;
    const key = Number(chip.dataset.key);
    if (match.removeMode) {
      match.removeMode = false;
      shopAct(() => E.removeCard(match.game, ME, key));
      return;
    }
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
  $('dOptions').addEventListener('click', (ev) => {
    const el = ev.target.closest('.card[data-option]');
    if (el) draftChoose(Number(el.dataset.option));
  });
  $('dQuit').addEventListener('click', () => {
    endMatch();
    showScreen('lobby');
  });
  $('sReady').addEventListener('click', goBattle);
  $('sQuit').addEventListener('click', () => {
    endMatch();
    showScreen('lobby');
  });
  document.addEventListener('keydown', (ev) => {
    if (match && !$('draft').hidden && ev.key >= '1' && ev.key <= '3') draftChoose(Number(ev.key) - 1);
    if (!match || $('shop').hidden || ev.target.matches('input, select, textarea')) return;
    if (ev.key === 'd' || ev.key === 'D' || ev.key === 'ㅇ') shopAct(() => E.reroll(match.game, ME));
    else if (ev.key === 'f' || ev.key === 'F' || ev.key === 'ㄹ') shopAct(() => E.buyXp(match.game, ME));
    else if (ev.key === 'Escape') {
      match.sel = null;
      match.fuseBody = null;
      match.removeMode = false;
      renderShop();
    }
  });

  renderLobby();
  showScreen('lobby');
}

// ───────────────────────── 사전 선택 ─────────────────────────

function renderLobby() {
  const mode = E.MODES[lobbyMode()];
  const econ = lobbyEcon();
  const c = E.COMMANDERS[$('mCommander').value];
  $('mPassive').textContent = `패시브: ${c.passive} · 고유 카드: ${E.CARDS[c.card].name} · 시작 덱의 나머지 ${econ.draftPicks}장은 경기를 시작하면 드래프트로 고른다`;
  const need = econ.picks;
  if (lobby.picks.length > need) lobby.picks = lobby.picks.slice(0, need);
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
  const many = mode.players > 2;
  $('mOpCommanderRow').hidden = many;
  $('mOpNote').textContent = many
    ? `상대는 봇 ${mode.players - 1}명이고 지휘관은 무작위다. 라운드마다 결투, 삼파전, 연합전, 보스 레이드, 난투장이 돌아가며 나온다.`
    : '';
  $('mLead').textContent = many
    ? `지휘관과 픽 카드 ${need}종을 고른 뒤, 상점과 전투를 반복한다. HP ${econ.playerHp}이 0이 되면 탈락하고, 마지막까지 남으면 이긴다. 1~2라운드는 중립 몬스터와 싸우는 연습이다.`
    : `지휘관과 픽 카드 ${need}종을 고른 뒤, 상점과 전투를 반복한다. 상대의 HP ${econ.playerHp}을 먼저 0으로 만들면 이긴다. 1~2라운드는 중립 몬스터와 싸우는 연습이라 HP를 잃지 않는다.`;
}

function startMatch() {
  const econ = lobbyEcon();
  if (!E.validatePicks(lobby.picks, econ).ok) return;
  const mode = lobbyMode();
  const n = E.MODES[mode].players;
  const seed = Number($('mSeed').value) || 1;
  const rng = E.makeRng(E.hashSeed(seed, 'opponent'));
  const players = [{ commander: $('mCommander').value, picks: lobby.picks, name: n > 2 ? '나' : undefined }];
  const styles = [null];
  for (let i = 1; i < n; i++) {
    let commander = n === 2 ? $('mOpCommander').value : 'random';
    if (commander === 'random') commander = rng.pick(E.COMMANDER_IDS);
    players.push({ commander, picks: E.botPicks(rng, econ), name: n > 2 ? `봇 ${i}` : undefined });
    const style = $('mBotStyle').value;
    styles.push(style === 'random' ? rng.pick(Object.keys(E.SHOP_STYLES)) : style);
  }
  match = {
    game: E.createGame({ seed, mode, players }),
    botLevel: $('mBotLevel').value,
    styles,
    shopSeconds: Number($('mShopTime').value),
    sel: null,
    fuseBody: null,
    removeMode: false,
    timerId: null,
    deadline: 0,
    hint: '',
  };
  // 봇들은 바로 드래프트를 마치고, 나는 화면에서 고른다
  for (let i = 1; i < n; i++) E.runDraftBot(match.game, i);
  if (match.game.phase === 'draft') {
    showScreen('draft');
    renderDraft();
  } else beginShop();
}

// ───────────────────────── 시작 덱 드래프트 ─────────────────────────

function renderDraft() {
  const { game } = match;
  const P = game.players[ME];
  const e = game.econ;
  const done = e.draftPicks - P.draft.left;
  $('dStep').innerHTML = `${done + 1}<small>/ ${e.draftPicks}</small>`;
  $('dInfo').textContent = `시작 덱 드래프트 · 지휘관 고유 카드 1장에 ${e.draftPicks}장을 더해 ${e.draftPicks + 1}장으로 시작한다. 후보는 공용 풀(중립 카드 + 모두의 픽 카드)에서 뜨고 3등급까지 나온다.`;
  $('dOptions').innerHTML = P.draft.options.map((id, i) => {
    const own = P.deck.filter((c) => c.id === id).length;
    return cardFace(game, id, {
      cost: E.CARDS[id].cost, costClass: '', attrs: ` data-option="${i}"`,
      prefix: i === 0 ? '<b class="sig">내 픽</b> · ' : '', note: own ? `이미 ${own}장 골랐다` : '',
    });
  }).join('');
  $('dDeckInfo').textContent = `${P.deck.length}장`;
  $('dDeck').innerHTML = deckChips(P.deck);
  $('dPicks').innerHTML = P.picks.map((id) => `<span class="chip ${E.CARDS[id].type}" title="${esc(E.CARDS[id].text || '')}"><b>${E.CARDS[id].tier}등급</b>${esc(E.CARDS[id].name)}</span>`).join('');
}

function draftChoose(i) {
  if (!match || match.game.phase !== 'draft') return;
  E.draftPick(match.game, ME, i);
  if (match.game.phase === 'shop') beginShop();
  else renderDraft();
}

function endMatch() {
  if (match && match.timerId) clearInterval(match.timerId);
  match = null;
}

// ───────────────────────── 상점 ─────────────────────────

function runBotShops() {
  const { game } = match;
  for (const P of game.players) if (P.idx !== ME && P.alive) E.runShopBot(game, P.idx, { style: match.styles[P.idx] });
}

function beginShop() {
  const { game } = match;
  // 봇이 먼저 상점을 본다. 첩보원이면 그 뒤에 상대의 시작 카드를 볼 수 있다.
  runBotShops();
  fillOpening();
  match.sel = null;
  match.fuseBody = null;
  match.removeMode = false;
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

function cardFace(game, id, { cost, costClass = 'gold', attrs = '', cls = [], note = '', prefix = '' }) {
  const def = E.CARDS[id];
  const r = game.battleRules;
  const stat = def.type === 'unit'
    ? `${fmt(def.atk * (r.unitAtkMult ?? 1))}/${fmt(def.hp * (r.unitHpMult ?? 1))}/${def.interval / 1000}초 · ${def.ranged ? '원거리' : '근접'}`
    : '';
  return `<div class="${['card', def.type, ...cls].join(' ')}"${attrs} role="button" tabindex="0">
    <span class="cost ${costClass}">${cost}</span>
    <span class="cname">${esc(def.name)}</span>
    <span class="ctype">${prefix}${TYPE_NAMES[def.type]} · ${def.tier}등급 · 마나 ${def.cost}${stat ? ` · ${stat}` : ''}</span>
    <span class="ctext">${esc(def.text || '')}</span>
    <span class="own">${note}</span>
  </div>`;
}

function shopCardHtml(game, P, s, i) {
  if (!s) return '<div class="card empty">비어 있음</div>';
  const cost = E.CARDS[s.id].tier;
  const own = P.deck.filter((c) => c.id === s.id && c.stars === 1).length;
  const soldOut = game.pool[s.id] <= 0;
  const cls = [];
  if (s.sold) cls.push('sold');
  else if (soldOut || P.gold < cost) cls.push('off');
  const note = s.sold ? '구매함' : soldOut ? '품절' : own >= 2 ? `보유 ${own}장 → 사면 강화 가능` : own === 1 ? '보유 1장' : '';
  return cardFace(game, s.id, {
    cost, cls, note, attrs: s.sold ? '' : ` data-slot="${i}"`, prefix: s.signature ? '<b class="sig">시그니처</b> · ' : '',
  });
}

/** 유령이면 복제한 플레이어의 덱을 돌려준다 */
function memberInfo(game, m) {
  const src = game.players[m.p !== null ? m.p : m.ghostOf];
  const ghost = m.p === null;
  const deck = ghost && !src.alive ? src.ghost.deck : src.deck;
  return { src, ghost, deck, name: ghost ? `${src.name}의 유령` : src.name };
}

function damageRule(info) {
  const b = info.baseDamage;
  switch (info.format) {
    case 'practice': return 'HP 피해 없음, 이기면 골드 +2';
    case 'boss': return 'HP 피해 없음. 보스에게 준 피해 순위로 보상을 받는다';
    case 'duel': return `지면 HP −(${b} + 상대에게 남은 유닛 수)`;
    case 'melee3': return `기준 피해 ${b} + 남은 상대 유닛 수. 2위는 50%, 3위는 100%를 받는다`;
    case 'melee4': return `기준 피해 ${b} + 남은 상대 유닛 수. 2위 30%, 3위 70%, 4위 100%`;
    case 'alliance': return `지면 둘 다 (${b} + 이긴 팀에 남은 유닛 수)의 절반을 받는다`;
    default: return '';
  }
}

function renderOpponents(game, info) {
  const P = game.players[ME];
  const spy = E.COMMANDERS[P.commander].seesOpening;
  if (info.format === 'practice') return '<div><b>중립 몬스터</b></div><div><small>싼 유닛 8장을 느리게 낸다.</small></div>';
  if (info.format === 'boss') {
    return '<div><b>고대 골렘</b></div><div><small>쓰러지지 않는다. 10초마다 전조 1.5초 뒤 전열 전체를 친다. 40초 동안 준 피해로 순위를 매긴다. 지휘관은 피해를 받지 않는다.</small></div>';
  }
  const group = E.groupOf(game, ME) || [];
  const myAt = group.findIndex((m) => m.p === ME);
  return group.map((m, i) => {
    if (m.p === ME) return '';
    const { src, ghost, deck, name } = memberInfo(game, m);
    const c = E.COMMANDERS[src.commander];
    const ally = info.format === 'alliance' && Math.floor(i / 2) === Math.floor(myAt / 2);
    const tags = `${ally ? ' · <b class="sig">아군</b>' : ''}${ghost ? ' · 유령 (피해를 받지 않는다)' : ''}`;
    const hp = ghost ? '' : ` · HP ${Math.max(0, src.hp)}/${src.maxHp} · 레벨 ${src.level}${streakText(src) ? ` · ${streakText(src)}` : ''}`;
    let extra = '';
    if (!ghost && !ally && spy) {
      extra = `<div class="pickhint">첩보원 패시브로 본 시작 카드: ${esc(src.opening.map((k) => E.cardLabel(src.deck.find((x) => x.key === k))).join(', ') || '없음')}</div>`;
    } else if (!ghost && !ally && c.seesOpening) extra = '<div><small>이 첩보원이 내 시작 카드를 미리 본다.</small></div>';
    return `<div class="opp"><div><b>${esc(name)}</b>${name === c.name ? '' : ` <small>${esc(c.name)}</small>`}${tags}${hp}</div>
      <div><small>패시브: ${esc(c.passive)}</small></div>${extra}
      <div class="decklist">${deckChips(deck)}</div></div>`;
  }).join('');
}

function renderStandings(game) {
  const rows = [...game.players].sort((A, B) => (B.alive - A.alive) || (A.alive ? B.hp - A.hp : A.place - B.place) || A.idx - B.idx);
  return `<table>${rows.map((X) => `<tr class="${X.idx === ME ? 'mine' : ''}${X.alive ? '' : ' out'}">
    <td>${esc(playerLabel(X))}</td>
    <td>${X.alive ? `HP ${X.hp}` : `${X.place}위 탈락`}</td>
    <td>${X.alive ? `L${X.level}${streakText(X) ? ` · ${streakText(X)}` : ''}` : ''}</td></tr>`).join('')}</table>`;
}

function historyLine(h) {
  const mine = h.results.find((r) => r.p === ME);
  if (!mine) return '';
  let what;
  if (h.format === 'boss') what = `${mine.rank + 1}위${mine.gold ? ` · 골드 +${mine.gold}` : ''}${mine.rewardOptions ? ' · 카드 보상' : ''}`;
  else if (h.format === 'melee3' || h.format === 'melee4') what = `${mine.rank + 1}위${mine.damage ? ` · HP −${mine.damage}` : ''}`;
  else what = `${mine.won === null ? '무승부' : mine.won ? '승리' : '패배'}${mine.damage ? ` · HP −${mine.damage}` : ''}${mine.gold ? ` · 골드 +${mine.gold}` : ''}`;
  const good = mine.won === true || mine.rank === 0;
  return `<li class="${good ? 'p0' : 'p1'}"><time>${h.round}R</time>${FORMAT_SHORT[h.format]} <b>${what}</b></li>`;
}

function renderShop() {
  if (!match) return;
  const { game } = match;
  const P = game.players[ME];
  const e = game.econ;
  const info = E.roundInfo(game);
  const many = game.players.length > 2;

  $('sRound').innerHTML = `${game.round}<small>라운드</small>`;
  const field = info.battlefield ? `전장: ${E.BATTLEFIELDS[info.battlefield].name} — ${E.BATTLEFIELDS[info.battlefield].text}` : '전장: 없음';
  $('sInfo').textContent = `다음 전투: ${FORMAT_NAMES[info.format]} · ${field} · ${damageRule(info)}`;

  // 내 상태
  const inc = E.incomePreview(game, ME);
  const need = e.xpToNext[P.level];
  $('sMe').innerHTML = `
    <span><span class="big">HP ${Math.max(0, P.hp)}</span> <small>/ ${P.maxHp}</small></span>
    <span><span class="big gold">${P.gold}골드</span> <small>다음 라운드 +${inc.total} (기본 ${inc.base}${inc.interest ? ` · 이자 ${inc.interest}` : ''}${inc.streak ? ` · 연속 ${inc.streak}` : ''}${inc.commander ? ` · 지휘관 ${inc.commander}` : ''})</small></span>
    <span><span class="big">레벨 ${P.level}</span> <small>${P.level >= e.maxLevel ? '최대' : `경험치 ${P.xp}/${need}`}</small>${P.level >= e.maxLevel ? '' : `<span class="xpbar"><i style="width:${(P.xp / need) * 100}%"></i></span>`}</span>
    <span><small>고르는 시작 카드</small> ${E.openingCount(game, ME)}장</span>
    <span><small>융합</small> ${P.fusionsLeft}회 남음</span>
    ${many ? `<span><small>남은 인원</small> ${E.aliveCount(game)}명</span>` : ''}
    ${streakText(P) ? `<span class="gold">${streakText(P)}</span>` : ''}`;

  // 보스 보상
  $('sReward').innerHTML = P.reward
    ? `<h2 class="sec">보스 보상 <small>카드 1장을 무료로 받는다</small></h2>
       <div class="hand">${P.reward.options.map((id, i) => cardFace(game, id, {
    cost: '무료', costClass: 'gold free', attrs: ` data-reward="${i}"`, cls: game.pool[id] <= 0 ? ['off'] : [], note: game.pool[id] <= 0 ? '품절' : '',
  })).join('')}</div>
       <div class="row"><button type="button" data-act="skipReward">받지 않기</button></div>`
    : '';

  // 상점
  $('sShop').innerHTML = P.shop.map((s, i) => shopCardHtml(game, P, s, i)).join('');
  const rc = E.rerollCostOf(game, ME);
  $('sShopButtons').innerHTML = `
    <button type="button" data-act="reroll"${P.gold < rc ? ' disabled' : ''}>리롤 (${rc === 0 ? '무료' : `${rc}골드`}) <small>D</small></button>
    <button type="button" data-act="lock" class="${P.locked ? 'on' : ''}">${P.locked ? '잠금 해제' : '잠금'} <small>다음 라운드에도 유지</small></button>
    <button type="button" data-act="xp"${P.gold < e.xpCost || P.level >= e.maxLevel ? ' disabled' : ''}>경험치 +${e.xpPerBuy} (${e.xpCost}골드) <small>F</small></button>
    <button type="button" data-act="removeMode" class="${match.removeMode ? 'on' : ''}"${P.removesLeft <= 0 || P.gold < e.removeCost || P.deck.length <= e.deckMin ? ' disabled' : ''}>카드 빼기 (${e.removeCost}골드) <small>${P.removesLeft > 0 ? '라운드당 1번' : '이번 라운드는 이미 뺌'}</small></button>`;

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
      if (match.removeMode) cls.push('removable');
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
  if (match.removeMode) {
    hint = `덱에서 뺄 카드를 누른다 (${e.removeCost}골드). 풀에서 온 카드는 풀로 돌아간다. (Esc: 취소)`;
  } else if (fuseBody) {
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

  // 이번 상대 (공개 정보)
  $('sOp').innerHTML = renderOpponents(game, info);
  $('sRankBox').hidden = !many;
  $('sRank').innerHTML = many ? renderStandings(game) : '';

  // 풀
  $('sPool').innerHTML = `<table>${[...E.POOL_CARD_IDS]
    .sort((a, b) => E.CARDS[a].tier - E.CARDS[b].tier || E.CARDS[a].cost - E.CARDS[b].cost)
    .map((id) => `<tr class="${P.picks.includes(id) ? 'mine' : ''}"><td>${E.CARDS[id].tier}등급 ${esc(E.CARDS[id].name)}${P.picks.includes(id) ? ' (내 픽)' : ''}</td><td>${game.pool[id]} / ${game.poolStart[id]}</td></tr>`)
    .join('')}</table>`;

  $('sHistory').innerHTML = [...game.history].reverse().map(historyLine).join('');
}

// ───────────────────────── 전투와 라운드 결과 ─────────────────────────

/** 내가 0번 자리에 오도록 전투의 자리 순서를 바꾼다. 연합전은 [나, 아군, 적, 적], 난전은 시계 방향 순서를 유지한다. */
function seatMeFirst(b) {
  const i = b.sides.indexOf(ME);
  if (i <= 0) return;
  const n = b.sides.length;
  const perm = b.kind === 'alliance'
    ? [i, i ^ 1, ...(i < 2 ? [2, 3] : [0, 1])]
    : b.sides.map((_, k) => (i + k) % n);
  b.sides = perm.map((k) => b.sides[k]);
  b.ghosts = perm.map((k) => b.ghosts[k]);
  b.cfg = { ...b.cfg, players: perm.map((k) => b.cfg.players[k]) };
}

function goBattle() {
  if (!match || match.game.phase !== 'shop' || !$('roundResult').hidden) return;
  if (match.timerId) clearInterval(match.timerId);
  match.timerId = null;
  const { game } = match;
  const info = E.roundInfo(game);
  const before = game.players.map((P) => ({ hp: P.hp, gold: P.gold }));
  const battles = E.roundBattles(game);
  const mine = battles.find((b) => b.sides.includes(ME));
  seatMeFirst(mine);
  // 내가 끼지 않는 전투는 바로 계산한다
  for (const b of battles) if (b !== mine) b.state = E.runBattle(b.cfg).state;
  launchBattle({
    cfg: mine.cfg,
    // 연습 라운드의 중립 몬스터는 엔진이 정한 느린 봇을 쓴다
    botOpts: (seat) => ({ seed: E.hashSeed(game.seed, 'bot', game.round, seat), ...(mine.cfg.players[seat].bot || E.BOT_LEVELS[match.botLevel]) }),
    label: `${game.round}라운드 ${FORMAT_SHORT[info.format]}`,
    onFinish(state) {
      mine.state = state;
      const summary = E.finishRound(game, battles);
      showRoundResult(summary, state, battles.indexOf(mine), before);
    },
  });
}

function resultText(r) {
  switch (r.kind) {
    case 'boss': return `${r.rank + 1}위 · 피해 ${fmt(r.bossDamage)}`;
    case 'melee3':
    case 'melee4': return `${r.rank + 1}위`;
    default: return r.won === null ? '무승부' : r.won ? '승리' : '패배';
  }
}

function showRoundResult(summary, state, myGroup, before) {
  const { game } = match;
  const P = game.players[ME];
  const many = game.players.length > 2;
  const mine = summary.results.find((r) => r.p === ME);
  const over = game.phase === 'over';
  const title = $('rrTitle');
  if (over) {
    title.className = game.winner === ME ? 'win' : 'lose';
    if (many) title.textContent = game.winner === ME ? '우승' : `경기 종료 · ${P.place}위`;
    else title.textContent = game.winner === ME ? '경기 승리' : game.winner === -1 ? '경기 무승부' : '경기 패배';
  } else if (!P.alive) {
    title.className = 'lose';
    title.textContent = `${P.place}위로 탈락`;
  } else {
    const good = mine.won === true || mine.rank === 0;
    title.className = good ? 'win' : mine.won === false ? 'lose' : '';
    title.textContent = `${summary.round}라운드 ${FORMAT_SHORT[summary.format]} · ${resultText(mine)}`;
  }
  const why = state.result.reason === 'commander' ? '지휘관이 쓰러졌다' : '시간이 다 됐다';
  const outs = summary.eliminated.length ? ` · 이번 라운드 탈락: ${summary.eliminated.map((p) => game.players[p].name).join(', ')}` : '';
  $('rrDetail').textContent = `${FORMAT_NAMES[summary.format]} · ${(state.result.timeMs / 1000).toFixed(1)}초 · ${why}${outs}`;

  // 내 전투에 있던 플레이어들 (보스 레이드는 전원)
  const shown = summary.results
    .filter((r) => summary.format === 'boss' || r.group === myGroup)
    .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0) || (b.won === true) - (a.won === true) || a.p - b.p);
  const rows = shown.map((r) => {
    const X = game.players[r.p];
    const hp = `${Math.max(0, before[r.p].hp)} → ${Math.max(0, X.hp)}${r.damage ? ` (−${r.damage})` : ''}`;
    const bonus = r.rewardOptions ? `카드 ${r.rewardOptions}장 중 1장${r.gold ? ` + 골드 ${r.gold}` : ''}` : r.gold ? `골드 +${r.gold}` : '';
    return `<tr class="${r.p === ME ? 'mine' : ''}"><td>${esc(r.p === ME ? '나' : playerLabel(X))}${r.team !== undefined ? ` <small>${r.team === mine.team ? '아군' : '상대 팀'}</small>` : ''}</td><td>${resultText(r)}</td><td>${hp}</td><td>${bonus}</td></tr>`;
  });
  const ghosts = summary.groups[myGroup] ? summary.groups[myGroup].filter((m) => m.p === null).map((m) => `${game.players[m.ghostOf].name}의 유령`) : [];
  let html = `<tr><th></th><th>결과</th><th>HP</th><th>보상</th></tr>${rows.join('')}`;
  if (ghosts.length) html += `<tr><td colspan="4"><small>함께 싸운 유령: ${esc(ghosts.join(', '))} (유령은 피해를 받지 않는다)</small></td></tr>`;
  if (over && many) {
    html += `<tr><th colspan="4">최종 순위</th></tr>${game.placements.map((p) => `<tr class="${p === ME ? 'mine' : ''}"><td colspan="4">${game.players[p].place}위 · ${esc(p === ME ? '나' : playerLabel(game.players[p]))}</td></tr>`).join('')}`;
  }
  $('rrStats').innerHTML = html;

  const next = over ? ['lobby', '새 경기'] : !P.alive ? ['watch', '남은 경기 결과 보기'] : ['next', '다음 라운드 (상점)'];
  $('rrButtons').innerHTML = `<button type="button" class="primary" data-act="${next[0]}">${next[1]}</button>${!over && !P.alive ? '<button type="button" data-act="lobby">새 경기</button>' : ''}`;
  $('rrButtons').onclick = (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    stopBattle();
    if (b.dataset.act === 'lobby') {
      endMatch();
      showScreen('lobby');
    } else if (b.dataset.act === 'watch') watchRest();
    else beginShop();
  };
  $('roundResult').hidden = false;
}

/** 내가 탈락한 뒤: 남은 경기를 봇끼리 끝까지 돌리고 최종 순위를 보여 준다 */
function watchRest() {
  const { game } = match;
  while (game.phase !== 'over' && game.round < 200) {
    runBotShops();
    E.finishRound(game, E.roundBattles(game).map((b) => ({ ...b, state: E.runBattle(b.cfg).state })));
  }
  const P = game.players[ME];
  $('rrTitle').className = 'lose';
  $('rrTitle').textContent = `경기 종료 · ${P.place}위`;
  $('rrDetail').textContent = `${game.round}라운드에 끝났다. 우승: ${playerLabel(game.players[game.winner] || game.players[game.placements[0]])}`;
  $('rrStats').innerHTML = `<tr><th>순위</th><th></th><th>탈락 라운드</th></tr>${game.placements.map((p) => {
    const X = game.players[p];
    return `<tr class="${p === ME ? 'mine' : ''}"><td>${X.place}위</td><td>${esc(p === ME ? '나' : playerLabel(X))}</td><td>${X.eliminatedRound ? `${X.eliminatedRound}R` : '-'}</td></tr>`;
  }).join('')}`;
  $('rrButtons').innerHTML = '<button type="button" class="primary" data-act="lobby">새 경기</button>';
}

window.__match = () => match;
window.__render = () => { if (game) { consumeEvents(); render(); } };

// 위의 let/const가 준비된 뒤에 시작한다
initMatch();
