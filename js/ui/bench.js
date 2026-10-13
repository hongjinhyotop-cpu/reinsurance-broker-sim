// 협상 시험대(임시 화면, design.md §6.8): M4의 계산을 손으로 확인한다. 세이브·행동 점수를 바꾸지 않는다.
// 계산은 negotiation.js가 하고 여기서는 입력을 모아 결과를 그리기만 한다. M5에서 라인 구성 보드로 대체된다.

import * as store from '../store.js';
import { quoteProposal, evaluateExpiringPanel } from '../negotiation.js';
import { h } from './components.js';

const TERMS_KO = { strict: '엄격', standard: '표준', broad: '넓음' };
const REASON_KO = { no_appetite: '이 라인은 받지 않는 곳이에요', shariah: '샤리아 기준을 맞출 수 없어요' };
const HINT_KO = { good: '받아줄 분위기예요', near: '거의 근접했어요', far: '눈높이가 많이 멀어요' };
const VERDICT_KO = { delighted: '매우 만족', accept: '수락', renegotiate: '재협상 요구', reject: '거부', invalid: '제출할 수 없음' };
const FAIL_KO = {
  share_total: '지분 합이 100%가 아니에요', min_rating: '고객의 최소 등급에 못 미치는 재보험사가 있어요',
  single_share: '한 곳당 최대 지분을 넘었어요', shariah_cap: '샤리아 상한을 넘었어요',
};
const PART_KO = {
  market: 'A_market 시장', line: 'A_line 라인', loss: 'A_loss 손해율', cons: 'A_cons 불확실성', terms: 'A_terms 조건',
  rel: '−A_rel 관계', bundle: '−A_bundle 번들', structure: '구조 옵션', quote: '경쟁 견적',
};
const SCORE_KO = { price: 'PS 가격', security: 'SS 담보', continuity: 'CS 연속성', terms: 'TS 조건', service: 'VS 서비스·관계' };

const pct = (x, d = 2) => `${x < 0 ? '−' : x > 0 ? '+' : ''}${Math.abs(x).toFixed(d)}%`;
const share = (x) => `${Math.round(x * 1000) / 10}%`;

// 화면이 다시 그려져도 입력이 남도록 모듈에 둔다. 게임이 바뀌면 비운다.
let uiGeneration = -1;
let form = null;      // 제안 입력
let pkg = null;       // 패키지(고객 평가) 입력
let showMath = false; // 계산 근거 보기

function initForm(data, state, treatyId = data.treaties[0].id) {
  const treaty = data.treaties.find((t) => t.id === treatyId);
  const expiring = treaty.expiring.panel[0];
  form = {
    treatyId, reinsurerId: expiring.re, market: Math.round(state.market.index), p: treaty.target_rc,
    sReq: Math.round(expiring.share * 100), weeksLeft: 4, terms: treaty.terms.preferred, structureOption: '',
    bundles: 0, lrExtra: 0, bigLoss: false, prepQuality: 0,
  };
  pkg = { rc: treaty.target_rc };
}

// 설계 §7.7의 두 예시. 관계도·스카우트는 지금 게임 상태를 쓰므로, 새 게임 직후가 아니면 숫자가 조금 달라질 수 있다.
const PRESETS = {
  normal: { label: '정상 갱신 예시 (설계 §7.7)', form: { treatyId: 'trt_jurong_property_xl', reinsurerId: 're_alpenglow', market: 42, p: -3, sReq: 35, weeksLeft: 4, terms: 'standard', structureOption: '', bundles: 0, lrExtra: 0, bigLoss: false, prepQuality: 0 }, rc: -1 },
  hard: { label: '하드마켓 예시 (설계 §7.7)', form: { treatyId: 'trt_jurong_property_xl', reinsurerId: 're_alpenglow', market: 70, p: 17, sReq: 35, weeksLeft: 4, terms: 'standard', structureOption: '', bundles: 0, lrExtra: 40.6, bigLoss: false, prepQuality: 0 }, rc: 17 },
};

function numberField(label, key, obj, rerun, { min, max, step = 1, hint = null } = {}) {
  const id = `bench-${key}`;
  return h('div', { class: 'field' },
    h('label', { for: id }, label),
    h('input', {
      id, type: 'number', min, max, step, value: String(obj[key]),
      onchange: (ev) => {
        const v = Number(ev.target.value);
        if (Number.isFinite(v)) obj[key] = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
        ev.target.value = String(obj[key]);
        rerun();
      },
    }),
    hint ? h('small', { class: 'dim' }, hint) : null);
}

function selectField(label, key, obj, options, rerun, onPick = null) {
  const id = `bench-${key}`;
  return h('div', { class: 'field' },
    h('label', { for: id }, label),
    h('select', {
      id, class: 'bench-select',
      onchange: (ev) => { obj[key] = ev.target.value; if (onPick) onPick(); rerun(); },
    }, options.map(([value, text]) => h('option', { value, selected: value === obj[key] ? true : null }, text))));
}

