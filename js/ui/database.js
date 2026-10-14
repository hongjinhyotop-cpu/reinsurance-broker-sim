// 고객·재보험사 DB 화면(design.md §6.2): 표 + 상세(프로필 / 스카우트 리포트). 숨은 속성은 reveal.js를 거친 값만 보여 준다.

import * as store from '../store.js';
import { ATTRS, revealAttr, stageOf, awareness } from '../reveal.js';
import { unlockedNotes } from '../scouting.js';
import { liveClients, liveReinsurers } from '../live.js';
import { meet, meetBlockReason } from '../turn.js';
import { h, toast, rangeBar, gauge } from './components.js';
import { richText, glossaryLink } from './glossary_view.js';
import { sealFor } from './seals.js';

const ATTR_LABEL = { conservatism: '보수성', price_sensitivity: '가격 민감도', loyalty: '관계 충성도' };
const ATTR_HELP = {
  conservatism: '새로운 구조·신규 거래·낯선 재보험사를 얼마나 꺼리는지',
  price_sensitivity: '가격을 얼마나 우선하는지',
  loyalty: '관계가 얼마나 오래, 깊게 이어지는지',
};
const LABEL_KO = { low: '낮음', mid: '보통', high: '높음', unclear: '불명' };
const STAGE_KO = { unknown: '미확인', blurred: '흐림', sharp: '선명', exact: '확정' };
const LINE_KO = { property_energy: '재산·에너지', marine_cargo: '해상화물', takaful_general: '일반 타카풀' };
const KIND_KO = {
  local_insurer: '국내 손해보험사', marine_specialist: '해상 전문 보험사', takaful_group: '타카풀 그룹',
  global_reinsurer: '글로벌 재보험사', regional_reinsurer: '지역 재보험사', syndicate: '신디케이트', retakaful: '리타카풀',
};
const TOPIC_LABEL = {
  client: {
    general: '일반 — 안부와 근황',
    conservatism: '구조·신규 거래 이야기',
    price_sensitivity: '예산·목표 이야기',
    loyalty: '장기 관계·타 브로커 접촉 이야기',
  },
  reinsurer: {
    general: '일반 — 안부와 근황',
    conservatism: '구조·신규 거래 이야기',
    price_sensitivity: '가격 기준·목표 손해율 이야기',
    loyalty: '장기 관계·타 브로커 접촉 이야기',
  },
};
const GROUP_KO = { client: '고객', reinsurer: '재보험사' };

// 화면이 다시 그려져도 고른 항목이 남도록 모듈에 둔다. 게임이 바뀌면(generation) 비운다.
let uiGeneration = -1;
let group = 'client'; // 'client' | 'reinsurer'
let selectedId = null;
let detailTab = 'report'; // 'profile' | 'report'
let topic = 'general';
let lastMeeting = null; // { id, topicLabel, newNotes, stageUps }

function entitiesOf(data, state, kind) {
  const defs = kind === 'client' ? liveClients(state, data.clients) : liveReinsurers(state, data.reinsurers); // 사건이 바꾼 등급·용량·요구 조건
  const dyn = kind === 'client' ? state.entities.clients : state.entities.reinsurers;
  return defs.map((def) => ({ def, dyn: dyn[def.id] }));
}

function ratingOf(def) {
  if (def.profile) return def.profile.rating;
  return def.live?.downgraded ? `${def.rating} (강등, 원래 ${def.live.baseRating})` : def.rating;
}

function scaleText(def) {
  if (def.profile) return `수입보험료 $${def.profile.gwp_usd_m}m`;
  const total = Object.values(def.capacity_usd_m).reduce((a, b) => a + b, 0);
  return `총 용량 $${Math.round(total * 10) / 10}m${def.live?.capacityShrunk ? ' (일시 축소)' : ''}`;
}

