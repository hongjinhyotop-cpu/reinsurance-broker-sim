// 라인 구성 보드의 상태 변경(design.md §6.3 M5b 메모): 의견 묻기·제안·반제 수락·제출.
// 응답과 고객 평가의 계산은 negotiation.js(순수 함수)가 하고, 여기서는 AP·인내심·관계도·패널 기록·저장만 한다.
// 상태는 store.commit 안에서만 바꾸고, 인내심·관계도·평판은 effects를 거친다.

import * as store from './store.js';
import { patienceStart, rejectPenalty, gapPenalty } from './difficulty.js';
import { applyEffects } from './effects.js';
import { quoteProposal, evaluateSigned, boardCheck, ratingScore } from './negotiation.js';
import { liveReinsurers, liveReinsurer, liveClient } from './live.js';

const HISTORY_MAX = 10;
const round2 = (x) => Math.round(x * 100) / 100;
// 지분은 1% 눈금에 맞춘다(보드 입력 단위). 용량 때문에 줄어든 지분은 내림해서 상한을 넘지 않게 한다.
const floorShare = (x) => Math.floor(x * 100 + 1e-9) / 100;
// 반제 RC는 재보험사에 유리한 쪽(위)으로 0.1%p 단위 올림. 화면에 보이는 값 그대로 수락해도 하한을 넘는다.
const ceilRc = (x) => Math.ceil(x * 10 - 1e-9) / 10;

// ---------- 조회 ----------

export function findTreaty(data, treatyId) {
  return data.treaties.find((t) => t.id === treatyId) ?? null;
}

// 더 협상할 수 없는 트리티: 고객이 수락했거나(placed), 경쟁 브로커로 옮겨 갔다(lost, M6b).
export function isClosed(t) {
  return t.phase !== 'open';
}

// 인셉션까지 남은 주(1~시즌 창구 길이로 자름). 반제 폭 계산에 쓴다.
export function treatyTiming(data, state, treaty) {
  const season = data.calendar.seasons.find((s) => s.id === treaty.season);
  const toInception = season.inception_turn - state.turn;
  const span = season.inception_turn - season.open_turn;
  return { season, toInception, weeksLeft: Math.min(span, Math.max(1, toInception)) };
}

export function patienceOf(data, state, reId, treatyId) {
  const p = state.entities.reinsurers[reId]?.patience?.[treatyId];
  return p === undefined ? patienceStart(data, state) : p;
}

// 서두름 띠를 띄울지. 반제 폭 규칙(weeks_left/6)이 이미 쓰는 같은 weeksLeft를 보여 줄 뿐이다.
export function isUrgent(data, state, treaty) {
  if (state.treaties[treaty.id] && isClosed(state.treaties[treaty.id])) return false;
  return treatyTiming(data, state, treaty).weeksLeft <= data.config.negotiation.board.urgent_weeks;
}

// 반제가 앞으로 며칠(주)더 유효한지. 1이면 "이번 주까지", 0 이하면 이미 만료.
export function counterWeeksLeft(row, turn) {
  if (row?.status !== 'countered' || row.counter_until === null || row.counter_until === undefined) return null;
  return row.counter_until - turn + 1;
}

export function rowOf(state, treatyId, reId) {
  return state.treaties[treatyId]?.panel.find((r) => r.re === reId) ?? null;
}

// 확정(수락)된 행만의 지분 배분.
export function signedShares(state, treatyId) {
  const out = {};
  for (const r of state.treaties[treatyId].panel) if (r.status === 'accepted') out[r.re] = r.share_signed;
  return out;
}

