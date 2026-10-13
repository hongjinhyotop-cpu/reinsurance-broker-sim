// 시즌 리뷰 화면(design.md §6.6, M7a): 연말 성적표 / 해고 결과 / 연말 전 "중간 점검" 미리보기.
// 숨은 속성은 읽지 않는다. 읽는 것은 성적표(점수·사실 숫자)와 report.json의 설명 문구뿐이다.

import * as store from '../store.js';
import { computeReport, tierOf } from '../finance.js';
import { h, formatUsdM, confirmDialog } from './components.js';
import { glossaryLink, richText } from './glossary_view.js';

const PART_ORDER = ['revenue', 'retention', 'rank', 'compliance', 'reputation'];

// 항목별 "사실 한 줄". 숫자는 모두 화면에 이미 보이는 공개 값이다.
function factText(id, f) {
  switch (id) {
    case 'revenue': return `확정 브로커리지 ${formatUsdM(f.brokerage_usd_m)} (목표 ${formatUsdM(f.target_usd_m)})`;
    case 'retention': return `고객 ${f.clients_total}곳 중 ${f.clients_kept}곳 유지`;
    case 'rank': return f.rank === null ? '아직 분기 순위 결산 전이에요' : `${f.rank}위 (${f.rank_of}곳 중, 목표 ${f.rank_max}위 이내)`;
    case 'compliance': return `${f.compliance}점 (목표 ${f.compliance_min}점 이상)`;
    case 'reputation': return `${f.reputation}점 (100점 만점)`;
    default: return '';
  }
}

// 다음 해에 바꿔 볼 곳: 비율이 낮은 항목부터, 순위가 아직 공개 전이면 순위 조언은 뺀다.
export function pickTips(report, board) {
  return report.parts
    .filter((p) => p.fraction < board.report.tip_below && !(p.id === 'rank' && report.facts.rank === null))
    .sort((a, b) => a.fraction - b.fraction || PART_ORDER.indexOf(a.id) - PART_ORDER.indexOf(b.id))
    .slice(0, board.report.tip_max);
}

function renderBreakdown(data, report) {
  const texts = data.report.components;
  const cfg = data.config.board;
  return h('section', { class: 'card' },
    h('h2', {}, '왜 이 등급인가'),
    h('div', { class: 'table-wrap' },
      h('table', { class: 'table table-wrap-text' },
        h('thead', {}, h('tr', {}, ['항목', '점수', '숫자로 보면', '쉬운 말로'].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', {}, report.parts.map((p) => {
          const tier = tierOf(p.fraction, cfg.report);
          return h('tr', {},
            h('th', { scope: 'row' }, texts[p.id].label_ko,
              p.id === report.strong ? h('span', { class: 'tag tag-ok' }, '가장 잘함') : null,
              p.id === report.weak ? h('span', { class: 'tag tag-warn' }, '가장 아쉬움') : null),
            h('td', { class: 'num' }, `${p.points} / ${p.max}`),
            h('td', {}, factText(p.id, report.facts)),
            h('td', { class: 'cell-text' }, richText(texts[p.id][`${tier}_ko`])));
        })))));
}

function renderTips(data, report, preview) {
  const tips = pickTips(report, data.config.board);
  return h('section', { class: 'card' },
    h('h2', {}, preview ? '남은 기간에 챙겨 볼 곳' : '다음 해에 바꿔 볼 곳'),
    tips.length === 0
      ? h('p', {}, richText(data.report.keep_going_ko))
      : h('ol', { class: 'plain-list' }, tips.map((p) => h('li', {}, h('strong', {}, `${data.report.components[p.id].label_ko} — `), richText(data.report.components[p.id].tip_ko)))));
}

const STATUS_KO = { placed: '확정', lost: '경쟁 브로커로 이탈', open: '아직 확정 안 됨' };

// 딜 복기가 아닌 한 줄 요약: 트리티마다 결과만 보여 준다.
function renderContracts(data, state) {
  return h('section', { class: 'card' },
    h('h2', {}, '올해 계약 한눈에'),
    h('div', { class: 'table-wrap' },
      h('table', { class: 'table' },
        h('thead', {}, h('tr', {}, ['고객', '결과', '최종 RC', '확정 브로커리지'].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', {}, data.treaties.map((t) => {
          const ts = state.treaties[t.id];
          const booked = state.finance.booked[t.id];
          const client = data.clients.find((c) => c.id === t.client);
          return h('tr', {},
            h('th', { scope: 'row' }, client.name_ko),
            h('td', {}, STATUS_KO[ts.phase], ts.gap_applied ? h('span', { class: 'tag tag-warn' }, '공백이 있었어요') : null),
            h('td', {}, ts.final_rc === null ? '—' : `${ts.final_rc > 0 ? '+' : ''}${ts.final_rc.toFixed(1)}%`),
            h('td', {}, booked ? formatUsdM(booked.brokerage_usd_m) : ts.phase === 'placed' ? '인셉션에 확정돼요' : '—'));
        })))));
}

