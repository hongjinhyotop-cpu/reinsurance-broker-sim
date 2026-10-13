// 시즌 리뷰 화면(design.md §6.6, M7a): 연말 성적표 / 해고 결과 / 연말 전 "중간 점검" 미리보기.
// 숨은 속성은 읽지 않는다. 읽는 것은 성적표(점수·사실 숫자)와 report.json의 설명 문구뿐이다.

import * as store from '../store.js';
import { computeReport, tierOf } from '../finance.js';
import { seasonRows, rankTrend } from '../season.js';
import { markSeasonReviewsSeen } from '../turn.js';
import { difficultyLabel } from '../difficulty.js';
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
        h('caption', { class: 'visually-hidden' }, '항목별 점수와 이유'),
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
const VERDICT_KO = { delighted: '매우 만족', accept: '수락', renegotiate: '재협상 요구', reject: '거부' };

// 부호를 붙인 증감 글자(0이면 "변화 없음")
export function signedText(n) {
  if (n === null || n === undefined) return '기록 없음';
  const r = Math.round(n * 10) / 10;
  return r === 0 ? '변화 없음' : `${r > 0 ? '+' : ''}${r}`;
}

const pctText = (ratio) => (ratio === null ? '—' : `${Math.round(ratio * 100)}%`);
const rcText = (rc) => (rc === null ? '—' : `${rc > 0 ? '+' : ''}${rc.toFixed(1)}%`);
const panelText = (panel) => (panel.length === 0 ? '—' : panel.map((r) => `${r.name_ko} ${Math.round(r.share * 100)}%`).join(' · '));

// 이사회 평가 한 줄: "신뢰 60 → 62 (+2)"
function evalLine(rev) {
  const delta = rev.board_after - rev.board_before;
  return `신뢰 ${Math.round(rev.board_before)} → ${Math.round(rev.board_after)} (${signedText(delta)})`;
}

function evalKey(rev) {
  if (rev.eval.kind === 'lost') return 'lost';
  if (rev.eval.kind === 'open') return 'pending';
  return rev.eval.delta > 0 ? 'up' : rev.eval.delta < 0 ? 'down' : 'flat';
}

function grossText(row) {
  if (!row.booked) return row.phase === 'placed' ? '인셉션에 확정돼요' : '—';
  const base = `${formatUsdM(row.booked.brokerage_usd_m)} (만기 대비 ${pctText(row.ratio)})`;
  return row.booked.cut_usd_m > 0 ? `${base} — 공백으로 ${formatUsdM(row.booked.cut_usd_m)} 줄었어요` : base;
}

// 시즌 중간 리뷰 카드 한 장(§6.6). 결과는 지금 상태, 변화량과 이사회 평가는 시즌이 끝난 주에 굳은 기록이다.
function renderSeasonCard(data, row) {
  const rev = row.review;
  const texts = data.report.season;
  const dl = (label, value) => [h('dt', {}, label), h('dd', {}, value)];
  const lateNote = rev && rev.status === 'open' && row.phase === 'placed' ? h('p', { class: 'dim' }, '시즌이 끝난 주에는 확정 전이었고, 그 뒤에 확정됐어요.') : null;
  return h('section', { class: 'card season-card' },
    h('h3', {}, `${row.season.label} 갱신 시즌 — ${row.client.name_ko}`,
      h('span', { class: `tag ${row.phase === 'placed' ? 'tag-ok' : row.phase === 'lost' ? 'tag-bad' : 'tag-warn'}` }, STATUS_KO[row.phase]),
      row.gap ? h('span', { class: 'tag tag-warn' }, glossaryLink('gl_cover_gap', { label: '공백' }), '이 있었어요') : null),
    h('dl', { class: 'info-list' },
      dl(['최종 ', glossaryLink('gl_rate_change', { label: 'RC' })], rcText(row.final_rc)),
      dl(['확정 ', glossaryLink('gl_panel', { label: '패널' })], panelText(row.panel)),
      dl(['확정 ', glossaryLink('gl_brokerage', { label: '브로커리지' })], grossText(row)),
      dl('고객 반응', VERDICT_KO[row.verdict] ?? '—')),
    lateNote,
    rev
      ? h('div', {},
        h('h4', {}, '시즌 동안 달라진 것'),
        rev.rel_client_delta === null
          ? h('p', { class: 'dim' }, '이 시즌의 출발 기록이 남아 있지 않아 변화는 알 수 없어요.')
          : h('dl', { class: 'info-list' },
            dl('고객 관계도', signedText(rev.rel_client_delta)),
            dl('재보험사 관계도(평균)', signedText(rev.rel_re_delta)),
            dl('스카우팅으로 더 알게 된 정보', rev.scout_gain === 0 ? '변화 없음' : `${rev.scout_gain}단계`),
            dl('새로 모은 용어', `${rev.codex_gain}개`)),
        h('h4', {}, '이사회 평가'),
        h('p', {}, h('strong', {}, evalLine(rev))),
        h('p', {}, richText(texts.eval_ko[evalKey(rev)])))
      : h('p', { class: 'dim' }, '이 시즌은 기록이 남아 있지 않아요.'));
}

