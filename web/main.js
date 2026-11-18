// 한 경기(1:1 또는 8인) 화면: 사전 선택 → 드래프트 → [상점 → 전투] 반복.
// 규칙은 전부 ../engine 에 있고, 여기는 그리기와 입력만 한다. 전투 화면은 fieldview.js가 그린다.

import * as E from '../engine/index.js';
import { createFieldView, endReason, fmt, esc } from './fieldview.js';

const ME = 0;
const $ = (id) => document.getElementById(id);
const TYPE_NAMES = { unit: '유닛', spell: '주문', buff: '강화', ops: '운영' };

function fillSelect(el, options, value) {
  el.innerHTML = options.map(([v, label]) => `<option value="${esc(v)}">${esc(label)}</option>`).join('');
  if (value !== undefined) el.value = value;
}

function deckChips(deck) {
  return E.deckSummary(deck)
    .sort((a, b) => E.CARDS[a.id].cost - E.CARDS[b.id].cost || a.id.localeCompare(b.id))
    .map((d) => {
      const def = E.CARDS[d.id];
      return `<span class="chip ${def.type}" title="${esc(E.Field.fieldText(d.id))}"><b>${def.cost}</b>${esc(E.cardLabel(d))}${d.n > 1 ? ` ×${d.n}` : ''}</span>`;
    })
    .join('');
}

/** 지금 보이는 화면을 바꾼다 */
function showScreen(name) {
  for (const id of ['lobby', 'draft', 'shop', 'fieldBattle']) $(id).hidden = id !== name;
  $('modeTabs').hidden = name !== 'lobby';
  $('roundResult').hidden = true;
}

window.__engine = E;

// ═════════════════════════════════════════════════════════════
// 한 경기 모드 (1:1 또는 8인): 사전 선택 → [상점 → 전투] 반복
// 규칙은 ../engine/game.js 에 있고, 여기는 화면만 다룬다. 나는 항상 0번 플레이어다.
// ═════════════════════════════════════════════════════════════

