// 밸런싱용 자동 플레이어(Node). 브라우저 없이 규칙 모듈을 그대로 불러 한 해를 시드 여러 개로 돌린다.
// 사용: node tests/balance/sim.mjs [시드수] [난이도들: normal,easy] [시나리오들: all,ignore,casual,some,neglect] ['{"경로":값}']
//   다섯째 인자는 config 값을 잠깐 바꿔 보는 덮어쓰기(점 표기. events./reinsurers./treaties./clients. 접두어면 그 데이터).
//   EARLY=1 이면 협상 창구가 열리기 전에도 협상을 시작하는 플레이어로 돌린다(design.md §14-33).
// 게임 규칙은 건드리지 않고 공개 함수(placement·turn)만 호출한다 — 실제 플레이어가 누르는 것과 같은 길이다.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadData } from '../../js/loader.js';
import * as store from '../../js/store.js';
import * as turn from '../../js/turn.js';
import * as PL from '../../js/placement.js';
import * as gl from '../../js/glossary.js';
import { findTemplate } from '../../js/mail.js';
import { liveReinsurers } from '../../js/live.js';
import { playStyleOf } from '../../js/playstyle.js';

const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

export async function boot() {
  const fetchFn = async (url) => {
    const text = await readFile(fileURLToPath(url), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(text), text: async () => text };
  };
  const res = await loadData({ fetchFn });
  if (!res.ok) throw new Error('데이터 오류: ' + JSON.stringify(res.errors.slice(0, 3)));
  store.configure(res.data);
  store.useStorage(mem());
  gl.useCodexStorage(mem());
  return res.data;
}

// ---------- 메일 답하기 ----------
const EFFECT_W = { reputation: 1, compliance: 1.2, board_confidence: 1.5, relationship: 0.5 };
function choiceScore(c) {
  let s = 0;
  for (const e of c.effects ?? []) {
    if (e.op === 'add' && typeof e.value === 'number') s += e.value * (EFFECT_W[e.field] ?? 0);
    if (e.op === 'cash' && typeof e.value === 'number') s += e.value * 5;
  }
  return s;
}
// policy: 'best' = AP 안에서 점수가 가장 높은 선택 / 'default' = 마감 기본 선택 / 'blocking' = 필수 메일만 기본 선택
function answerMails(data, s, policy, reserveAp) {
  for (const m of s.mails) {
    if (m.answered !== null) continue;
    const t = findTemplate(data.mails, m.template);
    if (!t || t.choices.length === 0) continue;
    if (policy === 'blocking' && !t.blocking) continue;
    let pick;
    if (policy === 'engaged') {
      // 적극적인 플레이어: 점수가 되는 한 비용이 가장 큰(=가장 공들이는) 선택을 한다
      const room = s.ap - reserveAp;
      pick = t.choices.filter((c) => c.ap_cost <= Math.max(room, 0)).sort((a, b) => b.ap_cost - a.ap_cost)[0] ?? t.choices.find((c) => c.id === t.default_choice);
    } else if (policy === 'best') {
      const room = s.ap - reserveAp;
      const ok = t.choices.filter((c) => c.ap_cost <= Math.max(room, 0) || c.ap_cost === 0);
      pick = ok.sort((a, b) => choiceScore(b) - choiceScore(a))[0];
    } else pick = t.choices.find((c) => c.id === t.default_choice);
    if (pick) turn.answer(m.id, pick.id);
  }
}

// ---------- 플레이스먼트 ----------
// 한 트리티를 고객이 수락할 때까지 밀어붙인다.
// opts.rcStart: target_rc에 더할 첫 제안 RC(작을수록 고객에게 유리), opts.rcStep: 가격 거절 때 올릴 폭, opts.maxTry: 재보험사당 시도 상한
function applyLevers(data, treatyDef, opts) {
  const s = store.getState();
  const t = s.treaties[treatyDef.id];
  if (!opts.levers || t.panel.some((r) => r.status === 'accepted')) return;
  // 시장이 하드할수록 가격을 낮추는 수단(약관 엄격 / 구조 옵션)을 쓴다. 고객 불만과의 맞교환이다.
  const hot = s.market.index >= opts.levers.market_from;
  const terms = hot ? 'strict' : treatyDef.terms.preferred;
  const opt = hot && opts.levers.structure_lines.includes(treatyDef.line) ? treatyDef.structure_options[0]?.id ?? '' : '';
  PL.setOptions(treatyDef.id, { terms, structureOption: opt });
}