// 시즌별 중간 리뷰 카드 모음. 아직 끝난 시즌이 없으면 아무것도 그리지 않는다.
function renderSeasonCards(data, state) {
  const rows = seasonRows(data, state).filter((r) => r.review).reverse();
  if (rows.length === 0) return null;
  return h('section', { class: 'season-reviews' },
    h('h2', {}, data.report.season.title_ko),
    h('p', { class: 'dim' }, richText(data.report.season.intro_ko)),
    rows.map((r) => renderSeasonCard(data, r)));
}

// 연말 시즌 비교 표: 세 시즌을 한 표로, 맨 아래 합계(§6.6).
function renderSeasonCompare(data, state) {
  const rows = seasonRows(data, state);
  if (rows.length === 0) return null;
  const texts = data.report.season;
  const sum = (pick) => rows.reduce((s, r) => s + (r.review && pick(r.review) !== null ? pick(r.review) : 0), 0);
  const note = richText(texts.compare_note_ko); // 화면 위쪽 글이 용어 첫 등장을 먼저 가져가도록 표 머리보다 먼저 만든다
  const heads = ['시즌 · 고객', '결과', ['최종 ', glossaryLink('gl_rate_change', { label: 'RC' })], ['확정 ', glossaryLink('gl_brokerage', { label: '브로커리지' })], [glossaryLink('gl_expiring', { label: '만기' }), ' 대비'], '고객 반응', '관계 변화(고객)', '스카우팅 진전', '새 용어', '이사회 평가'];
  return h('section', { class: 'card' },
    h('h2', {}, texts.compare_title_ko),
    h('p', { class: 'dim' }, note),
    h('div', { class: 'table-wrap' },
      h('table', { class: 'table' },
        h('caption', { class: 'visually-hidden' }, texts.compare_title_ko),
        h('thead', {}, h('tr', {}, heads.map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', {}, rows.map((r) => h('tr', {},
          h('th', { scope: 'row' }, `${r.season.label} · ${r.client.name_ko}`),
          h('td', {}, STATUS_KO[r.phase]),
          h('td', {}, rcText(r.final_rc)),
          h('td', {}, r.booked ? formatUsdM(r.booked.brokerage_usd_m) : '—'),
          h('td', {}, pctText(r.ratio)),
          h('td', {}, VERDICT_KO[r.verdict] ?? '—'),
          h('td', {}, r.review ? signedText(r.review.rel_client_delta) : '—'),
          h('td', {}, r.review && r.review.scout_gain !== null ? `${r.review.scout_gain}단계` : '—'),
          h('td', {}, r.review && r.review.codex_gain !== null ? `${r.review.codex_gain}개` : '—'),
          h('td', {}, r.review ? signedText(r.review.board_after - r.review.board_before) : '—')))),
        h('tfoot', {}, h('tr', {},
          h('th', { scope: 'row' }, '합계'),
          h('td', {}), h('td', {}),
          h('td', {}, formatUsdM(rows.reduce((s, r) => s + (r.booked?.brokerage_usd_m ?? 0), 0))),
          h('td', {}), h('td', {}), h('td', {}), h('td', {}),
          h('td', {}, `${sum((v) => v.codex_gain)}개`),
          h('td', {}, signedText(sum((v) => v.board_after - v.board_before))))))));
}

const QUARTER_KO = { q1: '1분기', q2: '2분기', q3: '3분기', q4: '4분기' };

// 분기별 순위 추이(라이벌 대비 상세): 내 리그 수익과 가장 강한 라이벌, 그 분기에 평판으로 넘어온 몫.
function renderTrend(data, state) {
  const rows = rankTrend(data, state);
  if (rows.length === 0) return null;
  const texts = data.report.season;
  const heads = ['분기', '내 순위', '내 리그 수익(누계)', '가장 강한 라이벌', '라이벌 누계', '라이벌과의 차이', '평판 효과(그 분기)'];
  return h('section', { class: 'card' },
    h('h2', {}, texts.trend_title_ko),
    h('div', { class: 'table-wrap' },
      h('table', { class: 'table' },
        h('caption', { class: 'visually-hidden' }, texts.trend_title_ko),
        h('thead', {}, h('tr', {}, heads.map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', {}, rows.map((r) => h('tr', {},
          h('th', { scope: 'row' }, QUARTER_KO[r.id] ?? r.id),
          h('td', {}, `${r.rank}위`),
          h('td', {}, formatUsdM(r.mine)),
          h('td', {}, r.rival_name_ko),
          h('td', {}, formatUsdM(r.rival_ytd)),
          h('td', {}, r.gap >= 0 ? `+${formatUsdM(r.gap)} 앞서요` : `${formatUsdM(-r.gap)} 뒤져요`),
          h('td', {}, r.flow_q > 0 ? `+${formatUsdM(r.flow_q)}` : '—')))))),
    h('p', { class: 'dim' }, richText(texts.flow_note_ko)));
}

