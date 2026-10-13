// 공통 셸: 상단 바(날짜·현금·이사회 신뢰·시장·AP·Continue) + 좌측 내비 + 본문 자리 (design.md §6.0).
// 아직 없는 화면은 "어느 단계에서 만들어지는지"를 알려 주는 안내 화면으로 대신한다.

import * as store from '../store.js';
import { describeTurn, turnLabel, seasonLabel } from '../calendar.js';
import { describeMarket } from '../market.js';
import { continueBlockReason, advance } from '../turn.js';
import { h, formatUsdM, toast } from './components.js';

// when: 이 화면이 만들어질 마일스톤(design.md §12)
export const NAV = [
  { id: 'inbox', label: '인박스', when: null },
  { id: 'database', label: '고객·재보험사 DB', when: 'M3' },
  { id: 'placement', label: '플레이스먼트', when: 'M5' },
  { id: 'calendar', label: '캘린더', when: null },
  { id: 'standings', label: '순위표', when: 'M7' },
  { id: 'review', label: '시즌 리뷰', when: 'M7' },
  { id: 'codex', label: '용어 도감', when: 'M2' },
  { id: 'settings', label: '설정', when: null },
];

const MILESTONES = {
  M2: '용어집',
  M3: '숨겨진 속성 스카우팅',
  M5: '라인 구성 보드',
  M7: '재무 · 순위표 · 리뷰',
};

const PLACEHOLDERS = {
  database: '거래 상대의 정보를 모아 보는 곳이에요. 미팅을 할수록 상대의 숨은 성격이 드러나는 스카우팅이 여기에 들어가요.',
  placement: '리스크 전체를 100%로 보고, 재보험사들이 몇 %씩 맡을지 채워 넣는 라인 구성 보드예요.',
  standings: '경쟁 중개회사 7곳과 수익을 비교하고 이사회 목표를 확인하는 곳이에요.',
  review: '갱신 시즌이 끝날 때마다, 그리고 연말에 성적표를 보는 곳이에요.',
  codex: '눌러서 읽은 재보험 용어가 모이는 도감이에요. 파일로 내보내 Anki로 복습할 수도 있어요.',
};

export function screenTitle(id) {
  return NAV.find((n) => n.id === id)?.label ?? '';
}

function stat(label, value, sub, title) {
  return h('div', { class: 'stat', title },
    h('dt', {}, label),
    h('dd', {}, value, sub ? h('small', {}, sub) : null),
  );
}

const STOP_TEXT = {
  deadline: '답장 마감이 다가와요',
  phase: '갱신 시즌의 새 단계예요',
  end: '마지막 주에 도착했어요',
};

function onContinue() {
  const { calendar } = store.getData();
  const res = advance();
  if (!res.ok) { toast(res.error, 'warn'); return; }
  const to = describeTurn(calendar, res.toTurn);
  const parts = [`${turnLabel(to)}(턴 ${res.toTurn})로 넘어왔어요`];
  if (res.arrived.length > 0) parts.push(`새 메일 ${res.arrived.length}통`);
  if (res.autoResolved.length > 0) parts.push(`마감이 지나 자동 처리된 메일 ${res.autoResolved.length}통`);
  if (res.stop && STOP_TEXT[res.stop]) parts.push(STOP_TEXT[res.stop]);
  if (res.toTurn - res.fromTurn > 1) parts.splice(1, 0, `${res.toTurn - res.fromTurn}주를 건너뛰었어요`);
  toast(parts.join(' · '), 'ok');
  if (res.saveError) toast(`자동 저장을 하지 못했어요 — ${res.saveError}`, 'warn');
}

function renderContinue(data, state) {
  const reason = continueBlockReason(data, state);
  // 비활성 버튼은 툴팁이 안 뜨는 브라우저가 있어서 감싸는 요소에 title을 주고, 이유는 글자로도 보여 준다.
  return h('span', { class: 'continue-wrap', title: reason ?? '한 주를 넘기고 새 메일을 받아요' },
    reason ? h('small', { class: 'continue-hint', role: 'status' }, reason) : null,
    h('button', { class: 'btn btn-primary', type: 'button', disabled: reason ? true : null, onclick: onContinue }, 'Continue ▶'),
  );
}

function renderTopbar() {
  const data = store.getData();
  const { config, calendar } = data;
  const s = store.getState();
  const desc = describeTurn(calendar, s.turn);
  const market = describeMarket(s.market.index, s.player.market_intel, config.market);

  return h('header', { class: 'topbar' },
    h('div', { class: 'brand' }, h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, 'MB'), h('span', { class: 'brand-name' }, s.player.firm)),
    h('dl', { class: 'stats' },
      stat('날짜',
        desc ? turnLabel(desc) : `턴 ${s.turn}`,
        desc ? `${seasonLabel(desc)} · 턴 ${desc.turn}/${desc.totalTurns}` : null,
        '게임 시간은 1주가 1턴이에요'),
      stat('현금', formatUsdM(s.player.cash_usd_m), null, 'm은 백만 달러 단위예요'),
      stat('이사회 신뢰', String(Math.round(s.player.board_confidence)), '0~100', '20 아래로 떨어지면 해고돼요'),
      stat('시장', market.label_ko, `오차 ±${market.error}`, '정확한 시장 지수는 보이지 않고, 라벨과 오차 범위만 보여요'),
      stat('행동 점수', `${s.ap}/${config.game.ap_per_week}`, null, '매주 6점이 새로 생기고, 남은 점수는 다음 주로 넘어가지 않아요'),
    ),
    renderContinue(data, s),
  );
}

function renderNav(activeId) {
  const unread = store.getState().mails.filter((m) => !m.read).length;
  return h('nav', { class: 'sidenav', 'aria-label': '주 메뉴' },
    h('ul', {},
      NAV.map((item) => h('li', {},
        h('a', { href: `#/${item.id}`, class: 'nav-link', 'aria-current': item.id === activeId ? 'page' : null },
          h('span', {}, item.label),
          item.when ? h('span', { class: 'tag' }, '준비 중') : null,
          item.id === 'inbox' && unread > 0 ? h('span', { class: 'badge', 'aria-label': `안 읽은 메일 ${unread}통` }, String(unread)) : null),
      )),
    ),
  );
}

export function renderShell(activeId, content) {
  return h('div', { class: 'shell' },
    renderTopbar(),
    renderNav(activeId),
    h('main', { id: 'main', class: 'content', tabindex: '-1' }, content),
  );
}

export function renderPlaceholder(id) {
  const item = NAV.find((n) => n.id === id);
  const nodes = [
    h('h1', {}, item.label),
    h('section', { class: 'card' },
      h('p', { class: 'badge-line' }, h('span', { class: 'tag tag-warn' }, '아직 만들지 않은 화면')),
      h('p', {}, PLACEHOLDERS[id]),
      h('p', { class: 'dim' }, `${item.when} 단계(${MILESTONES[item.when]})에서 만들어요.`),
    ),
  ];
  return h('div', { class: 'screen' }, nodes);
}
