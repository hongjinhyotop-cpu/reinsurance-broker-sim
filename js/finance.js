// 재무·이사회 평가(design.md §9). 계산은 순수 함수, 정산·마감은 store.commit 안에서 상태를 고친다.
// 현금 증감은 effects의 cash 연산자를 거치고, 난수는 쓰지 않는다(라이벌 난수는 rivals.js가 따로 만든다).

import { applyEffects } from './effects.js';
import { gapCutCfg, firedBelow as firedBelowOf } from './difficulty.js';
import { buildSnapshot, tableRows, tauntRoll, pickTaunt } from './rivals.js';

const round6 = (x) => Math.round(x * 1e6) / 1e6;
const round1 = (x) => Math.round(x * 10) / 10;

export const emptyFinance = () => ({ booked: {}, overhead_usd_m: 0, fines: [], negative_quarters: 0, quarters: [] });
export const emptyStandings = () => ({ quarters: [] });

export const PART_IDS = ['revenue', 'retention', 'rank', 'compliance', 'reputation'];

// ---------- 순수 계산 ----------

export function finalPremium(treaty, finalRc) {
  return round6(treaty.expiring.premium_usd_m * (1 + finalRc / 100));
}

export function brokerageOf(treaty, finalRc) {
  return round6(finalPremium(treaty, finalRc) * treaty.brokerage_rate);
}

// 공백 뒤 늦게 확정한 만큼 깎는 수수료 비율(0~max). 주당 비율에 늦은 주 수를 곱하고 상한을 둔다.
export function gapCut(weeks, cfg) {
  return Math.max(0, Math.min(cfg.max, cfg.per_week * weeks));
}

const inRange = (turn, from, to) => turn >= from && turn <= to;

// 확정한 브로커리지 합(발생주의). from~to 턴에 확정한 것만 더한다.
export function bookedTotal(finance, from = -Infinity, to = Infinity) {
  return round6(Object.values(finance.booked).filter((b) => inRange(b.turn, from, to)).reduce((s, b) => s + b.brokerage_usd_m, 0));
}

// 공백 때문에 깎인 수수료 합(M7b)
export function gapCutTotal(finance) {
  return round6(Object.values(finance.booked).reduce((s, b) => s + (b.cut_usd_m ?? 0), 0));
}

export function placedPremiumTotal(finance, to = Infinity) {
  return round6(Object.values(finance.booked).filter((b) => b.turn <= to).reduce((s, b) => s + b.premium_usd_m, 0));
}

// 확정했지만 아직 입금되지 않은 돈
export function receivableTotal(finance) {
  return round6(Object.values(finance.booked).filter((b) => !b.paid).reduce((s, b) => s + b.brokerage_usd_m, 0));
}

export function finesTotal(finance, from = -Infinity, to = Infinity) {
  return round6(finance.fines.filter((f) => f.kind === 'fine' && inRange(f.turn, from, to)).reduce((s, f) => s + f.usd_m, 0));
}

export const gapCount = (finance) => finance.fines.filter((f) => f.kind === 'gap').length;

// 경쟁 브로커로 옮겨 가지(lost) 않은 고객 수
export function keptClients(data, state) {
  return data.clients.filter((c) => {
    const treaty = data.treaties.find((t) => t.client === c.id);
    return !(treaty && state.treaties[treaty.id]?.phase === 'lost');
  }).length;
}

export function tierOf(fraction, reportCfg) {
  if (fraction >= reportCfg.tier_good) return 'good';
  if (fraction < reportCfg.tier_weak) return 'weak';
  return 'mid';
}

export function gradeOf(score, grades) {
  return (grades.find((g) => score >= g.min) ?? grades[grades.length - 1]).grade;
}

export function rankMailKey(rank, prevRank, board) {
  const bucket = rank <= board.rank_buckets.top_max ? 'top' : rank <= board.targets.rank_max ? 'mid' : 'low';
  const dir = prevRank !== null && rank > prevRank ? 'down' : 'up';
  return `${bucket}_${dir}`;
}

// 마지막 분기 결산의 순위(없으면 null)
export function latestSnapshot(state) {
  return state.standings.quarters.at(-1) ?? null;
}