// 확정 지분만으로 본 제약 점검. 제출 가능 여부는 이 결과로 정한다(§7.4).
export function signedCheck(data, state, treatyId) {
  const treaty = findTreaty(data, treatyId);
  const client = liveClient(state, data.clients.find((c) => c.id === treaty.client));
  const req = client.requirements;
  const ordered = liveReinsurers(state, data.reinsurers).filter((r) => r.capacity_usd_m[treaty.line] > 0 || treaty.expiring.panel.some((m) => m.re === r.id));
  return boardCheck({
    shares: signedShares(state, treatyId),
    members: ordered.map((r) => ({ id: r.id, rating: r.rating, shariahOk: r.shariah_ok, maxSingleShare: r.behavior.max_single_share })),
    caps: {},
    expiringIds: treaty.expiring.panel.map((m) => m.re),
    client: { minRating: req.min_rating, maxSingleShare: req.max_single_share, shariahRequired: req.shariah_required, shariahConventionalCap: req.shariah_conventional_cap },
  }, data.config.negotiation);
}

// ---------- 막힘 사유 ----------

// kind: 'ask' | 'propose' | 'accept_counter'. 막히면 이유(글자), 아니면 null.
export function actionBlockReason(data, state, kind, treatyId, reId, form = null) {
  const treaty = findTreaty(data, treatyId);
  const reinsurer = data.reinsurers.find((r) => r.id === reId);
  if (!treaty || !reinsurer || !state.treaties[treatyId]) return '없는 트리티나 재보험사예요';
  const t = state.treaties[treatyId];
  const cfg = data.config.negotiation.board;
  if (state.ending) return '게임이 끝나 더는 바꿀 수 없어요';
  if (t.phase === 'placed') return '이미 고객이 수락해 확정된 트리티예요';
  if (t.phase === 'lost') return '고객이 경쟁 브로커로 옮겨 가서 더 협상할 수 없어요';
  if (patienceOf(data, state, reId, treatyId) <= 0) return `${reinsurer.name_ko}은(는) 이 트리티에서 더 협상하지 않아요 (인내심이 바닥났어요)`;
  const row = rowOf(state, treatyId, reId);

  if (kind === 'accept_counter') {
    if (row?.status !== 'countered' || !row.last) return '받아들일 반제가 없어요';
    if (counterWeeksLeft(row, state.turn) <= 0) return '반제의 유효 기간이 지났어요. 처음부터 다시 제안해 주세요';
    return null;
  }
  const cost = kind === 'ask' ? cfg.ask_ap : cfg.propose_ap;
  if (!form || !(form.share > 0)) return '먼저 이 재보험사의 지분을 정해 주세요';
  if (state.ap < cost) return `행동 점수가 모자라요 (필요 ${cost}점, 남은 ${state.ap}점)`;
  if (kind === 'ask') {
    if (row && row.status !== 'draft') return '이미 제안한 행이에요. 지분이나 RC를 바꾸면 다시 물을 수 있어요';
    if (row?.last) return '같은 값으로 이미 물어봤어요. 지분이나 RC를 바꾸면 다시 물을 수 있어요';
    return null;
  }
  // 이미 답을 받은 값을 그대로 다시 보내는 것만 막는다(같은 값은 같은 답이라 AP만 날린다).
  const same = row && Math.abs(row.share_req - form.share) < 1e-9 && Math.abs(row.rc_req - form.rc) < 1e-9;
  if (same && row.status === 'accepted') return '이미 수락된 제안이에요';
  if (same && row.status === 'countered') return '반제를 받았어요. 수락하거나 지분·RC를 바꿔 다시 제안해 주세요';
  if (same && row.status === 'rejected') return '같은 제안이에요. 지분이나 RC를 바꿔 주세요';
  return null;
}

// ---------- 행 갱신 ----------

function upsertRow(t, reId, form) {
  let row = t.panel.find((r) => r.re === reId);
  if (!row) {
    row = { re: reId, share_req: 0, share_signed: 0, rc_req: 0, terms: t.terms, status: 'draft', last: null, counter_until: null, cap_known: null, history: [] };
    t.panel.push(row);
  }
  row.share_req = form.share;
  row.rc_req = form.rc;
  row.terms = t.terms;
  return row;
}

