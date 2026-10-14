// 라인 구성 보드(design.md §6.3): 트리티 하나를 막대 100%로 보고 재보험사별 지분을 채워 고객에게 낸다.
// 계산은 negotiation.js가, 상태 변경(AP·인내심·관계도·확정 지분·저장)은 placement.js가 하고 여기서는 입력을 모아 그리기만 한다.
// 숨은 속성의 원값은 어디에도 찍지 않는다(가격 감 같은 정성 표현과 스카우트가 허락한 오차 폭만 쓴다).

import * as store from '../store.js';
import { describeTurn } from '../calendar.js';
import { boardCheck, publicShareCap } from '../negotiation.js';
import * as placement from '../placement.js';
import { liveClient, liveReinsurers } from '../live.js';
import { responseHint, verdictHint } from '../guide.js';
import { patienceStart, rejectPenalty, guideDetail } from '../difficulty.js';
import { h, toast, confirmDialog } from './components.js';
import { glossaryLink, resetTermScope } from './glossary_view.js';
import { sealFor, stampEl, reTone, openingEnvelopeEl } from './seals.js';
import { portraitEl, RESPONSE_MOOD, VERDICT_MOOD } from './portraits.js';
import { run as runCeremony, OPEN_MS, isOpening, viewState, takeFresh } from './ceremony.js';
import { trackValue, reducedMotion } from './motion.js';

const TERMS_KO = { strict: '엄격', standard: '표준', broad: '넓음' };
const LINE_KO = { property_energy: '재산·에너지', marine_cargo: '해상화물', takaful_general: '일반 타카풀' };
const REASON_KO = {
  no_appetite: '이 라인은 받지 않는 곳이에요', shariah: '샤리아 기준을 맞출 수 없어요',
  no_capacity: '지금 시장에서는 맡을 수 있는 용량이 없어요',
};
const HINT_KO = { good: '받아줄 분위기예요', near: '거의 근접했어요', far: '눈높이가 많이 멀어요' };
const BLOCK_KO = {
  share_total: '확정(수락)된 지분의 합이 100%가 아니에요',
  single_share: '한 곳당 최대 지분을 넘은 재보험사가 있어요',
  min_rating: '고객의 최소 등급에 못 미치는 재보험사가 있어요',
  shariah_cap: '일반(비샤리아) 재보험사 지분이 샤리아 상한을 넘었어요',
};
const STATUS_KO = { draft: '미제안', accept: '수락', counter: '반제', reject: '거절', stop: '협상 중단' };
const ROW_STATUS = { draft: 'draft', accepted: 'accept', countered: 'counter', rejected: 'reject' };
const VERDICT_KO = { delighted: '매우 만족', accept: '수락', renegotiate: '재협상 요구', reject: '거부' };
const STEP = 5;
const VERDICT_STAMP = { delighted: 'delighted', accept: 'accept', renegotiate: 'renegotiate', reject: 'refuse' };

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const pct = (x, d = 1) => `${x < 0 ? '−' : x > 0 ? '+' : ''}${Math.abs(x).toFixed(d)}%`;
const share = (x) => `${Math.round(x * 1000) / 10}%`;

// 화면이 다시 그려져도 입력이 남도록 모듈에 둔다(아직 제안하지 않은 숫자). 게임이 바뀌면 비운다.
// 제안한 결과·확정 지분·인내심은 세이브(state.treaties)에 있다.
let uiGeneration = -1;
let board = null;
let focusKey = null;

function initBoard(data, state, treatyId) {
  const treaty = data.treaties.find((t) => t.id === treatyId);
  const t = state.treaties[treatyId];
  board = { treatyId, shares: {}, rcs: Object.fromEntries(data.reinsurers.map((r) => [r.id, treaty.target_rc])) };
  for (const row of t.panel) {
    board.shares[row.re] = Math.round((row.status === 'accepted' ? row.share_signed : row.share_req) * 100);
    board.rcs[row.re] = row.rc_req;
  }
}

// 이 트리티 라인을 받는 재보험사들. 만기 패널 순서를 먼저 두어 고스트 막대와 정렬이 맞게 한다.
function boardContext(data, state) {
  const treaty = data.treaties.find((t) => t.id === board.treatyId);
  const client = liveClient(state, data.clients.find((c) => c.id === treaty.client)); // 사건이 덮어쓴 요구 조건(M6b)
  const expiringIds = treaty.expiring.panel.map((m) => m.re);
  const liveRe = liveReinsurers(state, data.reinsurers); // 사건이 바꾼 등급·용량
  const byId = new Map(liveRe.map((r) => [r.id, r]));
  const takes = (r) => r.capacity_usd_m[treaty.line] > 0 || expiringIds.includes(r.id);
  const ordered = [...expiringIds.map((id) => byId.get(id)), ...liveRe.filter((r) => !expiringIds.includes(r.id))].filter(takes);
  const timing = placement.treatyTiming(data, state, treaty);
  return {
    treaty, client, expiringIds, reinsurers: ordered, season: timing.season, t: state.treaties[treaty.id],
    colorOf: new Map(ordered.map((r) => [r.id, reTone(r.id)])), // 재보험사마다 고정된 색(패널 순서와 무관)
    toInception: timing.toInception,
    placed: state.treaties[treaty.id].phase !== 'open', // 확정(placed)이거나 고객 이탈(lost)이면 보드를 잠근다
    lost: state.treaties[treaty.id].phase === 'lost',
  };
}

function capOf(ctx, state, reinsurer) {
  const known = placement.rowOf(state, ctx.treaty.id, reinsurer.id)?.cap_known;
  if (known !== null && known !== undefined) return { value: known, exact: true };
  return {
    value: publicShareCap({
      capacity: reinsurer.capacity_usd_m[ctx.treaty.line], limit: ctx.treaty.limit_usd_m,
      reinsurerMaxShare: reinsurer.behavior.max_single_share, clientMaxShare: ctx.client.requirements.max_single_share,
    }),
    exact: false,
  };
}

