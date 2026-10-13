// 숨은 속성 원값 → 화면에 보여도 되는 정보(단계·범위·라벨). design.md §4.3. DOM·저장소를 모르는 순수 함수.
// 숨은 속성의 원값은 UI가 직접 출력하지 않고 반드시 이 모듈을 거친다.

export const ATTRS = ['conservatism', 'price_sensitivity', 'loyalty'];

// 스카우트 값 s → 'unknown' | 'blurred' | 'sharp' | 'exact'
export function stageOf(s, cfg) {
  const t = cfg.stage_thresholds;
  if (s >= t.exact) return 'exact';
  if (s >= t.sharp) return 'sharp';
  if (s >= t.blurred) return 'blurred';
  return 'unknown';
}

// 문자열 → [-1, 1]. (엔티티, 속성, 세이브 시드)가 같으면 항상 같은 값이라 화면을 다시 열어도 범위가 흔들리지 않는다.
export function hashUnit(text) {
  let hash = 0x811c9dc5; // FNV-1a
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return (hash / 4294967295) * 2 - 1;
}

// 범위 전체가 한 구간에 들어오면 그 라벨, 아니면 'unclear'.
export function labelOf(lo, hi, cfg) {
  const { low_below: lowBelow, high_above: highAbove } = cfg.label_bands;
  if (hi < lowBelow) return 'low';
  if (lo > highAbove) return 'high';
  if (lo >= lowBelow && hi <= highAbove) return 'mid';
  return 'unclear';
}

// 한 속성의 공개 정보. 'unknown'이면 숫자를 하나도 돌려주지 않는다.
export function revealAttr({ value, s, entityId, attr, seed }, cfg) {
  const stage = stageOf(s, cfg);
  if (stage === 'unknown') return { stage, lo: null, hi: null, label: null, exact: null };
  if (stage === 'exact') {
    return { stage, lo: value, hi: value, label: labelOf(value, value, cfg), exact: value };
  }
  const err = Math.round(cfg.err_k * (1 - s / 100));
  // 한도가 err 이하라서 실제 값은 항상 표시 범위 안에 있다.
  const jitter = Math.round(hashUnit(`${seed}:${entityId}:${attr}`) * err * cfg.jitter_ratio);
  const lo = Math.max(0, value - err + jitter);
  const hi = Math.min(100, value + err + jitter);
  return { stage, lo, hi, label: labelOf(lo, hi, cfg), exact: null };
}

// 파악도(표시용): 세 속성 스카우트 값의 평균.
export function awareness(scout) {
  return Math.round(ATTRS.reduce((sum, a) => sum + scout[a], 0) / ATTRS.length);
}
