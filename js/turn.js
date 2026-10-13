// 턴 파이프라인(design.md §2.5): 주 전환 → 마감 처리 → 이벤트 판정(M6a) → 시장 갱신(M6a) → 예약 메일 도착 → 자동 저장.
// 재무·관계 감쇠 같은 단계는 이후 마일스톤에서 끼워 넣는다. 상태 변경은 store.commit 안에서만 한다.

import * as store from './store.js';
import { applyEffects } from './effects.js';
import { describeTurn, turnLabel, isQuarterStart } from './calendar.js';
import { describeMarket, driftIndex, gaussian, marketBand } from './market.js';
import { windowStarters, pickFireTurn, canFire, pickOutcome, pickClientProb, pickClientStillValid } from './events.js';
import { expireCounters, voidInvalidRows, applyGap } from './placement.js';
import { TOPICS, applyMeeting, relationshipAfterMeeting, newlyUnlocked } from './scouting.js';
import {
  fillText, findTemplate, deadlineTurn, scheduledFor, nextMailId, needsReply, choiceBlockReason,
} from './mail.js';

// ---------- 메일 본문용 치환 변수 ----------

export function mailVars(data, state) {
  const desc = describeTurn(data.calendar, state.turn);
  return {
    'market.label': describeMarket(state.market.index, state.player.market_intel, data.config.market).label_ko,
    'turn.label': desc ? turnLabel(desc) : `턴 ${state.turn}`,
    'player.firm': state.player.firm,
  };
}

// ---------- 메일 도착 ----------

function pushMail(state, template) {
  const id = nextMailId(state.mails);
  state.mails.push({
    id,
    template: template.id,
    turn: state.turn,
    deadline_turn: deadlineTurn(template, state.turn),
    read: false,
    answered: null,
    auto: false,
    thread: `t_${id.slice(2)}`,
  });
  return id;
}

// 이번 턴에 도착해야 할 메일을 넣는다: 고정 턴 메일 + 예약 큐(mail_send). 같은 템플릿이 같은 턴에 두 번 들어가지 않는다.
function deliverDue(data, state) {
  const arrived = [];
  const due = scheduledFor(data.mails, state.turn);
  const queued = state.scheduled.filter((q) => q.kind === 'mail' && q.turn <= state.turn);
  state.scheduled = state.scheduled.filter((q) => !(q.kind === 'mail' && q.turn <= state.turn));
  for (const t of [...due, ...queued.map((q) => findTemplate(data.mails, q.ref)).filter(Boolean)]) {
    const already = state.mails.some((m) => m.template === t.id && m.turn === state.turn);
    if (!already) arrived.push(pushMail(state, t));
  }
  return arrived;
}

// ---------- 이벤트 판정 (design.md §8.1) ----------

function eventView(data, state) {
  const relationshipOf = (target) => {
    const m = /^(client|reinsurer):(.+)$/.exec(target);
    if (!m) return null;
    return (m[1] === 'client' ? state.entities.clients : state.entities.reinsurers)[m[2]]?.relationship ?? null;
  };
  return {
    turn: state.turn, quarterId: describeTurn(data.calendar, state.turn).quarter.id, marketIndex: state.market.index,
    compliance: state.player.compliance, flags: state.player.flags, relationshipOf,
  };
}

// 발생 처리: 기록 → 즉시 효과 → 결과 분기(M6b) → 메일 도착 예약(같은 턴) → 후속 예약.
// client: 고객 고르기 이벤트(BOR)의 대상 고객. forceFollowups: 시험대에서 후속 예약의 확률을 건너뛴다.
export function fireEvent(data, state, event, { client = null, forceFollowups = false } = {}) {
  if (!state.fired_events.includes(event.id)) state.fired_events.push(event.id);
  applyEffects(state, event.effects_on_fire);
  const mailIds = [];
  if (event.mail) mailIds.push(event.mail);
  if (client && event.mails_by_client?.[client]) mailIds.push(event.mails_by_client[client]);
  const outcome = pickOutcome(event.outcomes, eventView(data, state));
  if (outcome) {
    applyEffects(state, outcome.effects);
    if (outcome.mail) mailIds.push(outcome.mail);
  }
  for (const ref of mailIds) state.scheduled.push({ turn: state.turn, kind: 'mail', ref });
  for (const f of event.followups ?? []) {
    const item = { turn: state.turn + f.delay_weeks, kind: 'event', ref: f.event };
    if (f.prob !== undefined && !forceFollowups) item.prob = f.prob;
    state.scheduled.push(item);
  }
}

