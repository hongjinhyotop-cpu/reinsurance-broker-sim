// 공통 셸: 상단 바(날짜·현금·이사회 신뢰·시장·AP·Continue) + 좌측 내비 + 본문 자리 (design.md §6.0).
// 아직 없는 화면은 "어느 단계에서 만들어지는지"를 알려 주는 안내 화면으로 대신한다.

import * as store from '../store.js';
import { describeTurn, turnLabel, seasonLabel } from '../calendar.js';
import { describeMarket } from '../market.js';
import { continueBlockReason, advance } from '../turn.js';
import { nextAction } from '../guide.js';
import { guideDetail } from '../difficulty.js';
import { getPrefs, setPref } from '../prefs.js';
import { h, formatUsdM, toast, navigate } from './components.js';
import { glossaryLink } from './glossary_view.js';
import { countUp, flipDate, arriveEnvelope, trackValue, reducedMotion } from './motion.js';
import { viewState } from './ceremony.js';
import { play, setSoundOn, soundAvailable } from './sound.js';
import { soundOn } from '../prefs.js';

// when: 이 화면이 만들어질 마일스톤(design.md §12)
export const NAV = [
  { id: 'inbox', label: '인박스', when: null },
  { id: 'database', label: '고객·재보험사 DB', when: null },
  { id: 'placement', label: '플레이스먼트', when: null },
  { id: 'calendar', label: '캘린더', when: null },
  { id: 'standings', label: '순위표', when: null },
  { id: 'review', label: '시즌 리뷰', when: null },
  { id: 'codex', label: '용어 도감', when: null },
  { id: 'settings', label: '설정', when: null },
];

// 아직 만들지 않은 화면이 생기면 여기에 적는다(M7a 기준으로 모든 내비 화면이 만들어졌다).
const MILESTONES = {};
const PLACEHOLDERS = {};

export function screenTitle(id) {
  return NAV.find((n) => n.id === id)?.label ?? '';
}

// count: { key, to, format }이면 값이 바뀔 때 숫자가 올라간다(motion.js). 끝난 글자는 항상 실제 값이다.
function stat(label, value, sub, title, { className = '', count = null } = {}) {
  const valueEl = h('span', { class: 'stat-value' }, value);
  if (count) countUp(valueEl, count.key, count.to, count.format);
  return h('div', { class: `stat${className ? ` ${className}` : ''}`, title },
    h('dt', {}, label),
    h('dd', {}, valueEl, sub ? h('small', {}, sub) : null),
  );
}

// 행동 점수 토큰(D3): 남은 만큼 꽉 찬 토큰, 쓴 만큼 점선 빈 칸. 쓰면 오른쪽 토큰부터 뒤집히고 새 주에 채워지면 다시 뒤집혀 돌아온다.
// 그림은 장식이고, 묶음 전체가 "행동 점수 4점 남음 (6점 중)"으로 읽힌다. 읽을 수 있는 숫자는 바로 옆에 따로 있다.
const FLIP_STAGGER_MS = 40;
function apTokens(ap, max) {
  const prev = trackValue('ap', ap);
  const animate = prev !== undefined && prev !== ap && !reducedMotion();
  const tokens = Array.from({ length: max }, (_, i) => {
    let anim = null;
    let delay = 0;
    if (animate && ap < prev && i >= ap && i < prev) { anim = 'is-spending'; delay = (prev - 1 - i) * FLIP_STAGGER_MS; }
    else if (animate && ap > prev && i >= prev && i < ap) { anim = 'is-refilling'; delay = (i - prev) * FLIP_STAGGER_MS; }
    return h('span', { class: `piece piece-token${i >= ap ? ' is-spent' : ''}${anim ? ` ${anim}` : ''}`, style: anim ? { animationDelay: `${delay}ms` } : null });
  });
  return h('span', { class: 'pieces', role: 'img', 'aria-label': `행동 점수 ${ap}점 남음 (${max}점 중)` }, tokens);
}

const STOP_TEXT = {
  event: '큰 사건이 터졌어요 — 인박스를 확인하세요',
  deadline: '답장 마감이 다가와요',
  phase: '갱신 시즌의 새 단계예요',
  end: '마지막 주에 도착했어요',
  ending: '게임이 끝났어요 — 시즌 리뷰를 확인하세요',
};

