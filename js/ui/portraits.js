// 인물 초상 10명 × 표정 3가지 (design.md §6.0.3 D5). 표시 전용 — 규칙·세이브를 모른다.
// 모두 새로 그린 가상 인물이다. 실제 인물을 닮지 않도록 얼굴은 점 눈·한 줄 입·눈썹 두 획뿐이고,
// 사람마다 다른 것은 머리 모양과 소품뿐이다. SVG는 createElementNS로만 만든다(innerHTML 금지).

import { reTone } from './seals.js';

const NS = 'http://www.w3.org/2000/svg';

function svg(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, String(v));
  for (const kid of kids) if (kid) el.append(kid);
  return el;
}

// 그리는 도구: fill = 사람 색(머리·옷), paper = 종이색, ink = 얼굴 선
const fill = (d) => svg('path', { class: 'pt-fill', d });
const paper = (d) => svg('path', { class: 'pt-paper', d });
const ink = (d, w = 1.3) => svg('path', { class: 'pt-ink', d, 'stroke-width': w });
const dot = (cx, cy, r, cls = 'pt-dot') => svg('circle', { class: cls, cx, cy, r });

// 소품
const TIE = () => [paper('M17 33.5 L20 37.5 L23 33.5 Z'), fill('M19.2 34.6 H20.8 L21.6 41 L20 42.6 L18.4 41 Z'), ink('M17 33.5 L20 37.5 L23 33.5', 0.8)];
const BOW = () => [paper('M17 33.5 L20 36.5 L23 33.5 Z'), paper('M16.6 34.2 L20 35.8 L23.4 34.2 L23.4 38 L20 36.4 L16.6 38 Z'), ink('M16.6 34.2 L20 35.8 L23.4 34.2 L23.4 38 L20 36.4 L16.6 38 Z', 0.9), dot(20, 36.1, 0.9)];
const OPEN_COLLAR = () => [paper('M16.5 33.5 L20 39 L23.5 33.5 Z'), ink('M16.5 33.5 L20 39 L23.5 33.5', 0.8)];
const ROUND_GLASSES = () => [svg('circle', { class: 'pt-ink', cx: 16.8, cy: 21, r: 2.7, 'stroke-width': 0.9 }), svg('circle', { class: 'pt-ink', cx: 23.2, cy: 21, r: 2.7, 'stroke-width': 0.9 }), ink('M19.5 20.6 H20.5', 0.9)];
const RECT_GLASSES = () => [svg('rect', { class: 'pt-ink', x: 13.8, y: 19.3, width: 5.6, height: 3.6, rx: 0.6, 'stroke-width': 0.9 }), svg('rect', { class: 'pt-ink', x: 20.6, y: 19.3, width: 5.6, height: 3.6, rx: 0.6, 'stroke-width': 0.9 }), ink('M19.4 20.6 H20.6', 0.9)];
const HALF_GLASSES = () => [ink('M14 21.6 H19.2 Q19 23.8 16.6 23.8 Q14.2 23.8 14 21.6 M20.8 21.6 H26 Q25.8 23.8 23.4 23.8 Q21 23.8 20.8 21.6 M19.2 21.8 H20.8', 0.9)];