// 이번 턴에 터진 이벤트 id 목록. 창구가 열리는 이벤트는 난수 둘(발생 여부·발생 턴)을 항상 쓴다.
function runEvents(data, state) {
  const events = data.events ?? [];
  const byId = new Map(events.map((e) => [e.id, e]));
  for (const ev of windowStarters(events, state.turn)) {
    const spec = ev.trigger.pick_client;
    if (spec) {
      // 고객 고르기: 데이터 순서대로 고객마다 난수 둘을 항상 쓴다(§8.3 ④).
      for (const c of data.clients) {
        const dyn = state.entities.clients[c.id];
        const hit = store.random() < pickClientProb(spec, { loyalty: c.hidden.loyalty, relationship: dyn.relationship });
        const pick = store.random();
        if (hit) state.scheduled.push({ turn: pickFireTurn(ev.trigger.window, pick), kind: 'event', ref: ev.id, client: c.id });
      }
      continue;
    }
    const hit = store.random() < ev.trigger.prob;
    const pick = store.random();
    if (hit) state.scheduled.push({ turn: pickFireTurn(ev.trigger.window, pick), kind: 'event', ref: ev.id });
  }
  const fired = [];
  // 발생 효과가 지연 0주 이벤트를 또 예약할 수 있어, 꺼낼 게 없을 때까지 반복한다(데이터 실수로 끝없이 돌지 않게 상한을 둔다).
  for (let guard = 0; guard < 50; guard += 1) {
    const due = state.scheduled.filter((q) => q.kind === 'event' && q.turn <= state.turn);
    if (due.length === 0) break;
    state.scheduled = state.scheduled.filter((q) => !(q.kind === 'event' && q.turn <= state.turn));
    for (const q of due) {
      const ev = byId.get(q.ref);
      if (!ev) continue;
      if (q.prob !== undefined && !(store.random() < q.prob)) continue;
      if (!canFire(ev, state.fired_events, eventView(data, state))) continue;
      if (q.client && !pickClientStillValid(ev.trigger.pick_client, state.entities.clients[q.client].relationship)) continue;
      fireEvent(data, state, ev, { client: q.client ?? null });
      fired.push(ev.id);
    }
  }
  return fired;
}

// ---------- 시장 갱신 (design.md §3) ----------

// 분기가 시작되는 턴에 드리프트를 한 번 적용하고, 분위기 묶음이 바뀌었으면 시장 리포트 메일을 예약한다.
function stepMarket(data, state) {
  const cfg = data.config.market;
  if (isQuarterStart(data.calendar, state.turn)) {
    const z = gaussian(store.random(), store.random());
    state.market.index = driftIndex(state.market.index, z, cfg.cycle);
  }
  const band = marketBand(state.market.index, cfg.family);
  if (band !== state.market.band) {
    state.market.band = band;
    state.scheduled.push({ turn: state.turn, kind: 'mail', ref: cfg.family.mails[band] });
  }
}

// ---------- 답하기 ----------

export function answerBlockReason(data, state, mailId, choiceId) {
  const mail = state.mails.find((m) => m.id === mailId);
  if (!mail) return '없는 메일이에요';
  if (mail.answered !== null) return '이미 답한 메일이에요';
  const choice = findTemplate(data.mails, mail.template)?.choices.find((c) => c.id === choiceId);
  if (!choice) return '없는 선택지예요';
  return choiceBlockReason(choice, state.ap);
}

