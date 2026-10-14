// 캘린더 화면(design.md §6.4, §6.0.3 D4): 58주를 한 노선으로 그린 노선도. 갱신일·인셉션·마감·사건이 역이고 열차가 지금 위치다.

import * as store from '../store.js';
import { describeTurn, turnLabel, seasonLabel } from '../calendar.js';
import { findTemplate, needsReply } from '../mail.js';
import { mailVars } from '../turn.js';
import { fillText } from '../mail.js';
import { h } from './components.js';
import { glossaryLink, linkWords } from './glossary_view.js';

let uiGeneration = -1;
let selectedTurn = null;

// 답이 필요한 메일의 마감 턴 → 메일 제목 목록
function deadlineMap(data, state) {
  const map = new Map();
  for (const mail of state.mails) {
    const template = findTemplate(data.mails, mail.template);
    if (!template || !needsReply(mail, template) || mail.deadline_turn === null) continue;
    if (!map.has(mail.deadline_turn)) map.set(mail.deadline_turn, []);
    map.get(mail.deadline_turn).push(fillText(template.subject_ko, mailVars(data, state)));
  }
  return map;
}

// ---------- 노선도 (design.md §6.0.3 D4): 새로 지은 가상 역 이름. 실제 노선·역 이름은 쓰지 않는다 ----------
const LINE_NAME = '갱신선';
const START_NAME = '출발 부두';
const END_NAME = '연말 종점';
const SEASON_STATION = {
  season_0101: { open: '새해 어귀', inception: '새해 나루' },
  season_0104: { open: '봄 어귀', inception: '봄 나루' },
  season_0107: { open: '한낮 어귀', inception: '한낮 나루' },
};
const LINK_COLUMNS = 13; // 가로줄 한 줄의 칸 수(CSS 격자와 같다)
const SVG_NS = 'http://www.w3.org/2000/svg';

// 사건 정의에 속한 메일 템플릿 id. 이미 도착한 메일만 보므로 앞으로 일어날 일은 드러나지 않는다.
function eventTemplates(data) {
  const ids = new Set();
  for (const ev of data.events ?? []) {
    if (ev.mail) ids.add(ev.mail);
    for (const id of Object.values(ev.mails_by_client ?? {})) ids.add(id);
    for (const o of ev.outcomes ?? []) if (o.mail) ids.add(o.mail);
  }
  return ids;
}

function eventTurnSet(data, state) {
  const templates = eventTemplates(data);
  return new Set(state.mails.filter((m) => templates.has(m.template)).map((m) => m.turn));
}

// 그 주가 역으로 이름이 있는가. { name, sub, kind } 또는 null.
function stationOf(data, turn) {
  const { calendar } = data;
  const season = calendar.seasons.find((x) => x.open_turn === turn || x.inception_turn === turn);
  const names = season ? SEASON_STATION[season.id] ?? { open: `${season.label} 어귀`, inception: `${season.label} 나루` } : null;
  if (season && season.inception_turn === turn) return { name: names.inception, sub: `${season.label} 인셉션`, kind: 'inception' };
  if (turn === 1) return { name: START_NAME, sub: season ? `${season.label} 협상 시작` : null, kind: 'open' };
  if (season) return { name: names.open, sub: `${season.label} 협상 시작`, kind: 'open' };
  if (turn === calendar.turns) return { name: END_NAME, sub: null, kind: 'end' };
  return null;
}

function cellClasses(data, state, turn, deadlines, events) {
  const classes = ['rail-stop'];
  const season = data.calendar.seasons.find((s) => turn >= s.open_turn && turn <= s.inception_turn);
  if (season) classes.push('in-window');
  const station = stationOf(data, turn);
  if (station) classes.push(`is-${station.kind}`);
  if (deadlines.has(turn)) classes.push('has-deadline');
  if (events.has(turn)) classes.push('has-event');
  if (turn === state.turn) classes.push('is-now');
  else if (turn < state.turn) classes.push('is-past');
  if (turn === selectedTurn) classes.push('is-selected');
  if (turn === 1) classes.push('is-first');
  if (turn === data.calendar.turns) classes.push('is-last');
  return classes.join(' ');
}