function renderMoney(f) {
  const row = (label, value) => [h('dt', {}, label), h('dd', {}, value)];
  return h('section', { class: 'card' },
    h('h2', {}, '돈 요약'),
    h('dl', { class: 'info-list' },
      row(['확정한 ', glossaryLink('gl_brokerage', { label: '브로커리지' })], formatUsdM(f.brokerage_usd_m)),
      row('낸 고정비', formatUsdM(f.overhead_usd_m)),
      row('낸 과태료', formatUsdM(f.fines_usd_m)),
      row('지금 현금', formatUsdM(f.cash_usd_m)),
      row('아직 받을 돈', formatUsdM(f.receivable_usd_m)),
      row('계약 공백', `${f.gaps}건`)));
}

function newGameButton() {
  return h('button', {
    class: 'btn btn-primary', type: 'button',
    onclick: async () => {
      const yes = await confirmDialog({ title: '새 게임을 시작할까요?', message: '이 게임은 자동 저장되어 있어요. 처음 화면으로 돌아가 새 게임이나 저장된 게임을 고를 수 있어요.', confirmLabel: '처음 화면으로' });
      if (yes) { location.hash = ''; store.quitToStart(); }
    },
  }, '새 게임 시작하기');
}

function gradeBadge(report, fired) {
  return h('div', { class: 'grade-box' },
    h('span', { class: `grade-letter grade-${report.grade.toLowerCase()}`, role: 'img', 'aria-label': `${report.grade} 등급` }, report.grade),
    h('div', {},
      h('div', { class: 'grade-score' }, `${report.score}점 / 100점`),
      fired ? h('div', { class: 'dim' }, '해고 시점까지의 성적으로 매긴 등급이에요') : null));
}

function confidenceLine(report, data) {
  if (report.partial) return null;
  const delta = data.config.board.grade_delta[report.grade];
  const sign = delta > 0 ? `+${delta}` : String(delta);
  return h('p', { class: 'dim' }, `이사회 신뢰: ${Math.round(report.confidence_before)}점 → ${Math.round(report.confidence_after)}점 (${report.grade} 등급 평가 ${sign})`);
}

export function renderReview() {
  const data = store.getData();
  const state = store.getState();
  const ending = state.ending;

  if (!ending) {
    const report = computeReport(data, state);
    return h('div', { class: 'screen screen-wide' },
      h('h1', {}, '시즌 리뷰'),
      h('section', { class: 'card' },
        h('p', { class: 'badge-line' }, h('span', { class: 'tag tag-warn' }, '아직 성적표가 아니에요')),
        h('h2', {}, '중간 점검 — 지금 이대로 끝난다면'),
        h('p', {}, richText(data.report.preview_note_ko)),
        gradeBadge(report, false)),
      renderBreakdown(data, report),
      renderTips(data, report, true),
      renderContracts(data, state),
      renderMoney(report.facts));
  }

  const report = ending.report;
  const fired = ending.kind === 'fired';
  const text = fired ? data.report.fired : data.report.grades[report.grade];
  return h('div', { class: 'screen screen-wide' },
    h('h1', {}, '시즌 리뷰'),
    h('section', { class: `card report-head${fired ? ' report-fired' : ''}` },
      h('p', { class: 'badge-line' }, h('span', { class: `tag ${fired ? 'tag-bad' : 'tag-ok'}` }, fired ? '게임 오버 — 해고' : '연말 성적표')),
      h('h2', {}, text.title_ko),
      gradeBadge(report, fired),
      text.summary_ko.map((line) => h('p', { class: 'chair-note' }, richText(line))),
      confidenceLine(report, data),
      fired ? h('p', { class: 'dim' }, ending.turn >= data.calendar.turns ? '연말 평가까지 마친 뒤의 결과예요.' : `턴 ${ending.turn}에 이사회가 결정했어요. 위 등급은 그때까지의 성적으로 계산했어요.`) : null),
    renderBreakdown(data, report),
    renderTips(data, report, false),
    renderContracts(data, state),
    renderMoney(report.facts),
    h('div', { class: 'row' }, newGameButton()));
}