function runCheck(data, state, ctx) {
  const req = ctx.client.requirements;
  return boardCheck({
    shares: Object.fromEntries(ctx.reinsurers.map((r) => [r.id, (board.shares[r.id] ?? 0) / 100])),
    members: ctx.reinsurers.map((r) => ({ id: r.id, rating: r.rating, shariahOk: r.shariah_ok, maxSingleShare: r.behavior.max_single_share })),
    caps: Object.fromEntries(ctx.reinsurers.map((r) => [r.id, capOf(ctx, state, r).value])),
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

// 입력칸을 고친 직후 다른 버튼을 누르면 blur(change)가 클릭보다 먼저 와서, 그 사이에 화면을 바꿔 버리면 클릭이 사라진다.
// 그래서 입력칸 편집은 상태만 먼저 고치고(placement.editRow는 조용히 저장) 화면은 클릭이 끝난 뒤에 다시 그린다.
function deferRender(rerender) {
  let done = false;
  const timer = setTimeout(() => run(), 500);
  function run() {
    if (done) return;
    done = true;
    clearTimeout(timer);
    document.removeEventListener('click', run, true);
    setTimeout(rerender, 0);
  }
  document.addEventListener('click', run, true);
}

// 지분·RC를 바꾸면 제안했던 행은 "미제안"으로 돌아간다(확정 지분도 사라진다).
function changeInput(kind, id, value, rerender, { deferred = false } = {}) {
  const t = store.getState().treaties[board.treatyId];
  if (t.phase !== 'open') return;
  const map = kind === 'share' ? board.shares : board.rcs;
  const same = (map[id] ?? (kind === 'share' ? 0 : undefined)) === value;
  if (!same) {
    map[id] = value;
    placement.editRow(board.treatyId, id);
  }
  if (deferred) deferRender(rerender); else rerender();
}

function setShare(id, value, rerender, opts) {
  changeInput('share', id, clamp(Math.round(value), 0, 100), rerender, opts);
}

function formOf(id) {
  return { share: (board.shares[id] ?? 0) / 100, rc: board.rcs[id] };
}

function runAction(fn, key, rerender) {
  focusKey = key;
  const res = fn();
  if (!res.ok) { toast(res.error, 'warn'); rerender(); return null; }
  return res;
}

// 확정(수락)된 행은 입력칸을 확정 값(줄어든 지분·반제 RC)에 맞춘다.
function syncAccepted(state) {
  for (const row of state.treaties[board.treatyId].panel) {
    if (row.status !== 'accepted') continue;
    board.shares[row.re] = Math.round(row.share_signed * 100);
    board.rcs[row.re] = row.rc_req;
  }
}

function onAsk(data, reinsurer, rerender) {
  const id = reinsurer.id;
  const res = runAction(() => placement.ask(board.treatyId, id, formOf(id)), `${id}:ask`, rerender);
  if (res) toast(`${reinsurer.name_ko}에 의견을 물었어요 (행동 점수 −${data.config.negotiation.board.ask_ap})`, 'info');
}

function onPropose(data, reinsurer, rerender) {
  const id = reinsurer.id;
  const cfg = data.config.negotiation.board;
  // 규칙은 곧바로 실행·저장되고, 봉투를 여는 동안 화면과 알림만 결과를 미룬다(ceremony.js, design.md §6.0.3).
  runCeremony(rowKey(id), OPEN_MS.reinsurer, () => runAction(() => placement.propose(board.treatyId, id, formOf(id)), `${id}:propose`, rerender), (res) => {
    const l = res.last;
    if (res.status === 'accepted') { toast(`${reinsurer.name_ko}이(가) 수락했어요 — ${share(l.share)} 확정 (행동 점수 −${cfg.propose_ap})`, 'ok'); }
    else if (res.status === 'countered') toast(`${reinsurer.name_ko}이(가) 반제했어요 — RC ${pct(l.rc)}라면 ${share(l.share)} (행동 점수 −${cfg.propose_ap})`, 'info');
    else if (res.penalty) toast(`${reinsurer.name_ko}이(가) 거절했어요 — 인내심 ${res.penalty.patience}, 관계도 ${res.penalty.relationship} (행동 점수 −${cfg.propose_ap})`, 'warn');
    else toast(`${reinsurer.name_ko}: ${l.reason ? REASON_KO[l.reason] : '거절'} (행동 점수 −${cfg.propose_ap})`, 'warn');
  });
}

// 결과 자리의 이름. 트리티가 달라도 겹치지 않게 트리티 id를 넣는다.
const rowKey = (reId) => `row:${board.treatyId}:${reId}`;
const verdictKey = () => `verdict:${board.treatyId}`;

// 결과를 기다리는 동안 도장 자리에 보이는 열리는 봉투(장식)와 건너뛰기 안내(role="status").
function openingBlock(kind) {
  return h('div', { class: `opening opening-${kind}` },
    openingEnvelopeEl({ size: 84 }),
    h('p', { class: 'opening-text', role: 'status' }, `${kind === 'client' ? '고객이 보낸 봉투를' : '봉투를'} 여는 중이에요 — 아무 키나 누르면 건너뛰어요`));
}

function onAcceptCounter(reinsurer, rerender) {
  const id = reinsurer.id;
  const res = runAction(() => placement.acceptCounter(board.treatyId, id), `${id}:counter`, rerender);
  if (res) { toast(`${reinsurer.name_ko}의 반제를 받아들였어요 — RC ${pct(res.rc)}에 ${share(res.share)} 확정`, 'ok'); }
}

async function onSubmit(data, ctx) {
  const ok = await confirmDialog({
    title: '고객에게 제출할까요?',
    message: `${ctx.client.name_ko}에 확정된 패널을 냅니다. 고객이 수락하면 이 트리티는 확정되고 되돌릴 수 없어요. 재협상이나 거부라면 다음 주부터 다시 낼 수 있어요.`,
    confirmLabel: '제출',
  });
  if (!ok) return;
  focusKey = 'submit';
  runCeremony(verdictKey(), OPEN_MS.client, () => {
    const res = placement.submit(board.treatyId);
    if (!res.ok) { toast(res.error, 'warn'); store.refresh(); return null; }
    return res;
  }, (res) => toast(`고객 반응: ${VERDICT_KO[res.verdict]}`, res.placed ? 'ok' : 'warn'));
}

// ---------- 그리기 ----------

function statusKey(row, stopped) {
  if (row && row.status === 'accepted') return 'accept';
  if (stopped) return 'stop';
  return row ? ROW_STATUS[row.status] : 'draft';
}

// 반제 남은 기한 문구. 1주 남았으면 "이번 주까지".
function counterDeadline(row, turn) {
  const left = placement.counterWeeksLeft(row, turn);
  if (left === null || left <= 0) return null;
  return left === 1 ? '이번 주까지' : `${left}주 남음`;
}

// 인내심 동전(D3): 남은 만큼 금색 동전, 거절당해 쓴 만큼 점선 빈 칸. 줄어든 순간 맨 뒤 동전이 뒤집힌다. 그림은 장식이고 묶음이 "인내심 2점 남음 (3점 중)"으로 읽힌다.
function patienceCoins(left, start, key) {
  const have = Math.min(left, start);
  const prev = trackValue(`patience:${key}`, have);
  const animate = prev !== undefined && prev > have && !reducedMotion();
  const coins = Array.from({ length: start }, (_, i) => h('span', { class: `piece piece-coin${i >= have ? ' is-spent' : ''}${animate && i >= have && i < prev ? ' is-spending' : ''}` }));
  return h('span', { class: 'pieces', role: 'img', 'aria-label': `인내심 ${have}점 남음 (${start}점 중)` }, coins);
}

// 막대 조각 안쪽: 인장(좁으면 생략) + 이름 + 지분. 폭이 좁은 화면에서는 이름을 CSS로 숨기고 숫자만 남긴다(표에 같은 내용이 있다).
function segLabel(r, s) {
  return [s >= 9 ? sealFor(r.id, { size: 20 }) : null, h('span', { class: 'pl-seg-name' }, `${r.name_ko} `), h('span', { class: 'pl-seg-num' }, String(s))];
}

function barTrack(ctx, state, data, check) {
  const nameOf = (id) => data.reinsurers.find((r) => r.id === id).name_ko;
  const ghosts = [];
  let at = 0;
  for (const m of ctx.treaty.expiring.panel) {
    const w = m.share * 100;
    ghosts.push(h('div', {
      class: `pl-seg pl-ghost re-${ctx.colorOf.get(m.re)}`, style: { left: `${at}%`, width: `${w}%` },
      title: `만기 ${nameOf(m.re)} ${share(m.share)}`,
    }, h('span', { class: 'pl-seg-name' }, `만기 ${nameOf(m.re)} `), h('span', { class: 'pl-seg-num' }, String(Math.round(w)))));
    at += w;
  }
  const edits = [];
  at = 0;
  for (const r of ctx.reinsurers) {
    const s = board.shares[r.id] ?? 0;
    if (s <= 0) continue;
    const row = placement.rowOf(state, ctx.treaty.id, r.id);
    const status = statusKey(row, false);
    edits.push(h('div', {
      class: `pl-seg pl-edit pl-st-${status} re-${ctx.colorOf.get(r.id)}`, style: { left: `${Math.min(at, 100)}%`, width: `${Math.max(0, Math.min(s, 100 - at))}%` },
      title: `${r.name_ko} ${s}% — ${STATUS_KO[status]}${counterDeadline(row, state.turn) ? ` (${counterDeadline(row, state.turn)})` : ''}`,
    }, segLabel(r, s)));
    at += s;
  }
  const restPct = Math.round((1 - check.total) * 100);
  if (restPct > 0) {
    edits.push(h('div', { class: 'pl-seg pl-rest', style: { left: `${Math.min(at, 100)}%`, width: `${restPct}%` } }, `남은 ${restPct}%`));
  }
  return h('div', { class: 'pl-bar' },
    h('div', { class: 'pl-gutter', 'aria-hidden': 'true' }, h('span', { class: 'pl-gutter-old' }, '만기'), h('span', { class: 'pl-gutter-now' }, '현재')),
    h('div', { class: 'pl-track', role: 'img', 'aria-label': `지분 합 ${Math.round(check.total * 100)}%, 남은 지분 ${restPct}%. 아래 표에 같은 내용이 있어요.` }, ghosts, edits),
    h('div', { class: 'pl-scale', 'aria-hidden': 'true' }, Array.from({ length: 11 }, (_, i) => h('span', { style: { left: `${i * 10}%` } }, String(i * 10)))),
  );
}

// 마지막 응답 한 줄들. 세이브에 남은 row.last로 그린다.
function describeLast(pen, l) {
  if (l.mode === 'ask') {
    return l.kind === 'decline' ? `의견: 받을 수 없는 곳이에요 — ${REASON_KO[l.reason]}` : `의견: 가격 감 "${HINT_KO[l.hint]}"`;
  }
  if (l.mode === 'counter_accept') return `반제 수락: RC ${pct(l.rc)}에 ${share(l.share)} 확정`;
  if (l.kind === 'decline') return `제안: 거절 — ${REASON_KO[l.reason]}`;
  if (l.kind === 'accept') return `제안: 수락 — RC ${pct(l.rc)}에 ${share(l.share)} 확정${l.support > 0 ? ' (여유가 있어요 — 지분을 늘려 다시 제안해 볼 수 있어요)' : ''}`;
  if (l.kind === 'counter') return `제안: 반제 — RC ${pct(l.rc)}라면 ${share(l.share)}`;
  return `제안: 거절 — 가격이 너무 낮아요 (인내심 ${pen.patience}, 관계도 ${pen.relationship})`;
}

// 힌트 오차의 정확한 %p는 스카우트 값을 거꾸로 알려 주므로 말로만 전한다(숨은 값 보호). 경계는 기존 hint_near_pp를 쓴다.
export function hintErrWords(errPp, cfg) {
  if (errPp >= cfg.hint_near_pp * 2) return '꽤 어긋날 수 있어요';
  if (errPp >= cfg.hint_near_pp) return '조금 어긋날 수 있어요';
  return '거의 맞아요';
}

// 제안 응답을 도장으로 찍는다(수락·반제·거절). 의견 묻기에는 찍지 않는다.
const RESPONSE_STAMP = { accept: 'accept', counter: 'counter', reject: 'decline', decline: 'decline' };

function resultLines(data, row, hint, fresh = false) {
  const l = row?.last;
  if (!l) return null;
  const lines = [];
  lines.push(h('p', { class: `pl-line${l.mode === 'ask' ? '' : ` pl-resp pl-resp-${ROW_STATUS[row.status]}`}`, role: 'status' }, describeLast(rejectPenalty(data, store.getState()), l)));
  // 사유 있는 거절(decline)·의견 묻기에는 목소리를 붙이지 않는다. 사유 문구가 이미 있다.
  if (l.mode === 'propose' && ['accept', 'counter', 'reject'].includes(l.kind)) {
    const re = data.reinsurers.find((r) => r.id === row.re);
    lines.push(h('p', { class: 'pl-line pl-voice' }, portraitEl(re.id, RESPONSE_MOOD[l.kind], { size: 32 }), h('span', {}, `“${re.response_lines[l.kind]}” — ${re.contact.name}`)));
  }
  if (l.mode === 'ask' && l.hint) {
    lines.push(h('p', { class: 'pl-line dim' }, `가격 민감도를 아는 만큼만 정확해요 — 이 감은 ${hintErrWords(l.err_pp, data.config.negotiation)}`));
  }
  if (l.mode === 'propose' && l.limited) lines.push(h('p', { class: 'pl-line' }, `라인이 제한돼요. 요청한 ${share(l.share_req)}보다 적게 맡을 수 있어요.`));
  if (l.mode === 'propose' && l.hint && l.kind !== 'accept') lines.push(h('p', { class: 'pl-line dim' }, `가격 감: ${HINT_KO[l.hint]}`));
  if (hint) lines.push(nextLine(hint));
  const stampKind = l.mode === 'ask' ? null : l.mode === 'counter_accept' ? 'accept' : RESPONSE_STAMP[l.kind];
  const stamp = stampKind ? stampEl(stampKind, { size: stampKind === 'counter' ? 84 : 66 }) : null;
  return stamp ? h('div', { class: 'pl-result' }, h('div', { class: 'pl-result-lines' }, lines), h('div', { class: `pl-result-stamp${fresh ? ' is-fresh' : ''}` }, stamp)) : lines;
}

// 결과 밑 "다음엔 이렇게" 한 줄(design.md §6.3). 이유·목소리와 달리 화면의 어디를 바꿔 볼지를 말한다.
function nextLine(text) {
  return h('p', { class: 'pl-line pl-next' }, h('strong', {}, '다음엔 이렇게 → '), text);
}

function stepButton(label, delta, ariaLabel, reinsurer, rerender, locked) {
  return h('button', {
    type: 'button', class: 'btn btn-step', 'aria-label': ariaLabel, 'data-key': `${reinsurer.id}:${delta > 0 ? 'up' : 'down'}`,
    title: 'Shift를 누르고 누르면 1%씩', disabled: locked ? true : null,
    onclick: (ev) => {
      focusKey = `${reinsurer.id}:${delta > 0 ? 'up' : 'down'}`;
      setShare(reinsurer.id, (board.shares[reinsurer.id] ?? 0) + delta * (ev.shiftKey ? 1 : STEP), rerender);
    },
  }, label);
}

function reinsurerRow(data, state, ctx, check, reinsurer, rerender) {
  const id = reinsurer.id;
  const cfg = data.config.negotiation.board;
  const s = board.shares[id] ?? 0;
  const row = placement.rowOf(state, ctx.treaty.id, id);
  const patience = placement.patienceOf(data, state, id, ctx.treaty.id);
  const stopped = patience <= 0;
  const status = statusKey(row, stopped);
  const cap = capOf(ctx, state, reinsurer);
  const expiringShare = ctx.treaty.expiring.panel.find((m) => m.re === id)?.share ?? 0;
  const locked = ctx.placed;
  const deadline = counterDeadline(row, state.turn);

  const chips = [];
  for (const f of check.flags[id]) chips.push(h('span', { class: 'tag tag-bad' }, flagText(f, cap.exact)));
  if (check.shariah && !reinsurer.shariah_ok && s > 0) chips.push(h('span', { class: 'tag tag-bad' }, '샤리아 상한에 포함되는 일반 재보험사'));
  if (expiringShare === 0 && s > 0) chips.push(h('span', { class: 'tag tag-warn' }, '만기에 없던 곳'));

  const form = formOf(id);
  const askWhy = locked ? null : placement.actionBlockReason(data, state, 'ask', ctx.treaty.id, id, form);
  const proposeWhy = locked ? null : placement.actionBlockReason(data, state, 'propose', ctx.treaty.id, id, form);
  // 행동 점수 부족은 위쪽에서 한 번만 알리고, 행에는 "왜 이 버튼이 막혔는지"가 필요한 경우만 적는다(수락된 행은 상태 칩으로 충분하다).
  let shownWhy = null;
  if (!locked && s > 0) {
    if (stopped) shownWhy = askWhy ?? proposeWhy;
    else if (row?.status === 'countered' || row?.status === 'rejected') shownWhy = proposeWhy;
    else if (row?.status === 'draft' && row.last) shownWhy = askWhy;
  }
  if (shownWhy && shownWhy.startsWith('행동 점수')) shownWhy = null;

  const shareInput = h('input', {
    type: 'number', min: '0', max: '100', step: '1', value: String(s), 'data-key': `${id}:share`, disabled: locked ? true : null,
    id: `pl-share-${id}`, 'aria-label': `${reinsurer.name_ko} 지분(%)`,
    onchange: (ev) => {
      const v = Number(ev.target.value);
      focusKey = `${id}:share`;
      setShare(id, Number.isFinite(v) ? v : 0, rerender, { deferred: true });
    },
    onkeydown: (ev) => {
      if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
      ev.preventDefault();
      focusKey = `${id}:share`;
      setShare(id, (board.shares[id] ?? 0) + (ev.key === 'ArrowRight' ? 1 : -1) * (ev.shiftKey ? 1 : STEP), rerender);
    },
  });

  const rcInput = h('input', {
    type: 'number', min: '-30', max: '40', step: '0.1', value: String(board.rcs[id]), 'data-key': `${id}:rc`, disabled: locked ? true : null,
    id: `pl-rc-${id}`, 'aria-label': `${reinsurer.name_ko}에 낼 RC(%)`,
    onchange: (ev) => {
      const v = Number(ev.target.value);
      focusKey = `${id}:rc`;
      if (!Number.isFinite(v)) { deferRender(rerender); return; }
      changeInput('rc', id, Math.round(clamp(v, -30, 40) * 100) / 100, rerender, { deferred: true });
    },
  });

  return h('div', { class: `pl-row re-${ctx.colorOf.get(id)}` },
    h('div', { class: 'pl-row-head' },
      sealFor(reinsurer.id, { size: 34 }),
      h('strong', { class: 'pl-name' }, reinsurer.name_ko),
      h('span', { class: reinsurer.live?.downgraded ? 'tag tag-bad' : 'tag', title: reinsurer.live?.downgraded ? `사건으로 등급이 ${reinsurer.live.baseRating}에서 내려갔어요` : null },
        reinsurer.live?.downgraded ? `${reinsurer.rating} (강등, 원래 ${reinsurer.live.baseRating})` : reinsurer.rating),
      reinsurer.live?.capacityShrunk ? h('span', { class: 'tag tag-warn', title: '사건으로 일정 기간 인수 용량이 줄었어요' }, '용량 일시 축소') : null,
      reinsurer.shariah_ok ? h('span', { class: 'tag' }, glossaryLink('gl_shariah', { label: '샤리아' })) : null,
      h('span', { class: 'dim pl-cap' }, `${cap.exact ? '확인된 상한' : '이론 상한'} ${cap.exact ? '' : '~'}${share(cap.value)}`),
      expiringShare > 0 ? h('span', { class: 'dim pl-cap' }, `만기 ${share(expiringShare)}`) : null,
      h('span', { class: 'dim pl-cap', title: '거절당할 때마다 줄어들어요. 0이 되면 이 트리티에서는 더 협상하지 않아요.' },
        h('span', { 'aria-hidden': 'true' }, '인내심 '),
        patienceCoins(patience, patienceStart(data, state), `${ctx.treaty.id}:${id}`),
        h('span', { 'aria-hidden': 'true' }, `${Math.min(patience, patienceStart(data, state))}/${patienceStart(data, state)}`)),
      h('span', { class: `pl-status pl-status-${status}` }, STATUS_KO[status]),
      deadline ? h('span', { class: 'pl-deadline', title: '주를 넘기면 이 반제는 사라져요. 인내심은 깎이지 않지만 처음부터 다시 제안해야 해요.' },
        h('span', { 'aria-hidden': 'true' }, '▲ '), `반제 ${deadline}`) : null,
    ),
    h('div', { class: 'pl-row-controls' },
      h('div', { class: 'pl-stepper', role: 'group', 'aria-label': `${reinsurer.name_ko} 지분 조절` },
        stepButton('−5', -1, `${reinsurer.name_ko} 지분 5% 줄이기`, reinsurer, rerender, locked),
        shareInput, h('span', { class: 'pl-unit' }, '%'),
        stepButton('+5', 1, `${reinsurer.name_ko} 지분 5% 늘리기`, reinsurer, rerender, locked)),
      h('div', { class: 'pl-rc' }, h('label', { for: `pl-rc-${id}` }, 'RC'), rcInput, h('span', { class: 'pl-unit' }, '%')), // label 안에는 버튼(용어 링크)을 넣을 수 없어 일반 글자로 둔다. 링크는 위쪽 고객 요구 줄에 있다.
      // 입력칸을 고친 직후엔 화면이 아직 옛 값 기준이라, 값에 따라 달라지는 이유는 막지 않고(aria-disabled) 눌렀을 때 알려 준다.
      h('button', {
        type: 'button', class: 'btn', disabled: locked || stopped ? true : null, 'aria-disabled': askWhy ? 'true' : null, 'data-key': `${id}:ask`,
        title: `가격 감과 맡을 수 있는 한도를 알려 줘요 (행동 점수 ${cfg.ask_ap}점)`,
        onclick: () => onAsk(data, reinsurer, rerender),
      }, `의견 묻기 (${cfg.ask_ap} AP)`),
      h('button', {
        type: 'button', class: 'btn btn-primary', disabled: locked || stopped ? true : null, 'aria-disabled': proposeWhy ? 'true' : null, 'data-key': `${id}:propose`,
        title: `실제로 제안해요 — 수락되면 지분이 확정돼요 (행동 점수 ${cfg.propose_ap}점, 너무 낮으면 거절당해 인내심·관계도가 깎여요)`,
        onclick: () => onPropose(data, reinsurer, rerender),
      }, `제안 보내기 (${cfg.propose_ap} AP)`),
      row?.status === 'countered' && !locked ? h('button', {
        type: 'button', class: 'btn', disabled: stopped ? true : null, 'data-key': `${id}:counter`,
        title: '상대가 부른 RC와 지분으로 확정해요 (행동 점수는 들지 않아요)',
        onclick: () => onAcceptCounter(reinsurer, rerender),
      }, `반제 수락 (무료${deadline ? ` · ${deadline}` : ''})`) : null,
    ),
    shownWhy ? h('p', { class: 'pl-line dim pl-small' }, shownWhy) : null,
    chips.length > 0 ? h('div', { class: 'pl-chips' }, chips) : null,
    isOpening(rowKey(id)) ? openingBlock('reinsurer') : resultLines(data, row, locked ? null : responseHint(row, { signedTotal: ctx.signedTotal, patience, start: patienceStart(data, state), detail: guideDetail(data, state) }, data.config.guide), takeFresh(rowKey(id))),
  );
}

function accessibleTable(ctx, state, check) {
  return h('table', { class: 'table pl-table' },
    h('caption', { class: 'visually-hidden' }, '막대와 같은 내용을 표로 정리했어요'),
    h('thead', {}, h('tr', {}, ['재보험사', '만기 지분', '현재 지분', '상태', '경고'].map((t) => h('th', { scope: 'col' }, t)))),
    h('tbody', {}, ctx.reinsurers.map((r) => {
      const s = board.shares[r.id] ?? 0;
      const exp = ctx.treaty.expiring.panel.find((m) => m.re === r.id)?.share ?? 0;
      const cap = capOf(ctx, state, r);
      const warns = check.flags[r.id].map((f) => flagText(f, cap.exact));
      const row = placement.rowOf(state, ctx.treaty.id, r.id);
      return h('tr', {},
        h('th', { scope: 'row' }, r.name_ko), h('td', {}, share(exp)), h('td', {}, `${s}%`),
        h('td', {}, STATUS_KO[statusKey(row, false)]), h('td', {}, warns.length > 0 ? warns.join(' · ') : '없음'));
    })),
    h('tfoot', {}, h('tr', {}, h('th', { scope: 'row' }, '합계'), h('td', {}, '100%'), h('td', {}, `${Math.round(check.total * 100)}%`), h('td', {}), h('td', {}))));
}

const STRUCTURE_TERM = { xol: ['gl_xol', '초과손해'], qs: ['gl_quota_share', '쿼터쉐어'] };

// 화면 라벨의 용어는 처음 한 번만 링크(RC에는 쉬운 말도 병기). 글자 조각과 링크 버튼이 섞인 배열을 돌려준다.
function requirementLine(ctx) {
  const req = ctx.client.requirements;
  const bits = [
    ['최소 ', glossaryLink('gl_rating', { label: '등급' }), ` ${req.min_rating}`],
    [glossaryLink('gl_single_share'), ` ${share(req.max_single_share)}`],
    ['목표 ', glossaryLink('gl_rate_change', { label: 'RC', gloss: true }), ` ${pct(ctx.t.target_rc)}`],
    [`선호 조건 ${TERMS_KO[req.preferred_terms]}`],
  ];
  if (req.shariah_required) bits.push([glossaryLink('gl_shariah', { label: '샤리아' }), ` 필수(일반 재보험사 합 ${share(req.shariah_conventional_cap ?? 1)} 이하)`]);
  return bits.flatMap((bit, i) => (i === 0 ? [bit] : [' · ', bit]));
}

function timingNodes(ctx) {
  const inception = glossaryLink('gl_inception', { label: '인셉션', gloss: true });
  if (ctx.toInception < 0) return ['이 시즌의 ', inception, '은 이미 지났어요'];
  if (ctx.toInception === 0) return ['이번 주가 ', inception, '이에요'];
  return [inception, `까지 ${ctx.toInception}주`];
}

// 고객이 자기 말투로 하는 이유 한 줄. 이유 종류만 세이브에 있고 문구는 데이터에서 찾는다.
function reasonText(ctx) {
  const key = ctx.t.verdict_reason;
  if (!key || !ctx.t.verdict) return '';
  const side = ctx.t.verdict === 'delighted' || ctx.t.verdict === 'accept' ? 'good' : 'bad';
  const line = ctx.client.verdict_reasons?.[side]?.[key];
  return line ? ` “${line}” — ${ctx.client.profile.contact.name}` : '';
}

function verdictText(data, ctx) {
  const v = ctx.t.verdict;
  const eff = data.config.negotiation.board.verdict_effects;
  if (v === 'delighted') return `고객이 매우 만족해요! 트리티가 확정됐어요 (고객 관계도 +${eff.delighted.client_relationship}, 평판 +${eff.delighted.reputation}).${reasonText(ctx)}`;
  if (v === 'accept') return `고객이 수락했어요. 트리티가 확정됐어요 (고객 관계도 +${eff.accept.client_relationship}).${reasonText(ctx)}`;
  if (v === 'renegotiate') return `고객이 재협상을 요구해요. 패널이나 가격, 조건을 손봐서 턴 ${ctx.t.retry_turn}부터 다시 낼 수 있어요. (지금까지 재협상 ${ctx.t.renegotiations}번)${reasonText(ctx)}`;
  if (v === 'reject') return `고객이 거부했어요. 다른 브로커를 알아볼지도 몰라요. 패널을 크게 다시 짜서 턴 ${ctx.t.retry_turn}부터 다시 낼 수 있어요. (지금까지 거부 ${ctx.t.rejections}번)${reasonText(ctx)}`;
  return null;
}

// 고객 반응 문장 옆에 담당자 초상(D5)과 도장을 붙인다(매우 만족·수락·재협상·거부).
function verdictBlock(textNode, verdict, fresh = false, client = null) {
  const stamp = stampEl(VERDICT_STAMP[verdict], { size: verdict === 'renegotiate' ? 108 : 92 });
  const face = client ? portraitEl(client.id, VERDICT_MOOD[verdict], { size: 40 }) : null;
  const who = face ? h('div', { class: 'pl-who' }, face, h('span', { class: 'pl-who-name' }, client.profile.contact.name)) : null;
  return stamp ? h('div', { class: 'pl-verdict' }, who, textNode, h('div', { class: `pl-result-stamp${fresh ? ' is-fresh' : ''}` }, stamp)) : textNode;
}

// 협상 로그: 모든 행의 기록을 행동 순서대로, 최근 것이 위로.
function logEntries(data, ctx) {
  const nameOf = (id) => data.reinsurers.find((r) => r.id === id).name_ko;
  const entries = [];
  for (const row of ctx.t.panel) {
    for (const e of row.history) {
      let text;
      if (e.mode === 'ask') text = `의견 묻기 — ${e.kind === 'decline' ? '받을 수 없는 곳' : `가격 감 "${HINT_KO[e.hint]}"`} (지분 ${share(e.share)}, RC ${pct(e.rc)})`;
      else if (e.mode === 'counter_expired') text = '반제 만료 — 유효 기간이 지나 처음부터 다시 제안해야 해요';
      else if (e.mode === 'counter_accept') text = `반제 수락 — RC ${pct(e.rc)}에 ${share(e.share)} 확정`;
      else {
        const what = { accept: `수락 — RC ${pct(e.rc)}에 ${share(e.share)} 확정`, counter: `반제 — RC ${pct(e.rc)}라면 ${share(e.share)}`, reject: '거절 — 가격이 너무 낮아요', decline: '거절 — 사유가 있는 거절' }[e.kind];
        text = `제안 — ${what}`;
      }
      entries.push({ n: e.n, text: `턴 ${e.turn} · ${nameOf(row.re)} · ${text}` });
    }
  }
  return entries.sort((a, b) => b.n - a.n).map((e) => e.text);
}

export function renderPlacement() {
  const data = store.getData();
  const state = viewState(store.getState()); // 봉투를 여는 동안은 누르기 직전의 상태로 그려 결과가 미리 새지 않게 한다
  if (uiGeneration !== store.getGeneration() || !board) {
    uiGeneration = store.getGeneration();
    initBoard(data, state, data.treaties[0].id);
  }

  const root = h('div', { class: 'screen screen-wide pl' });
  const cfg = data.config.negotiation.board;
  const draw = () => {
    resetTermScope(); // 다시 그릴 때마다 첫 등장 장부를 새로 시작한다
    syncAccepted(state);
    const ctx = boardContext(data, state);
    const check = runCheck(data, state, ctx);
    const signed = placement.signedCheck(data, state, ctx.treaty.id);
    ctx.signedTotal = signed.total;
    const total = Math.round(check.total * 100);
    const signedTotal = Math.round(signed.total * 100);
    const trt = ctx.treaty;
    const desc = describeTurn(data.calendar, state.turn);
    const locked = ctx.placed;

    const globalChips = [];
    if (check.over) globalChips.push(h('span', { class: 'tag tag-bad' }, `${total - 100}% 초과 — 합이 100%를 넘으면 제출할 수 없어요`));
    if (check.shariah) globalChips.push(h('span', { class: 'tag tag-bad' }, `샤리아 상한 초과 — 일반 재보험사 합 ${share(check.shariah.conventional)} (상한 ${share(check.shariah.cap)})`));
    const turnoverPct = Math.round(check.turnover * 100);
    if (turnoverPct > 0) globalChips.push(h('span', { class: 'tag tag-warn' }, `만기에 없던 재보험사가 ${turnoverPct}%를 가져가요 — 보수적인 고객에게는 부담일 수 있어요`));

    if (ctx.t.structure_option) globalChips.push(h('span', { class: 'tag tag-warn' }, '구조 옵션은 가격을 낮추지만, 보수적인 고객에게는 부담일 수 있어요'));

    const rerender = () => { draw(); };

    const header = h('section', { class: 'card card-plain pl-info', 'aria-label': '트리티 정보' },
      h('div', { class: 'pl-head' },
        h('div', { class: 'field' },
          h('label', { for: 'pl-treaty' }, '트리티'),
          h('select', {
            id: 'pl-treaty', class: 'pl-select',
            onchange: (ev) => { initBoard(data, state, ev.target.value); focusKey = 'treaty'; rerender(); }, 'data-key': 'treaty',
          }, data.treaties.map((t) => h('option', { value: t.id, selected: t.id === board.treatyId ? true : null },
            `${t.name_ko}${state.treaties[t.id].phase === 'placed' ? ' (확정)' : state.treaties[t.id].phase === 'lost' ? ' (고객 이탈)' : ''}`)))),
        h('div', { class: 'field' },
          h('label', { for: 'pl-terms' }, '약관 조건'),
          h('select', {
            id: 'pl-terms', class: 'pl-select', disabled: locked ? true : null,
            onchange: (ev) => { focusKey = 'terms'; placement.setOptions(trt.id, { terms: ev.target.value }); rerender(); }, 'data-key': 'terms',
          }, Object.entries(TERMS_KO).map(([v, t]) => h('option', { value: v, selected: v === ctx.t.terms ? true : null }, t)))),
        h('div', { class: 'field' },
          h('label', { for: 'pl-structure' }, '구조 옵션'),
          h('select', {
            id: 'pl-structure', class: 'pl-select', disabled: locked ? true : null,
            onchange: (ev) => { focusKey = 'structure'; placement.setOptions(trt.id, { structureOption: ev.target.value }); rerender(); }, 'data-key': 'structure',
          }, [h('option', { value: '' }, '없음'), ...trt.structure_options.map((o) => h('option', { value: o.id, selected: o.id === ctx.t.structure_option ? true : null }, o.label_ko))]))),
      locked ? null : h('p', { class: 'dim pl-small' }, '조건이나 구조 옵션을 바꾸면 가격 하한이 달라져서, 이미 받은 수락·반제·거절은 모두 "미제안"으로 돌아가요(쓴 행동 점수는 돌아오지 않아요).'),
      h('p', {},
        h('strong', {}, ctx.client.name_ko), ` · ${LINE_KO[trt.line]} · `, glossaryLink('gl_limit', { label: '한도' }), ` $${trt.limit_usd_m}m (`, glossaryLink('gl_retention', { label: '부담' }), ` $${trt.attachment_usd_m}m 초과) · `, glossaryLink('gl_expiring', { label: '만기' }), ' ', glossaryLink('gl_premium', { label: '보험료' }), ` $${trt.expiring.premium_usd_m}m · `,
        `${ctx.season.label} 시즌 · `, timingNodes(ctx), desc ? ` · 지금 ${desc.quarter.label_ko} ${desc.weekInQuarter}주차` : ''),
      h('p', { class: 'dim' }, '고객 요구: ', requirementLine(ctx)),
      h('p', { class: 'dim pl-small' }, glossaryLink('gl_treaty', { label: '트리티' }), '는 ', glossaryLink(STRUCTURE_TERM[trt.structure][0], { label: STRUCTURE_TERM[trt.structure][1] }), ' 방식이에요.'));

    const boardCard = h('section', { class: 'card card-ledger pl-ledger', 'aria-label': '지분 막대' },
      h('div', { class: 'pl-bar-head' },
        h('h2', {}, '위험 100%를 나눠 채우기'),
        h('div', { class: 'row pl-quick' },
          h('button', {
            type: 'button', class: 'btn', 'data-key': 'load-expiring', disabled: locked ? true : null,
            onclick: () => {
              focusKey = 'load-expiring';
              for (const m of trt.expiring.panel) {
                const v = Math.round(m.share * 100);
                if ((board.shares[m.re] ?? 0) !== v) { board.shares[m.re] = v; placement.editRow(trt.id, m.re); }
              }
              rerender();
            },
          }, '만기 지분 불러오기'),
          h('button', {
            type: 'button', class: 'btn', 'data-key': 'clear', disabled: locked ? true : null,
            onclick: () => {
              focusKey = 'clear';
              for (const r of ctx.reinsurers) if ((board.shares[r.id] ?? 0) !== 0) { board.shares[r.id] = 0; placement.editRow(trt.id, r.id); }
              rerender();
            },
          }, '비우기'))),
      barTrack(ctx, state, data, check),
      h('p', { class: 'pl-legend dim' },
        '위쪽 흐린 띠는 만기 때 ', glossaryLink('gl_panel', { label: '패널' }), '(고스트)이고, 아래쪽이 지금 구성이에요. 점선=아직 제안 전, 색이 꽉 찬 칸=수락(', glossaryLink('gl_signed_line', { label: '확정 지분' }), '), 주황 이중 테두리=',
        glossaryLink('gl_counter_offer', { label: '반제' }), ', 빗금=거절이에요.'),
      h('p', { class: 'pl-sum' },
        h('strong', { class: check.over ? 'pl-over' : '' }, `입력 합계 ${total}% / 100%`),
        check.filled ? ' — 가득 찼어요' : check.over ? '' : ` — 남은 ${Math.round(check.remaining * 100)}%`,
        h('span', { class: 'dim' }, ` · 확정(수락) ${signedTotal}%`)),
      globalChips.length > 0 ? h('div', { class: 'pl-chips pl-warnings', role: 'group', 'aria-label': '경고' }, globalChips) : null,
      locked ? null : h('div', { class: 'notice' },
        h('strong', {}, '제안은 진짜예요. '),
        `의견 묻기는 ${cfg.ask_ap}점, 제안은 ${cfg.propose_ap}점의 `, glossaryLink('gl_ap', { label: '행동 점수' }),
        '를 쓰고, 너무 낮은 가격으로 거절당하면 그 재보험사의 인내심과 관계도가 깎여요. 입력칸에서 ← → 로 5%씩, Shift+← →로 1%씩 조절할 수 있어요.'),
      !locked && state.ap < Math.min(cfg.ask_ap, cfg.propose_ap) ? h('div', { class: 'notice notice-warn', role: 'status' }, '이번 주 행동 점수를 다 썼어요. Continue로 다음 주로 넘어가면 새로 채워져요.') : null);

    const lostBanner = ctx.lost
      ? h('div', { class: 'notice notice-warn', role: 'status' }, h('strong', {}, '고객이 경쟁 브로커로 옮겨 갔어요. '), '이 트리티는 더 협상할 수 없어요.')
      : null;
    const downgradeBanner = !locked && ctx.reinsurers.some((r) => r.live?.downgraded)
      ? h('div', { class: 'notice notice-warn', role: 'status' },
        h('strong', {}, '재보험사 등급이 내려갔어요. '),
        ctx.reinsurers.filter((r) => r.live?.downgraded).map((r) => `${r.name_ko}: ${r.live.baseRating} → ${r.rating}`).join(' · '),
        ' — 고객의 최소 등급에 못 미치는 곳은 패널에서 빼야 제출할 수 있어요.')
      : null;
    const urgent = !locked && placement.isUrgent(data, state, trt)
      ? h('div', { class: 'pl-urgent', role: 'status' },
        h('span', { class: 'pl-urgent-icon', 'aria-hidden': 'true' }, '▲'),
        h('div', {},
          h('strong', {}, '재보험사들이 서두르고 있어요'),
          h('p', {}, timingNodes(ctx), ' — 마감이 가까워서 반제 폭이 좁아졌고, 반제는 받은 주가 지나면 사라져요.')))
      : null;

    const rows = h('section', { class: 'pl-rows', 'aria-label': '재보험사별 지분' },
      ctx.reinsurers.map((r) => reinsurerRow(data, state, ctx, check, r, rerender)));

    // 제출 영역
    const submitWhy = placement.submitBlockReason(data, state, trt.id);
    const blockText = signed.blockers.map((b) => BLOCK_KO[b]);
    const verdict = verdictText(data, ctx);
    const verdictFresh = takeFresh(verdictKey());
    const nextText = verdict ? verdictHint(data, state, ctx.t, { detail: guideDetail(data, state) }) : null;
    const submitChildren = [h('h2', {}, '고객에게 제출'), isOpening(verdictKey()) ? openingBlock('client') : null];
    if (ctx.lost) {
      submitChildren.push(h('p', { class: 'pl-resp pl-resp-reject', role: 'status' }, '고객이 다른 브로커로 옮겨 가서 제출할 수 없어요.'));
    } else if (locked) {
      submitChildren.push(
        verdictBlock(h('p', { class: 'pl-resp pl-resp-accept', role: 'status' }, verdict), ctx.t.verdict, verdictFresh, ctx.client),
        nextText ? nextLine(nextText) : null,
        h('p', {}, `최종 평균 RC ${pct(ctx.t.final_rc, 2)} · 확정 패널 ${ctx.t.panel.filter((r) => r.status === 'accepted').map((r) => `${data.reinsurers.find((x) => x.id === r.re).name_ko} ${share(r.share_signed)}`).join(' · ')}`));
    } else {
      if (verdict) submitChildren.push(verdictBlock(h('p', { class: `pl-resp pl-resp-${ctx.t.verdict === 'renegotiate' ? 'counter' : 'reject'}`, role: 'status' }, verdict), ctx.t.verdict, verdictFresh, ctx.client));
      if (nextText) submitChildren.push(nextLine(nextText));
      submitChildren.push(
        blockText.length > 0
          ? h('ul', { class: 'plain-list', role: 'status' }, blockText.map((t) => h('li', {}, t)))
          : h('p', { role: 'status' }, '확정된 지분이 100%이고 하드 위반도 없어요.'),
        submitWhy && submitWhy !== 'blockers' ? h('p', { class: 'dim', role: 'status' }, submitWhy) : null,
        h('button', {
          type: 'button', class: 'btn btn-submit', disabled: submitWhy ? true : null, 'data-key': 'submit',
          onclick: () => { onSubmit(data, ctx); },
        }, '고객에 패키지 제출'),
        h('p', { class: 'dim pl-small' }, '수락(확정)된 지분만 패키지에 들어가요. 아직 수락받지 못한 행의 지분은 제출 때 빠지니, 막대를 수락으로 100% 채워야 제출할 수 있어요. 용량 부족은 칩으로만 알려 주고 제출을 막지는 않아요.'));
    }
    const submit = h('section', { class: 'card card-ledger pl-submit', 'aria-label': '제출' }, submitChildren);

    const entries = logEntries(data, ctx);
    const log = h('section', { class: 'card card-plain', 'aria-label': '협상 로그' },
      h('h2', {}, '협상 로그'),
      entries.length === 0 ? h('p', { class: 'dim' }, '아직 의견을 묻거나 제안한 기록이 없어요.')
        : h('ul', { class: 'plain-list pl-log' }, entries.slice(0, 30).map((t) => h('li', {}, t))));

    // 서두름 띠처럼 없을 수 있는 조각은 null이다. replaceChildren에 null을 그대로 넘기면 "null"이라는 글자가 들어가므로 걸러서 넘긴다.
    root.replaceChildren(...[
      h('h1', {}, '플레이스먼트 — ', glossaryLink('gl_line', { label: '라인' }), ' 구성 보드'),
      urgent, lostBanner, downgradeBanner, header, boardCard, rows,
      h('section', { class: 'card card-plain', 'aria-label': '표로 보기' }, h('h2', {}, '표로 보기'), accessibleTable(ctx, state, check)),
      h('div', { class: 'pl-bottom' }, submit, log),
    ].filter((node) => node !== null));

    if (focusKey) {
      const el = root.querySelector(`[data-key="${focusKey}"]`);
      if (el && !el.disabled) el.focus();
      focusKey = null;
    }
  };

  draw();
  return root;
}
