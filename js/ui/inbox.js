// 인박스 화면(design.md §6.1): 좌측 목록 + 우측 읽기 창 + 선택지 버튼.

import * as store from '../store.js';
import { describeTurn, turnLabel } from '../calendar.js';
import { fillText, findTemplate, needsReply, matchesFilter, choiceBlockReason, MAIL_FILTERS } from '../mail.js';
import { mailVars, markRead, answer } from '../turn.js';
import { h, toast } from './components.js';
import { richText } from './glossary_view.js';
import { sealFor, senderEntity, senderSealId, reTone } from './seals.js';
import { portraitEl, mailPortraitId, mailMood } from './portraits.js';

const PRIORITY_LABEL = { urgent: '긴급', normal: '일반', low: '참고' };
const FROM_KIND_LABEL = { client: '고객', reinsurer: '재보험사', regulator: '규제', market: '시장', board: '이사회', system: '시스템', mentor: '선배', rival: '경쟁 브로커' };

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

// 메일 목록: 촘촘한 표. 행 전체가 눌리도록 버튼의 ::after를 행 크기로 펼친다(누를 수 있는 것은 버튼 하나뿐).
function senderCell(template, data) {
  const ent = senderEntity(template.from.name_ko, data);
  return h('td', { class: 'mail-from-cell' },
    h('div', { class: 'mail-from-wrap' },
      sealFor(ent ? ent.id : senderSealId(template.from.kind) ?? 'sender_system', { size: 24 }),
      h('span', { class: 'mail-from' }, template.from.name_ko)));
}

function renderList(rows, state, data) {
  if (rows.length === 0) return h('p', { class: 'dim mail-empty' }, '이 조건에 맞는 메일이 없어요.');
  return h('table', { class: 'table mail-list' },
    h('caption', { class: 'visually-hidden' }, '받은 메일 목록. 줄마다 보낸 곳, 제목, 우선순위, 날짜가 있어요'),
    h('thead', {}, h('tr', {},
      h('th', { scope: 'col', class: 'mail-col-state' }, h('span', { class: 'visually-hidden' }, '읽음 여부')),
      h('th', { scope: 'col' }, '보낸 곳'),
      h('th', { scope: 'col' }, '제목'))),
    h('tbody', {}, rows.map(({ mail, template }) => {
      const waiting = needsReply(mail, template);
      const picked = mail.id === selectedId;
      return h('tr', { class: `mail-tr${picked ? ' is-selected' : ''}${mail.read ? '' : ' is-unread'}` },
        h('td', { class: 'mail-state' }, h('span', { class: 'mail-dot', 'aria-hidden': 'true' })),
        senderCell(template, data),
        h('td', { class: 'mail-subject-cell' },
          h('button', {
            type: 'button',
            class: 'mail-row',
            'aria-current': picked ? 'true' : null,
            onclick: () => { selectedId = mail.id; store.refresh(); },
          },
            h('span', { class: 'mail-row-main' },
              mail.read ? null : h('span', { class: 'visually-hidden' }, '(안 읽음) '),
              h('span', { class: 'mail-subject' }, fillText(template.subject_ko, mailVars(data, state))),
              h('span', { class: 'mail-meta' },
                h('span', { class: `pill pill-${template.priority}` }, PRIORITY_LABEL[template.priority]),
                waiting ? h('span', { class: 'tag tag-warn' }, '답 필요') : null,
                h('span', { class: 'mail-date' }, turnText(data.calendar, mail.turn)))))));
    })));
}

// 편지 머리글: 보낸 쪽마다 다르다. 재보험사·고객·이사회·규제·시장·시스템·선배 모두 인장 + 글자 머리글.
const LETTER_TITLE = { board: '이사회', regulator: '금융감독당국 · 공문', market: '시장 리포트 데스크', system: '게임 안내', mentor: '선배의 쪽지', rival: '경쟁 브로커 · 사적인 쪽지' };

// 사람이 보낸 메일이면 머리글 오른쪽 끝에 작은 초상(D5). 표정은 메일마다 정한 화면 상수.
function letterPortrait(template, ent) {
  const id = mailPortraitId(template, ent);
  return id ? h('span', { class: 'lh-portrait' }, portraitEl(id, mailMood(template.id), { size: 48 })) : null;
}

function letterhead(template, data, waiting) {
  const ent = senderEntity(template.from.name_ko, data);
  if (ent) {
    return h('div', { class: `letterhead letterhead-${ent.kind}${ent.kind === 'reinsurer' ? ` re-${reTone(ent.id)}` : ''}` },
      sealFor(ent.id, { size: 56 }),
      h('div', { class: 'lh-text' },
        h('p', { class: 'lh-name' }, ent.name_ko),
        h('p', { class: 'lh-sub' }, `${ent.kind === 'reinsurer' ? '재보험사' : '고객'} · ${ent.hq}`)),
      ent.kind === 'client' && waiting ? h('span', { class: 'lh-note' }, '회신 요청') : null,
      letterPortrait(template, ent));
  }
  const kind = template.from.kind;
  const sealId = senderSealId(kind);
  return h('div', { class: `letterhead letterhead-${kind}` },
    sealId ? sealFor(sealId, { size: 56 }) : null,
    h('div', { class: 'lh-text' },
      h('p', { class: 'lh-name' }, LETTER_TITLE[kind] ?? FROM_KIND_LABEL[kind]),
      h('p', { class: 'lh-sub' }, template.from.name_ko.replace(/\s*\(가상\)\s*$/, ''))),
    kind === 'regulator' ? h('span', { class: 'lh-note' }, '공문') : null,
    letterPortrait(template, null));
}

function renderReader(mail, template, state, data) {
  const vars = mailVars(data, state);
  const open = needsReply(mail, template);

  const header = h('header', { class: 'mail-head' },
    letterhead(template, data, open),
    h('p', { class: 'letter-meta dim' },
      `보낸 사람: ${template.from.name_ko} (${FROM_KIND_LABEL[template.from.kind]}) · ${turnText(data.calendar, mail.turn)}`),
    h('div', { class: 'letter-subject' },
      h('span', { class: 'letter-subject-label', 'aria-hidden': 'true' }, '제목'),
      h('h2', {}, fillText(template.subject_ko, vars))),
    h('p', {},
      h('span', { class: `pill pill-${template.priority}` }, PRIORITY_LABEL[template.priority]),
      template.blocking ? h('span', { class: 'tag tag-warn' }, '답해야 다음 주로 넘어가요') : null),
  );

  const body = h('div', { class: 'mail-body' }, template.body_ko.map((line) => h('p', {}, richText(fillText(line, vars)))));

  const parts = [header, body, h('p', { class: 'letter-sign' }, `— ${template.from.name_ko}`)];

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
  return h('article', { class: `mail-reader letter letter-${template.from.kind}` }, parts);
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
      h('section', { class: 'inbox-list card card-ledger', 'aria-label': '메일 목록' }, renderList(rows, state, data)),
      h('section', { class: 'inbox-reader', 'aria-label': '메일 읽기' },
        current ? renderReader(current.mail, current.template, state, data) : h('p', { class: 'dim' }, '메일이 아직 없어요.')),
    ),
  );
}

export function unreadCount() {
  return store.getState().mails.filter((m) => !m.read).length;
}