let match = null; // { game, botLevel, styles, shopSeconds, sel, fuseBody, timerId, deadline, hint }
const lobby = { picks: [] };
// 유닛 전투 화면 (경기의 전투 방식이 유닛 전투일 때 쓴다)
const fieldView = createFieldView($('fieldBattle'), {
  onQuit() {
    endMatch();
    showScreen('lobby');
  },
});
const STYLE_NAMES = { eco: '저축형', balanced: '균형형', spend: '소비형' };
const FORMAT_NAMES = {
  practice: '연습 (중립 몬스터)', duel: '결투', melee4: '난투장 (4인 · 중앙 점령)', alliance: '연합전 (2:2)', boss: '보스 레이드',
};
const FORMAT_SHORT = { practice: '연습', duel: '결투', melee4: '난투장', alliance: '연합전', boss: '보스' };

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
  document.addEventListener('keydown', onKey);

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
    ? `상대는 봇 ${mode.players - 1}명이고 지휘관은 무작위다. 라운드마다 결투, 난투장, 연합전, 보스 레이드가 돌아가며 나온다.`
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
  fieldView.stop();
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
  const r = E.fullBattleRules(game);
  const fs = E.Field.FIELD_STATS[id];
  const reach = fs ? `${def.ranged ? `사거리 ${fs.range}` : '근접'} · 속도 ${fs.speed}` : '';
  const stat = def.type === 'unit'
    ? `${fmt(def.atk * r.unitAtkMult)}/${fmt(def.hp * r.unitHpMult)}/${def.interval / 1000}초 · ${reach}`
    : '';
  const text = E.Field.fieldText(id);
  return `<div class="${['card', def.type, ...cls].join(' ')}"${attrs} role="button" tabindex="0">
    <span class="cost ${costClass}">${cost}</span>
    <span class="cname">${esc(def.name)}</span>
    <span class="ctype">${prefix}${TYPE_NAMES[def.type]} · ${def.tier}등급 · 마나 ${def.cost}${stat ? ` · ${stat}` : ''}</span>
    <span class="ctext">${esc(text)}</span>
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

function damageRule(info, game) {
  const b = info.baseDamage;
  const k = game.econ.survivorDamage;
  const units = (who) => (k === 1 ? `${who} 남은 유닛 수` : `${who} 남은 유닛 수 × ${k}`);
  switch (info.format) {
    case 'practice': return 'HP 피해 없음, 이기면 골드 +2';
    case 'boss': return 'HP 피해 없음. 보스에게 준 피해 순위로 보상을 받는다';
    case 'duel': return `지면 HP −(${b} + ${units('상대에게')})`;
    case 'melee4': return `가운데 원 점령과 처치 점수로 순위를 정한다. 기준 피해 ${b} + ${units('상대에게')}. 2위 30%, 3위 70%, 4위 100%`;
    case 'alliance': return `지면 둘 다 (${b} + ${units('이긴 팀에')})의 절반을 받는다`;
    default: return '';
  }
}

function renderOpponents(game, info) {
  const P = game.players[ME];
  const spy = E.COMMANDERS[P.commander].seesOpening;
  if (info.format === 'practice') return '<div><b>중립 몬스터</b></div><div><small>싼 유닛 8장을 느리게 낸다.</small></div>';
  if (info.format === 'boss') {
    const hit = '움직이지 않고, 10초마다 전조 1.5초 뒤 자기 주변 넓은 범위를 친다';
    return `<div><b>고대 골렘</b></div><div><small>쓰러지지 않는다. ${hit}. 40초 동안 준 피해로 순위를 매긴다. 지휘관은 피해를 받지 않는다.</small></div>`;
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
  else if (h.format === 'melee4') what = `${mine.rank + 1}위${mine.damage ? ` · HP −${mine.damage}` : ''}`;
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
  $('sInfo').textContent = `다음 전투: ${FORMAT_NAMES[info.format]} · ${field} · ${damageRule(info, game)}`;

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
    <button type="button" data-act="lock" class="${P.locked ? 'on' : ''}">${P.locked ? '잠금 해제' : '잠금'} <small>S · 다음 라운드에도 유지</small></button>
    <button type="button" data-act="xp"${P.gold < e.xpCost || P.level >= e.maxLevel ? ' disabled' : ''}>경험치 +${e.xpPerBuy} (${e.xpCost}골드) <small>F</small></button>
    <button type="button" data-act="removeMode" class="${match.removeMode ? 'on' : ''}"${P.removesLeft <= 0 || P.gold < e.removeCost || P.deck.length <= e.deckMin ? ' disabled' : ''}>카드 빼기 (${e.removeCost}골드) <small>X · ${P.removesLeft > 0 ? '라운드당 1번' : '이번 라운드는 이미 뺌'}</small></button>`;

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
    actions.push(`<button type="button" data-act="upgrade" data-id="${u.id}" data-stars="${u.stars}" class="primary">${esc(E.CARDS[u.id].name)}${'★'.repeat(u.stars - 1)} 3장 → ${'★'.repeat(u.stars + 1)}로 합치기 <small>C</small></button>`);
  }
  const sel = P.deck.find((c) => c.key === match.sel);
  let hint = match.hint;
  if (match.removeMode) {
    hint = `덱에서 뺄 카드를 누른다 (${e.removeCost}골드). 풀에서 온 카드는 풀로 돌아간다. (Esc: 취소)`;
  } else if (fuseBody) {
    hint = `${E.cardLabel(fuseBody)}에 붙일 재료 카드를 누른다 (키보드: ←/→로 고르고 V). 보라색 테두리가 쓸 수 있는 재료다. 재료 카드는 사라진다.`;
    actions.push('<button type="button" data-act="cancelFuse">융합 취소</button>');
  } else if (sel) {
    const isOpening = P.opening.includes(sel.key);
    if (E.openingCount(game, ME) > 0) actions.push(`<button type="button" data-act="opening">${isOpening ? '시작 카드에서 빼기' : '시작 카드로 고르기'} <small>G</small></button>`);
    const canRemove = P.removesLeft > 0 && P.gold >= e.removeCost && P.deck.length > e.deckMin;
    actions.push(`<button type="button" data-act="remove"${canRemove ? '' : ' disabled'}>덱에서 빼기 (${e.removeCost}골드${P.removesLeft > 0 ? '' : ', 이번 라운드는 이미 뺌'})</button>`);
    const canBody = P.fusionsLeft > 0 && !sel.fuse && P.deck.length > e.deckMin;
    actions.push(`<button type="button" data-act="fuse"${canBody ? '' : ' disabled'}>융합: 이 카드에 효과 붙이기 <small>V</small></button>`);
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
  for (const b of battles) if (b !== mine) b.state = E.runRoundBattle(b).state;
  const opts = {
    cfg: mine.cfg,
    // 연습 라운드의 중립 몬스터는 엔진이 정한 느린 봇을 쓴다
    botOpts: (seat) => ({ seed: E.hashSeed(game.seed, 'bot', game.round, seat), ...(mine.cfg.players[seat].bot || E.BOT_LEVELS[match.botLevel]) }),
    label: `${game.round}라운드 ${FORMAT_SHORT[info.format]}`,
    onFinish(state) {
      mine.state = state;
      const summary = E.finishRound(game, battles);
      showRoundResult(summary, state, battles.indexOf(mine), before);
    },
  };
  showScreen('fieldBattle');
  fieldView.start(opts);
}

