// 인장(재보험사 5·고객 3)과 결과 도장 (design.md §6.0.3).
// 실제 회사 로고·상표는 쓰지 않는다 — 모두 새로 그린 단순한 도형이다. SVG는 createElementNS로만 만든다(innerHTML 금지).
// 색은 CSS 클래스(.seal-re-N 등)가 정하고, 여기서는 모양만 그린다. 이 파일은 데이터를 읽는 규칙을 모른다(표시 전용).

const NS = 'http://www.w3.org/2000/svg';

function svg(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) el.setAttribute(k, String(v));
  for (const kid of kids) if (kid) el.append(kid);
  return el;
}

// ---------- 재보험사 색 ----------

// 재보험사마다 고정된 색 번호(--re-N). 패널 순서나 트리티가 바뀌어도 같은 재보험사는 같은 색이다.
const RE_TONE = { re_alpenglow: 0, re_kallang: 1, re_thames_quay: 2, re_nur: 3, re_dunes_crescent: 4 };

export function reTone(id) {
  if (id in RE_TONE) return RE_TONE[id];
  let sum = 0; // 목록에 없는 재보험사(나중에 추가될 콘텐츠)도 같은 id면 같은 색
  for (const ch of String(id)) sum = (sum * 31 + ch.charCodeAt(0)) % 5;
  return sum;
}

// ---------- 인장 ----------

const STROKE = { fill: 'none', stroke: 'currentColor', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };

// 틀: 안쪽을 종이색으로 채우고 굵은 테두리 + 가는 안쪽 테두리
const FRAMES = {
  circle: () => [
    svg('circle', { class: 'seal-bg', cx: 24, cy: 24, r: 21.5 }),
    svg('circle', { ...STROKE, 'stroke-width': 2.6, cx: 24, cy: 24, r: 21.5 }),
    svg('circle', { ...STROKE, 'stroke-width': 0.8, cx: 24, cy: 24, r: 18.2 }),
  ],
  hexagon: () => [
    svg('polygon', { class: 'seal-bg', points: '24,2.5 42.6,13.25 42.6,34.75 24,45.5 5.4,34.75 5.4,13.25' }),
    svg('polygon', { ...STROKE, 'stroke-width': 2.6, points: '24,2.5 42.6,13.25 42.6,34.75 24,45.5 5.4,34.75 5.4,13.25' }),
    svg('polygon', { ...STROKE, 'stroke-width': 0.8, points: '24,6.4 39.2,15.2 39.2,32.8 24,41.6 8.8,32.8 8.8,15.2' }),
  ],
  tablet: () => [
    svg('rect', { class: 'seal-bg', x: 3, y: 3, width: 42, height: 42, rx: 9 }),
    svg('rect', { ...STROKE, 'stroke-width': 2.6, x: 3, y: 3, width: 42, height: 42, rx: 9 }),
    svg('rect', { ...STROKE, 'stroke-width': 0.8, x: 6.8, y: 6.8, width: 34.4, height: 34.4, rx: 6 }),
  ],
  diamond: () => [
    svg('polygon', { class: 'seal-bg', points: '24,1.5 46.5,24 24,46.5 1.5,24' }),
    svg('polygon', { ...STROKE, 'stroke-width': 2.6, points: '24,1.5 46.5,24 24,46.5 1.5,24' }),
    svg('polygon', { ...STROKE, 'stroke-width': 0.8, points: '24,6.4 41.6,24 24,41.6 6.4,24' }),
  ],
};