function mathTable(rows) {
  return h('table', { class: 'table bench-math' },
    h('tbody', {}, rows.map(([k, v]) => h('tr', {}, h('th', { scope: 'row' }, k), h('td', {}, v)))));
}

function renderProposalResult(data, state) {
  const cfg = data.config.negotiation;
  const treaty = data.treaties.find((t) => t.id === form.treatyId);
  const client = data.clients.find((c) => c.id === treaty.client);
  const reinsurer = data.reinsurers.find((r) => r.id === form.reinsurerId);
  const dyn = state.entities.reinsurers[reinsurer.id];
  const q = quoteProposal({
    treaty, client, reinsurer, relationship: dyn.relationship, scoutPrice: dyn.scout.price_sensitivity, seed: state.seed,
  }, { ...form, sReq: form.sReq / 100, structureOption: form.structureOption || null }, cfg);
  const r = q.response;

  let headline;
  if (r.kind === 'decline') headline = `거절 — ${REASON_KO[r.reason]}`;
  else if (r.kind === 'accept') headline = `수락 — RC ${pct(r.rc)}에 ${share(r.share)}를 맡겠대요${r.support > 0 ? ` (여유가 있어 ${share(r.support)}p를 더 얹을 수 있대요)` : ''}`;
  else if (r.kind === 'counter') headline = `반제 — RC ${pct(r.rc)}라면 ${share(r.share)}를 맡겠대요`;
  else headline = '거절 — 가격이 너무 낮아요 (인내심 −1, 관계 −2)';

  const lines = [h('p', { class: `bench-headline bench-${r.kind}`, role: 'status' }, headline)];
  if (r.limited) lines.push(h('p', { class: 'notice notice-warn' }, `라인이 제한돼요. 요청한 ${form.sReq}%보다 적은 ${share(q.maxShare)}까지만 가능해요.`));
  if (q.hint) {
    lines.push(h('p', {}, `가격 감: ${HINT_KO[q.hint.level]}`,
      h('small', { class: 'dim' }, ` (가격 민감도를 아는 만큼만 정확해요 — 판단 오차 약 ±${q.hint.errPp.toFixed(1)}%p)`)));
  }
  if (showMath) {
    const rows = Object.entries(q.floor.parts).map(([k, v]) => [PART_KO[k], pct(v)]);
    rows.push(['가격 하한 F', pct(q.floor.floor)], ['불확실성 N', q.floor.N.toFixed(2)], ['가용 지분 상한', share(q.maxShare)],
      ['시드 노이즈 반영', pct(q.noise * cfg.noise_pp)], ['격차 gap (제안 − 하한)', r.gap === null ? '—' : pct(r.gap)]);
    lines.push(h('details', { open: true }, h('summary', {}, '계산 근거 (시험대 전용)'), mathTable(rows)));
  }
  return lines;
}

function renderPackageResult(data, state) {
  const cfg = data.config.negotiation;
  const treaty = data.treaties.find((t) => t.id === form.treatyId);
  const client = data.clients.find((c) => c.id === treaty.client);
  const ev = evaluateExpiringPanel({
    treaty, client, clientRelationship: state.entities.clients[client.id].relationship, reinsurers: data.reinsurers,
  }, { market: form.market, rc: pkg.rc, terms: form.terms }, cfg);

  const lines = [h('p', { class: `bench-headline bench-v-${ev.verdict}`, role: 'status' }, `고객 반응: ${VERDICT_KO[ev.verdict]}`)];
  if (ev.hardFails.length > 0) lines.push(h('ul', { class: 'plain-list' }, ev.hardFails.map((f) => h('li', {}, FAIL_KO[f]))));
  lines.push(h('p', { class: 'dim' }, `만기 패널(${treaty.expiring.panel.map((m) => `${data.reinsurers.find((r) => r.id === m.re).name_ko} ${share(m.share)}`).join(' · ')})을 모두 RC ${pct(pkg.rc)}, 조건 ${TERMS_KO[form.terms]}으로 냈다고 가정해요.`));
  if (showMath) {
    const rows = Object.entries(ev.scores).map(([k, v]) => [`${SCORE_KO[k]} (가중치 ${(ev.weights[k] * 100).toFixed(1)}%)`, v.toFixed(1)]);
    rows.push(['평균 RC', pct(ev.avgRc)], ['고객 공정가 기준', pct(ev.reference)], ['턴오버', share(ev.turnover)],
      ['종합 U', ev.U.toFixed(1)], ['수락 임계값 θ_c', ev.theta.toFixed(1)]);
    lines.push(h('details', { open: true }, h('summary', {}, '계산 근거 (시험대 전용)'), mathTable(rows)));
  }
  return lines;
}

