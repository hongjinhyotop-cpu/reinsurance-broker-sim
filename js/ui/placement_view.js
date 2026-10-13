// 라인 구성 보드 M5a(design.md §6.3): 트리티 하나를 막대 100%로 보고 재보험사별 지분을 채운다.
// 계산은 negotiation.js(시험대와 같은 quoteProposal, 제약 검사 boardCheck)가 하고 여기서는 입력을 모아 그리기만 한다.
// M5a에서는 세이브·행동 점수·관계도·인내심을 바꾸지 않는다. 지분은 이 모듈의 메모리에만 있다(M5b에서 저장).

import * as store from '../store.js';
import { describeTurn } from '../calendar.js';
import { quoteProposal, boardCheck, publicShareCap } from '../negotiation.js';
import { h, toast } from './components.js';

const TERMS_KO = { strict: '엄격', standard: '표준', broad: '넓음' };
const LINE_KO = { property_energy: '재산·에너지', marine_cargo: '해상화물', takaful_general: '일반 타카풀' };
const REASON_KO = { no_appetite: '이 라인은 받지 않는 곳이에요', shariah: '샤리아 기준을 맞출 수 없어요' };
const HINT_KO = { good: '받아줄 분위기예요', near: '거의 근접했어요', far: '눈높이가 많이 멀어요' };
const BLOCK_KO = {
  share_total: '지분 합이 100%가 아니에요',
  single_share: '한 곳당 최대 지분을 넘은 재보험사가 있어요',
  min_rating: '고객의 최소 등급에 못 미치는 재보험사가 있어요',
  shariah_cap: '일반(비샤리아) 재보험사 지분이 샤리아 상한을 넘었어요',
};
const STATUS_KO = { draft: '미제안', accept: '수락', counter: '반제', reject: '거절' };
const STEP = 5;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const pct = (x, d = 1) => `${x < 0 ? '−' : x > 0 ? '+' : ''}${Math.abs(x).toFixed(d)}%`;
const share = (x) => `${Math.round(x * 1000) / 10}%`;

// 화면이 다시 그려져도 입력이 남도록 모듈에 둔다. 게임이 바뀌면 비운다.
let uiGeneration = -1;
let board = null;
let focusKey = null;

function initBoard(data, treatyId) {
  const treaty = data.treaties.find((t) => t.id === treatyId);
  board = {
    treatyId,
    shares: {},       // 재보험사 id → 정수 %(0~100)
    rcs: Object.fromEntries(data.reinsurers.map((r) => [r.id, treaty.target_rc])),
    terms: treaty.terms.preferred,
    structureOption: '',
    results: {},      // 재보험사 id → 마지막 의견/제안 결과(지분·RC·조건이 바뀌면 지운다)
    capKnown: {},     // 재보험사 id → 확인된 실제 용량 상한(0~1)
    log: [],
  };
}

// 이 트리티 라인을 받는 재보험사들. 만기 패널 순서를 먼저 두어 고스트 막대와 정렬이 맞게 한다.
function boardContext(data, state) {
  const treaty = data.treaties.find((t) => t.id === board.treatyId);
  const client = data.clients.find((c) => c.id === treaty.client);
  const expiringIds = treaty.expiring.panel.map((m) => m.re);
  const byId = new Map(data.reinsurers.map((r) => [r.id, r]));
  const takes = (r) => r.capacity_usd_m[treaty.line] > 0 || expiringIds.includes(r.id);
  const ordered = [...expiringIds.map((id) => byId.get(id)), ...data.reinsurers.filter((r) => !expiringIds.includes(r.id))].filter(takes);
  const season = data.calendar.seasons.find((s) => s.id === treaty.season);
  const toInception = season.inception_turn - state.turn;
  return {
    treaty, client, expiringIds, reinsurers: ordered, season,
    colorOf: new Map(ordered.map((r, i) => [r.id, i % 5])),
    weeksLeft: clamp(toInception, 1, season.inception_turn - season.open_turn),
    toInception,
    market: Math.round(state.market.index),
  };
}

function capOf(ctx, reinsurer) {
  if (board.capKnown[reinsurer.id] !== undefined) return { value: board.capKnown[reinsurer.id], exact: true };
  return {
    value: publicShareCap({
      capacity: reinsurer.capacity_usd_m[ctx.treaty.line], limit: ctx.treaty.limit_usd_m,
      reinsurerMaxShare: reinsurer.behavior.max_single_share, clientMaxShare: ctx.client.requirements.max_single_share,
    }),
    exact: false,
  };
}