// 발신자 인장 틀(D2): 이사회=방패, 규제=팔각, 시장=깃발, 시스템=모서리 깎은 사각, 선배=아치 창. 서로 달라서 색 없이도 구분된다.
const outline = (outer, inner) => () => [
  svg('path', { class: 'seal-bg', d: outer }),
  svg('path', { ...STROKE, 'stroke-width': 2.6, d: outer }),
  svg('path', { ...STROKE, 'stroke-width': 0.8, d: inner }),
];
Object.assign(FRAMES, {
  shield: outline('M24 2.5 L43 8.5 V25 C43 35 34 42 24 45.5 C14 42 5 35 5 25 V8.5 Z', 'M24 6.6 L39.2 11.4 V25 C39.2 33 32 38.6 24 41.8 C16 38.6 8.8 33 8.8 25 V11.4 Z'),
  octagon: outline('M15 2.5 H33 L45.5 15 V33 L33 45.5 H15 L2.5 33 V15 Z', 'M16.2 6.4 H31.8 L41.6 16.2 V31.8 L31.8 41.6 H16.2 L6.4 31.8 V16.2 Z'),
  banner: outline('M6 3.5 H42 V44.5 L24 36.5 L6 44.5 Z', 'M9.8 7.3 H38.2 V38.5 L24 32.2 L9.8 38.5 Z'),
  chamfer: outline('M11 3 H37 L45 11 V37 L37 45 H11 L3 37 V11 Z', 'M12.6 6.8 H35.4 L41.2 12.6 V35.4 L35.4 41.2 H12.6 L6.8 35.4 V12.6 Z'),
  arch: outline('M7 45 V22 A17 17 0 0 1 41 22 V45 Z', 'M10.8 41.2 V22 A13.2 13.2 0 0 1 37.2 22 V41.2 Z'),
});

const path = (d, w = 2.2, extra = {}) => svg('path', { ...STROKE, 'stroke-width': w, d, ...extra });
const solid = (tag, attrs) => svg(tag, { fill: 'currentColor', stroke: 'none', ...attrs });

// 안쪽 무늬. 각 id가 서로 다른 모양이라 색을 못 봐도 구분된다.
const MOTIFS = {
  re_alpenglow: () => [path('M10 35 L19 18 L25 27 L30 20 L38 35 Z'), solid('circle', { cx: 33.5, cy: 13.5, r: 3 }), path('M9 37.5 H39', 1.6)],
  re_kallang: () => [0, 7, 14].map((dy) => path(`M9 ${16 + dy} q3.75 -5 7.5 0 t7.5 0 t7.5 0 t7.5 0`, 2)),
  re_thames_quay: () => [path('M8 20.5 H40', 2), path('M10 35 V31 a7 7 0 0 1 14 0 V35 M24 35 V31 a7 7 0 0 1 14 0 V35', 2.2), path('M8 35 H40', 2)],
  re_nur: () => [
    svg('rect', { ...STROKE, 'stroke-width': 2, x: 15.5, y: 15.5, width: 17, height: 17 }),
    svg('rect', { ...STROKE, 'stroke-width': 2, x: 15.5, y: 15.5, width: 17, height: 17, transform: 'rotate(45 24 24)' }),
    solid('circle', { cx: 24, cy: 24, r: 2.4 }),
  ],
  re_dunes_crescent: () => [solid('path', { d: 'M31 11 A10 10 0 1 0 31 27 A8 8 0 1 1 31 11 Z' }), path('M8 37 q8 -9 16 0 t16 0', 2.2)],
  cli_jurong_crest: () => [path('M12 35 V20 L20.5 26 V20 L29 26 V20 L36 26 V35 Z', 2.2), path('M12 35 H36', 2)],
  cli_straits_port: () => [
    svg('circle', { ...STROKE, 'stroke-width': 2, cx: 24, cy: 13.5, r: 3.2 }),
    path('M24 16.7 V37 M18 22 H30', 2.2), path('M11.5 28 q2 10 12.5 10 q10.5 0 12.5 -10', 2.2),
  ],
  cli_nusantara: () => [
    svg('polygon', { ...STROKE, 'stroke-width': 2, points: '24,10.5 37.5,24 24,37.5 10.5,24' }),
    path('M24 10.5 V37.5 M10.5 24 H37.5', 1.4), solid('circle', { cx: 24, cy: 24, r: 2.6 }),
  ],
};