// 사람마다: back(얼굴 뒤), hair(얼굴 앞), extra(옷깃·소품)
const LOOKS = {
  // 서진 선배: 단발 + 둥근 안경
  mentor: () => ({
    back: [fill('M10.5 29 V19 C10.5 12 14.5 9.5 20 9.5 C25.5 9.5 29.5 12 29.5 19 V29 Z')],
    hair: [fill('M12 18 C12.5 12.5 16 11 20 11 C24 11 27.5 12.5 28 18 C24 16 18 15.6 12 18 Z')],
    extra: [OPEN_COLLAR, ROUND_GLASSES],
  }),
  // 이사회 의장: 옆머리만 남은 머리 + 반달 안경 + 나비넥타이
  board_chair: () => ({
    hair: [fill('M11.8 22 C11 17 12.4 14 14.6 13 L15.2 18.4 Z'), fill('M28.2 22 C29 17 27.6 14 25.4 13 L24.8 18.4 Z')],
    extra: [BOW, HALF_GLASSES],
  }),
  // 주롱 크레스트 담당: 옆가르마 짧은 머리 + 넥타이
  cli_jurong_crest: () => ({
    hair: [fill('M11.8 19 C11.5 12.5 15.5 10 20.5 10 C25.5 10 28.6 13 28.2 19 C26 15 22 14 16.5 15.5 C14.5 16 13 17.5 11.8 19 Z')],
    extra: [TIE],
  }),
  // 스트레이츠 포트 담당: 곱슬 짧은 머리 + 콧수염 + 열린 깃
  cli_straits_port: () => ({
    hair: [fill('M12 18 C11 12 14 10 17 10.6 C18.5 9.4 21.5 9.4 23 10.6 C26 10 29 12 28 18 C26 15.5 23 15.8 20 15 C17 15.8 14 15.5 12 18 Z')],
    extra: [OPEN_COLLAR, () => [ink('M17.3 23.9 Q20 22.5 22.7 23.9', 1.7)]],
  }),
  // 누산타라 담당: 둥근 머릿수건
  cli_nusantara: () => ({
    back: [fill('M9 36 C8.5 24 9 10 20 9 C31 10 31.5 24 31 36 Z')],
    hair: [fill('M11.5 18 C12 12 16 10.5 20 10.5 C24 10.5 28 12 28.5 18 C25 15.5 15 15.5 11.5 18 Z')],
  }),
  // 알펜글로우 담당: 짧게 깎은 머리 + 각진 안경 + 넥타이
  re_alpenglow: () => ({
    hair: [fill('M12 17 V14 C12 11.5 15 10.5 20 10.5 C25 10.5 28 11.5 28 14 V17 C25 15.8 15 15.8 12 17 Z')],
    extra: [TIE, RECT_GLASSES],
  }),
  // 칼랑 담당: 쪽진 머리 + 열린 깃
  re_kallang: () => ({
    back: [dot(20, 8.6, 3.6, 'pt-fill')],
    hair: [fill('M11.8 19.5 C11.5 13 15 10.5 20 10.5 C25 10.5 28.5 13 28.2 19.5 C26 14.5 14 14.5 11.8 19.5 Z')],
    extra: [OPEN_COLLAR],
  }),
  // 템스 키 담당: 옆으로 넘긴 앞머리 + 나비넥타이
  re_thames_quay: () => ({
    hair: [fill('M11.8 19 C11 13 13 10 18 9.5 C23 8 29 10 28.4 17 C25.5 13.5 19 15 15 14.6 C13.6 15.6 12.6 17 11.8 19 Z')],
    extra: [BOW],
  }),
  // 누르 담당: 이마가 뾰족한 머릿수건 + 브로치
  re_nur: () => ({
    back: [fill('M8.5 37 C8 26 8.5 11 20 8.6 C31.5 11 32 26 31.5 37 Z')],
    hair: [fill('M11.5 18.5 C12 12 16 10.2 20 10.2 C24 10.2 28 12 28.5 18.5 L20 14.6 Z')],
    extra: [() => [dot(25.5, 35.5, 1.3, 'pt-paper')]],
  }),
  // 두네스 크레센트 담당: 짧은 머리 + 턱수염 + 열린 깃
  re_dunes_crescent: () => ({
    hair: [fill('M12 18 C11.6 12.5 15 10.4 20 10.4 C25 10.4 28.4 12.5 28 18 C25.5 15 14.5 15 12 18 Z')],
    extra: [OPEN_COLLAR, () => [fill('M12.2 23 C12.5 29 16 31.6 20 31.6 C24 31.6 27.5 29 27.8 23 C26.5 26.5 24 27.9 20 27.9 C16 27.9 13.5 26.5 12.2 23 Z')]],
  }),
};

// 표정: 눈썹·입·땀방울만 바뀐다.
const FACES = {
  neutral: () => [ink('M15 18 H18.5 M21.5 18 H25'), ink('M18 25.6 H22')],
  pleased: () => [ink('M15 18.4 Q16.8 16.8 18.5 18.4 M21.5 18.4 Q23.2 16.8 25 18.4'), ink('M17.2 25 Q20 27.8 22.8 25')],
  troubled: () => [ink('M15 18.2 L18.5 17 M21.5 17 L25 18.2'), ink('M17.6 26.4 Q20 24.6 22.4 26.4'), svg('path', { class: 'pt-drop', d: 'M30.2 13.4 Q32 16.6 30.2 17.4 Q28.4 16.6 30.2 13.4 Z' })],
};