// 지금 상태로 계산한 성적표(순수). 연말·해고 때 저장하고, 연말 전에는 "중간 점검" 미리보기로 쓴다.
export function computeReport(data, state) {
  const board = data.config.board;
  const f = state.finance;
  const snap = latestSnapshot(state);
  const rankOf_ = snap ? snap.rank : null;
  const brokerage = bookedTotal(f);
  const kept = keptClients(data, state);
  const clientsTotal = data.clients.length;
  const w = board.score.weights;

  const fractions = {
    revenue: Math.min(board.score.revenue_cap, brokerage / board.targets.brokerage_usd_m),
    retention: clientsTotal > 0 ? kept / clientsTotal : 1,
    rank: rankOf_ === null ? board.score.rank_unknown_fraction : (board.score.rank_fraction[rankOf_ - 1] ?? 0),
    compliance: Math.min(1, Math.max(0, state.player.compliance / 100)),
    reputation: Math.min(1, Math.max(0, state.player.reputation / 100)),
  };
  const parts = PART_IDS.map((id) => ({ id, fraction: round6(fractions[id]), max: w[id], points: round1(fractions[id] * w[id]) }));
  const score = round1(parts.reduce((s, p) => s + p.fraction * p.max, 0));

  let strong = parts[0];
  for (const p of parts) if (p.fraction > strong.fraction) strong = p;
  let weak = parts[parts.length - 1]; // 모두 같으면 서로 다른 항목이 되도록 뒤에서부터 본다
  for (let i = parts.length - 1; i >= 0; i -= 1) if (parts[i].fraction < weak.fraction) weak = parts[i];

  return {
    score, grade: gradeOf(score, board.grades), partial: true, parts,
    facts: {
      brokerage_usd_m: brokerage, target_usd_m: board.targets.brokerage_usd_m,
      rank: rankOf_, rank_of: data.brokers.length + 1, rank_max: board.targets.rank_max,
      clients_kept: kept, clients_total: clientsTotal,
      compliance: Math.round(state.player.compliance), compliance_min: board.targets.compliance_min,
      reputation: Math.round(state.player.reputation),
      gaps: gapCount(f), fines_usd_m: finesTotal(f), overhead_usd_m: round6(f.overhead_usd_m),
      cash_usd_m: state.player.cash_usd_m, receivable_usd_m: receivableTotal(f), placed_premium_usd_m: placedPremiumTotal(f),
      gap_cut_usd_m: gapCutTotal(f),
    },
    strong: strong.id, weak: weak.id,
    confidence_before: state.player.board_confidence, confidence_after: state.player.board_confidence,
  };
}

// ---------- 상태를 바꾸는 정산·마감 (store.commit 안에서 부른다) ----------

// 매 주 전환의 재무 정산(§2.5 7단계): 브로커리지 확정 → 입금 → 고정비. 새로 확정한 트리티 id를 돌려준다.
export function settleWeek(data, state) {
  const cfg = data.config.finance;
  const f = state.finance;
  const booked = [];
  for (const treaty of data.treaties) {
    const t = state.treaties[treaty.id];
    const season = data.calendar.seasons.find((s) => s.id === treaty.season);
    if (!t || t.phase !== 'placed' || f.booked[treaty.id] || state.turn < season.inception_turn) continue;
    const rc = t.final_rc ?? 0;
    const gapWeeks = t.gap_applied ? Math.max(0, state.turn - 1 - season.inception_turn) : 0; // 공백 뒤 늦게 확정한 주 수(§9.1)
    const cut = gapCut(gapWeeks, gapCutCfg(data, state));
    const full = brokerageOf(treaty, rc);
    const brokerage = round6(full * (1 - cut));
    f.booked[treaty.id] = {
      turn: state.turn, premium_usd_m: finalPremium(treaty, rc), brokerage_usd_m: brokerage,
      due_turn: state.turn + cfg.cash_delay_weeks, paid: false, gap_weeks: gapWeeks, cut_usd_m: round6(full - brokerage),
    };
    booked.push(treaty.id);
  }
  for (const b of Object.values(f.booked)) {
    if (b.paid || b.due_turn > state.turn) continue;
    applyEffects(state, [{ op: 'cash', value: b.brokerage_usd_m }]);
    b.paid = true;
  }
  if (state.turn >= 2) {
    const weekly = data.config.game.weekly_overhead_usd_m;
    applyEffects(state, [{ op: 'cash', value: -weekly }]);
    f.overhead_usd_m = round6(f.overhead_usd_m + weekly);
  }
  return booked;
}

function sendMail(state, ref) {
  state.scheduled.push({ turn: state.turn, kind: 'mail', ref });
}

