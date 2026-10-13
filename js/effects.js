// 효과 연산자 인터프리터(design.md §10.8). 데이터는 선언만 하고, 상태를 바꾸는 코드는 여기에만 있다.
// state를 직접 고치므로 store.commit() 안에서만 호출한다.

const CLAMP_DEFAULT = { min: 0, max: 100 }; // player 수치와 market.index는 0~100 범위를 지킨다(세이브 검증과 같은 약속)

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// target → 값이 들어 있는 객체. client:<id>·reinsurer:<id>는 세이브의 entities 항목이다(M5b).
function resolveBox(state, target) {
  if (target === 'player') return state.player;
  if (target === 'market') return state.market;
  const m = /^(client|reinsurer):(.+)$/.exec(target);
  if (m) {
    const box = (m[1] === 'client' ? state.entities.clients : state.entities.reinsurers)[m[2]];
    if (!box) throw new Error(`없는 효과 대상: ${target}`);
    return box;
  }
  throw new Error(`지원하지 않는 효과 대상: ${target}`);
}

// 점 표기 경로(scout.loyalty, patience.trt_x)의 마지막 칸을 가리키는 { owner, key }.
function resolveField(box, field) {
  const parts = field.split('.');
  let owner = box;
  for (const p of parts.slice(0, -1)) {
    if (p === '__proto__' || p === 'constructor' || p === 'prototype') throw new Error(`쓸 수 없는 경로: ${field}`);
    owner = owner[p];
    if (owner === null || typeof owner !== 'object') throw new Error(`없는 경로: ${field}`);
  }
  const key = parts[parts.length - 1];
  if (key === '__proto__' || key === 'constructor' || key === 'prototype') throw new Error(`쓸 수 없는 경로: ${field}`);
  return { owner, key };
}

// 사건이 덮어쓰는 값(design.md §8.3 ①②)은 정적 정의를 건드리지 않고 세이브의 overrides·트리티 상태에 둔다.
function ensureOverrides(state) {
  if (!state.overrides) state.overrides = { reinsurers: {}, clients: {} };
  return state.overrides;
}

function applyTreatyEffect(state, effect) {
  const id = effect.target.slice('treaty:'.length);
  const t = state.treaties[id];
  if (!t) throw new Error(`없는 효과 대상: ${effect.target}`);
  switch (effect.field) {
    case 'lr_extra': {
      const cur = t.lr_extra ?? 0;
      const raw = effect.op === 'add' ? cur + effect.value : effect.op === 'mul' ? cur * effect.value : effect.value;
      t.lr_extra = clamp(raw, effect.min ?? 0, effect.max ?? 100);
      return;
    }
    case 'big_loss':
      t.big_loss = Boolean(effect.value);
      return;
    case 'structure_option':
      if (t.structure_option === effect.value) return;
      t.structure_option = effect.value;
      // 구조 옵션은 가격 하한에 들어가므로 이미 받은 응답은 모두 무효다(placement.setOptions와 같은 약속).
      for (const row of t.panel) { row.status = 'draft'; row.share_signed = 0; row.counter_until = null; row.last = null; }
      return;
    case 'phase':
      if (effect.value === 'lost' && t.phase === 'open') t.phase = 'lost'; // 이미 확정된 트리티는 그대로
      return;
    default:
      throw new Error(`쓸 수 없는 트리티 필드: ${effect.field}`);
  }
}

export function applyEffect(state, effect) {
  switch (effect.op) {
    case 'add':
    case 'set':
    case 'mul': {
      if (typeof effect.target === 'string' && effect.target.startsWith('treaty:')) { applyTreatyEffect(state, effect); return; }
      if (effect.field === 'rating' && effect.target.startsWith('reinsurer:')) {
        const id = effect.target.slice('reinsurer:'.length);
        if (!state.entities.reinsurers[id]) throw new Error(`없는 효과 대상: ${effect.target}`);
        const ov = ensureOverrides(state);
        ov.reinsurers[id] = { ...ov.reinsurers[id], rating: String(effect.value) };
        return;
      }
      if (effect.field === 'requirements.shariah_conventional_cap' && effect.target.startsWith('client:')) {
        const id = effect.target.slice('client:'.length);
        if (!state.entities.clients[id]) throw new Error(`없는 효과 대상: ${effect.target}`);
        const ov = ensureOverrides(state);
        const cur = ov.clients[id]?.shariah_conventional_cap ?? effect.base ?? 1;
        const raw = effect.op === 'add' ? cur + effect.value : effect.op === 'mul' ? cur * effect.value : effect.value;
        ov.clients[id] = { ...ov.clients[id], shariah_conventional_cap: Math.round(clamp(raw, 0, 1) * 1e4) / 1e4 };
        return;
      }
      const { owner, key } = resolveField(resolveBox(state, effect.target), effect.field);
      const cur = owner[key];
      const raw = effect.op === 'add' ? cur + effect.value : effect.op === 'mul' ? cur * effect.value : effect.value;
      owner[key] = clamp(raw, effect.min ?? CLAMP_DEFAULT.min, effect.max ?? CLAMP_DEFAULT.max);
      return;
    }
    case 'cash':
      state.player.cash_usd_m = Math.round((state.player.cash_usd_m + effect.value) * 1e6) / 1e6;
      return;
    case 'flag_set':
      if (!state.player.flags.includes(effect.flag)) state.player.flags.push(effect.flag);
      return;
    case 'flag_clear':
      state.player.flags = state.player.flags.filter((f) => f !== effect.flag);
      return;
    case 'mail_send':
      // 지연 0주여도 예약 큐에 넣는다. 도착 처리는 turn.js가 한곳에서 한다.
      state.scheduled.push({ turn: state.turn + (effect.delay_weeks ?? 0), kind: 'mail', ref: effect.mail });
      return;
    case 'event_schedule': {
      // 발생 판정(조건·once·prob)은 예약을 꺼낼 때 turn.js가 한다(design.md §8.1).
      const item = { turn: state.turn + effect.delay_weeks, kind: 'event', ref: effect.event };
      if (effect.prob !== undefined) item.prob = effect.prob;
      state.scheduled.push(item);
      return;
    }
    case 'modifier_add': {
      const m = { target: effect.target, field: effect.field, mult: effect.mult ?? 1, add: effect.add ?? 0, until_turn: state.turn + effect.duration_weeks };
      state.modifiers.push(m);
      return;
    }
    default:
      throw new Error(`지원하지 않는 연산자: ${effect.op}`);
  }
}

export function applyEffects(state, effects) {
  for (const effect of effects) applyEffect(state, effect);
}