function resultText(r) {
  switch (r.kind) {
    case 'boss': return `${r.rank + 1}위 · 피해 ${fmt(r.bossDamage)}`;
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
  const why = state.mode === 'field' ? endReason(state) : state.result.reason === 'commander' ? '지휘관이 쓰러졌다' : '시간이 다 됐다';
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
    fieldView.stop();
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
    E.finishRound(game, E.roundBattles(game).map((b) => ({ ...b, state: E.runRoundBattle(b).state })));
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
window.__render = () => fieldView.refresh();
window.__fieldView = fieldView;

// ═════════════════════════════════════════════════════════════
// 키보드 단축키
// 글자 키는 ev.code로 읽는다. 한글 입력 상태이거나 자판 배열이 달라도 같은 자리의 키가 같은 일을 한다.
// ═════════════════════════════════════════════════════════════

function digitOf(ev) {
  const m = /^(?:Digit|Numpad)(\d)$/.exec(ev.code);
  return m ? Number(m[1]) : null;
}


function clickFirst(container) {
  const b = $(container).querySelector('button:not([disabled])');
  if (b) b.click();
  return Boolean(b);
}


function deckOrder(P) {
  return [...P.deck].sort((a, b) => E.CARDS[a.id].cost - E.CARDS[b.id].cost || a.id.localeCompare(b.id) || a.key - b.key);
}

function shopKey(ev) {
  const { game: g } = match;
  const P = g.players[ME];
  const d = digitOf(ev);
  if (d !== null) {
    if (P.reward) {
      if (d === 0) shopAct(() => E.skipReward(g, ME));
      else if (d <= P.reward.options.length) shopAct(() => E.claimReward(g, ME, d - 1));
    } else if (d >= 1 && d <= P.shop.length) shopAct(() => E.buy(g, ME, d - 1));
    return true;
  }
  const order = deckOrder(P);
  switch (ev.code) {
    case 'KeyD': shopAct(() => E.reroll(g, ME)); return true;
    case 'KeyF': shopAct(() => E.buyXp(g, ME)); return true;
    case 'KeyS': shopAct(() => E.toggleLock(g, ME)); return true;
    case 'ArrowLeft':
    case 'ArrowRight': {
      if (!order.length) return true;
      const i = order.findIndex((c) => c.key === match.sel);
      const step = ev.code === 'ArrowRight' ? 1 : -1;
      match.sel = order[i < 0 ? (step > 0 ? 0 : order.length - 1) : (i + step + order.length) % order.length].key;
      match.removeMode = false;
      match.hint = '';
      renderShop();
      return true;
    }
    case 'KeyG': {
      if (match.sel === null || E.openingCount(g, ME) <= 0) return true;
      let keys = [...P.opening];
      if (keys.includes(match.sel)) keys = keys.filter((k) => k !== match.sel);
      else {
        keys.push(match.sel);
        while (keys.length > E.openingCount(g, ME)) keys.shift();
      }
      E.setOpening(g, ME, keys);
      renderShop();
      return true;
    }
    case 'KeyX':
      if (match.sel !== null) {
        const key = match.sel;
        shopAct(() => {
          const res = E.removeCard(g, ME, key);
          if (res.ok) match.sel = null;
          return res;
        });
      } else {
        match.removeMode = !match.removeMode;
        match.fuseBody = null;
        renderShop();
      }
      return true;
    case 'KeyV':
      if (match.fuseBody && match.sel !== null && match.sel !== match.fuseBody) {
        const body = match.fuseBody;
        const mat = match.sel;
        match.fuseBody = null;
        shopAct(() => {
          const res = E.fuse(g, ME, body, mat);
          if (res.ok) match.sel = body;
          return res;
        });
      } else if (match.sel !== null) {
        match.fuseBody = match.fuseBody === match.sel ? null : match.sel;
        renderShop();
      }
      return true;
    case 'KeyC': {
      const u = E.upgradable(g, ME)[0];
      if (u) shopAct(() => E.upgrade(g, ME, u.id, u.stars));
      return true;
    }
    case 'Enter':
    case 'NumpadEnter': goBattle(); return true;
    case 'Escape':
      match.sel = null;
      match.fuseBody = null;
      match.removeMode = false;
      match.hint = '';
      renderShop();
      return true;
    default: return false;
  }
}

function onKey(ev) {
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
  if (ev.target instanceof Element && ev.target.matches('input, select, textarea')) return;
  const enter = ev.code === 'Enter' || ev.code === 'NumpadEnter';
  let handled = false;
  if (!$('roundResult').hidden) handled = enter && clickFirst('rrButtons'); // 라운드 결과 창
  else if (!$('fieldBattle').hidden) handled = fieldView.onKey(ev);
  else if (!$('shop').hidden && match) handled = shopKey(ev);
  else if (!$('draft').hidden && match) {
    const d = digitOf(ev);
    if (d >= 1 && d <= 3) {
      draftChoose(d - 1);
      handled = true;
    }
  }
  if (handled) ev.preventDefault();
}

// 위의 let/const가 준비된 뒤에 시작한다
initMatch();