function renderTable(rows, kind) {
  return h('table', { class: 'table db-table' },
    h('caption', { class: 'visually-hidden' }, `${GROUP_KO[kind]} 목록`),
    h('thead', {}, h('tr', {},
      ['이름', glossaryLink('gl_rating', { label: '등급', gloss: true }), kind === 'client' ? '규모' : glossaryLink('gl_capacity', { label: '용량', gloss: true }), '관계도', '파악도', '미팅'].map((t, i) => h('th', { scope: 'col', class: i >= 3 ? 'num' : null }, t)))),
    h('tbody', {}, rows.map(({ def, dyn }) => h('tr', { class: def.id === selectedId ? 'is-selected' : null },
      h('th', { scope: 'row' },
        h('span', { class: 'db-name' },
          sealFor(def.id, { size: 24 }),
          h('button', {
            type: 'button', class: 'link-btn', 'aria-current': def.id === selectedId ? 'true' : null,
            onclick: () => { selectedId = def.id; lastMeeting = null; store.refresh(); },
          }, def.name_ko))),
      h('td', {}, ratingOf(def)),
      h('td', {}, scaleText(def)),
      h('td', { class: 'num' }, String(Math.round(dyn.relationship))),
      h('td', { class: 'num' }, `${awareness(dyn.scout)}%`),
      h('td', { class: 'num' }, `${dyn.meetings}회`)))));
}

function renderProfile(def, dyn, kind) {
  const info = [];
  const add = (k, v) => info.push(h('dt', {}, k), h('dd', {}, v));
  add('영문 이름', def.name);
  add('종류', KIND_KO[def.kind] ?? def.kind);
  add('소재지', def.hq);
  add('등급', ratingOf(def));
  if (kind === 'client') {
    add('라인', def.profile.lines.map((l) => LINE_KO[l]).join(', '));
    add('수입보험료', `$${def.profile.gwp_usd_m}m`);
    add('담당자', `${def.profile.contact.name} (${def.profile.contact.title})`);
    const r = def.requirements;
    add('요구 조건', [
      '재보험사 최소 ', glossaryLink('gl_rating', { label: '등급' }), ` ${r.min_rating} · `,
      glossaryLink('gl_single_share'), ` ${Math.round(r.max_single_share * 100)}%`,
      r.shariah_required ? [' · ', glossaryLink('gl_shariah', { label: '샤리아' }), ` 준수 필수(일반 재보험사 ${Math.round(r.shariah_conventional_cap * 100)}%까지)`] : null,
    ]);
  } else {
    add('담당자', `${def.contact.name} (${def.contact.title})`);
    add('싱가포르 지점', def.onshore ? '있음' : '없음');
    add(glossaryLink('gl_shariah', { label: '샤리아 준수' }), def.shariah_ok ? '가능' : '해당 없음');
    add(glossaryLink('gl_capacity', { label: '인수 용량' }), Object.entries(def.capacity_usd_m).filter(([, v]) => v > 0).map(([l, v]) => `${LINE_KO[l]} $${Math.round(v * 10) / 10}m`).join(' · ') + (def.live?.capacityShrunk ? ' (일시 축소 중)' : ''));
  }
  add('관계도', `${Math.round(dyn.relationship)} / 100`);
  const intro = kind === 'client' ? def.profile.intro_ko : def.intro_ko;
  return h('div', {},
    h('p', { class: 'db-intro' }, richText(intro)),
    h('dl', { class: 'info-list' }, info),
    kind === 'client'
      ? h('p', { class: 'dim' }, '이 고객은 보험을 직접 파는 ', glossaryLink('gl_primary_insurer'), '이고, 재보험을 사는 쪽, 곧 ', glossaryLink('gl_cedant'), '예요.')
      : h('p', { class: 'dim' }, '이곳은 위험을 넘겨받는 ', glossaryLink('gl_reinsurer'), '예요.'),
    h('p', { class: 'dim' }, '이름과 회사는 모두 가상이에요.'));
}