// 딜 복기가 아닌 한 줄 요약: 트리티마다 결과만 보여 준다.
function renderContracts(data, state) {
  return h('section', { class: 'card' },
    h('h2', {}, '올해 계약 한눈에'),
    h('div', { class: 'table-wrap' },
      h('table', { class: 'table' },
        h('caption', { class: 'visually-hidden' }, '올해 계약 한눈에'),
        h('thead', {}, h('tr', {}, ['고객', '결과', '최종 RC', '확정 브로커리지'].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', {}, data.treaties.map((t) => {
          const ts = state.treaties[t.id];
          const booked = state.finance.booked[t.id];
          const client = data.clients.find((c) => c.id === t.client);
          return h('tr', {},
            h('th', { scope: 'row' }, client.name_ko),
            h('td', {}, STATUS_KO[ts.phase], ts.gap_applied ? h('span', { class: 'tag tag-warn' }, glossaryLink('gl_cover_gap', { label: '공백' }), '이 있었어요') : null),
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
      row(['낸 ', glossaryLink('gl_overhead')], formatUsdM(f.overhead_usd_m)),
      row(['낸 ', glossaryLink('gl_fine')], formatUsdM(f.fines_usd_m)),
      f.gap_cut_usd_m > 0 ? row('공백으로 줄어든 수수료', formatUsdM(f.gap_cut_usd_m)) : null,
      row('지금 현금', formatUsdM(f.cash_usd_m)),
      row(glossaryLink('gl_receivable'), formatUsdM(f.receivable_usd_m)),
      row(['계약 ', glossaryLink('gl_cover_gap', { label: '공백' })], `${f.gaps}건`)));
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
  return h('p', { class: 'dim' }, [glossaryLink('gl_board_trust'), `: ${Math.round(report.confidence_before)}점 → ${Math.round(report.confidence_after)}점 (${report.grade} 등급 평가 ${sign})`]);
}

// 성적표·중간 점검 머리에 붙는 난이도 표시(design.md §9.5)
const levelTag = (data, state) => h('span', { class: 'tag' }, `난이도: ${difficultyLabel(data, state)}`);

export function renderReview() {
  markSeasonReviewsSeen(); // 화면을 그리는 것으로 "봤다"고 친다(안내띠 3a). 그린 다음에 셸의 안내띠가 계산된다
  const data = store.getData();
  const state = store.getState();
  const ending = state.ending;

  if (!ending) {
    const report = computeReport(data, state);
    return h('div', { class: 'screen screen-wide' },
      h('h1', {}, '시즌 리뷰'),
      h('section', { class: 'card' },
        h('p', { class: 'badge-line' }, h('span', { class: 'tag tag-warn' }, '아직 성적표가 아니에요'), levelTag(data, state)),
        h('h2', {}, '중간 점검 — 지금 이대로 끝난다면'),
        h('p', {}, richText(data.report.preview_note_ko)),
        gradeBadge(report, false)),
      renderSeasonCards(data, state),
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
      h('p', { class: 'badge-line' }, h('span', { class: `tag ${fired ? 'tag-bad' : 'tag-ok'}` }, fired ? '게임 오버 — 해고' : glossaryLink('gl_report_card')), levelTag(data, state)),
      h('h2', {}, text.title_ko),
      gradeBadge(report, fired),
      text.summary_ko.map((line) => h('p', { class: 'chair-note' }, richText(line))),
      confidenceLine(report, data),
      fired ? h('p', { class: 'dim' }, ending.turn >= data.calendar.turns ? '연말 평가까지 마친 뒤의 결과예요.' : `턴 ${ending.turn}에 이사회가 결정했어요. 위 등급은 그때까지의 성적으로 계산했어요.`) : null),
    renderSeasonCompare(data, state),
    renderTrend(data, state),
    renderSeasonCards(data, state),
    renderBreakdown(data, report),
    renderTips(data, report, false),
    renderContracts(data, state),
    renderMoney(report.facts),
    h('div', { class: 'row' }, newGameButton()));
}