export function renderBench() {
  const data = store.getData();
  const state = store.getState();
  if (uiGeneration !== store.getGeneration() || !form) {
    uiGeneration = store.getGeneration();
    initForm(data, state);
    showMath = false;
  }
  const treaty = () => data.treaties.find((t) => t.id === form.treatyId);

  const out = h('div', { class: 'bench-out' });
  const rerun = () => {
    out.replaceChildren(
      h('section', { class: 'card', 'aria-label': '재보험사 응답' }, h('h2', {}, '① 재보험사의 응답'), renderProposalResult(data, state)),
      h('section', { class: 'card', 'aria-label': '고객 평가' }, h('h2', {}, '② 고객의 평가'), renderPackageResult(data, state)),
    );
  };

  const formBox = h('div', {});
  const drawForm = () => {
    formBox.replaceChildren(
      h('div', { class: 'bench-form' },
        selectField('트리티', 'treatyId', form, data.treaties.map((t) => [t.id, t.name_ko]), rerun, () => {
          const keep = { market: form.market, treatyId: form.treatyId };
          initForm(data, state, form.treatyId); form.market = keep.market; drawForm();
        }),
        selectField('재보험사', 'reinsurerId', form, data.reinsurers.map((r) => [r.id, `${r.name_ko} (${r.rating})`]), rerun),
        numberField('시장 지수 (0~100)', 'market', form, rerun, { min: 0, max: 100, hint: '높을수록 하드마켓(재보험사 우위)' }),
        numberField('제안 RC (%)', 'p', form, rerun, { min: -30, max: 40, step: 0.1, hint: '낮을수록 고객에게 유리해요' }),
        numberField('요청 지분 (%)', 'sReq', form, rerun, { min: 1, max: 100 }),
        numberField('마감까지 남은 주', 'weeksLeft', form, rerun, { min: 1, max: 6 }),
        selectField('약관 조건', 'terms', form, Object.entries(TERMS_KO), rerun),
        selectField('구조 옵션', 'structureOption', form, [['', '없음'], ...treaty().structure_options.map((o) => [o.id, o.label_ko])], rerun),
        numberField('번들 약속 수', 'bundles', form, rerun, { min: 0, max: 5, hint: '다른 트리티 지분 약속' }),
        numberField('자료 준비도 (0~100)', 'prepQuality', form, rerun, { min: 0, max: 100 }),
        numberField('사고로 더해진 손해율 (%p)', 'lrExtra', form, rerun, { min: 0, max: 80, step: 0.1 }),
        h('div', { class: 'field' },
          h('label', { for: 'bench-bigLoss' }, '당해 대손실'),
          h('input', { id: 'bench-bigLoss', type: 'checkbox', checked: form.bigLoss ? true : null, onchange: (ev) => { form.bigLoss = ev.target.checked; rerun(); } })),
        numberField('② 패키지 평균 RC (%)', 'rc', pkg, rerun, { min: -30, max: 40, step: 0.1, hint: '만기 패널에 모두 이 가격으로 냈다고 가정' }),
      ));
  };

  const presetButtons = Object.values(PRESETS).map((preset) => h('button', {
    type: 'button', class: 'btn',
    onclick: () => { Object.assign(form, preset.form); pkg.rc = preset.rc; drawForm(); rerun(); },
  }, preset.label));

  drawForm();
  rerun();
  return h('div', { class: 'screen screen-wide' },
    h('h1', {}, '협상 시험대'),
    h('div', { class: 'notice notice-warn' },
      h('strong', {}, '임시 화면이에요. '),
      '재보험사가 어떻게 답하고 고객이 어떻게 평가하는지 계산을 눌러 보는 곳이에요. 저장, 행동 점수, 관계도는 바뀌지 않아요. 라인 구성 보드(M5)가 생기면 사라져요.'),
    h('div', { class: 'row' }, presetButtons),
    h('p', { class: 'dim' }, '관계도와 스카우트 정보는 지금 게임 상태를 따라가요. 새 게임 직후가 아니면, 그리고 재보험사 응답에 섞이는 작은 노이즈(±0.3%p) 때문에 설계 문서 예시와 숫자가 조금 다를 수 있어요.'),
    h('div', { class: 'bench' }, h('section', { class: 'card', 'aria-label': '입력' }, h('h2', {}, '입력'), formBox,
      h('label', { class: 'bench-math-toggle' },
        h('input', { type: 'checkbox', checked: showMath ? true : null, onchange: (ev) => { showMath = ev.target.checked; rerun(); } }),
        ' 계산 근거 보기 (시험대 전용 — 실제 게임에서는 숨은 성격이 드러나므로 보여 주지 않아요)')),
    out));
}