export function answer(mailId, choiceId) {
  const data = store.getData();
  const state = store.getState();
  const reason = answerBlockReason(data, state, mailId, choiceId);
  if (reason) return { ok: false, error: reason };
  store.commit((s) => {
    const mail = s.mails.find((m) => m.id === mailId);
    const choice = findTemplate(data.mails, mail.template).choices.find((c) => c.id === choiceId);
    s.ap -= choice.ap_cost;
    mail.answered = choiceId;
    mail.read = true;
    applyEffects(s, choice.effects);
    voidInvalidRows(data, s);
    deliverDue(data, s); // mail_send(지연 0)가 바로 도착하도록
  });
  store.autosave();
  return { ok: true };
}

export function markRead(mailId) {
  const mail = store.getState().mails.find((m) => m.id === mailId);
  if (!mail || mail.read) return;
  store.commit(() => { mail.read = true; });
}

// ---------- 미팅 (design.md §2.4, §4.3) ----------

function findEntity(data, kind, id) {
  const list = kind === 'client' ? data.clients : kind === 'reinsurer' ? data.reinsurers : null;
  return list?.find((e) => e.id === id) ?? null;
}

export function meetBlockReason(data, state, kind, id, topic) {
  if (!findEntity(data, kind, id)) return '없는 상대예요';
  if (!TOPICS.includes(topic)) return '없는 미팅 주제예요';
  const cost = data.config.scouting.meeting_ap;
  if (state.ap < cost) return `행동 점수가 모자라요 (필요 ${cost}점, 남은 ${state.ap}점)`;
  return null;
}

// 미팅: AP를 쓰고 스카우트 값·관계도를 올린다. 새로 읽을 수 있게 된 단서 메모를 돌려준다.
export function meet(kind, id, topic) {
  const data = store.getData();
  const state = store.getState();
  const reason = meetBlockReason(data, state, kind, id, topic);
  if (reason) return { ok: false, error: reason };
  const cfg = data.config.scouting;
  const def = findEntity(data, kind, id);
  const entity = (kind === 'client' ? state.entities.clients : state.entities.reinsurers)[id];
  const before = { ...entity.scout };
  let after;
  store.commit((s) => {
    const e = (kind === 'client' ? s.entities.clients : s.entities.reinsurers)[id];
    s.ap -= cfg.meeting_ap;
    e.scout = applyMeeting(e.scout, topic, cfg);
    e.relationship = relationshipAfterMeeting(e.relationship, cfg);
    e.meetings += 1;
    after = e.scout;
  });
  store.autosave();
  return { ok: true, before, after: { ...after }, newNotes: newlyUnlocked(def.scout_notes, before, after) };
}

// ---------- 게임 시작 / Continue ----------

// 새 게임 직후, 시작 턴에 도착해야 할 메일을 넣는다.
export function startGame() {
  const data = store.getData();
  store.commit((s) => { deliverDue(data, s); });
}

function unansweredMails(data, state) {
  return state.mails
    .map((m) => ({ mail: m, template: findTemplate(data.mails, m.template) }))
    .filter(({ mail, template }) => template && needsReply(mail, template));
}

// Continue를 누를 수 있는지. 못 누르면 이유를 알려 준다.
export function continueBlockReason(data, state) {
  if (state.turn >= data.calendar.turns) return '마지막 주예요. 연말 리뷰는 아직 만들지 않았어요';
  const blocker = unansweredMails(data, state).find(({ mail, template }) => template.blocking && mail.deadline_turn !== null && mail.deadline_turn <= state.turn);
  if (blocker) return `이번 주가 마감인 필수 메일에 먼저 답해 주세요: "${blocker.template.subject_ko}"`;
  return null;
}

