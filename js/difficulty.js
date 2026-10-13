// 난이도 프로필(design.md §9.5). DOM·저장소를 모르는 순수 함수.
// 규칙 모듈은 계산식을 바꾸지 않고, 여기서 보정된 값을 받아 쓴다. 보통 프로필은 전부 중립값이라 숫자가 그대로 나온다.

const round1 = (n) => Math.round(n * 10) / 10;

// 진행 중인 게임의 난이도 id. 세이브에 없거나 모르는 값이면 기본 난이도(보통)로 읽는다.
export function difficultyId(data, state) {
  const { profiles, default: dflt } = data.config.difficulty;
  return state && profiles[state.difficulty] ? state.difficulty : dflt;
}

export function profileOf(data, state) {
  return data.config.difficulty.profiles[difficultyId(data, state)];
}

export const difficultyLabel = (data, state) => profileOf(data, state).label_ko;

// 공백 벌칙(관계도·평판·이사회 신뢰). 메일 id는 그대로.
export function gapPenalty(data, state) {
  const g = data.config.season.gap;
  const k = profileOf(data, state).gap_penalty_scale;
  return { ...g, relationship: round1(g.relationship * k), reputation: round1(g.reputation * k), board_confidence: round1(g.board_confidence * k) };
}

// 공백 뒤 늦은 확정의 수수료 감액 설정({ per_week, max }).
export function gapCutCfg(data, state) {
  const g = data.config.finance.gap_cut;
  const k = profileOf(data, state).gap_cut_scale;
  return { per_week: g.per_week * k, max: g.max * k };
}

export function firedBelow(data, state) {
  return data.config.board.fired_below + profileOf(data, state).fired_below_shift;
}

// 미팅 설정(스카우트 값 증가만 곱한다. AP 비용·관계도 증가는 그대로).
export function scoutingCfg(data, state) {
  const s = data.config.scouting;
  const k = profileOf(data, state).scout_gain_scale;
  return k === 1 ? s : { ...s, meeting_focus_gain: s.meeting_focus_gain * k, meeting_other_gain: s.meeting_other_gain * k };
}

export function patienceStart(data, state) {
  return data.config.negotiation.board.patience_start + profileOf(data, state).patience_bonus;
}

// 가격 거절 한 번의 벌칙({ patience, relationship }). response는 협상 계산이 돌려준 값(없으면 config 값).
// 인내심은 정수라 깎는 폭이 아니라 시작값(patienceStart)으로 조절한다.
export function rejectPenalty(data, state, response = null) {
  const n = data.config.negotiation;
  const patience = response?.patienceDelta ?? n.reject_patience;
  const relationship = response?.relationshipDelta ?? n.reject_relationship;
  const k = profileOf(data, state).reject_relationship_scale;
  return { patience, relationship: k === 1 ? relationship : round1(relationship * k) };
}

export const guideDetail = (data, state) => profileOf(data, state).guide_detail === true;