function workTreaty(data, treatyDef, opts) {
  const id = treatyDef.id;
  applyLevers(data, treatyDef, opts);
  const tries = opts.tries ?? (opts.tries = {});
  for (let guard = 0; guard < 60; guard++) {
    const s = store.getState();
    const t = s.treaties[id];
    if (!t || t.phase !== 'open' || s.ending) return;
    const season = data.calendar.seasons.find((x) => x.id === treatyDef.season);
    if (s.turn < season.open_turn && !opts.early) return;
    // 반제는 AP 없이 받는다(상대가 부른 값 그대로)
    for (const row of t.panel) {
      if (row.status === 'countered' && !PL.actionBlockReason(data, s, 'accept_counter', id, row.re)) PL.acceptCounter(id, row.re);
    }
    const s1 = store.getState();
    if (PL.signedCheck(data, s1, id).canSubmit) {
      if (s1.turn < s1.treaties[id].retry_turn) return;
      const r = PL.submit(id);
      if (!r.ok || r.placed) return;
      for (const row of store.getState().treaties[id].panel) if (row.status === 'accepted') PL.editRow(id, row.re);
      opts.cut = (opts.cut ?? 0) - (opts.cutStep ?? 0.5); // 고객이 아쉬워하면 가격을 더 깎아 본다
      for (const k of Object.keys(tries)) delete tries[k];
      return; // 다음 주에 재제출
    }
    if (s1.ap < 1) return;
    const signed = PL.signedShares(s1, id);
    const have = Object.values(signed).reduce((a, b) => a + b, 0);
    const remain = Math.round((1 - have) * 100) / 100;
    const res = liveReinsurers(s1, data.reinsurers);
    const order = [...treatyDef.expiring.panel.map((m) => m.re), ...res.filter((r) => r.capacity_usd_m[treatyDef.line] > 0).map((r) => r.id)];
    let acted = false;
    for (const reId of new Set(order)) {
      const st = store.getState();
      const row = PL.rowOf(st, id, reId);
      if (row?.status === 'accepted') continue;
      if (row?.status === 'rejected' && row.last?.kind === 'decline') continue; // 용량이 없는 상대
      if (PL.patienceOf(data, st, reId, id) <= 0 || (tries[reId] ?? 0) >= (opts.maxTry ?? 6)) continue;
      const re = res.find((r) => r.id === reId);
      if (!re || !(re.capacity_usd_m[treatyDef.line] > 0)) continue;
      const share = Math.floor(Math.min(remain, re.behavior.max_single_share) * 100) / 100;
      if (share < 0.05) continue;
      const base = st.treaties[id].target_rc + (opts.rcStart ?? 0) + (opts.cut ?? 0);
      const step = opts.rcStep ?? 1;
      const round1 = (x) => Math.round(x * 10) / 10;
      if (opts.useAsk) {
        // 묻기(1 AP, 인내심 안 깎임)로 받아 줄 가격을 찾고, 받아 줄 만하면 제안한다
        if (row && row.status === 'draft' && row.last?.mode === 'ask') {
          const k = row.last.kind;
          if (k === 'accept' || k === 'counter') {
            const rc = k === 'counter' ? row.last.rc : row.rc_req;
            const form = { share: Math.min(share, Math.floor((row.last.share ?? share) * 100) / 100), rc: round1(rc) };
            if (!PL.actionBlockReason(data, st, 'propose', id, reId, form)) { tries[reId] = (tries[reId] ?? 0) + 1; PL.propose(id, reId, form); acted = true; break; }
            continue;
          }
          // 거절·용량 없음: 용량 없음은 건너뛰고, 가격 거절이면 RC를 올려 다시 묻는다
          if (row.last.reason === 'no_capacity' || k === 'decline') continue;
          const jump = row.last.hint === 'far' ? step * 2 : step;
          PL.editRow(id, reId);
          const form = { share, rc: round1(row.rc_req + jump) };
          tries[reId] = (tries[reId] ?? 0) + 1;
          if (!PL.actionBlockReason(data, store.getState(), 'ask', id, reId, form)) { PL.ask(id, reId, form); acted = true; break; }
          continue;
        }
        if (row && row.status === 'rejected') PL.editRow(id, reId);
        const form = { share, rc: round1(row && row.status === 'rejected' ? row.rc_req + step : base) };
        tries[reId] = (tries[reId] ?? 0) + 1;
        if (!PL.actionBlockReason(data, store.getState(), 'ask', id, reId, form)) { PL.ask(id, reId, form); acted = true; break; }
        continue;
      }
      let rc = base;
      if (row && row.status === 'rejected' && row.last?.kind === 'reject') rc = row.rc_req + step;
      const form = { share, rc: round1(rc) };
      if (PL.actionBlockReason(data, st, 'propose', id, reId, form)) continue;
      tries[reId] = (tries[reId] ?? 0) + 1;
      PL.propose(id, reId, form);
      acted = true;
      break; // 응답을 보고 다시 판단
    }
    if (!acted) return;
  }
}