function runCheck(data, ctx) {
  const req = ctx.client.requirements;
  return boardCheck({
    shares: Object.fromEntries(ctx.reinsurers.map((r) => [r.id, (board.shares[r.id] ?? 0) / 100])),
    members: ctx.reinsurers.map((r) => ({ id: r.id, rating: r.rating, shariahOk: r.shariah_ok, maxSingleShare: r.behavior.max_single_share })),
    caps: Object.fromEntries(ctx.reinsurers.map((r) => [r.id, capOf(ctx, r).value])),
    expiringIds: ctx.expiringIds,
    client: { minRating: req.min_rating, maxSingleShare: req.max_single_share, shariahRequired: req.shariah_required, shariahConventionalCap: req.shariah_conventional_cap },
  }, data.config.negotiation);
}

function flagText(flag, exactCap) {
  if (flag.kind === 'single_share') return `한 곳당 최대 ${share(flag.limit)} 초과`;
  if (flag.kind === 'capacity') return `용량 부족 — 맡을 수 있는 한도 ${exactCap ? '' : '~'}${share(flag.cap)}`;
  return '고객 최소 등급 미달';
}

// ---------- 행동 ----------

function setShare(id, value) {
  board.shares[id] = clamp(Math.round(value), 0, 100);
  delete board.results[id];
}

function clearAllResults() { board.results = {}; }

function askReinsurer(data, state, ctx, reinsurer, mode) {
  const s = board.shares[reinsurer.id] ?? 0;
  if (s <= 0) { toast('먼저 이 재보험사의 지분을 정해 주세요', 'warn'); return; }
  const dyn = state.entities.reinsurers[reinsurer.id];
  const rc = board.rcs[reinsurer.id];
  const q = quoteProposal({
    treaty: ctx.treaty, client: ctx.client, reinsurer, relationship: dyn.relationship, scoutPrice: dyn.scout.price_sensitivity, seed: state.seed,
  }, {
    market: ctx.market, p: rc, sReq: s / 100, weeksLeft: ctx.weeksLeft, terms: board.terms, structureOption: board.structureOption || null,
    bundles: 0, lrExtra: 0, bigLoss: false, prepQuality: 0,
  }, data.config.negotiation);
  board.capKnown[reinsurer.id] = q.maxShare; // 의견을 묻거나 제안하면 실제 상한이 드러난다(§6.3)

  const r = q.response;
  const result = { mode, kind: mode === 'ask' ? 'draft' : r.kind, response: r, hint: q.hint, maxShare: q.maxShare, shareReq: s, rc };
  board.results[reinsurer.id] = result;
  board.log.unshift(`${reinsurer.name_ko} · 지분 ${s}% · RC ${pct(rc)} — ${mode === 'ask' ? '의견 묻기' : '시험 제안'}: ${describeResult(result)}`);
  if (board.log.length > 24) board.log.length = 24;
}

function describeResult(res) {
  const r = res.response;
  if (res.mode === 'ask') {
    if (r.kind === 'decline') return `거절 사유 — ${REASON_KO[r.reason]}`;
    return `가격 감 "${HINT_KO[res.hint.level]}"`;
  }
  if (r.kind === 'decline') return `거절 — ${REASON_KO[r.reason]}`;
  if (r.kind === 'accept') return `수락 — RC ${pct(r.rc)}에 ${share(r.share)}${r.support > 0 ? ` (+${share(r.support)}p 지원 가능)` : ''}`;
  if (r.kind === 'counter') return `반제 — RC ${pct(r.rc)}라면 ${share(r.share)}`;
  return '거절 — 가격이 너무 낮아요';
}

// ---------- 그리기 ----------

function statusOf(res) {
  if (!res || res.mode === 'ask') return 'draft';
  return res.kind === 'decline' ? 'reject' : res.kind;
}