function cellLabel(data, state, turn, deadlines, events) {
  const desc = describeTurn(data.calendar, turn);
  const station = stationOf(data, turn);
  const bits = [`${turnLabel(desc)}, 턴 ${turn}`];
  if (station) bits.push(`${station.name}역`);
  if (turn === state.turn) bits.push('이번 주');
  if (desc.season) bits.push(desc.season.phase === 'inception' ? `${desc.season.label} 인셉션` : `${desc.season.label} 시즌 협상`);
  if (deadlines.has(turn)) bits.push('메일 마감');
  if (events.has(turn)) bits.push('사건 발생');
  return bits.join(', ');
}

// 지금 위치를 알리는 작은 열차(새로 그린 단순한 도형, 장식). 움직이지 않는다.
function trainIcon() {
  const el = (tag, attrs) => {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    return node;
  };
  const svg = el('svg', { viewBox: '0 0 28 18', width: 28, height: 18, class: 'rail-train', 'aria-hidden': 'true', focusable: 'false' });
  svg.append(
    el('rect', { x: 1, y: 1, width: 26, height: 12, rx: 4, class: 'train-body' }),
    el('rect', { x: 4, y: 4, width: 5, height: 4, class: 'train-window' }),
    el('rect', { x: 11.5, y: 4, width: 5, height: 4, class: 'train-window' }),
    el('rect', { x: 19, y: 4, width: 5, height: 4, class: 'train-window' }),
    el('circle', { cx: 8, cy: 15, r: 2, class: 'train-wheel' }),
    el('circle', { cx: 20, cy: 15, r: 2, class: 'train-wheel' }));
  return svg;
}

function renderStop(data, state, turn, deadlines, events) {
  const station = stationOf(data, turn);
  const isNow = turn === state.turn;
  const marks = [];
  if (isNow) marks.push(trainIcon());
  const inception = station?.kind === 'inception';
  if (inception) marks.push(h('span', { class: 'mark-star' }, '★'));
  if (deadlines.has(turn)) marks.push(h('span', { class: 'mark-due' }, '!'));
  if (events.has(turn)) marks.push(h('span', { class: 'mark-event' }, '◆'));
  return h('li', { class: cellClasses(data, state, turn, deadlines, events) },
    h('span', { class: 'rail-lane', 'aria-hidden': 'true' }),
    h('button', {
      type: 'button', class: 'rail-btn',
      'aria-pressed': turn === selectedTurn ? 'true' : 'false',
      'aria-label': cellLabel(data, state, turn, deadlines, events),
      'aria-current': isNow ? 'date' : null,
      onclick: () => { selectedTurn = turn; store.refresh(); },
    },
      h('span', { class: 'rail-marks', 'aria-hidden': 'true' }, marks),
      h('span', { class: 'rail-dot', 'aria-hidden': 'true' }, String(turn)),
      h('span', { class: 'rail-name', 'aria-hidden': 'true' },
        station ? h('strong', {}, station.name) : null,
        station?.sub ? h('span', {}, station.sub) : null,
        isNow ? h('em', {}, '지금') : null)));
}

function renderMap(data, state, deadlines) {
  const events = eventTurnSet(data, state);
  const { quarters } = data.calendar;
  return h('div', { class: 'rail-map' }, quarters.map((q, i) => {
    const stops = [];
    for (let turn = q.from; turn <= q.to; turn += 1) stops.push(renderStop(data, state, turn, deadlines, events));
    const next = quarters[i + 1];
    return h('section', { class: 'rail-quarter' },
      h('h2', {}, q.label_ko, h('small', { class: 'dim' }, ` 턴 ${q.from}–${q.to}`)),
      h('ol', { class: 'rail-row' }, stops),
      next ? h('div', {
        class: `rail-link${next.from <= state.turn ? ' is-past' : ''}`, 'aria-hidden': 'true',
        style: { width: `${((q.to - q.from + 1) / LINK_COLUMNS) * 100}%` },
      }) : null);
  }));
}

