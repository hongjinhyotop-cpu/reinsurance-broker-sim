// 순위표 화면(design.md §6.5, M7a): 브로커 리그 표(분기 결산 기준)와 이사회 목표 패널.

import * as store from '../store.js';
import { latestSnapshot, computeReport } from '../finance.js';
import { tableRows } from '../rivals.js';
import { h, formatUsdM } from './components.js';
import { glossaryLink, richText } from './glossary_view.js';

const QUARTER_KO = { q1: '1분기', q2: '2분기', q3: '3분기', q4: '4분기' };

// 부호를 붙인 증감(USD m). 첫 분기는 비교할 앞 분기가 없다.
function signedUsdM(v) {
  if (v === null) return '—';
  if (Math.abs(v) < 0.005) return '$0.00m';
  return `${v > 0 ? '+' : '-'}$${Math.abs(v).toFixed(2)}m`;
}

function complianceStatus(score) {
  if (score >= 75) return '통과';
  if (score >= 50) return '경고';
  return '위험';
}

function renderLeague(data, state) {
  const snap = latestSnapshot(state);
  const prev = state.standings.quarters.at(-2) ?? null;
  const rows = tableRows(data.brokers, snap, { firm: state.player.firm, reputation: Math.round(state.player.reputation), prev });
  const head = h('thead', {},
    h('tr', {},
      h('th', { scope: 'col' }, '순위'),
      h('th', { scope: 'col' }, '브로커'),
      h('th', { scope: 'col' }, glossaryLink('gl_brokerage', { label: '브로커리지 누계' })),
      h('th', { scope: 'col' }, '전분기 대비'),
      h('th', { scope: 'col' }, glossaryLink('gl_placed_premium', { label: '플레이스드 프리미엄' })),
      h('th', { scope: 'col' }, '고객 수'),
      h('th', { scope: 'col' }, '평판')));
  if (!rows) {
    return h('section', { class: 'card' },
      h('h2', {}, '브로커 리그'),
      h('p', { class: 'dim' }, '분기가 끝나면 순위가 처음 공개돼요. 첫 결산은 1분기 마지막 주에 나와요.'),
      h('ul', { class: 'plain-list' }, [h('li', {}, `${state.player.firm} (우리)`), ...data.brokers.map((b) => h('li', {}, `${b.name_ko} — ${b.tag_ko}`))]));
  }
  const body = h('tbody', {}, rows.map((r) => h('tr', { class: r.isPlayer ? 'is-selected' : null },
    h('td', {}, String(r.rank)),
    h('th', { scope: 'row' }, r.name_ko, r.isPlayer ? h('span', { class: 'tag tag-me' }, '우리') : null, r.tag_ko ? h('small', { class: 'dim row-tag' }, r.tag_ko) : null),
    h('td', {}, formatUsdM(r.ytd),
      r.isPlayer && r.flow_ytd > 0 ? h('small', { class: 'dim row-tag' }, `브로커리지 ${formatUsdM(r.brokerage_ytd)} + 평판 효과 ${formatUsdM(r.flow_ytd)}`) : null),
    h('td', {}, signedUsdM(r.dq)),
    h('td', {}, formatUsdM(r.placed_premium_usd_m)),
    h('td', {}, String(r.clients)),
    h('td', {}, String(r.reputation)))));
  return h('section', { class: 'card' },
    h('h2', {}, '브로커 리그'),
    h('p', { class: 'dim' }, `${QUARTER_KO[snap.id] ?? snap.id} 결산 기준이에요. 순위는 분기가 끝날 때마다 바뀌어요.`),
    h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('caption', { class: 'visually-hidden' }, '브로커 리그 순위표'), head, body)),
    h('p', { class: 'dim' }, richText(data.report.season.flow_note_ko)));
}

function goalRow(label, now, ok) {
  return h('tr', {},
    h('th', { scope: 'row' }, label),
    h('td', {}, now),
    h('td', {}, ok === null ? h('span', { class: 'tag' }, '공개 전') : h('span', { class: ok ? 'tag tag-ok' : 'tag tag-warn' }, ok ? '달성' : '아직')));
}

function renderGoals(data, state) {
  const f = computeReport(data, state).facts;
  const t = data.config.board;
  return h('section', { class: 'card' },
    h('h2', {}, '이사회 목표'),
    h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, '목표'), h('th', { scope: 'col' }, '지금'), h('th', { scope: 'col' }, '상태'))),
      h('tbody', {},
        goalRow(['확정 ', glossaryLink('gl_brokerage', { label: '브로커리지' }), ` ${formatUsdM(f.target_usd_m)} 이상`], `${formatUsdM(f.brokerage_usd_m)}`, f.brokerage_usd_m >= f.target_usd_m),
        goalRow(`순위 ${f.rank_max}위 이내`, f.rank === null ? '아직 결산 전' : `${f.rank}위 (${f.rank_of}곳 중)`, f.rank === null ? null : f.rank <= f.rank_max),
        goalRow(`고객 ${t.targets.clients_kept}곳 유지`, `${f.clients_kept}곳`, f.clients_kept >= t.targets.clients_kept),
        goalRow([glossaryLink('gl_compliance', { label: '컴플라이언스' }), ` ${f.compliance_min}점 이상`], `${f.compliance}점 (${complianceStatus(state.player.compliance)})`, state.player.compliance >= f.compliance_min))),
    h('p', { class: 'dim goal-note' }, `이사회 신뢰는 지금 ${Math.round(state.player.board_confidence)}점이에요. ${t.fired_below}점 아래로 내려가면 해고돼요.`));
}

export function renderStandings() {
  const data = store.getData();
  const state = store.getState();
  return h('div', { class: 'screen screen-wide' },
    h('h1', {}, '순위표'),
    h('p', { class: 'dim' }, '경쟁 중개회사 7곳과 수익을 견줘 보고, 이사회가 정한 목표를 확인하는 곳이에요.'),
    renderLeague(data, state),
    renderGoals(data, state));
}
