// 플레이 스타일 칭호(design.md §9.7, D6). DOM·저장소를 모르는 순수 함수.
// 세이브에 이미 남은 공개 기록만 읽는다. 숨은 속성·스카우트 값·계산 내부 값(가격 하한, 고객 평가 점수)은 읽지 않는다.
// 점수·등급과 무관하고 저장하지 않는다(같은 기록이면 언제나 같은 칭호).

import { findTemplate } from './mail.js';

const sum = (xs) => xs.reduce((s, x) => s + x, 0);

// 칭호 판정에 쓰는 기록 묶음. 화면(근거 글)과 테스트가 같은 값을 본다.
export function playStyleFacts(data, state) {
  const eventActions = state.mails.filter((m) => {
    if (m.answered === null || m.auto) return false;
    const t = findTemplate(data.mails, m.template);
    if (!t || t.type !== 'event') return false;
    return (t.choices.find((c) => c.id === m.answered)?.ap_cost ?? 0) > 0;
  }).length;

  const clients = Object.values(state.entities.clients);
  const reinsurers = Object.values(state.entities.reinsurers);
  const treaties = Object.values(state.treaties);
  const placed = treaties.filter((t) => t.phase === 'placed' && t.final_rc !== null);
  const reinsurerRejects = sum(treaties.map((t) => sum(t.panel.map((r) => (r.history ?? []).filter((x) => x.kind === 'reject').length))));

  return {
    event_actions: eventActions,
    meetings: sum([...clients, ...reinsurers].map((e) => e.meetings ?? 0)),
    client_rel_avg: clients.length ? sum(clients.map((c) => c.relationship)) / clients.length : 0,
    placed: placed.length,
    avg_rc: placed.length ? sum(placed.map((t) => t.final_rc)) / placed.length : null,
    pushbacks: sum(treaties.map((t) => (t.renegotiations ?? 0) + (t.rejections ?? 0))) + reinsurerRejects,
    late_placed: treaties.filter((t) => t.gap_applied && t.phase === 'placed').length,
    gaps: treaties.filter((t) => t.gap_applied).length,
    fines: (state.finance?.fines ?? []).filter((f) => f.kind === 'fine').length,
    lost: treaties.filter((t) => t.phase === 'lost').length,
    compliance: state.player.compliance,
  };
}

// 칭호마다 조건. 문턱값은 config.playstyle(§9.7). balanced는 조건 없음(마지막).
const RULES = {
  crisis: (f, c) => f.event_actions >= c.crisis_event_actions,
  relationship: (f, c) => f.meetings >= c.relationship_meetings && f.client_rel_avg >= c.relationship_client_rel,
  numbers: (f, c) => f.placed >= c.numbers_min_placed && f.avg_rc >= c.numbers_avg_rc,
  client_side: (f, c) => f.placed >= c.numbers_min_placed && f.avg_rc <= c.client_side_avg_rc,
  tenacious: (f, c) => f.pushbacks >= c.tenacious_pushbacks,
  cliffhanger: (f, c) => f.late_placed >= c.cliffhanger_late,
  guardian: (f, c) => f.gaps === 0 && f.fines === 0 && f.lost === 0 && f.compliance >= c.guardian_compliance,
  balanced: () => true,
};
export const PLAYSTYLE_IDS = Object.keys(RULES);

// 위에서부터 처음 맞는 칭호 id 하나.
export function playStyleOf(data, state) {
  const cfg = data.config.playstyle;
  const facts = playStyleFacts(data, state);
  const id = cfg.order.find((k) => RULES[k]?.(facts, cfg)) ?? 'balanced';
  return { id, facts };
}

// 결과 카드 한 줄: "마리나 베이 데스크 | 시드 1234 | 보통 | A | 관계의 장인". 해고면 등급 칸이 "해고(C)".
export function shareLine({ gameTitle, seed, levelLabel, grade, fired, styleTitle }) {
  return [gameTitle, `시드 ${seed}`, levelLabel, fired ? `해고(${grade})` : grade, styleTitle].join(' | ');
}
