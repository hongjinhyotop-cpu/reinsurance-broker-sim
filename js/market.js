// 시장 온도계 표시용 순수 함수. 플레이어에게는 정확한 지수가 아니라 라벨 + 오차만 보인다(design.md §3).
// 분기 드리프트와 분위기 묶음(M6a)도 이 파일에 있다. 이벤트 충격은 effects(market.index)가 더한다.

export function marketLabel(index, labels) {
  for (const band of labels) {
    if (index <= band.max) return band.label_ko;
  }
  return labels[labels.length - 1].label_ko;
}

// 오차 = errK × (1 − market_intel/100). 시장 정찰로 market_intel이 오르면 줄어든다.
export function marketUncertainty(intel, errK) {
  const ratio = Math.min(1, Math.max(0, intel / 100));
  return Math.round(errK * (1 - ratio));
}

export function describeMarket(index, intel, marketConfig) {
  return {
    label_ko: marketLabel(index, marketConfig.labels),
    error: marketUncertainty(intel, marketConfig.intel_error_k),
  };
}

// ---------- 시장 사이클 (design.md §3, M6a) ----------

// Box-Muller: 균등 난수 둘 → 표준정규 하나. u1이 0이면 로그가 발산하므로 아주 작은 값으로 막는다.
export function gaussian(u1, u2) {
  return Math.sqrt(-2 * Math.log(Math.max(u1, 1e-12))) * Math.cos(2 * Math.PI * u2);
}

// 지수는 소수 둘째 자리까지만 남겨 세이브가 지저분해지지 않게 한다.
const clampIndex = (x) => Math.round(Math.min(100, Math.max(0, x)) * 100) / 100;

// 분기 드리프트: M_next = clamp(M + drift), drift = −revert × (M − center) + noise_sd × z.
export function driftIndex(index, z, cycle) {
  return clampIndex(index - cycle.revert * (index - cycle.center) + cycle.noise_sd * z);
}

// 분위기 묶음: 소프트(≤soft_max) / 중립 / 하드(≥hard_min). 묶음이 바뀔 때만 시장 리포트 메일을 보낸다.
export function marketBand(index, family) {
  if (index <= family.soft_max) return 'soft';
  if (index >= family.hard_min) return 'hard';
  return 'neutral';
}