// 한 주를 넘긴다(§2.5 1~2단계 + 마감 처리). 새로 도착한 메일 id와 자동 처리된 메일 id를 돌려준다.
function stepWeek(data, state) {
  state.turn += 1;
  state.ap = data.config.game.ap_per_week;

  // 마감을 넘긴 메일은 기본 선택으로 자동 처리한다(AP·막힘 검사 없음 — 로더가 default_choice의 ap_cost 0을 보장).
  const autoResolved = [];
  for (const { mail, template } of unansweredMails(data, state)) {
    if (mail.deadline_turn === null || mail.deadline_turn >= state.turn) continue;
    const choice = template.choices.find((c) => c.id === template.default_choice);
    mail.answered = choice.id;
    mail.auto = true;
    applyEffects(state, choice.effects);
    autoResolved.push(mail.id);
  }

  state.modifiers = state.modifiers.filter((m) => state.turn < m.until_turn); // 기간이 끝난 보정을 지운다(§2.5 1단계)
  const expiredCounters = expireCounters(state); // 반제는 그 주만 유효하다(§6.3 마감 압박)
  const fired = runEvents(data, state);
  const voided = voidInvalidRows(data, state); // 등급 강등 등으로 무효가 된 확정 지분(§8.3 ⑥)
  const gaps = applyGap(data, state); // 인셉션이 지났는데 열린 트리티(§8.3 ⑤)
  stepMarket(data, state);
  const arrived = deliverDue(data, state);
  return { arrived, autoResolved, expiredCounters, fired, voided, gaps };
}

// 멈춰야 하는 이유(없으면 null). 설계 §2.1: 새 메일, 마감 임박, 시즌 단계 전환.
export function stopReason(data, state, arrived, fired = [], gaps = []) {
  if (fired.length > 0) return 'event';
  if (gaps.length > 0) return 'mail';
  if (arrived.length > 0) return 'mail';
  const warn = data.config.turn.deadline_warning_weeks;
  const near = unansweredMails(data, state).some(({ mail }) => mail.deadline_turn !== null && mail.deadline_turn - state.turn <= warn);
  if (near) return 'deadline';
  if (data.calendar.seasons.some((s) => s.open_turn === state.turn || s.inception_turn === state.turn)) return 'phase';
  if (state.turn >= data.calendar.turns) return 'end';
  return null;
}

// Continue: 멈출 이유가 생길 때까지 주를 넘긴다. 결과 요약을 돌려준다.
export function advance() {
  const data = store.getData();
  const reason = continueBlockReason(data, store.getState());
  if (reason) return { ok: false, error: reason };

  const summary = { ok: true, fromTurn: store.getState().turn, arrived: [], autoResolved: [], expiredCounters: 0, events: [], voided: [], gaps: [], stop: null };
  store.commit((s) => {
    // 끝없는 반복 방지: 전체 턴 수를 넘길 수 없다.
    for (let guard = 0; guard < data.calendar.turns; guard += 1) {
      const step = stepWeek(data, s);
      summary.arrived.push(...step.arrived);
      summary.autoResolved.push(...step.autoResolved);
      summary.expiredCounters += step.expiredCounters;
      summary.events.push(...step.fired);
      summary.voided.push(...step.voided);
      summary.gaps.push(...step.gaps);
      summary.stop = stopReason(data, s, step.arrived, step.fired, step.gaps);
      if (summary.stop) break;
    }
  });
  summary.toTurn = store.getState().turn;
  const saved = store.autosave();
  if (!saved.ok) summary.saveError = saved.error;
  return summary;
}

// ---------- 사건 시험대 (연습용, design.md §8.3 ⑧) ----------

// 창구·확률·조건·once를 건너뛰고 사건을 지금 일으킨다. 쓴 게임에는 debug_events_used 플래그가 붙는다.
export function forceEvent(eventId, { client = null, cascade = false } = {}) {
  const data = store.getData();
  const ev = data.events.find((e) => e.id === eventId);
  if (!ev) return { ok: false, error: '없는 사건이에요' };
  if (ev.trigger.pick_client && !client) return { ok: false, error: '이 사건은 고객을 골라야 해요' };
  let voided = [];
  store.commit((s) => {
    if (!s.player.flags.includes('debug_events_used')) s.player.flags.push('debug_events_used');
    fireEvent(data, s, ev, { client, forceFollowups: cascade });
    voided = voidInvalidRows(data, s);
    deliverDue(data, s);
  });
  store.autosave();
  return { ok: true, voided };
}
