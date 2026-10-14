// 성격 안개 눈금 막대 (design.md §6.0.3 D4). 표시 전용 — reveal.js가 이미 돌려준 단계·범위·라벨만 받는다.
// 원값(value)·스카우트 값(s)·jitter는 받지 않는다. 점수 숫자는 글로도 막대 안에도 쓰지 않는다.

import { h } from './components.js';

const BAND_KO = { low: '낮음', mid: '보통', high: '높음' };
const BAND_ADJ = { low: '낮은', mid: '보통인', high: '높은' };

// 단계별 안개 말(짧은 글 / 스크린리더용 문장)
export const FOG_WORDS = {
  unknown: { short: '안개 짙음', long: '안개가 짙게 덮여 있어요' },
  blurred: { short: '안개 절반쯤 걷힘', long: '안개가 절반쯤 걷혔어요' },
  sharp: { short: '안개 거의 걷힘', long: '안개가 거의 걷혔어요' },
  exact: { short: '안개 모두 걷힘', long: '안개가 모두 걷혔어요' },
};
const WIDTH_WORD = { blurred: '범위가 넓어요', sharp: '범위가 좁아요' };

// 범위가 닿는 구간 이름. 라벨(낮음/보통/높음)과 같은 label_bands 기준이라 새 정보가 아니다.
export function bandsTouched(r, cfg) {
  const { low_below: lowBelow, high_above: highAbove } = cfg.label_bands;
  const out = [];
  if (r.lo < lowBelow) out.push('low');
  if (r.hi >= lowBelow && r.lo <= highAbove) out.push('mid');
  if (r.hi > highAbove) out.push('high');
  return out;
}

// 스크린리더용 설명(숫자 없음). r = reveal.js의 revealAttr 결과.
export function describeFog(name, r, cfg) {
  const head = `${name} 눈금 막대.`;
  if (r.stage === 'unknown') return `${head} 아직 알 수 없어요. ${FOG_WORDS.unknown.long}.`;
  if (r.stage === 'exact') return `${head} 확정됐어요. ${BAND_KO[r.label]}이에요. ${FOG_WORDS.exact.long}.`;
  const touched = bandsTouched(r, cfg);
  let where;
  if (touched.length === 1) where = `대체로 ${BAND_ADJ[touched[0]]} 쪽이에요`;
  else if (touched.length === 2) where = `${BAND_KO[touched[0]]}과 ${BAND_KO[touched[1]]}에 걸쳐 있어요`;
  else where = `${touched.map((b) => BAND_KO[b]).join('·')} 모두에 걸쳐 있어요`;
  return `${head} ${where}. ${WIDTH_WORD[r.stage]}. ${FOG_WORDS[r.stage].long}.`;
}

const pct = (v) => `${Math.min(100, Math.max(0, v))}%`;

function layer(kind, left, width) {
  return h('span', { class: `fog-layer fog-${kind}`, style: { left: pct(left), width: pct(width) } });
}

// 막대 하나. cfg = config.scouting (label_bands 사용).
export function fogMeter(name, r, cfg) {
  const { low_below: lowBelow, high_above: highAbove } = cfg.label_bands;
  const parts = [
    h('span', { class: 'fog-tick', style: { left: pct(lowBelow) } }),
    h('span', { class: 'fog-tick', style: { left: pct(highAbove) } }),
  ];
  if (r.stage === 'unknown') {
    parts.push(layer('dense', 0, 100));
  } else if (r.stage === 'exact') {
    parts.push(h('span', { class: 'fog-pin', style: { left: pct(Math.min(r.lo, 99)) } }));
  } else {
    const kind = r.stage === 'blurred' ? 'mid' : 'light';
    parts.push(
      h('span', { class: 'fog-range', style: { left: pct(r.lo), width: pct(Math.max(r.hi - r.lo, 1)) } }),
      layer(kind, 0, r.lo),
      layer(kind, r.hi, 100 - r.hi));
  }
  return h('span', { class: `fog fog-stage-${r.stage}` },
    h('span', { class: 'fog-bar', role: 'img', 'aria-label': describeFog(name, r, cfg) }, parts),
    h('span', { class: 'fog-bands', 'aria-hidden': 'true' },
      h('span', { style: { width: pct(lowBelow) } }, BAND_KO.low),
      h('span', { style: { width: pct(highAbove - lowBelow) } }, BAND_KO.mid),
      h('span', { style: { width: pct(100 - highAbove) } }, BAND_KO.high)));
}
