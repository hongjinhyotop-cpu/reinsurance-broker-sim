// "지금 값": 정적 정의(data/*.json)에 사건이 덮어쓴 값(세이브 overrides)과 기간 보정(modifiers)을 얹은 순수 함수들(design.md §8.3 ①).
// DOM·저장소를 모른다. 협상 계산·보드·DB·안내띠는 정적 정의 대신 이 값을 읽는다.

export const MODIFIER_FIELD_RE = /^(capacity(\.(property_energy|marine_cargo|takaful_general))?|max_single_share|price_floor)$/;

// 아직 켜져 있는 보정(턴 < until_turn).
export function activeModifiers(state, target) {
  return (state.modifiers ?? []).filter((m) => m.target === target && state.turn < m.until_turn);
}

const fieldMods = (mods, field) => mods.filter((m) => m.field === field);
const applyAll = (base, mods) => mods.reduce((v, m) => v * (m.mult ?? 1), base) + mods.reduce((v, m) => v + (m.add ?? 0), 0);

export function liveReinsurer(state, def) {
  const mods = activeModifiers(state, `reinsurer:${def.id}`);
  const rating = state.overrides?.reinsurers?.[def.id]?.rating ?? def.rating;
  const capacity = {};
  for (const [line, base] of Object.entries(def.capacity_usd_m)) {
    capacity[line] = Math.max(0, applyAll(base, [...fieldMods(mods, 'capacity'), ...fieldMods(mods, `capacity.${line}`)]));
  }
  const maxSingle = Math.round(Math.min(1, Math.max(0, applyAll(def.behavior.max_single_share, fieldMods(mods, 'max_single_share')))) * 1e4) / 1e4;
  const floorAdd = fieldMods(mods, 'price_floor').reduce((v, m) => v + (m.add ?? 0), 0);
  return {
    ...def, rating, capacity_usd_m: capacity, behavior: { ...def.behavior, max_single_share: maxSingle }, floor_add: floorAdd,
    live: {
      downgraded: rating !== def.rating, capacityShrunk: Object.keys(capacity).some((l) => capacity[l] < def.capacity_usd_m[l] - 1e-9),
      baseRating: def.rating,
    },
  };
}

export function liveReinsurers(state, defs) {
  return defs.map((d) => liveReinsurer(state, d));
}

export function liveClient(state, def) {
  const ov = state.overrides?.clients?.[def.id];
  if (!ov) return def;
  const requirements = { ...def.requirements };
  if (ov.shariah_conventional_cap !== undefined) requirements.shariah_conventional_cap = ov.shariah_conventional_cap;
  if (ov.min_rating !== undefined) requirements.min_rating = ov.min_rating;
  return { ...def, requirements };
}

export function liveClients(state, defs) {
  return defs.map((d) => liveClient(state, d));
}
