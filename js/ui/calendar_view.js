// 캘린더 화면(design.md §6.4): 58턴을 분기별 그리드로, 시즌 창구·인셉션·마감·이번 주를 표시한다.

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

function cellClasses(data, state, turn, deadlines) {
  const classes = ['cal-cell'];
  const season = data.calendar.seasons.find((s) => turn >= s.open_turn && turn <= s.inception_turn);
  if (season) classes.push('in-window');
  if (season && season.inception_turn === turn) classes.push('is-inception');
  if (deadlines.has(turn)) classes.push('has-deadline');
  if (turn === state.turn) classes.push('is-now');
  else if (turn < state.turn) classes.push('is-past');
  if (turn === selectedTurn) classes.push('is-selected');
  return classes.join(' ');
}

function cellLabel(data, state, turn, deadlines) {
  const desc = describeTurn(data.calendar, turn);
  const bits = [`${turnLabel(desc)}, 턴 ${turn}`];
  if (turn === state.turn) bits.push('이번 주');
  if (desc.season) bits.push(desc.season.phase === 'inception' ? `${desc.season.label} 인셉션` : `${desc.season.label} 시즌 협상`);
  if (deadlines.has(turn)) bits.push('메일 마감');
  return bits.join(', ');
}

function renderGrid(data, state, deadlines) {
  return data.calendar.quarters.map((q) => {
    const cells = [];
    for (let turn = q.from; turn <= q.to; turn += 1) {
      const desc = describeTurn(data.calendar, turn);
      cells.push(h('button', {
        type: 'button', class: cellClasses(data, state, turn, deadlines),
        'aria-pressed': turn === selectedTurn ? 'true' : 'false',
        'aria-label': cellLabel(data, state, turn, deadlines),
        'aria-current': turn === state.turn ? 'date' : null,
        onclick: () => { selectedTurn = turn; store.refresh(); },
      },
        h('span', { class: 'cal-num' }, String(turn)),
        h('span', { class: 'cal-mark', 'aria-hidden': 'true' },
          desc.season?.phase === 'inception' ? '★' : deadlines.has(turn) ? '!' : turn === state.turn ? '●' : ''),
      ));
    }
    return h('section', { class: 'cal-quarter' },
      h('h2', {}, q.label_ko, h('small', { class: 'dim' }, ` 턴 ${q.from}–${q.to}`)),
      h('div', { class: 'cal-grid' }, cells),
    );
  });
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
    h('p', { class: 'dim' }, seasonLabel(desc)),
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

  return h('div', { class: 'screen screen-wide' },
    h('h1', {}, '캘린더'),
    h('p', {}, `지금은 `, h('strong', {}, `${turnLabel(nowDesc)} (전체 ${nowDesc.totalTurns}주 중 ${state.turn}주차)`), '예요. ',
      linkWords(seasonLabel(nowDesc), [['인셉션', 'gl_inception'], ['갱신', 'gl_renewal']]), '.'),
    h('ul', { class: 'cal-legend', 'aria-label': '범례' },
      h('li', {}, h('span', { class: 'swatch swatch-now' }), '이번 주'),
      h('li', {}, h('span', { class: 'swatch swatch-window' }), glossaryLink('gl_renewal', { label: '갱신' }), ' 시즌 협상 기간'),
      h('li', {}, h('span', { class: 'swatch swatch-inception' }), '★ ', glossaryLink('gl_inception', { label: '인셉션' }), '(계약 시작)'),
      h('li', {}, h('span', { class: 'swatch swatch-deadline' }), '! 답장 마감'),
      h('li', {}, h('span', { class: 'swatch swatch-past' }), '지난 주'),
    ),
    renderGrid(data, state, deadlines),
    renderSummary(data, state, deadlines),
  );
}