function scoutWithLeftover(data, s, ap0) {
  // 남은 AP로 미팅(스카우팅)을 한다 — 잘하는 플레이어가 쓰는 길
  while (store.getState().ap >= 2) {
    const st = store.getState();
    const target = data.reinsurers.map((r) => ({ r, m: st.entities.reinsurers[r.id].meetings })).sort((a, b) => a.m - b.m)[0];
    const topic = ['price_sensitivity', 'conservatism', 'loyalty'][target.m % 3];
    const r = turn.meet('reinsurer', target.r.id, topic);
    if (!r.ok) break;
  }
}

// ---------- 시나리오 ----------
// 시드마다 플레이어의 "솜씨"를 조금씩 다르게 뽑는다(같은 시드면 같은 사람). 값은 [최소, 최대] 범위에서 고른다.
//  all     : 계약 전부 확정 — 세 트리티를 끝까지 밀고, 메일도 공들여 답하고, 약관·구조·미팅을 쓴다(잘하는 사람)
//  some    : 일부만 확정 — 트리티를 1~2개만 챙기고 나머지는 놓친다
//  ignore  : 사건 무시 — 트리티는 챙기지만 사건·일반 메일은 열어도 답하지 않는다(필수 메일만 기본 선택)
//  casual  : 평범 — 트리티는 하되 가끔 한 주를 건너뛰고, 메일은 반쯤만 답하고, 가격을 후하게 부른다
//  neglect : 방치 — Continue만 누르고 필수 메일만 기본 선택
export const SCENARIOS = {
  all: { treaties: [3, 3], engage: [0.85, 1], lazy: [0, 0.05], scout: [0.6, 1], levers: [0.8, 1], ask: 1, rcStart: [-0.5, 0.5], maxTry: [10, 14] },
  some: { treaties: [1, 2], engage: [0.5, 1], lazy: [0, 0.15], scout: [0, 0.6], levers: [0.3, 1], ask: 1, rcStart: [-0.5, 1], maxTry: [8, 12] },
  ignore: { treaties: [3, 3], engage: [0, 0], lazy: [0, 0.1], scout: [0, 0.3], levers: [0.3, 0.8], ask: 1, rcStart: [-0.5, 1], maxTry: [8, 12] },
  casual: { treaties: [2, 3], engage: [0.2, 0.7], lazy: [0.2, 0.5], scout: [0, 0.3], levers: [0, 0.3], ask: 0.4, rcStart: [0.5, 2.5], maxTry: [4, 8] },
  neglect: { treaties: [0, 0], engage: [0, 0], lazy: [0, 0], scout: [0, 0], levers: [0, 0], ask: 0, rcStart: [0, 0], maxTry: [1, 1] },
};

function sampleSkill(scenario, seed) {
  const sc = SCENARIOS[scenario];
  let st = (Math.imul(seed + 7919, 2654435761) ^ 0x9e3779b9) >>> 0;
  const u = () => { st = (Math.imul(st, 1664525) + 1013904223) >>> 0; return st / 4294967296; };
  const pick = ([lo, hi]) => lo + (hi - lo) * u();
  const treaties = Math.round(pick(sc.treaties));
  return {
    treaties, engage: pick(sc.engage), lazy: pick(sc.lazy), scout: pick(sc.scout) > 0.3 ? 1 : 0,
    levers: u() < pick(sc.levers), useAsk: u() < sc.ask, rcStart: pick(sc.rcStart), maxTry: Math.round(pick(sc.maxTry)), roll: u,
    // 어느 트리티를 챙기는지: 일부만이면 무작위로 고른다
    chosen: [0, 1, 2].sort(() => u() - 0.5).slice(0, treaties),
  };
}

export function playYear(data, { seed, difficulty, scenario, hook = null }) {
  const k = sampleSkill(scenario, seed);
  store.newGame({ seed, difficulty });
  turn.startGame();
  const opts = () => ({ rcStart: k.rcStart, rcStep: 1, useAsk: k.useAsk, maxTry: k.maxTry, levers: k.levers ? { market_from: 52, structure_lines: ['marine_cargo'] } : null, early: process.env.EARLY === '1' });
  const treatyOpts = {};
  for (let guard = 0; guard < 120; guard += 1) {
    const s = store.getState();
    if (hook) hook(s);
    if (s.ending) break;
    // 메일: engage 확률로 공들여 답하고, 아니면 필수 메일만 기본 선택
    const policy = k.roll() < k.engage ? 'engaged' : 'blocking';
    answerMails(data, s, policy, 4);
    if (k.treaties > 0 && k.roll() >= k.lazy) {
      for (const idx of k.chosen) {
        const t = data.treaties[idx];
        workTreaty(data, t, treatyOpts[t.id] ?? (treatyOpts[t.id] = opts()));
      }
    }
    if (k.scout && k.roll() < 0.6) scoutWithLeftover(data, store.getState());
    answerMails(data, store.getState(), policy, 0);
    const r = turn.advance();
    if (!r.ok) break;
  }
  const s = store.getState();
  const ending = s.ending;
  const rep = ending?.report;
  return {
    kind: ending?.kind ?? 'none', grade: rep?.grade ?? '-', score: rep?.score ?? 0, turn: s.turn,
    conf: s.player.board_confidence, rep: s.player.reputation, comp: s.player.compliance,
    gaps: s.finance.fines.filter((f) => f.kind === 'gap').length,
    placed: data.treaties.filter((t) => s.treaties[t.id].phase === 'placed').length,
    lost: data.treaties.filter((t) => s.treaties[t.id].phase === 'lost').length,
    brokerage: rep?.facts?.brokerage_usd_m ?? 0, rank: rep?.facts?.rank ?? null,
    cash: s.player.cash_usd_m, firedTurn: ending?.kind === 'fired' ? s.turn : null,
    parts: Object.fromEntries((rep?.parts ?? []).map((x) => [x.id, x.points])),
    seasonDeltas: Object.values(s.seasons).map((x) => x.review?.eval?.delta ?? null),
    style: playStyleOf(data, s).id, // D6 칭호(§9.7) — 문턱값이 한쪽에 몰리지 않는지 본다
  };
}