function barTrack(ctx, check, data) {
  const nameOf = (id) => data.reinsurers.find((r) => r.id === id).name_ko;
  const ghosts = [];
  let at = 0;
  for (const m of ctx.treaty.expiring.panel) {
    const w = m.share * 100;
    ghosts.push(h('div', {
      class: `pl-seg pl-ghost re-${ctx.colorOf.get(m.re)}`, style: { left: `${at}%`, width: `${w}%` },
      title: `만기 ${nameOf(m.re)} ${share(m.share)}`,
    }, `만기 ${nameOf(m.re)} ${Math.round(w)}`));
    at += w;
  }
  const edits = [];
  at = 0;
  for (const r of ctx.reinsurers) {
    const s = board.shares[r.id] ?? 0;
    if (s <= 0) continue;
    const status = statusOf(board.results[r.id]);
    edits.push(h('div', {
      class: `pl-seg pl-edit pl-st-${status} re-${ctx.colorOf.get(r.id)}`, style: { left: `${Math.min(at, 100)}%`, width: `${Math.max(0, Math.min(s, 100 - at))}%` },
      title: `${r.name_ko} ${s}% — ${STATUS_KO[status]}`,
    }, `${r.name_ko} ${s}`));
    at += s;
  }
  const restPct = Math.round((1 - check.total) * 100);
  if (restPct > 0) {
    edits.push(h('div', { class: 'pl-seg pl-rest', style: { left: `${Math.min(at, 100)}%`, width: `${restPct}%` } }, `남은 ${restPct}%`));
  }
  return h('div', { class: 'pl-bar' },
    h('div', { class: 'pl-track', role: 'img', 'aria-label': `지분 합 ${Math.round(check.total * 100)}%, 남은 지분 ${restPct}%. 아래 표에 같은 내용이 있어요.` }, ghosts, edits),
    h('div', { class: 'pl-scale', 'aria-hidden': 'true' }, Array.from({ length: 11 }, (_, i) => h('span', { style: { left: `${i * 10}%` } }, String(i * 10)))),
  );
}

function resultLines(res) {
  if (!res) return null;
  const r = res.response;
  const lines = [];
  if (res.mode === 'ask') {
    lines.push(r.kind === 'decline'
      ? h('p', { class: 'pl-line' }, `의견: 받을 수 없는 곳이에요 — ${REASON_KO[r.reason]}`)
      : h('p', { class: 'pl-line' }, `의견: 가격 감 "${HINT_KO[res.hint.level]}"`,
        h('small', { class: 'dim' }, ` (가격 민감도를 아는 만큼만 정확해요 — 오차 약 ±${res.hint.errPp.toFixed(1)}%p)`)));
  } else {
    lines.push(h('p', { class: `pl-line pl-resp pl-resp-${statusOf(res)}`, role: 'status' }, `시험 제안: ${describeResult(res)}`));
    if (r.limited) lines.push(h('p', { class: 'pl-line' }, `라인이 제한돼요. 요청한 ${res.shareReq}%보다 적은 ${share(res.maxShare)}까지만 맡을 수 있어요.`));
    if (res.hint) lines.push(h('p', { class: 'pl-line dim' }, `가격 감: ${HINT_KO[res.hint.level]}`));
  }
  return lines;
}

function stepButton(label, delta, ariaLabel, reinsurer, rerender) {
  return h('button', {
    type: 'button', class: 'btn btn-step', 'aria-label': ariaLabel, 'data-key': `${reinsurer.id}:${delta > 0 ? 'up' : 'down'}`,
    title: 'Shift를 누르고 누르면 1%씩',
    onclick: (ev) => {
      const step = ev.shiftKey ? 1 : STEP;
      setShare(reinsurer.id, (board.shares[reinsurer.id] ?? 0) + delta * step);
      focusKey = `${reinsurer.id}:${delta > 0 ? 'up' : 'down'}`;
      rerender();
    },
  }, label);
}