function onContinue() {
  const { calendar } = store.getData();
  const res = advance();
  if (!res.ok) { toast(res.error, 'warn'); return; }
  const to = describeTurn(calendar, res.toTurn);
  const parts = [`${turnLabel(to)}(턴 ${res.toTurn})로 넘어왔어요`];
  if (res.arrived.length > 0) parts.push(`새 메일 ${res.arrived.length}통`);
  if (res.events.length > 0) parts.push(`사건 ${res.events.length}건`);
  if (res.autoResolved.length > 0) parts.push(`마감이 지나 자동 처리된 메일 ${res.autoResolved.length}통`);
  if (res.voided.length > 0) parts.push(`등급 강등으로 취소된 확정 지분 ${res.voided.length}건`);
  if (res.gaps.length > 0) parts.push('계약 공백이 생겼어요(인셉션이 지났는데 확정되지 않은 트리티)');
  if (res.expiredCounters > 0) parts.push(`유효 기간이 지나 사라진 반제 ${res.expiredCounters}건`);
  if (res.booked.length > 0) parts.push(`브로커리지 ${res.booked.length}건 확정`);
  if (res.closedQuarters.length > 0) parts.push('분기 결산이 끝났어요(순위표 갱신)');
  if (res.seasonsClosed.length > 0) parts.push('시즌 중간 리뷰가 나왔어요(시즌 리뷰 화면)');
  if (res.stop && STOP_TEXT[res.stop]) parts.push(STOP_TEXT[res.stop]);
  if (res.toTurn - res.fromTurn > 1) parts.splice(1, 0, `${res.toTurn - res.fromTurn}주를 건너뛰었어요`);
  toast(parts.join(' · '), 'ok');
  if (res.ending) navigate('review'); // 끝난 게임은 바로 결과 화면으로 안내한다
  if (res.saveError) toast(`자동 저장을 하지 못했어요 — ${res.saveError}`, 'warn');
  // 작은 움직임(장식): 달력 장이 넘어가고, 사건이 있으면 봉투가 들어온다. 화면은 위에서 이미 다시 그려졌다.
  flipDate(document.querySelector('.stat-date dd'));
  play('page');
  if (res.events.length > 0) {
    arriveEnvelope();
    play('envelope');
    play('alert', { delay: 0.28 }); // 봉투 소리 바로 뒤에 사건 알림
  }
}

// 효과음 켜기/끄기(D3). 기본은 꺼짐이고 저장되어 새 게임에도 유지된다(rbs:prefs:v1).
function onToggleSound() {
  if (!soundOn() && !soundAvailable()) { toast('이 브라우저에서는 소리를 낼 수 없어요', 'warn'); return; }
  const res = setSoundOn(!soundOn());
  if (!res.ok) toast('저장하지 못했어요. 이번에 켜 둔 동안만 적용돼요', 'warn');
  store.refresh();
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
    h('button', { class: 'btn sound-toggle', type: 'button', title: '도장·봉투·주 넘김·사건 알림의 짧은 소리예요. 기본은 꺼져 있어요', onclick: onToggleSound }, soundOn() ? '효과음 끄기' : '효과음 켜기'),
    h('dl', { class: 'stats' },
      stat('날짜',
        desc ? turnLabel(desc) : `턴 ${s.turn}`,
        desc ? `${seasonLabel(desc)} · 턴 ${desc.turn}/${desc.totalTurns}` : null,
        '게임 시간은 1주가 1턴이에요', { className: 'stat-date' }),
      stat('현금', formatUsdM(s.player.cash_usd_m), null, 'm은 백만 달러 단위예요', { count: { key: 'cash', to: s.player.cash_usd_m, format: formatUsdM } }),
      stat('이사회 신뢰', String(Math.round(s.player.board_confidence)), '0~100', '20 아래로 떨어지면 해고돼요', { count: { key: 'board', to: Math.round(s.player.board_confidence), format: (n) => String(Math.round(n)) } }),
      stat('시장', market.label_ko, `오차 ±${market.error}`, '정확한 시장 지수는 보이지 않고, 라벨과 오차 범위만 보여요'),
      stat(glossaryLink('gl_ap', { label: '행동 점수', scope: new Set() }), [apTokens(s.ap, config.game.ap_per_week), `${s.ap}/${config.game.ap_per_week}`], null, '매주 6점이 새로 생기고, 남은 점수는 다음 주로 넘어가지 않아요', { className: 'stat-ap' }),
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

// "지금 할 일" 안내띠(design.md §6.0.1). 정답이 아니라 돌아올 자리: 어느 화면에서 무엇을 하는지만 한 줄로 알린다.
function renderGuideStrip(activeId) {
  if (!getPrefs().guide_strip) return null;
  const data = store.getData();
  const state = viewState(store.getState()); // 봉투를 여는 동안은 누르기 직전의 상태(결과를 미리 말하지 않는다)
  const act = nextAction(data, state, { detail: guideDetail(data, state) });
  if (!act) return null;
  return h('aside', { class: 'guide-strip', 'aria-label': '지금 할 일' },
    h('span', { class: 'guide-label' }, '다음으로 할 일'),
    h('span', { class: 'guide-text' }, act.text),
    act.route && act.route !== activeId ? h('a', { class: 'guide-go', href: `#/${act.route}` }, `${screenTitle(act.route)} 열기`) : null,
    h('button', {
      class: 'btn guide-off', type: 'button', title: '끄면 설정 화면에서 다시 켤 수 있어요',
      onclick: () => {
        const res = setPref('guide_strip', false);
        toast(res.ok ? '안내띠를 껐어요. 설정 화면에서 다시 켤 수 있어요' : '안내띠를 껐어요(이 브라우저에서는 저장되지 않아, 새로 열면 다시 나타나요)', res.ok ? 'info' : 'warn');
        store.refresh();
      },
    }, '끄기'),
  );
}

// 키보드 사용자가 상단 바와 메뉴를 지나치지 않고 본문으로 건너뛴다. 주소(#main)는 바꾸지 않는다(화면 주소와 겹친다).
function renderSkipLink() {
  return h('a', {
    class: 'skip-link', href: '#main',
    onclick: (ev) => { ev.preventDefault(); document.getElementById('main')?.focus(); },
  }, '본문으로 건너뛰기');
}

export function renderShell(activeId, content) {
  return h('div', { class: 'shell' },
    renderSkipLink(),
    renderTopbar(),
    renderNav(activeId),
    h('main', { id: 'main', class: 'content', tabindex: '-1' }, renderGuideStrip(activeId), content),
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
