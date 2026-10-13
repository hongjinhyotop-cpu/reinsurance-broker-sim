// 시즌 중간 리뷰(design.md §6.6, §9.2, M7b). 계산은 순수 함수, 열기·마감은 store.commit 안에서 상태를 고친다.
// 숨은 속성의 원값은 읽지 않는다: 스카우팅 변화는 reveal.stageOf의 "단계" 합으로만 센다.

import { applyEffects } from './effects.js';
import { ATTRS, stageOf } from './reveal.js';

const round1 = (x) => Math.round(x * 10) / 10;
const round4 = (x) => Math.round(x * 1e4) / 1e4;
const round6 = (x) => Math.round(x * 1e6) / 1e6;
const STAGE_ORDER = ['unknown', 'blurred', 'sharp', 'exact'];

export const emptySeasons = () => ({});
const emptyRecord = () => ({ open: null, review: null, seen: false });

export function treatyOfSeason(data, season) {
  return data.treaties.find((t) => t.season === season.id) ?? null;
}

// 그 시즌에 만나는 재보험사: 트리티 라인에 용량이 있는 곳(안내띠의 미팅 횟수와 같은 기준)
function lineReinsurers(data, treaty) {
  return data.reinsurers.filter((r) => r.capacity_usd_m[treaty.line] > 0);
}

// 고객과 라인 재보험사의 속성 단계(0~3) 합. 올라갈수록 많이 알게 된 것이고, 원값은 보이지 않는다.
export function scoutStages(data, state, treaty) {
  const cfg = data.config.scouting;
  let sum = 0;
  const add = (scout) => { for (const a of ATTRS) sum += STAGE_ORDER.indexOf(stageOf(scout[a], cfg)); };
  add(state.entities.clients[treaty.client].scout);
  for (const r of lineReinsurers(data, treaty)) add(state.entities.reinsurers[r.id].scout);
  return sum;
}

function avgRelationship(data, state, treaty) {
  const list = lineReinsurers(data, treaty);
  if (list.length === 0) return 0;
  return round1(list.reduce((s, r) => s + state.entities.reinsurers[r.id].relationship, 0) / list.length);
}

// 만기 기준 브로커리지(RC 0일 때): 시즌 평가와 "만기 대비 %"의 기준
export function expectedBrokerage(treaty) {
  return round6(treaty.expiring.premium_usd_m * treaty.brokerage_rate);
}

function openRecord(data, state, treaty, codexCount) {
  return {
    turn: state.turn,
    rel_client: round1(state.entities.clients[treaty.client].relationship),
    rel_re_avg: avgRelationship(data, state, treaty),
    scout_stages: scoutStages(data, state, treaty),
    codex_count: codexCount,
  };
}

// 이사회 평가: 확정 브로커리지 / 만기 기준 비율의 단계, 아직 확정 전(open)·이탈(lost)은 고정값.
export function evalSeason(treaty, treatyState, booked, cfg) {
  if (treatyState.phase === 'lost') return { kind: 'lost', ratio: null, delta: cfg.lost };
  if (treatyState.phase !== 'placed' || !booked) return { kind: 'open', ratio: null, delta: cfg.open };
  const ratio = round4(booked.brokerage_usd_m / expectedBrokerage(treaty));
  const tier = cfg.tiers.find((t) => ratio >= t.min_ratio) ?? cfg.tiers.at(-1);
  return { kind: 'tier', ratio, delta: tier.delta };
}

export function evalMailKey(ev) {
  if (ev.kind === 'lost') return 'lost';
  if (ev.kind === 'open') return 'pending';
  return ev.delta > 0 ? 'up' : ev.delta < 0 ? 'down' : 'flat';
}

// 마감 리뷰 기록(순수). 출발 기록이 없으면(옛 세이브) 변화량은 null이다.
export function buildReview(data, state, season, codexCount) {
  const treaty = treatyOfSeason(data, season);
  const ts = state.treaties[treaty.id];
  const open = state.seasons[season.id]?.open ?? null;
  const ev = evalSeason(treaty, ts, state.finance.booked[treaty.id], data.config.board.season_eval);
  return {
    turn: state.turn,
    status: ts.phase,
    rel_client_delta: open ? round1(state.entities.clients[treaty.client].relationship - open.rel_client) : null,
    rel_re_delta: open ? round1(avgRelationship(data, state, treaty) - open.rel_re_avg) : null,
    scout_gain: open ? Math.max(0, scoutStages(data, state, treaty) - open.scout_stages) : null,
    codex_gain: open ? Math.max(0, codexCount - open.codex_count) : null,
    eval: ev,
    board_before: state.player.board_confidence,
    board_after: state.player.board_confidence,
  };
}

