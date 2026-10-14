// 뉴스 띠 헤드라인 고르기(design.md §6.0.3 D6 ④). DOM·저장소를 모르는 순수 함수.
// 이미 도착한 사건 메일과 이미 알린 시장 분위기(market.band)만 읽는다 — 앞으로 일어날 일은 드러내지 않는다.

import { nextFloat, normalizeSeed } from './rng.js';

// 사건 메일 템플릿 id → 사건 id
function eventMailMap(events) {
  const map = new Map();
  for (const ev of events ?? []) {
    if (ev.mail) map.set(ev.mail, ev.id);
    for (const id of Object.values(ev.mails_by_client ?? {})) map.set(id, ev.id);
    for (const o of ev.outcomes ?? []) if (o.mail) map.set(o.mail, ev.id);
  }
  return map;
}

// 최근(recent_weeks 안) 도착한 사건 id, 최근 것부터.
export function recentEvents(data, state) {
  const map = eventMailMap(data.events);
  const weeks = data.news.recent_weeks;
  const seen = new Set();
  return state.mails
    .filter((m) => map.has(m.template) && m.turn <= state.turn && state.turn - m.turn < weeks)
    .sort((a, b) => b.turn - a.turn)
    .map((m) => map.get(m.template))
    .filter((id) => (seen.has(id) ? false : (seen.add(id), true)));
}

// 시드·턴으로 만든 따로 된 난수로 섞는다(게임 난수 흐름 rng_state는 쓰지 않는다).
function shuffled(list, seed, turn) {
  const out = [...list];
  let st = normalizeSeed((seed ^ Math.imul(turn + 1, 0x9e3779b1) ^ 0x6e657773) >>> 0);
  for (let i = out.length - 1; i > 0; i -= 1) {
    const r = nextFloat(st);
    st = r.state;
    const j = Math.floor(r.value * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// 이번 주의 헤드라인 순서: 최근 사건 → (시장 분위기 + 일반)을 섞은 것. 글자만 돌려준다.
export function pickHeadlines(data, state) {
  const all = data.news.headlines;
  const band = state.market?.band ?? 'neutral';
  const byEvent = recentEvents(data, state).flatMap((id) => all.filter((n) => n.event === id));
  const pool = all.filter((n) => n.event === undefined && (n.bands === undefined || n.bands.includes(band)));
  return [...byEvent, ...shuffled(pool, state.seed, state.turn)].map((n) => n.text_ko);
}