function attrRow(def, dyn, attr, seed, cfg) {
  const r = revealAttr({ value: def.hidden[attr], s: dyn.scout[attr], entityId: def.id, attr, seed }, cfg);
  let reading;
  if (r.stage === 'unknown') {
    reading = h('div', { class: 'attr-reading' },
      h('span', { class: 'attr-unknown', 'aria-label': '아직 알 수 없음' }, '???'),
      h('span', { class: 'dim' }, '미팅으로 알아내기'));
  } else {
    const range = r.stage === 'exact' ? `${r.exact}` : `${r.lo} ~ ${r.hi}`;
    reading = h('div', { class: 'attr-reading' },
      rangeBar(r.lo, r.hi),
      h('span', { class: `attr-label attr-${r.label}` }, LABEL_KO[r.label]),
      h('span', { class: 'dim' }, `${r.stage === 'exact' ? '정확한 값' : '추정 범위'} ${range}`));
  }
  return h('div', { class: 'attr-row' },
    h('div', { class: 'attr-head' },
      h('h3', {}, ATTR_LABEL[attr]),
      h('span', { class: `tag stage-${r.stage}` }, STAGE_KO[r.stage])),
    h('p', { class: 'dim attr-help' }, ATTR_HELP[attr]),
    reading,
    h('div', { class: 'attr-scout' },
      h('span', { class: 'dim' }, `스카우트 값 ${Math.round(dyn.scout[attr])}`),
      gauge(dyn.scout[attr], [cfg.stage_thresholds.blurred, cfg.stage_thresholds.sharp, cfg.stage_thresholds.exact])));
}

function onMeet(kind, def) {
  const res = meet(kind, def.id, topic);
  if (!res.ok) { toast(res.error, 'warn'); return; }
  const cfg = store.getData().config.scouting;
  const topicLabel = TOPIC_LABEL[kind][topic];
  // 단계가 올라간 속성(??? → 흐림 등)을 알려 주려고 미팅 전후 단계를 비교한다.
  const stageUps = ATTRS
    .map((a) => ({ a, from: stageOf(res.before[a], cfg), to: stageOf(res.after[a], cfg) }))
    .filter((x) => x.from !== x.to);
  lastMeeting = { id: def.id, topicLabel, newNotes: res.newNotes, stageUps, reaction: def.meeting_reactions[topic] };
  const bits = [`${def.name_ko}와 미팅했어요`];
  if (stageUps.length > 0) bits.push(stageUps.map((x) => `${ATTR_LABEL[x.a]} ${STAGE_KO[x.to]}`).join(', '));
  if (res.newNotes.length > 0) bits.push(`새 단서 ${res.newNotes.length}개`);
  toast(bits.join(' · '), 'ok');
  store.refresh();
}

function renderMeetingBox(def, kind, state, data) {
  const cost = data.config.scouting.meeting_ap;
  const reason = meetBlockReason(data, state, kind, def.id, topic);
  return h('div', { class: 'meet-box card-memo' },
    h('label', { for: 'meet-topic' }, '미팅 주제'),
    h('select', {
      id: 'meet-topic',
      onchange: (ev) => { topic = ev.target.value; store.refresh(); },
    }, Object.entries(TOPIC_LABEL[kind]).map(([id, label]) => h('option', { value: id, selected: id === topic ? true : null }, label))),
    h('button', {
      type: 'button', class: 'btn btn-primary', disabled: reason ? true : null, title: reason ?? null,
      onclick: () => onMeet(kind, def),
    }, `미팅 잡기 (행동 ${cost}점)`),
    h('span', { class: 'dim' }, `남은 행동 점수 ${state.ap}점`),
    reason ? h('small', { class: 'continue-hint', role: 'status' }, reason) : null);
}