function summarize(rows) {
  const n = rows.length;
  const cnt = (f) => rows.filter(f).length;
  const grades = {};
  for (const r of rows) { const k = r.kind === 'fired' ? '해고' : r.grade; grades[k] = (grades[k] ?? 0) + 1; }
  const mean = (k) => rows.reduce((a, r) => a + (r[k] ?? 0), 0) / n;
  const deltas = {};
  for (const r of rows) for (const d of r.seasonDeltas) deltas[d] = (deltas[d] ?? 0) + 1;
  const parts = {};
  for (const r of rows) for (const [k, v] of Object.entries(r.parts)) parts[k] = (parts[k] ?? 0) + v / n;
  const ranks = {};
  for (const r of rows) ranks[r.rank] = (ranks[r.rank] ?? 0) + 1;
  const top = rows.map((r) => r.score).sort((a, b) => b - a).slice(0, 5);
  const styles = {};
  for (const r of rows) styles[r.style] = (styles[r.style] ?? 0) + 1;
  return { n, top, parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, +v.toFixed(1)])), ranks, grades, fired: cnt((r) => r.kind === 'fired'), mean_score: +mean('score').toFixed(1), mean_conf: +mean('conf').toFixed(1), mean_rep: +mean('rep').toFixed(1), mean_comp: +mean('comp').toFixed(1), mean_placed: +mean('placed').toFixed(2), mean_gaps: +mean('gaps').toFixed(2), mean_brokerage: +mean('brokerage').toFixed(2), deltas, styles };
}

// 점 표기 경로로 값을 잠시 바꿔 끼운다. 접두어가 없으면 config이고, events./reinsurers./treaties./clients. 로 시작하면 그 데이터다.
// 배열은 번호나 id로 가리킨다: 'events.evt_global_cat_hardening.effects_on_fire.1.mult'
export function applyOverrides(data, overrides) {
  const next = { ...data, config: structuredClone(data.config) };
  const DATA_ROOTS = ['events', 'reinsurers', 'treaties', 'clients'];
  for (const [path, value] of Object.entries(overrides)) {
    const keys = path.split('.');
    let root = 'config';
    if (DATA_ROOTS.includes(keys[0])) { root = keys.shift(); if (next[root] === data[root]) next[root] = structuredClone(data[root]); }
    let o = next[root];
    const step = (cur, k) => (Array.isArray(cur) && !/^\d+$/.test(k) ? cur.find((x) => x.id === k) : cur[k]);
    for (const k of keys.slice(0, -1)) o = step(o, k);
    const last = keys.at(-1);
    if (Array.isArray(o) && !/^\d+$/.test(last)) o[o.findIndex((x) => x.id === last)] = value;
    else o[last] = value;
  }
  store.configure(next);
  return next;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const n = Number(process.argv[2] ?? 60);
  const diffs = (process.argv[3] ?? 'normal,easy').split(',');
  const scens = (process.argv[4] ?? Object.keys(SCENARIOS).join(',')).split(',');
  let data = await boot();
  // 인자 5번째: JSON 문자열로 config 덮어쓰기 (예: '{"negotiation.capacity_k":0.25}')
  if (process.argv[5]) data = applyOverrides(data, JSON.parse(process.argv[5]));
  for (const d of diffs) {
    for (const sc of scens) {
      const rows = [];
      for (let seed = 1; seed <= n; seed++) rows.push(playYear(data, { seed, difficulty: d, scenario: sc }));
      const sm = summarize(rows);
      console.log(`[${d}/${sc}] ` + JSON.stringify(sm));
    }
  }
}
