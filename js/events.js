// 이벤트 판정 순수 함수(design.md §8.1). DOM·저장소를 모르고, 난수는 호출자가 시드 RNG에서 뽑아 넘긴다.
// 상태 변경(발생 기록·효과 적용·예약)은 turn.js가 store.commit 안에서 한다.

export const CONDITION_TYPES = ['turn_between', 'quarter_is', 'market_gte', 'market_lte', 'flag_set', 'flag_absent', 'relationship_lt', 'relationship_gte', 'compliance_gte', 'compliance_lt'];

// view = { turn, quarterId, marketIndex, compliance, flags: string[], relationshipOf: (target) => number|null }
export function conditionMet(cond, view) {
  switch (cond.type) {
    case 'turn_between': return view.turn >= cond.from && view.turn <= cond.to;
    case 'quarter_is': return view.quarterId === cond.quarter;
    case 'market_gte': return view.marketIndex >= cond.value;
    case 'market_lte': return view.marketIndex <= cond.value;
    case 'flag_set': return view.flags.includes(cond.flag);
    case 'flag_absent': return !view.flags.includes(cond.flag);
    case 'relationship_lt':
    case 'relationship_gte': {
      const r = view.relationshipOf(cond.target);
      if (r === null || r === undefined) return false;
      return cond.type === 'relationship_lt' ? r < cond.value : r >= cond.value;
    }
    case 'compliance_gte': return view.compliance >= cond.value;
    case 'compliance_lt': return view.compliance < cond.value;
    default: return false;
  }
}

export function conditionsMet(conditions, view) {
  return (conditions ?? []).every((c) => conditionMet(c, view));
}

// 이번 턴에 창구가 시작되는 이벤트들(데이터 순서 그대로).
export function windowStarters(events, turn) {
  return events.filter((e) => e.trigger.window?.from_turn === turn);
}

// 창구 안에서 발생 턴을 고른다. u ∈ [0, 1).
export function pickFireTurn(window, u) {
  const span = window.to_turn - window.from_turn + 1;
  return window.from_turn + Math.min(span - 1, Math.floor(u * span));
}

// 발생해도 되는가: once인데 이미 터졌으면 안 되고, 조건이 모두 맞아야 한다.
export function canFire(event, firedIds, view) {
  if (event.trigger.once !== false && firedIds.includes(event.id)) return false;
  return conditionsMet(event.trigger.conditions, view);
}

// 첫 번째로 조건이 모두 맞는 결과(outcomes, design.md §8.3 ③). 없으면 null.
export function pickOutcome(outcomes, view) {
  return (outcomes ?? []).find((o) => conditionsMet(o.conditions, view)) ?? null;
}

// BOR 같은 "고객 고르기" 이벤트의 한 고객 확률(§8.3 ④). 관계도가 기준 이상이면 후보가 아니라 0.
// 충성도는 숨은 값이지만 계산에만 쓰고 화면·메일에는 내지 않는다.
export function pickClientProb(spec, { loyalty, relationship }) {
  if (relationship >= spec.relationship_ref) return 0;
  return Math.min(1, Math.max(0, spec.base * (1 - loyalty / 100) * (1 + (spec.relationship_ref - relationship) / 100)));
}

// 고객 고르기 이벤트가 이 시점에 아직 유효한가(그 사이 관계를 고쳤으면 버려진다).
export function pickClientStillValid(spec, relationship) {
  return relationship < spec.relationship_ref;
}
