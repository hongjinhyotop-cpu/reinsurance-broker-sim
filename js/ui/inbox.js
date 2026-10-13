// 인박스 화면(design.md §6.1): 좌측 목록 + 우측 읽기 창 + 선택지 버튼.

import * as store from '../store.js';
import { describeTurn, turnLabel } from '../calendar.js';
import { fillText, findTemplate, needsReply, matchesFilter, choiceBlockReason, MAIL_FILTERS } from '../mail.js';
import { mailVars, markRead, answer } from '../turn.js';
import { h, toast } from './components.js';
import { richText } from './glossary_view.js';

const PRIORITY_LABEL = { urgent: '긴급', normal: '일반', low: '참고' };
const FROM_KIND_LABEL = { client: '고객', reinsurer: '재보험사', regulator: '규제', market: '시장', board: '이사회', system: '시스템' };

// 화면이 다시 그려져도 고른 메일·필터가 남도록 모듈에 둔다. 게임이 바뀌면(generation) 비운다.
let uiGeneration = -1;
let selectedId = null;
let filterId = 'all';

function turnText(calendar, turn) {
  const desc = describeTurn(calendar, turn);
  return desc ? `${turnLabel(desc)} (턴 ${turn})` : `턴 ${turn}`;
}

function deadlineText(calendar, turn, deadlineTurn, now) {
  const left = deadlineTurn - now;
  const when = turnText(calendar, deadlineTurn);
  if (left < 0) return `마감 ${when} — 지났어요`;
  if (left === 0) return `마감 ${when} — 이번 주가 마지막이에요`;
  return `마감 ${when} — ${left}주 남음`;
}

function renderList(rows, state, calendar) {
  if (rows.length === 0) return h('p', { class: 'dim mail-empty' }, '이 조건에 맞는 메일이 없어요.');
  return h('ul', { class: 'mail-list' }, rows.map(({ mail, template }) => {
    const waiting = needsReply(mail, template);
    return h('li', {},
      h('button', {
        type: 'button',
        class: `mail-row${mail.id === selectedId ? ' is-selected' : ''}${mail.read ? '' : ' is-unread'}`,
        'aria-current': mail.id === selectedId ? 'true' : null,
        onclick: () => { selectedId = mail.id; store.refresh(); },
      },
        h('span', { class: 'mail-dot', 'aria-hidden': 'true' }),
        h('span', { class: 'mail-row-main' },
          h('span', { class: 'mail-from' }, template.from.name_ko, mail.read ? null : h('span', { class: 'visually-hidden' }, ' (안 읽음)')),
          h('span', { class: 'mail-subject' }, fillText(template.subject_ko, mailVars(store.getData(), state))),
          h('span', { class: 'mail-meta' },
            h('span', { class: `pill pill-${template.priority}` }, PRIORITY_LABEL[template.priority]),
            waiting ? h('span', { class: 'tag tag-warn' }, '답 필요') : null,
            h('span', { class: 'dim' }, turnText(calendar, mail.turn))),
        ),
      ),
    );
  }));
}