// 협상 로그 순서를 지키려고 트리티마다 몇 번째 행동인지(moves)를 센다.
function pushHistory(t, row, turn, entry) {
  t.moves += 1;
  row.history.push({ n: t.moves, turn, ...entry });
  if (row.history.length > HISTORY_MAX) row.history.splice(0, row.history.length - HISTORY_MAX);
}

function quoteFor(data, state, treatyId, reId, form) {
  const treaty = findTreaty(data, treatyId);
  const client = liveClient(state, data.clients.find((c) => c.id === treaty.client));
  const reinsurer = liveReinsurer(state, data.reinsurers.find((r) => r.id === reId));
  const t = state.treaties[treatyId];
  const dyn = state.entities.reinsurers[reId];
  const timing = treatyTiming(data, state, treaty);
  // 번들은 아직 없어서 0이다. 사건이 올린 손해율(lr_extra)과 당해 대손실(big_loss, M6b)은 트리티 상태에서 읽는다.
  return quoteProposal({
    treaty, client, reinsurer, relationship: dyn.relationship, scoutPrice: dyn.scout.price_sensitivity, seed: state.seed,
  }, {
    market: Math.round(state.market.index), p: form.rc, sReq: form.share, weeksLeft: timing.weeksLeft, terms: t.terms,
    structureOption: t.structure_option || null, bundles: 0, lrExtra: t.lr_extra ?? 0, bigLoss: Boolean(t.big_loss), prepQuality: t.prep_quality,
  }, data.config.negotiation);
}

function lastOf(mode, q, form) {
  const r = q.response;
  return {
    mode, kind: r.kind, rc: r.rc, share: r.share, support: r.support, limited: r.limited, reason: r.reason,
    hint: q.hint ? q.hint.level : null, err_pp: q.hint ? q.hint.errPp : null, max_share: q.maxShare, share_req: form.share,
  };
}

function normalizeForm(form) {
  return { share: Math.round(form.share * 100) / 100, rc: round2(form.rc) };
}

// ---------- 의견 묻기 / 제안 ----------

// 의견 묻기: AP만 쓰고 가격 감과 실제 용량 상한을 알아낸다. 관계도·인내심은 그대로다.
export function ask(treatyId, reId, rawForm) {
  const data = store.getData();
  const state = store.getState();
  const form = normalizeForm(rawForm);
  const reason = actionBlockReason(data, state, 'ask', treatyId, reId, form);
  if (reason) return { ok: false, error: reason };
  const q = quoteFor(data, state, treatyId, reId, form);
  const last = lastOf('ask', q, form);
  store.commit((s) => {
    const t = s.treaties[treatyId];
    s.ap -= data.config.negotiation.board.ask_ap;
    const row = upsertRow(t, reId, form);
    row.status = 'draft';
    row.share_signed = 0;
    row.counter_until = null;
    row.last = last;
    row.cap_known = round4(q.maxShare);
    pushHistory(t, row, s.turn, { mode: 'ask', kind: last.kind, rc: form.rc, share: form.share, hint: last.hint });
  });
  store.autosave();
  return { ok: true, last };
}

const round4 = (x) => Math.round(x * 10000) / 10000;