const polar = (r, deg) => [24 + r * Math.cos(deg * Math.PI / 180), 24 + r * Math.sin(deg * Math.PI / 180)];

Object.assign(MOTIFS, {
  // 이사회: 둥근 탁자와 둘러앉은 다섯 자리
  sender_board: () => [
    svg('circle', { ...STROKE, 'stroke-width': 2.2, cx: 24, cy: 24, r: 5.5 }),
    ...[0, 1, 2, 3, 4].map((i) => { const [x, y] = polar(12.5, -90 + i * 72); return solid('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: 2.3 }); }),
  ],
  // 규제: 저울
  sender_regulator: () => [
    path('M24 11 V35 M17 35 H31 M12 16 H36', 2.2),
    path('M12 16 L8 27 M12 16 L16 27 M8 27 Q12 31.5 16 27', 1.8),
    path('M36 16 L32 27 M36 16 L40 27 M32 27 Q36 31.5 40 27', 1.8),
  ],
  // 시장: 오르내리는 선과 바닥선
  sender_market: () => [
    path('M11 25 L17 18 L23 22 L30 12 L37 17', 2.2),
    path('M11 29.5 H37', 1.6),
    solid('circle', { cx: 37, cy: 17, r: 2 }),
  ],
  // 시스템: 톱니바퀴
  sender_system: () => [
    svg('circle', { ...STROKE, 'stroke-width': 2.2, cx: 24, cy: 24, r: 6.5 }),
    solid('circle', { cx: 24, cy: 24, r: 2 }),
    ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => { const [x1, y1] = polar(9.3, i * 45); const [x2, y2] = polar(13, i * 45); return path(`M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)}`, 3); }),
  ],
  // 선배: 만년필 촉
  sender_mentor: () => [
    path('M24 11 L31 26 L24 37.5 L17 26 Z', 2.2),
    path('M24 27.5 V37', 1.6),
    solid('circle', { cx: 24, cy: 25, r: 1.7 }),
    path('M20.5 11 H27.5', 2.2),
  ],
});

const FRAME_OF = {
  re_alpenglow: 'circle', re_kallang: 'circle', re_thames_quay: 'circle', re_nur: 'circle', re_dunes_crescent: 'circle',
  cli_jurong_crest: 'hexagon', cli_straits_port: 'tablet', cli_nusantara: 'diamond',
  sender_board: 'shield', sender_regulator: 'octagon', sender_market: 'banner', sender_system: 'chamfer', sender_mentor: 'arch',
};

// 메일 발신 종류(template.from.kind) → 인장 id. 재보험사·고객은 senderEntity가 따로 찾는다.
export function senderSealId(kind) {
  const id = `sender_${kind}`;
  return id in MOTIFS ? id : null;
}

export function hasSeal(id) {
  return id in MOTIFS;
}

// 인장 SVG. 옆에 이름 글자가 있으므로 기본은 장식(aria-hidden)이다. title을 주면 이미지로 읽힌다.
export function sealFor(id, { size = 28, title = null } = {}) {
  const tone = id.startsWith('re_') ? `seal-re-${reTone(id)}` : id.startsWith('sender_') ? `seal-${id.replace('_', '-')}` : 'seal-client';
  const frame = FRAME_OF[id] ?? 'circle';
  const motif = MOTIFS[id] ?? (() => [solid('circle', { cx: 24, cy: 24, r: 6 })]);
  return svg('svg', {
    class: `seal ${tone}`, viewBox: '0 0 48 48', width: size, height: size, focusable: 'false',
    role: title ? 'img' : null, 'aria-label': title, 'aria-hidden': title ? null : 'true',
  }, ...FRAMES[frame](), ...[].concat(motif()));
}

// 메일 보낸 이름("알펜글로우 리 언더라이터 (가상)")에서 재보험사·고객을 찾는다. 없으면 null.
export function senderEntity(fromName, data) {
  for (const r of data.reinsurers) if (fromName.startsWith(r.name_ko)) return { id: r.id, kind: 'reinsurer', name_ko: r.name_ko, hq: r.hq };
  for (const c of data.clients) if (fromName.startsWith(c.name_ko)) return { id: c.id, kind: 'client', name_ko: c.name_ko, hq: c.hq };
  return null;
}

// ---------- 결과 도장 ----------

// 도장 종류 → 모양·글자·잉크색. 같은 말이 옆 글자에 이미 있으므로 도장은 장식(aria-hidden)이다.
//   재보험사 응답: accept(수락) · counter(반제) · decline(거절)
//   고객 반응:    delighted(매우 만족) · accept(수락) · renegotiate(재협상) · refuse(거부)
const STAMPS = {
  accept: { text: '수락', shape: 'round', tone: 'ok' },
  delighted: { text: '매우 만족', shape: 'round-double', tone: 'bad' },
  counter: { text: '반제', shape: 'bar', tone: 'warn' },
  renegotiate: { text: '재협상', shape: 'bar-arrows', tone: 'warn' },
  decline: { text: '거절', shape: 'square-slash', tone: 'bad' },
  refuse: { text: '거부', shape: 'square-cross', tone: 'bad' },
  fired: { text: '해고', shape: 'square-cross', tone: 'bad' },
};

let stampSeq = 0;

function roughFilter(id) {
  // 잉크가 번지고 군데군데 비는 도장 질감. 움직이지 않는다(seed 고정).
  return svg('filter', { id, x: '-6%', y: '-6%', width: '112%', height: '112%' },
    svg('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.045', numOctaves: '2', seed: '7', result: 'warp' }),
    svg('feDisplacementMap', { in: 'SourceGraphic', in2: 'warp', scale: '2.6', result: 'bent' }),
    svg('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.9', numOctaves: '2', seed: '3', result: 'grain' }),
    svg('feColorMatrix', { in: 'grain', type: 'matrix', values: '0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  9 0 0 0 -2.7', result: 'holes' }),
    svg('feComposite', { in: 'bent', in2: 'holes', operator: 'in' }));
}

