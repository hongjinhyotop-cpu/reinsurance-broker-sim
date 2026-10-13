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

export function applyEffect(state, effect) {
  switch (effect.op) {
    case 'add':
    case 'set':
    case 'mul': {
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
    default:
      throw new Error(`지원하지 않는 연산자: ${effect.op}`);
  }
}

export function applyEffects(state, effects) {
  for (const effect of effects) applyEffect(state, effect);
}