// 제안: AP를 쓰고 수락(지분 확정) / 반제 / 거절을 받는다. 거절이면 인내심·관계도가 깎인다.
export function propose(treatyId, reId, rawForm) {
  const data = store.getData();
  const state = store.getState();
  const form = normalizeForm(rawForm);
  const reason = actionBlockReason(data, state, 'propose', treatyId, reId, form);
  if (reason) return { ok: false, error: reason };
  const q = quoteFor(data, state, treatyId, reId, form);
  const r = q.response;
  const last = lastOf('propose', q, form);

  let status;
  let signed = 0;
  let penalty = null;
  if (r.kind === 'accept') {
    signed = floorShare(r.share);
    if (signed > 0) { status = 'accepted'; last.share = signed; } else { status = 'rejected'; last.kind = 'decline'; last.reason = 'no_capacity'; last.share = 0; }
  } else if (r.kind === 'counter') {
    const cs = floorShare(r.share);
    if (cs > 0) { status = 'countered'; last.rc = ceilRc(r.rc); last.share = cs; } else { status = 'rejected'; last.kind = 'decline'; last.reason = 'no_capacity'; last.share = 0; }
  } else {
    status = 'rejected';
    if (r.kind === 'reject') penalty = rejectPenalty(data, state, r); // 보통이면 협상 계산이 돌려준 값과 같다(design.md §9.5)
  }

  const startPatience = patienceStart(data, state);
  const curPatience = patienceOf(data, state, reId, treatyId);
  const counterValidWeeks = data.config.negotiation.board.counter_valid_weeks;
  store.commit((s) => {
    const t = s.treaties[treatyId];
    s.ap -= data.config.negotiation.board.propose_ap;
    const row = upsertRow(t, reId, form);
    row.status = status;
    row.share_signed = status === 'accepted' ? signed : 0;
    row.counter_until = status === 'countered' ? s.turn + counterValidWeeks - 1 : null;
    row.last = last;
    row.cap_known = round4(q.maxShare);
    pushHistory(t, row, s.turn, { mode: 'propose', kind: last.kind, rc: last.rc ?? form.rc, share: last.share, hint: last.hint });
    if (penalty) {
      applyEffects(s, [
        { op: 'set', target: `reinsurer:${reId}`, field: `patience.${treatyId}`, value: curPatience + penalty.patience, min: 0, max: startPatience },
        { op: 'add', target: `reinsurer:${reId}`, field: 'relationship', value: penalty.relationship },
      ]);
    }
  });
  store.autosave();
  return { ok: true, last, status, penalty };
}

// 반제 수락: 상대가 부른 RC·지분으로 확정한다. AP는 들지 않는다.
export function acceptCounter(treatyId, reId) {
  const data = store.getData();
  const state = store.getState();
  const reason = actionBlockReason(data, state, 'accept_counter', treatyId, reId);
  if (reason) return { ok: false, error: reason };
  const row0 = rowOf(state, treatyId, reId);
  const rc = row0.last.rc;
  const share = row0.last.share;
  store.commit((s) => {
    const t = s.treaties[treatyId];
    const row = rowOf(s, treatyId, reId);
    row.share_req = share;
    row.rc_req = rc;
    row.share_signed = share;
    row.status = 'accepted';
    row.counter_until = null;
    row.last = { ...row.last, mode: 'counter_accept', kind: 'accept', rc, share };
    pushHistory(t, row, s.turn, { mode: 'counter_accept', kind: 'accept', rc, share });
  });
  store.autosave();
  return { ok: true, rc, share };
}

// ---------- 수정 / 조건 변경 ----------

function resetRow(row) {
  row.status = 'draft';
  row.share_signed = 0;
  row.counter_until = null;
  row.last = null;
}

// 주가 넘어간 직후(state.turn은 이미 새 턴) 유효 기간이 끝난 반제를 지운다. 인내심·관계도는 건드리지 않는다.
// 호출하는 쪽(turn.js)이 store.commit 안에서 부른다. 사라진 반제 개수를 돌려준다.
export function expireCounters(state) {
  let n = 0;
  for (const t of Object.values(state.treaties)) {
    for (const row of t.panel) {
      if (row.status !== 'countered' || counterWeeksLeft(row, state.turn) > 0) continue;
      resetRow(row);
      t.moves += 1;
      row.history.push({ n: t.moves, turn: state.turn, mode: 'counter_expired', kind: 'expired', rc: row.rc_req, share: row.share_req });
      if (row.history.length > HISTORY_MAX) row.history.splice(0, row.history.length - HISTORY_MAX);
      n += 1;
    }
  }
  return n;
}