function reinsurerRow(data, state, ctx, check, reinsurer, rerender) {
  const id = reinsurer.id;
  const s = board.shares[id] ?? 0;
  const res = board.results[id];
  const status = statusOf(res);
  const cap = capOf(ctx, reinsurer);
  const expiringShare = ctx.treaty.expiring.panel.find((m) => m.re === id)?.share ?? 0;

  const chips = [];
  for (const f of check.flags[id]) chips.push(h('span', { class: 'tag tag-bad' }, flagText(f, cap.exact)));
  if (check.shariah && !reinsurer.shariah_ok && s > 0) chips.push(h('span', { class: 'tag tag-bad' }, '샤리아 상한에 포함되는 일반 재보험사'));
  if (expiringShare === 0 && s > 0) chips.push(h('span', { class: 'tag tag-warn' }, '만기에 없던 곳'));

  const shareInput = h('input', {
    type: 'number', min: '0', max: '100', step: '1', value: String(s), 'data-key': `${id}:share`,
    id: `pl-share-${id}`, 'aria-label': `${reinsurer.name_ko} 지분(%)`,
    onchange: (ev) => {
      const v = Number(ev.target.value);
      setShare(id, Number.isFinite(v) ? v : 0);
      focusKey = `${id}:share`;
      rerender();
    },
    onkeydown: (ev) => {
      if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
      ev.preventDefault();
      setShare(id, (board.shares[id] ?? 0) + (ev.key === 'ArrowRight' ? 1 : -1) * (ev.shiftKey ? 1 : STEP));
      focusKey = `${id}:share`;
      rerender();
    },
  });

  const rcInput = h('input', {
    type: 'number', min: '-30', max: '40', step: '0.1', value: String(board.rcs[id]), 'data-key': `${id}:rc`,
    id: `pl-rc-${id}`, 'aria-label': `${reinsurer.name_ko}에 낼 RC(%)`,
    onchange: (ev) => {
      const v = Number(ev.target.value);
      if (Number.isFinite(v)) board.rcs[id] = clamp(v, -30, 40);
      delete board.results[id];
      focusKey = `${id}:rc`;
      rerender();
    },
  });

  return h('div', { class: `pl-row re-${ctx.colorOf.get(id)}` },
    h('div', { class: 'pl-row-head' },
      h('span', { class: 'pl-swatch', 'aria-hidden': 'true' }),
      h('strong', {}, reinsurer.name_ko),
      h('span', { class: 'tag' }, reinsurer.rating),
      reinsurer.shariah_ok ? h('span', { class: 'tag' }, '샤리아') : null,
      h('span', { class: 'dim pl-cap' }, `${cap.exact ? '확인된 상한' : '이론 상한'} ${cap.exact ? '' : '~'}${share(cap.value)}`),
      expiringShare > 0 ? h('span', { class: 'dim pl-cap' }, `만기 ${share(expiringShare)}`) : null,
      h('span', { class: `pl-status pl-status-${status}` }, STATUS_KO[status]),
    ),
    h('div', { class: 'pl-row-controls' },
      h('div', { class: 'pl-stepper', role: 'group', 'aria-label': `${reinsurer.name_ko} 지분 조절` },
        stepButton('−5', -1, `${reinsurer.name_ko} 지분 5% 줄이기`, reinsurer, rerender),
        shareInput, h('span', { class: 'pl-unit' }, '%'),
        stepButton('+5', 1, `${reinsurer.name_ko} 지분 5% 늘리기`, reinsurer, rerender)),
      h('div', { class: 'pl-rc' }, h('label', { for: `pl-rc-${id}` }, 'RC'), rcInput, h('span', { class: 'pl-unit' }, '%')),
      h('button', {
        type: 'button', class: 'btn', disabled: s <= 0 ? true : null, title: '가격 감과 맡을 수 있는 한도만 알려 줘요',
        onclick: () => { askReinsurer(data, state, ctx, reinsurer, 'ask'); focusKey = `${id}:ask`; rerender(); }, 'data-key': `${id}:ask`,
      }, '의견 묻기'),
      h('button', {
        type: 'button', class: 'btn', disabled: s <= 0 ? true : null, title: '수락·반제·거절을 알려 줘요 (시험이라 점수는 그대로)',
        onclick: () => { askReinsurer(data, state, ctx, reinsurer, 'propose'); focusKey = `${id}:propose`; rerender(); }, 'data-key': `${id}:propose`,
      }, '시험 제안'),
    ),
    chips.length > 0 ? h('div', { class: 'pl-chips' }, chips) : null,
    resultLines(res),
  );
}

function accessibleTable(ctx, check) {
  return h('table', { class: 'table pl-table' },
    h('caption', { class: 'visually-hidden' }, '막대와 같은 내용을 표로 정리했어요'),
    h('thead', {}, h('tr', {}, ['재보험사', '만기 지분', '현재 지분', '상태', '경고'].map((t) => h('th', { scope: 'col' }, t)))),
    h('tbody', {}, ctx.reinsurers.map((r) => {
      const s = board.shares[r.id] ?? 0;
      const exp = ctx.treaty.expiring.panel.find((m) => m.re === r.id)?.share ?? 0;
      const cap = capOf(ctx, r);
      const warns = check.flags[r.id].map((f) => flagText(f, cap.exact));
      return h('tr', {},
        h('th', { scope: 'row' }, r.name_ko), h('td', {}, share(exp)), h('td', {}, `${s}%`),
        h('td', {}, STATUS_KO[statusOf(board.results[r.id])]), h('td', {}, warns.length > 0 ? warns.join(' · ') : '없음'));
    })),
    h('tfoot', {}, h('tr', {}, h('th', { scope: 'row' }, '합계'), h('td', {}, '100%'), h('td', {}, `${Math.round(check.total * 100)}%`), h('td', {}), h('td', {}))));
}