function renderReport(def, dyn, kind, state, data) {
  const cfg = data.config.scouting;
  const notes = unlockedNotes(def.scout_notes, dyn.scout);
  const locked = def.scout_notes.length - notes.length;
  const fresh = lastMeeting && lastMeeting.id === def.id ? lastMeeting : null;

  const parts = [renderMeetingBox(def, kind, state, data)];
  if (fresh) {
    parts.push(h('div', { class: 'notice fresh-box', role: 'status' },
      // 상대의 반응 한 줄: 성격 이름 없이 말투와 행동으로만 드러난다(design.md §4.3).
      h('blockquote', { class: 'clue reaction' }, h('p', {}, fresh.reaction), h('footer', { class: 'dim' }, `${def.name_ko} · ${fresh.topicLabel}`)),
      h('strong', {}, `방금 알게 된 것 (${fresh.topicLabel})`),
      h('ul', { class: 'plain-list' },
        fresh.stageUps.length === 0 && fresh.newNotes.length === 0
          ? h('li', {}, '이번 미팅에서는 새로 열린 단계나 단서가 없었어요. 범위는 조금 좁아졌을 수 있어요.')
          : [
            fresh.stageUps.map((x) => h('li', {}, `${ATTR_LABEL[x.a]}: ${STAGE_KO[x.from]} → ${STAGE_KO[x.to]}`)),
            fresh.newNotes.map((n) => h('li', {}, `새 단서 — ${ATTR_LABEL[n.attr]}`)),
          ])));
  }
  parts.push(h('div', { class: 'attr-list' }, ATTRS.map((a) => attrRow(def, dyn, a, state.seed, cfg))));
  parts.push(h('section', { class: 'clues' },
    h('h3', {}, '단서 메모'),
    notes.length === 0 ? h('p', { class: 'dim' }, '아직 읽을 수 있는 단서가 없어요. 미팅을 더 해 보세요.') : null,
    notes.map((n) => h('blockquote', { class: 'clue' },
      h('p', {}, n.text_ko),
      h('footer', { class: 'dim' }, ATTR_LABEL[n.attr]))),
    locked > 0 ? h('p', { class: 'dim' }, `아직 읽지 못한 단서가 ${locked}개 더 있어요.`) : null));
  return h('div', {}, parts);
}

export function renderDatabase() {
  const data = store.getData();
  const state = store.getState();
  if (uiGeneration !== store.getGeneration()) {
    uiGeneration = store.getGeneration();
    group = 'client'; selectedId = null; detailTab = 'report'; topic = 'general'; lastMeeting = null;
  }
  const rows = entitiesOf(data, state, group);
  if (!rows.some((r) => r.def.id === selectedId)) selectedId = rows[0]?.def.id ?? null;
  const current = rows.find((r) => r.def.id === selectedId) ?? null;

  const table = renderTable(rows, group); // 화면 위쪽(표 머리)에서 용어 링크가 먼저 생기도록 상세보다 먼저 만든다
  const detail = current
    ? h('section', { class: 'db-detail card', 'aria-label': `${current.def.name_ko} 상세` },
      h('header', { class: 'db-detail-head' },
        sealFor(current.def.id, { size: 48 }),
        h('div', {},
          h('h2', {}, current.def.name_ko),
          h('p', { class: 'dim' }, `${KIND_KO[current.def.kind]} · 파악도 ${awareness(current.dyn.scout)}%`))),
      h('div', { class: 'filters', role: 'group', 'aria-label': '상세 탭' },
        [['report', '스카우트 리포트'], ['profile', '프로필']].map(([id, label]) => h('button', {
          type: 'button', class: `chip${detailTab === id ? ' is-active' : ''}`, 'aria-pressed': detailTab === id ? 'true' : 'false',
          onclick: () => { detailTab = id; store.refresh(); },
        }, label))),
      detailTab === 'profile' ? renderProfile(current.def, current.dyn, group) : renderReport(current.def, current.dyn, group, state, data))
    : null;

  return h('div', { class: 'screen screen-wide' },
    h('h1', {}, '고객·재보험사 DB'),
    h('p', { class: 'dim' }, '미팅을 할수록 상대의 숨은 성격이 ??? → 넓은 범위 → 좁은 범위 → 확정 순서로 드러나요.'),
    h('div', { class: 'filters', role: 'group', 'aria-label': '목록 종류' },
      ['client', 'reinsurer'].map((k) => h('button', {
        type: 'button', class: `chip${group === k ? ' is-active' : ''}`, 'aria-pressed': group === k ? 'true' : 'false',
        onclick: () => { group = k; selectedId = null; topic = 'general'; lastMeeting = null; store.refresh(); },
      }, `${GROUP_KO[k]} ${(k === 'client' ? data.clients : data.reinsurers).length}`))),
    h('div', { class: 'db' },
      h('section', { class: 'db-list card card-ledger', 'aria-label': `${GROUP_KO[group]} 목록` }, table),
      detail));
}