// 지분이나 RC를 바꿨을 때(조용히 저장하고, 화면은 호출한 쪽이 다시 그린다). 제안했던 행은 "미제안"으로 돌아가고 확정 지분도 사라진다. 바뀐 게 없으면 false.
export function editRow(treatyId, reId) {
  const state = store.getState();
  const row = rowOf(state, treatyId, reId);
  if (!row || (row.status === 'draft' && row.last === null)) return false;
  if (isClosed(state.treaties[treatyId])) return false;
  store.commit((s) => { resetRow(rowOf(s, treatyId, reId)); }, { quiet: true });
  return true;
}

// 약관 조건·구조 옵션 변경. 가격 하한이 달라지므로 모든 행이 "미제안"으로 돌아간다.
export function setOptions(treatyId, { terms, structureOption }) {
  const state = store.getState();
  const t = state.treaties[treatyId];
  if (!t || isClosed(t)) return false;
  const nextTerms = terms ?? t.terms;
  const nextOpt = structureOption ?? t.structure_option;
  if (nextTerms === t.terms && nextOpt === t.structure_option) return false;
  store.commit((s) => {
    const tt = s.treaties[treatyId];
    tt.terms = nextTerms;
    tt.structure_option = nextOpt;
    for (const row of tt.panel) { resetRow(row); row.terms = nextTerms; }
  }, { quiet: true });
  return true;
}

// ---------- 고객에게 제출 ----------

export function submitBlockReason(data, state, treatyId) {
  const t = state.treaties[treatyId];
  if (!t) return '없는 트리티예요';
  if (state.ending) return '게임이 끝나 더는 바꿀 수 없어요';
  if (t.phase === 'placed') return '이미 고객이 수락해 확정된 트리티예요';
  if (t.phase === 'lost') return '고객이 경쟁 브로커로 옮겨 갔어요';
  if (state.turn < t.retry_turn) return `고객이 생각할 시간이 필요해요. 턴 ${t.retry_turn}(다음 주)부터 다시 제출할 수 있어요`;
  const check = signedCheck(data, state, treatyId);
  if (!check.canSubmit) return 'blockers';
  return null;
}

// 확정 패널을 고객에게 낸다. 고객 반응(매우 만족/수락/재협상/거부)과 그에 따른 변화를 돌려준다.
export function submit(treatyId) {
  const data = store.getData();
  const state = store.getState();
  const reason = submitBlockReason(data, state, treatyId);
  if (reason) return { ok: false, error: reason === 'blockers' ? '확정된 지분이 100%가 아니거나 고객의 조건에 맞지 않아요' : reason };

  const cfg = data.config.negotiation;
  const treaty = findTreaty(data, treatyId);
  const client = liveClient(state, data.clients.find((c) => c.id === treaty.client));
  const t = state.treaties[treatyId];
  const panel = t.panel.filter((r) => r.status === 'accepted').map((r) => ({ re: r.re, share: r.share_signed, rc: r.rc_req, terms: t.terms }));
  const ev = evaluateSigned({
    treaty, client, clientRelationship: state.entities.clients[client.id].relationship, reinsurers: liveReinsurers(state, data.reinsurers),
  }, { market: Math.round(state.market.index), targetRc: t.target_rc, panel, structureOption: t.structure_option || null }, cfg);
  if (ev.verdict === 'invalid') return { ok: false, error: '고객의 조건에 맞지 않는 패키지예요' };

  const reward = cfg.board.verdict_effects[ev.verdict] ?? null;
  const placed = ev.verdict === 'delighted' || ev.verdict === 'accept';
  store.commit((s) => {
    const tt = s.treaties[treatyId];
    tt.verdict = ev.verdict;
    tt.verdict_reason = ev.reason;
    if (placed) {
      tt.phase = 'placed';
      tt.final_rc = round2(ev.avgRc);
      applyEffects(s, [
        { op: 'add', target: `client:${client.id}`, field: 'relationship', value: reward.client_relationship },
        { op: 'add', target: 'player', field: 'reputation', value: reward.reputation },
      ]);
    } else {
      tt.retry_turn = s.turn + cfg.board.retry_weeks;
      if (ev.verdict === 'renegotiate') tt.renegotiations += 1;
      else tt.rejections += 1;
    }
  });
  store.autosave();
  return { ok: true, verdict: ev.verdict, reason: ev.reason, placed, reward };
}