// 분기 마지막 턴이면 분기 결산 → 현금 규칙 → 라이벌 갱신·순위 메일(§2.5 9단계). 닫은 분기 id(없으면 null)를 돌려준다.
export function closeQuarterIfEnd(data, state) {
  const quarter = data.calendar.quarters.find((q) => q.to === state.turn);
  if (!quarter) return null;
  const f = state.finance;
  const board = data.config.board;

  const previousOverhead = f.quarters.reduce((s, x) => s + x.overhead_usd_m, 0);
  f.quarters.push({
    id: quarter.id,
    brokerage_usd_m: bookedTotal(f, quarter.from, quarter.to),
    overhead_usd_m: round6(f.overhead_usd_m - previousOverhead),
    fines_usd_m: finesTotal(f, quarter.from, quarter.to),
    cash_usd_m: state.player.cash_usd_m,
  });

  if (state.player.cash_usd_m < 0) f.negative_quarters += 1;
  else f.negative_quarters = 0;
  if (f.negative_quarters === 1) {
    sendMail(state, board.mails.cash_warning);
  } else if (f.negative_quarters >= 2) {
    applyEffects(state, [{ op: 'add', target: 'player', field: 'board_confidence', value: data.config.finance.negative_cash_penalty }]);
    sendMail(state, board.mails.cash_penalty);
  }

  const rivalQuarters = data.config.rivals.quarters;
  if (rivalQuarters.includes(quarter.id)) {
    const prev = latestSnapshot(state);
    const snap = buildSnapshot({
      defs: data.brokers, prev, quarter, quarterIndex: rivalQuarters.indexOf(quarter.id), seed: state.seed,
      marketIndex: state.market.index, cfg: data.config.rivals, reputation: state.player.reputation,
      player: {
        q: bookedTotal(f, quarter.from, quarter.to), ytd: bookedTotal(f, -Infinity, quarter.to),
        placed_premium_usd_m: placedPremiumTotal(f, quarter.to), clients: keptClients(data, state),
      },
    });
    state.standings.quarters.push(snap);
    // 평판 효과를 처음 크게 누린 분기에는 의장이 한 번만 알려 준다(§9.3).
    const flow = data.config.rivals.reputation_flow;
    if (snap.player.flow_q >= flow.notice_min_usd_m && !state.player.flags.includes('rep_flow_noted')) {
      applyEffects(state, [{ op: 'flag_set', flag: 'rep_flow_noted' }]);
      sendMail(state, flow.mail);
    }
    // 마지막 분기는 순위 메일 대신 연말 성적표 메일이 간다.
    if (state.turn < data.calendar.turns) {
      sendMail(state, board.mails.rank[rankMailKey(snap.rank, snap.prev_rank, board)]);
      sendTaunt(data, state, snap, prev, rivalQuarters.indexOf(quarter.id));
    }
  }
  return quarter.id;
}

// 라이벌 도발 메일(§9.3 D6): 바로 위·아래 라이벌이 가끔 쪽지 한 통. 효과·선택지가 없고 게임 난수 흐름을 쓰지 않는다.
function sendTaunt(data, state, snap, prev, quarterIndex) {
  const cfg = data.config.rivals.taunt;
  if (!cfg) return;
  const rows = tableRows(data.brokers, snap, { firm: state.player.firm, reputation: state.player.reputation, prev });
  const pick = pickTaunt(rows, tauntRoll(state.seed, quarterIndex), cfg.prob);
  const ref = pick ? cfg.mails[pick.rival]?.[pick.side] : null;
  if (ref) sendMail(state, ref);
}

// 연말(턴 58)이거나 이사회 신뢰가 해고선 아래면 게임을 끝낸다(§9.2). 끝났으면 ending을, 아니면 null을 돌려준다.
export function checkEnding(data, state) {
  if (state.ending) return null;
  const board = data.config.board;
  const yearEnd = state.turn >= data.calendar.turns;
  const firedBelow = firedBelowOf(data, state);
  if (!yearEnd && state.player.board_confidence >= firedBelow) return null;

  const report = computeReport(data, state);
  if (yearEnd) {
    report.partial = false;
    applyEffects(state, [{ op: 'add', target: 'player', field: 'board_confidence', value: board.grade_delta[report.grade] }]);
    report.confidence_after = state.player.board_confidence;
  }
  const fired = state.player.board_confidence < firedBelow;
  state.ending = { kind: fired ? 'fired' : 'year_end', turn: state.turn, report };
  sendMail(state, fired ? board.mails.fired : board.mails.grade[report.grade]);
  return state.ending;
}