function renderSummary(data, state, deadlines) {
  const turn = selectedTurn;
  const desc = describeTurn(data.calendar, turn);
  const vars = mailVars(data, state);
  const arrived = state.mails.filter((m) => m.turn === turn);
  const todo = [];

  if (turn === state.turn) todo.push('이번 주예요. 인박스에서 새 메일을 확인하세요.');
  else if (turn < state.turn) todo.push('이미 지난 주예요.');
  else todo.push(`아직 ${turn - state.turn}주 뒤예요.`);

  return h('section', { class: 'card cal-summary', 'aria-live': 'polite' },
    h('h2', {}, `${turnLabel(desc)} · 턴 ${turn}/${desc.totalTurns}`),
    h('p', { class: 'dim' }, linkWords(seasonLabel(desc), [['인셉션', 'gl_inception'], ['갱신', 'gl_renewal']])),
    stationOf(data, turn) ? h('p', {}, h('strong', {}, `${stationOf(data, turn).name}역`), stationOf(data, turn).sub ? ` · ${stationOf(data, turn).sub}` : null) : null,
    h('p', {}, todo),
    h('h3', {}, '이 주에 도착한 메일'),
    arrived.length === 0
      ? h('p', { class: 'dim' }, turn > state.turn ? '아직 도착하지 않았어요.' : '없어요.')
      : h('ul', { class: 'plain-list' }, arrived.map((m) => {
        const t = findTemplate(data.mails, m.template);
        return h('li', {}, fillText(t.subject_ko, vars));
      })),
    h('h3', {}, '이 주가 마감인 메일'),
    deadlines.has(turn)
      ? h('ul', { class: 'plain-list' }, deadlines.get(turn).map((subject) => h('li', {}, subject)))
      : h('p', { class: 'dim' }, '없어요.'),
  );
}

export function renderCalendar() {
  const data = store.getData();
  const state = store.getState();
  if (uiGeneration !== store.getGeneration()) {
    uiGeneration = store.getGeneration();
    selectedTurn = null;
  }
  if (selectedTurn === null) selectedTurn = state.turn;
  const deadlines = deadlineMap(data, state);
  const nowDesc = describeTurn(data.calendar, state.turn);

  return h('div', { class: 'screen screen-wide cal-screen' },
    h('h1', {}, '캘린더'),
    h('p', {}, `지금은 `, h('strong', {}, `${turnLabel(nowDesc)} (전체 ${nowDesc.totalTurns}주 중 ${state.turn}주차)`), '예요. ',
      linkWords(seasonLabel(nowDesc), [['인셉션', 'gl_inception'], ['갱신', 'gl_renewal']]), '.'),
    h('div', { class: 'rail-title' },
      h('span', { class: 'rail-badge' }, LINE_NAME),
      h('span', {}, `${START_NAME} → ${END_NAME}`),
      h('span', { class: 'dim' }, `지금 ${state.turn}/${nowDesc.totalTurns}주`)),
    h('ul', { class: 'cal-legend', 'aria-label': '범례' },
      h('li', {}, h('span', { class: 'swatch swatch-now' }), '이번 주 (열차)'),
      h('li', {}, h('span', { class: 'swatch swatch-window' }), glossaryLink('gl_renewal', { label: '갱신' }), ' 시즌 협상 기간 (겹선)'),
      h('li', {}, h('span', { class: 'swatch swatch-inception' }), '★ ', glossaryLink('gl_inception', { label: '인셉션' }), '(계약 시작)'),
      h('li', {}, h('span', { class: 'swatch swatch-deadline' }), '! 답장 마감'),
      h('li', {}, h('span', { class: 'swatch swatch-event' }), '◆ 사건'),
      h('li', {}, h('span', { class: 'swatch swatch-past' }), '지난 주 (실선) · 앞으로 갈 길 (점선)'),
    ),
    h('div', { class: 'cal-body' },
      renderMap(data, state, deadlines),
      renderSummary(data, state, deadlines)),
  );
}