// ---------- 사건이 규칙을 바꾼 뒤의 정리 (design.md §8.3 ⑤⑥) ----------

// 열린 트리티에서 확정·반제 행의 재보험사가 고객의 최소 등급 아래로 내려갔으면 그 행을 지운다. 지운 { treaty, re } 목록을 돌려준다.
// 인내심·관계도는 건드리지 않는다. 호출하는 쪽이 store.commit 안에서 부른다.
export function voidInvalidRows(data, state) {
  const voided = [];
  for (const treaty of data.treaties) {
    const t = state.treaties[treaty.id];
    if (!t || isClosed(t)) continue;
    const client = liveClient(state, data.clients.find((c) => c.id === treaty.client));
    const minScore = ratingScore(client.requirements.min_rating, data.config.negotiation);
    for (const row of [...t.panel]) {
      if (row.status !== 'accepted' && row.status !== 'countered') continue;
      const re = liveReinsurer(state, data.reinsurers.find((r) => r.id === row.re));
      if (ratingScore(re.rating, data.config.negotiation) >= minScore) continue;
      t.panel.splice(t.panel.indexOf(row), 1);
      t.moves += 1;
      voided.push({ treaty: treaty.id, re: row.re });
    }
  }
  return voided;
}

// 인셉션 턴이 지난 첫 주에 열린 트리티가 있으면 한 번만 공백 벌칙을 준다. 벌칙을 준 트리티 id 목록을 돌려준다.
export function applyGap(data, state) {
  const gap = gapPenalty(data, state);
  const hit = [];
  for (const treaty of data.treaties) {
    const t = state.treaties[treaty.id];
    const season = data.calendar.seasons.find((x) => x.id === treaty.season);
    if (!t || t.phase !== 'open' || t.gap_applied || state.turn !== season.inception_turn + 1) continue;
    t.gap_applied = true;
    state.finance?.fines.push({ turn: state.turn, kind: 'gap', usd_m: 0, ref: treaty.id }); // 성적표가 "공백 N건"을 말하도록 남긴다(§9.1)
    applyEffects(state, [
      { op: 'add', target: `client:${treaty.client}`, field: 'relationship', value: gap.relationship },
      { op: 'add', target: 'player', field: 'reputation', value: gap.reputation },
      { op: 'add', target: 'player', field: 'board_confidence', value: gap.board_confidence },
      { op: 'mail_send', mail: gap.mail },
    ]);
    hit.push(treaty.id);
  }
  return hit;
}

// 안내띠·보드용: 열린 트리티에서 고객의 최소 등급에 못 미치는데 아직 쓰이고 있는 재보험사(지금 값).
// "쓰이고 있다" = 저장된 행이 있거나, 패널이 비어 있고 만기 패널에 있음.
export function ratingShort(data, state, treaty) {
  const t = state.treaties[treaty.id];
  const client = liveClient(state, data.clients.find((c) => c.id === treaty.client));
  const minScore = ratingScore(client.requirements.min_rating, data.config.negotiation);
  const inPlay = new Set(t.panel.filter((r) => r.share_req > 0 || r.share_signed > 0).map((r) => r.re));
  if (t.panel.length === 0) for (const m of treaty.expiring.panel) inPlay.add(m.re);
  return liveReinsurers(state, data.reinsurers)
    .filter((re) => inPlay.has(re.id) && ratingScore(re.rating, data.config.negotiation) < minScore);
}