function requirementLine(ctx, data) {
  const req = ctx.client.requirements;
  const bits = [`최소 등급 ${req.min_rating}`, `단일 최대 ${share(req.max_single_share)}`, `목표 RC ${pct(ctx.treaty.target_rc)}`, `선호 조건 ${TERMS_KO[req.preferred_terms]}`];
  if (req.shariah_required) bits.push(`샤리아 필수(일반 재보험사 합 ${share(req.shariah_conventional_cap ?? 1)} 이하)`);
  return bits.join(' · ');
}

function timingText(ctx) {
  if (ctx.toInception < 0) return '이 시즌의 인셉션은 이미 지났어요';
  if (ctx.toInception === 0) return '이번 주가 인셉션이에요';
  return `인셉션까지 ${ctx.toInception}주`;
}

export function renderPlacement() {
  const data = store.getData();
  const state = store.getState();
  if (uiGeneration !== store.getGeneration() || !board) {
    uiGeneration = store.getGeneration();
    initBoard(data, data.treaties[0].id);
  }

  const root = h('div', { class: 'screen screen-wide pl' });
  const draw = () => {
    const ctx = boardContext(data, state);
    const check = runCheck(data, ctx);
    const total = Math.round(check.total * 100);
    const trt = ctx.treaty;
    const desc = describeTurn(data.calendar, state.turn);

    const globalChips = [];
    if (check.over) globalChips.push(h('span', { class: 'tag tag-bad' }, `${total - 100}% 초과 — 합이 100%를 넘으면 제출할 수 없어요`));
    if (check.shariah) globalChips.push(h('span', { class: 'tag tag-bad' }, `샤리아 상한 초과 — 일반 재보험사 합 ${share(check.shariah.conventional)} (상한 ${share(check.shariah.cap)})`));
    const turnoverPct = Math.round(check.turnover * 100);
    if (turnoverPct > 0) globalChips.push(h('span', { class: 'tag tag-warn' }, `만기에 없던 재보험사가 ${turnoverPct}%를 가져가요 — 보수적인 고객에게는 부담일 수 있어요`));

    const blockText = check.blockers.map((b) => BLOCK_KO[b]);
    const rerender = () => { draw(); };

    const header = h('section', { class: 'card', 'aria-label': '트리티 정보' },
      h('div', { class: 'pl-head' },
        h('div', { class: 'field' },
          h('label', { for: 'pl-treaty' }, '트리티'),
          h('select', {
            id: 'pl-treaty', class: 'bench-select',
            onchange: (ev) => { initBoard(data, ev.target.value); focusKey = 'treaty'; rerender(); }, 'data-key': 'treaty',
          }, data.treaties.map((t) => h('option', { value: t.id, selected: t.id === board.treatyId ? true : null }, t.name_ko)))),
        h('div', { class: 'field' },
          h('label', { for: 'pl-terms' }, '약관 조건'),
          h('select', {
            id: 'pl-terms', class: 'bench-select',
            onchange: (ev) => { board.terms = ev.target.value; clearAllResults(); focusKey = 'terms'; rerender(); }, 'data-key': 'terms',
          }, Object.entries(TERMS_KO).map(([v, t]) => h('option', { value: v, selected: v === board.terms ? true : null }, t)))),
        h('div', { class: 'field' },
          h('label', { for: 'pl-structure' }, '구조 옵션'),
          h('select', {
            id: 'pl-structure', class: 'bench-select',
            onchange: (ev) => { board.structureOption = ev.target.value; clearAllResults(); focusKey = 'structure'; rerender(); }, 'data-key': 'structure',
          }, [h('option', { value: '' }, '없음'), ...trt.structure_options.map((o) => h('option', { value: o.id, selected: o.id === board.structureOption ? true : null }, o.label_ko))]))),
      h('p', {},
        h('strong', {}, ctx.client.name_ko), ` · ${LINE_KO[trt.line]} · 한도 $${trt.limit_usd_m}m (부담 $${trt.attachment_usd_m}m 초과) · 만기 보험료 $${trt.expiring.premium_usd_m}m · `,
        `${ctx.season.label} 시즌 · ${timingText(ctx)}`, desc ? ` · 지금 ${desc.quarter.label_ko} ${desc.weekInQuarter}주차` : ''),
      h('p', { class: 'dim' }, `고객 요구: ${requirementLine(ctx, data)}`));

    const boardCard = h('section', { class: 'card', 'aria-label': '지분 막대' },
      h('div', { class: 'pl-bar-head' },
        h('h2', {}, '위험 100%를 나눠 채우기'),
        h('div', { class: 'row pl-quick' },
          h('button', {
            type: 'button', class: 'btn', 'data-key': 'load-expiring',
            onclick: () => {
              board.shares = Object.fromEntries(trt.expiring.panel.map((m) => [m.re, Math.round(m.share * 100)]));
              clearAllResults(); focusKey = 'load-expiring'; rerender();
            },
          }, '만기 지분 불러오기'),
          h('button', {
            type: 'button', class: 'btn', 'data-key': 'clear',
            onclick: () => { board.shares = {}; clearAllResults(); focusKey = 'clear'; rerender(); },
          }, '비우기'))),
      barTrack(ctx, check, data),
      h('p', { class: 'pl-legend dim' },
        '위쪽 흐린 띠는 만기 때 지분(고스트)이고, 아래쪽이 지금 구성이에요. 점선=아직 제안 전, 실선=수락, 주황 테두리=반제, 빗금=거절이에요.'),
      h('p', { class: 'pl-sum' },
        h('strong', { class: check.over ? 'pl-over' : '' }, `합계 ${total}% / 100%`),
        check.filled ? ' — 가득 찼어요' : check.over ? '' : ` — 남은 ${Math.round(check.remaining * 100)}%`),
      globalChips.length > 0 ? h('div', { class: 'pl-chips' }, globalChips) : null,
      h('div', { class: 'notice' },
        h('strong', {}, '시험 제안이에요. '),
        '의견 묻기와 시험 제안은 시험대와 같은 계산으로 답만 알려 줘요. 행동 점수, 관계도, 인내심은 그대로이고 저장도 안 돼요. 입력칸에서 ← → 로 5%씩, Shift+← →로 1%씩 조절할 수 있어요.'));

    const rows = h('section', { class: 'pl-rows', 'aria-label': '재보험사별 지분' },
      ctx.reinsurers.map((r) => reinsurerRow(data, state, ctx, check, r, rerender)));

    const submit = h('section', { class: 'card', 'aria-label': '제출' },
      h('h2', {}, '고객에게 제출'),
      blockText.length > 0
        ? h('ul', { class: 'plain-list', role: 'status' }, blockText.map((t) => h('li', {}, t)))
        : h('p', { role: 'status' }, '지분이 100%로 채워졌고 하드 위반도 없어요.'),
      h('button', {
        type: 'button', class: 'btn btn-primary', disabled: check.canSubmit ? null : true, 'data-key': 'submit',
        onclick: () => toast('고객에게 제출하고 반응을 받는 부분은 다음 단계(M5b)에서 만들어요', 'info'),
      }, '고객에 패키지 제출'),
      h('p', { class: 'dim pl-small' }, '용량 부족은 칩으로만 알려 주고 제출을 막지는 않아요. 제출 이후는 M5b에서 만들어요.'));

    const log = h('section', { class: 'card', 'aria-label': '협상 로그' },
      h('h2', {}, '협상 로그'),
      board.log.length === 0 ? h('p', { class: 'dim' }, '아직 의견을 묻거나 제안한 기록이 없어요.')
        : h('ul', { class: 'plain-list pl-log' }, board.log.map((t) => h('li', {}, t))));

    root.replaceChildren(
      h('h1', {}, '플레이스먼트 — 라인 구성 보드'),
      header, boardCard, rows,
      h('section', { class: 'card', 'aria-label': '표로 보기' }, h('h2', {}, '표로 보기'), accessibleTable(ctx, check)),
      h('div', { class: 'pl-bottom' }, submit, log));

    if (focusKey) {
      const el = root.querySelector(`[data-key="${focusKey}"]`);
      if (el && !el.disabled) el.focus();
      focusKey = null;
    }
  };

  draw();
  return root;
}
