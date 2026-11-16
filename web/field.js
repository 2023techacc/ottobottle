// 유닛 소환 전투 시제품: 전투 한 판의 설정과 결과 화면. 전투 화면은 fieldview.js가 그린다.
// 규칙은 ../engine/field.js 에 있다. 나는 항상 0번 자리(아래쪽)다.

import * as E from '../engine/index.js';
import { createFieldView, endReason, fmt, esc } from './fieldview.js';

const F = E.Field;
const ME = 0;
const $ = (id) => document.getElementById(id);
const FORMATS = {
  duel: { name: '결투 (1:1)', n: 2 },
  melee4: { name: '난투장 (4인 · 중앙 점령)', n: 4 },
  alliance: { name: '연합전 (2:2)', n: 4 },
};

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
  $('rulesNote').textContent = `지휘관 체력 ${r.commanderHp} · 유닛 공격 ×${r.unitAtkMult} · 유닛 체력 ×${r.unitHpMult} · 유닛은 ${r.unitCap}기까지 · 난투장은 본진을 치지 않는다. 가운데 원 안에 유닛이 가장 많은 사람이 1초에 1점, 적 유닛을 쓰러뜨리면 ${r.killScore}점(원 안이면 ${r.killScore * r.killZoneMult}점)을 얻어 ${r.captureGoal}점에 먼저 닿으면 이긴다`;
  $('statTable').innerHTML = `<div class="decklist">${Object.entries(F.FIELD_STATS).filter(([id]) => !E.CARDS[id].special).map(([id, s]) => {
    const def = E.CARDS[id];
    return `<span class="chip unit" title="${esc(F.fieldText(id))}"><b>${def.cost}</b>${esc(def.name)} · ${def.ranged ? '원거리' : '근접'} · 사거리 ${s.range} · 속도 ${s.speed}</span>`;
  }).join('')}</div>`;
  refreshSetup();
}

// ─────────────────────────────────────────────────────────────
// 전투
// ─────────────────────────────────────────────────────────────

const view = createFieldView($('fbattle'), { onQuit: toSetup });

function startBattle() {
  const seed = Number($('seed').value) || 1;
  const format = $('format').value;
  let battlefield = $('battlefield').value;
  if (battlefield === 'none') battlefield = null;
  else if (battlefield === 'random') battlefield = E.makeRng(E.hashSeed(seed, 'field')).pick(E.BATTLEFIELD_IDS);
  $('fsetup').hidden = true;
  $('tabs').hidden = true;
  $('result').hidden = true;
  $('fbattle').hidden = false;
  view.start({
    cfg: { seed, format, battlefield, players: setup.players.map((p, i) => ({ ...p, name: roleName(format, i) })) },
    botOpts: { seed, ...E.BOT_LEVELS[$('botLevel').value] },
    label: FORMATS[format].name,
    onFinish: showResult,
  });
}

function toSetup() {
  view.stop();
  $('result').hidden = true;
  $('fbattle').hidden = true;
  $('fsetup').hidden = false;
  $('tabs').hidden = false;
}

function showResult(state) {
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
  $('resultDetail').textContent = `${FORMATS[state.format].name} · ${(res.timeMs / 1000).toFixed(1)}초 · ${endReason(state)} · 시드 ${state.seed}`;
  const order = [...state.players].sort((A, B) => res.ranks[A.idx] - res.ranks[B.idx] || A.idx - B.idx);
  const cap = !!state.capture;
  $('resultStats').innerHTML = `<tr><th></th><th>순위</th><th>${cap ? '점수 <small>(원 + 처치)</small>' : '지휘관 체력'}</th>${cap ? '<th>쓰러뜨린 유닛</th>' : ''}<th>낸 카드</th><th>유닛에 준 피해</th>${cap ? '' : '<th>지휘관에 준 피해</th>'}<th>걸은 거리</th></tr>${order.map((P) => `
    <tr class="${P.idx === ME ? 'mine' : ''}"><td>${esc(P.name)}</td><td>${res.ranks[P.idx] + 1}</td>
    <td>${cap ? `${fmt(res.scores[P.idx])} <small>(${fmt(P.stats.zoneScore)} + ${fmt(P.stats.killScore)})</small>` : fmt(Math.max(0, P.hp))}</td>${cap ? `<td>${fmt(P.stats.kills)}</td>` : ''}
    <td>${P.stats.cardsPlayed}</td><td>${fmt(P.stats.unitDamage)}</td>${cap ? '' : `<td>${fmt(P.stats.commanderDamage)}</td>`}<td>${fmt(P.stats.walked)}</td></tr>`).join('')}`;
  $('result').hidden = false;
}

function onKey(ev) {
  if (!$('result').hidden) {
    if (ev.code === 'Enter' || ev.code === 'NumpadEnter') {
      $('again').click();
      ev.preventDefault();
    }
    return;
  }
  view.onKey(ev);
}

function initInput() {
  $('toSetup').addEventListener('click', toSetup);
  $('again').addEventListener('click', () => {
    $('seed').value = String(1 + Math.floor(Math.random() * 99999));
    refreshSetup();
    startBattle();
  });
  $('replay').addEventListener('click', () => startBattle());
  document.addEventListener('keydown', onKey);
}

initSetup();
initInput();

// 자동 검증과 디버깅용
window.__game = () => (view.state ? { state: view.state } : null);
window.__engine = E;
window.__render = () => view.refresh();