function starPath(cx, cy, outer, inner) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (-90 + i * 36) * Math.PI / 180;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(' ');
}

const line = (w, attrs) => svg('path', { ...STROKE, 'stroke-width': w, ...attrs });
const label = (text, size, x = 60, y = 60) => svg('text', { class: 'stamp-text', x, y, 'font-size': size, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, document.createTextNode(text));

function stampBody(def) {
  switch (def.shape) {
    case 'round':
      return { w: 120, h: 120, nodes: [svg('circle', { ...STROKE, 'stroke-width': 6, cx: 60, cy: 60, r: 53 }), svg('circle', { ...STROKE, 'stroke-width': 1.8, cx: 60, cy: 60, r: 45 }), label(def.text, 36)] };
    case 'round-double':
      return {
        w: 120, h: 120,
        nodes: [svg('circle', { ...STROKE, 'stroke-width': 6, cx: 60, cy: 60, r: 53 }), svg('circle', { ...STROKE, 'stroke-width': 2.4, cx: 60, cy: 60, r: 46 }),
          svg('circle', { ...STROKE, 'stroke-width': 1.4, cx: 60, cy: 60, r: 40 }),
          svg('polygon', { fill: 'currentColor', points: starPath(60, 30, 9, 3.8) }), label('매우', 21, 60, 56), label('만족', 21, 60, 80)],
      };
    case 'bar':
      return { w: 150, h: 84, nodes: [svg('rect', { ...STROKE, 'stroke-width': 6, x: 4, y: 4, width: 142, height: 76, rx: 5 }), svg('rect', { ...STROKE, 'stroke-width': 1.8, x: 12, y: 12, width: 126, height: 60, rx: 2, 'stroke-dasharray': '5 3' }), label(def.text, 36, 75, 42)] };
    case 'bar-arrows':
      return {
        w: 150, h: 84,
        nodes: [svg('rect', { ...STROKE, 'stroke-width': 6, x: 4, y: 4, width: 142, height: 76, rx: 5 }), label(def.text, 30, 75, 34),
          line(3, { d: 'M26 60 H124 M116 53 L124 60 L116 67 M34 53 L26 60 L34 67' })],
      };
    case 'square-slash':
      return {
        w: 120, h: 120,
        nodes: [svg('rect', { ...STROKE, 'stroke-width': 6, x: 6, y: 6, width: 108, height: 108, rx: 3 }), svg('rect', { ...STROKE, 'stroke-width': 1.8, x: 14, y: 14, width: 92, height: 92 }),
          line(3.4, { d: 'M14 42 L42 14 M78 106 L106 78' }), label(def.text, 36)],
      };
    default: // square-cross
      return {
        w: 120, h: 120,
        nodes: [svg('rect', { ...STROKE, 'stroke-width': 6, x: 6, y: 6, width: 108, height: 108, rx: 3 }), svg('rect', { ...STROKE, 'stroke-width': 1.8, x: 14, y: 14, width: 92, height: 92 }),
          line(3.4, { d: 'M14 14 L38 38 M106 14 L82 38 M14 106 L38 82 M106 106 L82 82' }), label(def.text, 36)],
      };
  }
}

// kind: STAMPS의 키. size: 가로 크기(px).
export function stampEl(kind, { size = 84 } = {}) {
  const def = STAMPS[kind];
  if (!def) return null;
  const { w, h, nodes } = stampBody(def);
  const filterId = `stamp-rough-${++stampSeq}`;
  const group = svg('g', { filter: `url(#${filterId})` }, ...nodes);
  return svg('svg', {
    class: `stamp stamp-${def.tone} stamp-${kind}`, viewBox: `0 0 ${w} ${h}`, width: size, height: Math.round(size * h / w),
    focusable: 'false', 'aria-hidden': 'true',
  }, svg('defs', {}, roughFilter(filterId)), group);
}

// 등급 도장(D2): 연말 성적표의 등급 글자. 이중 둥근 도장 안에 글자 한 자만 들어 있고, 바깥 요소가 "A 등급"으로 읽힌다.
const GRADE_TONE = { S: 'ok', A: 'ok', B: 'ink', C: 'warn', D: 'bad' };

export function gradeStampEl(grade, { size = 104 } = {}) {
  const filterId = `stamp-rough-${++stampSeq}`;
  const group = svg('g', { filter: `url(#${filterId})` },
    svg('circle', { ...STROKE, 'stroke-width': 6, cx: 60, cy: 60, r: 53 }),
    svg('circle', { ...STROKE, 'stroke-width': 2.2, cx: 60, cy: 60, r: 46 }),
    svg('circle', { ...STROKE, 'stroke-width': 1.2, cx: 60, cy: 60, r: 40 }),
    label(grade, 66));
  return svg('svg', {
    class: `stamp grade-letter grade-${grade.toLowerCase()} stamp-${GRADE_TONE[grade] ?? 'ink'}`, viewBox: '0 0 120 120', width: size, height: size,
    focusable: 'false', role: 'img', 'aria-label': `${grade} 등급`,
  }, svg('defs', {}, roughFilter(filterId)), group);
}

// 사건 메일이 도착할 때 들어오는 봉투(D2, 장식). 붉은 봉인 하나가 찍힌 단순한 봉투다.
export function envelopeEl({ size = 64 } = {}) {
  return svg('svg', { class: 'envelope', viewBox: '0 0 64 46', width: size, height: Math.round(size * 46 / 64), focusable: 'false', 'aria-hidden': 'true' },
    svg('rect', { class: 'envelope-body', x: 2, y: 2, width: 60, height: 42, rx: 2 }),
    svg('path', { ...STROKE, 'stroke-width': 2, d: 'M2 4 L32 27 L62 4 M2 44 L24 24 M62 44 L40 24' }),
    svg('circle', { class: 'envelope-seal', cx: 32, cy: 27, r: 5 }));
}