function renderReader(mail, template, state, data) {
  const vars = mailVars(data, state);
  const open = needsReply(mail, template);

  const header = h('header', { class: 'mail-head' },
    h('h2', {}, fillText(template.subject_ko, vars)),
    h('p', { class: 'dim' },
      `보낸 사람: ${template.from.name_ko} (${FROM_KIND_LABEL[template.from.kind]}) · ${turnText(data.calendar, mail.turn)}`),
    h('p', {},
      h('span', { class: `pill pill-${template.priority}` }, PRIORITY_LABEL[template.priority]),
      template.blocking ? h('span', { class: 'tag tag-warn' }, '답해야 다음 주로 넘어가요') : null),
  );

  const body = h('div', { class: 'mail-body' }, template.body_ko.map((line) => h('p', {}, richText(fillText(line, vars)))));

  const parts = [header, body];

  if (open) {
    if (mail.deadline_turn !== null) parts.push(h('p', { class: 'notice notice-warn' }, deadlineText(data.calendar, mail.turn, mail.deadline_turn, state.turn)));
    parts.push(h('div', { class: 'choices', role: 'group', 'aria-label': '답장 선택지' },
      template.choices.map((choice) => {
        const reason = choiceBlockReason(choice, state.ap);
        const isDefault = template.default_choice === choice.id;
        return h('button', {
          type: 'button', class: 'btn choice-btn', disabled: reason ? true : null, title: reason ?? null,
          onclick: () => {
            const res = answer(mail.id, choice.id);
            if (!res.ok) toast(res.error, 'warn');
          },
        },
          h('span', { class: 'choice-label' }, fillText(choice.label_ko, vars)),
          h('span', { class: 'choice-cost' }, choice.ap_cost > 0 ? `행동 ${choice.ap_cost}점` : '점수 없음'),
          isDefault ? h('span', { class: 'dim choice-note' }, '마감까지 답하지 않으면 이 선택이 적용돼요') : null,
        );
      })));
  } else if (mail.answered !== null) {
    const choice = template.choices.find((c) => c.id === mail.answered);
    parts.push(h('section', { class: 'mail-reply' },
      h('p', { class: 'dim' }, mail.auto ? '마감이 지나 기본 선택이 자동으로 적용됐어요' : '내가 보낸 답장'),
      h('p', { class: 'reply-choice' }, fillText(choice.label_ko, vars)),
      h('p', {}, richText(fillText(choice.result_ko, vars))),
    ));
  }
  return h('article', { class: 'mail-reader' }, parts);
}

export function renderInbox() {
  const data = store.getData();
  const state = store.getState();
  if (uiGeneration !== store.getGeneration()) {
    uiGeneration = store.getGeneration();
    selectedId = null;
    filterId = 'all';
  }

  const all = state.mails
    .map((mail) => ({ mail, template: findTemplate(data.mails, mail.template) }))
    .filter((r) => r.template)
    .reverse(); // 새 메일이 위로
  const rows = all.filter(({ mail, template }) => matchesFilter(filterId, mail, template));

  // 처음 들어오면 가장 위(최신)의 안 읽은 메일, 없으면 최신 메일을 연다.
  if (!all.some((r) => r.mail.id === selectedId)) {
    const pick = all.find((r) => !r.mail.read) ?? all[0];
    selectedId = pick ? pick.mail.id : null;
  }
  const current = all.find((r) => r.mail.id === selectedId) ?? null;
  if (current && !current.mail.read) queueMicrotask(() => markRead(current.mail.id));

  const todo = all.filter(({ mail, template }) => needsReply(mail, template)).length;

  return h('div', { class: 'screen screen-wide' },
    h('h1', {}, '인박스'),
    h('p', { class: 'dim' }, todo > 0 ? `답이 필요한 메일이 ${todo}통 있어요.` : '답이 필요한 메일이 없어요. 위쪽의 Continue로 다음 주로 넘어가세요.'),
    h('div', { class: 'filters', role: 'group', 'aria-label': '메일 필터' },
      MAIL_FILTERS.map((f) => h('button', {
        type: 'button', class: `chip${f.id === filterId ? ' is-active' : ''}`, 'aria-pressed': f.id === filterId ? 'true' : 'false',
        onclick: () => { filterId = f.id; store.refresh(); },
      }, f.label))),
    h('div', { class: 'inbox' },
      h('section', { class: 'inbox-list card', 'aria-label': '메일 목록' }, renderList(rows, state, data.calendar)),
      h('section', { class: 'inbox-reader card', 'aria-label': '메일 읽기' },
        current ? renderReader(current.mail, current.template, state, data) : h('p', { class: 'dim' }, '메일이 아직 없어요.')),
    ),
  );
}

export function unreadCount() {
  return store.getState().mails.filter((m) => !m.read).length;
}
