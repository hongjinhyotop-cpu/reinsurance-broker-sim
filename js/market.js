// 시장 온도계 표시용 순수 함수. 플레이어에게는 정확한 지수가 아니라 라벨 + 오차만 보인다(design.md §3).
// 지수 갱신(드리프트·이벤트 충격)은 M6에서 이 파일에 추가한다.

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