// ---------- 상태를 바꾸는 열기·마감 (store.commit 안에서 부른다) ----------

// 창구가 열리는 턴에 그 시즌의 출발 기록을 남긴다. 이미 있으면 건드리지 않는다.
export function openSeasons(data, state, codexCount) {
  const opened = [];
  for (const season of data.calendar.seasons) {
    const treaty = treatyOfSeason(data, season);
    if (!treaty || season.open_turn !== state.turn) continue;
    const rec = state.seasons[season.id] ?? (state.seasons[season.id] = emptyRecord());
    if (rec.open) continue;
    rec.open = openRecord(data, state, treaty, codexCount);
    opened.push(season.id);
  }
  return opened;
}

// 시즌이 끝난 주에 리뷰를 굳히고 이사회 신뢰를 ± 한 뒤 의장 편지를 예약한다. 마감한 시즌 id 목록을 돌려준다.
export function closeSeasons(data, state, codexCount) {
  const cfg = data.config.board.season_eval;
  const closed = [];
  for (const season of data.calendar.seasons) {
    if (!treatyOfSeason(data, season) || state.turn !== season.inception_turn + cfg.end_offset_weeks) continue;
    const rec = state.seasons[season.id] ?? (state.seasons[season.id] = emptyRecord());
    if (rec.review) continue;
    const review = buildReview(data, state, season, codexCount);
    applyEffects(state, [{ op: 'add', target: 'player', field: 'board_confidence', value: review.eval.delta }]);
    review.board_after = state.player.board_confidence;
    rec.review = review;
    state.scheduled.push({ turn: state.turn, kind: 'mail', ref: cfg.mails[evalMailKey(review.eval)] });
    closed.push(season.id);
  }
  return closed;
}

// 시즌 리뷰 화면을 그렸으면 만들어진 리뷰를 모두 "봄"으로 바꾼다(안내띠 3a).
export function markSeen(state) {
  let changed = false;
  for (const rec of Object.values(state.seasons)) {
    if (rec.review && !rec.seen) { rec.seen = true; changed = true; }
  }
  return changed;
}

// ---------- 읽기 전용 질의 ----------

export function unseenReview(data, state) {
  for (const season of data.calendar.seasons) {
    const rec = state.seasons?.[season.id];
    if (rec?.review && !rec.seen) return { season, review: rec.review };
  }
  return null;
}

// 마감 리뷰가 있는 가장 최근 시즌
export function latestReview(data, state) {
  for (let i = data.calendar.seasons.length - 1; i >= 0; i -= 1) {
    const season = data.calendar.seasons[i];
    const rec = state.seasons?.[season.id];
    if (rec?.review) return { season, review: rec.review };
  }
  return null;
}

// 시즌별 표·카드 한 줄. 결과는 지금 상태를 읽고, 이사회 평가와 변화량은 굳은 기록(없으면 null)을 쓴다.
export function seasonRows(data, state) {
  return data.calendar.seasons.flatMap((season) => {
    const treaty = treatyOfSeason(data, season);
    if (!treaty) return [];
    const ts = state.treaties[treaty.id];
    const booked = state.finance.booked[treaty.id] ?? null;
    const expected = expectedBrokerage(treaty);
    const rec = state.seasons?.[season.id] ?? null;
    return [{
      season, treaty, client: data.clients.find((c) => c.id === treaty.client),
      phase: ts.phase, gap: ts.gap_applied, final_rc: ts.final_rc, verdict: ts.verdict,
      panel: ts.panel.filter((r) => r.share_signed > 0).map((r) => ({ re: r.re, name_ko: data.reinsurers.find((x) => x.id === r.re)?.name_ko ?? r.re, share: r.share_signed })),
      booked, expected, ratio: booked ? round4(booked.brokerage_usd_m / expected) : null,
      review: rec?.review ?? null,
    }];
  });
}

// 분기별 순위 추이 표 행: 내 리그 수익(확정 브로커리지 누계 + 평판 효과 누계)과 가장 강한 라이벌.
export function rankTrend(data, state) {
  return state.standings.quarters.map((snap) => {
    const mine = round4(snap.player.ytd + (snap.player.flow_ytd ?? 0));
    let best = null;
    for (const def of data.brokers) {
      const r = snap.rivals[def.id];
      if (r && (!best || r.ytd > best.ytd)) best = { name_ko: def.name_ko, ytd: r.ytd };
    }
    return {
      id: snap.id, rank: snap.rank, mine, flow_q: snap.player.flow_q ?? 0,
      rival_name_ko: best?.name_ko ?? '—', rival_ytd: best?.ytd ?? 0, gap: round4(mine - (best?.ytd ?? 0)),
    };
  });
}