function toneClass(id) {
  if (id.startsWith('re_')) return `seal-re-${reTone(id)}`;
  if (id === 'board_chair') return 'seal-sender-board';
  if (id === 'mentor') return 'seal-sender-mentor';
  return 'seal-client';
}

// 장식(aria-hidden). 이름과 반응은 옆 글자가 말한다.
export function portraitEl(id, mood = 'neutral', { size = 48 } = {}) {
  if (!(id in LOOKS)) return null;
  const look = LOOKS[id]();
  const parts = (list) => (list ?? []).flatMap((p) => (typeof p === 'function' ? p() : [p]));
  return svg('svg', {
    class: `portrait ${toneClass(id)} pt-${mood in FACES ? mood : 'neutral'}`, viewBox: '0 0 40 48',
    width: Math.round(size * 40 / 48), height: size, focusable: 'false', 'aria-hidden': 'true',
  },
    svg('rect', { class: 'seal-bg', x: 2, y: 2, width: 36, height: 44, rx: 4 }),
    fill('M6 43 C7 36.5 12.5 33.5 20 33.5 C27.5 33.5 33 36.5 34 43 Z'),
    paper('M17.2 29 V34 H22.8 V29 Z'),
    ink('M17.2 29.4 V33.6 M22.8 29.4 V33.6', 1),
    ...parts(look.back), // 몸 다음에 그려야 머릿수건이 목을 덮는다
    svg('ellipse', { class: 'pt-face', cx: 20, cy: 21, rx: 8, ry: 9.5 }),
    ...parts(look.hair),
    dot(16.8, 21, 1.1), dot(23.2, 21, 1.1),
    ...parts(look.extra),
    ...FACES[mood in FACES ? mood : 'neutral'](),
    svg('rect', { class: 'pt-ink pt-frame', x: 2, y: 2, width: 36, height: 44, rx: 4, 'stroke-width': 2.4 }),
    svg('rect', { class: 'pt-ink pt-frame', x: 5, y: 5, width: 30, height: 38, rx: 2.5, 'stroke-width': 0.8 }),
  );
}

// 메일 보낸 사람 → 초상 id. 사람이 아닌 곳(규제·시장·시스템, "이사회" 이름만)은 null.
export function mailPortraitId(template, entity) {
  if (entity) return entity.id;
  if (template.from.kind === 'mentor') return 'mentor';
  if (template.from.kind === 'board' && template.from.name_ko.startsWith('이사회 의장')) return 'board_chair';
  return null;
}

// 메일 템플릿 → 표정(화면 상수). 목록에 없으면 기본.
const MAIL_MOOD = {
  pleased: [
    'mail_welcome_board', 'mail_board_rank_top_up', 'mail_board_rank_mid_up', 'mail_board_rank_low_up',
    'mail_board_report_s', 'mail_board_report_a', 'mail_board_season_up', 'mail_board_reputation_flow',
    'mail_evt_capital_inflow', 'mail_reinsurer_hello',
  ],
  troubled: [
    'mail_board_fired', 'mail_board_cash_warning', 'mail_board_cash_penalty',
    'mail_board_rank_top_down', 'mail_board_rank_mid_down', 'mail_board_rank_low_down',
    'mail_board_report_c', 'mail_board_report_d', 'mail_board_season_down', 'mail_board_season_lost',
    'mail_evt_jurong_explosion', 'mail_evt_malacca_collision', 'mail_evt_monsoon_flood_my', 'mail_evt_reinsurer_downgrade',
    'mail_evt_bor_letter_jurong', 'mail_evt_bor_letter_straits', 'mail_evt_bor_letter_nusantara',
    'mail_evt_bor_lost_jurong', 'mail_evt_bor_lost_straits', 'mail_evt_bor_lost_nusantara', 'mail_mentor_lost',
  ],
};

export function mailMood(templateId) {
  if (MAIL_MOOD.pleased.includes(templateId)) return 'pleased';
  if (MAIL_MOOD.troubled.includes(templateId)) return 'troubled';
  return 'neutral';
}

// 결과 → 표정. 재보험사 응답(수락·반제·거절)과 고객 반응(매우 만족·수락·재협상·거부).
export const RESPONSE_MOOD = { accept: 'pleased', counter: 'neutral', reject: 'troubled' };
export const VERDICT_MOOD = { delighted: 'pleased', accept: 'pleased', renegotiate: 'neutral', reject: 'troubled' };
