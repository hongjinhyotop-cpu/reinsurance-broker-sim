// 용어 링크·3단계 카드·도감 화면(design.md §5, §6.7). 기록 규칙은 glossary.js가, 여기서는 그리기만 한다.
// 용어 풀이는 "무슨 뜻인가"만 보여 준다. 숨은 속성이나 협상 계산은 다루지 않는다.

import * as store from '../store.js';
import {
  parseMarkup, indexTerms, collect, getCodex, progressOf, searchTerms, starsOf, stateOf, starText,
  CATEGORIES, CATEGORY_KO, APPEARS_KO,
} from '../glossary.js';
import { h, toast, navigate, gauge } from './components.js';

// ---------- 용어 찾기 ----------

let indexCache = { list: null, map: new Map() };
function termIndex() {
  const list = store.getData()?.glossary ?? [];
  if (indexCache.list !== list) indexCache = { list, map: indexTerms(list) };
  return indexCache.map;
}

// ---------- 링크 ----------

// "한 번 그린 화면 안에서는 같은 용어를 첫 등장만 링크로" 규칙의 장부. main.js가 화면을 그리기 전에, 보드가 다시 그리기 전에 비운다.
let scope = new Set();
export function resetTermScope() {
  scope = new Set();
}

function termButton(term, text) {
  return h('button', {
    type: 'button', class: 'term', 'data-term': term.id, 'aria-haspopup': 'dialog',
    title: '눌러서 뜻 보기', onclick: () => openTermCard(term.id),
  }, text);
}

// 데이터 글(메일·소개글)의 [[id|문구]]를 글자와 링크 버튼 조각 배열로 바꾼다. 이미 나온 용어는 글자로만 둔다.
export function richText(text, { scope: seen = scope } = {}) {
  const terms = termIndex();
  return parseMarkup(text).segments.map((seg) => {
    if (!seg.term) return seg.text;
    const term = terms.get(seg.term);
    const label = seg.label ?? term?.term_ko ?? seg.term;
    if (!term || seen.has(seg.term)) return label;
    seen.add(seg.term);
    return termButton(term, label);
  });
}

// 화면 고정 문구용. gloss가 true면 처음 한 번만 쉬운 말을 괄호로 붙인다("RC(작년 대비 가격 변화)").
export function glossaryLink(id, { label, gloss = false, scope: seen = scope } = {}) {
  const term = termIndex().get(id);
  if (!term) return label ?? id;
  const text = label ?? term.term_ko;
  if (seen.has(id)) return text;
  seen.add(id);
  return termButton(term, gloss && term.gloss_ko ? `${text}(${term.gloss_ko})` : text);
}

// 화면 고정 문구 속 낱말을 용어 링크로 바꾼다. words: [[낱말, 용어 id], ...]. 글에서 처음 나온 낱말만, 화면 첫 등장일 때만 링크가 된다.
export function linkWords(text, words) {
  let parts = [text];
  for (const [word, id] of words) {
    parts = parts.flatMap((part) => {
      if (typeof part !== 'string') return [part];
      const at = part.indexOf(word);
      if (at < 0) return [part];
      return [part.slice(0, at), glossaryLink(id, { label: word }), part.slice(at + word.length)];
    });
  }
  return parts;
}

// ---------- 도감 기록 + 알림 ----------

function record(id, level) {
  const res = collect(id, level);
  if (res.isNew) {
    const ids = [...termIndex().keys()];
    toast(`새 용어 수집! (${progressOf(getCodex(), ids).seen}/${ids.length})`, 'ok');
  }
  if (res.save.failedFirst) toast('도감을 저장하지 못했어요. 이번에 켜 둔 동안만 기억해요.', 'warn');
}

// ---------- 3단계 카드 ----------

const STEP_BUTTON = { 1: '비유 보기 ▾', 2: '실무 표현 보기 ▾' };
let cardDialog = null;
let titleSeq = 0;

// 카드를 치운다. close 이벤트(Esc로 닫을 때)와 버튼으로 닫을 때 모두 여기로 오고, 두 번 불려도 한 번만 일한다.
function discardCard(dlg) {
  if (!dlg.isConnected) return;
  dlg.remove();
  if (cardDialog === dlg) cardDialog = null;
  if (location.hash === '#/codex') store.refresh(); // 도감이 열려 있으면 별을 새로 그린다
}
function closeCard(dlg) {
  dlg.close();
  discardCard(dlg);
}

function levelSection(num, title, ...children) {
  return h('section', { class: 'term-level' }, h('h3', {}, `${num} ${title}`), children);
}

function drawCard(dlg, st) {
  const terms = termIndex();
  const term = terms.get(st.id);
  const stars = starsOf(getCodex().entries[st.id]);
  const inner = new Set([st.id]); // 카드 안에서는 이 용어 자신을 다시 링크로 만들지 않는다
  const body = [
    h('header', { class: 'term-head' },
      h('div', {},
        h('h2', { id: dlg.getAttribute('aria-labelledby') }, term.term_ko),
        term.term_en ? h('p', { class: 'dim term-en', lang: 'en' }, term.term_en) : null),
      h('span', { class: 'term-stars', role: 'img', 'aria-label': `도감 별 3개 중 ${stars}개` }, starText(stars))),
    levelSection('①', '한 줄 설명', h('p', {}, richText(term.level1_ko, { scope: inner }))),
  ];
  if (st.shown >= 2) body.push(levelSection('②', '일상 비유', h('p', {}, richText(term.level2_ko, { scope: inner }))));
  if (st.shown >= 3) {
    const l3 = term.level3;
    body.push(levelSection('③', '실무 표현과 게임 속 예시',
      h('p', {}, richText(l3.industry_ko, { scope: inner })),
      l3.industry_en.length > 0 ? h('ul', { class: 'term-en-list', lang: 'en' }, l3.industry_en.map((e) => h('li', {}, e))) : null,
      h('p', { class: 'term-game' }, h('strong', {}, '게임 속 예시 '), richText(l3.game_example_ko, { scope: inner }))));
  }
  const related = term.related.map((id) => terms.get(id)).filter(Boolean);
  const actions = [
    st.shown < 3 ? h('button', {
      type: 'button', class: 'btn btn-primary', 'data-focus': '1',
      onclick: () => { st.shown += 1; record(st.id, st.shown); drawCard(dlg, st); },
    }, STEP_BUTTON[st.shown]) : null,
    h('button', { type: 'button', class: 'btn', onclick: () => { showInCodex(st.id); closeCard(dlg); navigate('codex'); } }, '도감에서 보기'),
    h('button', { type: 'button', class: 'btn', 'data-focus': st.shown < 3 ? null : '1', onclick: () => closeCard(dlg) }, '닫기'),
  ];
  body.push(
    related.length > 0 ? h('div', { class: 'term-related' },
      h('span', { class: 'dim' }, '관련 용어'),
      related.map((r) => h('button', {
        type: 'button', class: 'chip', onclick: () => { st.id = r.id; st.shown = 1; record(r.id, 1); drawCard(dlg, st); },
      }, r.term_ko))) : null,
    h('div', { class: 'dialog-actions' }, actions));
  dlg.replaceChildren(h('div', { class: 'term-card-body' }, body));
  dlg.querySelector('[data-focus]')?.focus();
}

export function openTermCard(id) {
  if (!termIndex().has(id)) return;
  const st = { id, shown: 1 };
  record(id, 1);
  if (cardDialog?.open) { // 이미 열려 있으면 내용만 바꾼다
    drawCard(cardDialog, st);
    return;
  }
  const dlg = h('dialog', { class: 'dialog term-card', 'aria-labelledby': `term-title-${++titleSeq}` });
  cardDialog = dlg;
  dlg.addEventListener('click', (ev) => { if (ev.target === dlg) closeCard(dlg); }); // 어두운 바깥을 누르면 닫기
  dlg.addEventListener('close', () => discardCard(dlg)); // Esc로 닫을 때
  document.body.append(dlg);
  dlg.showModal();
  drawCard(dlg, st);
}

// ---------- 도감 화면 ----------

let codexCategory = 'all';
let codexStatus = 'all';
let codexQuery = '';
let codexSelected = null;
let codexScroll = 0; // 카드를 눌러 화면이 다시 그려져도 목록 스크롤 자리를 지킨다

export function showInCodex(id) {
  codexSelected = id;
  codexCategory = 'all';
  codexStatus = 'all';
  codexQuery = '';
}

const STATUS_FILTERS = [['all', '전체'], ['seen', '발견'], ['mastered', '마스터']];

function hintText(term) {
  return `${CATEGORY_KO[term.category]} · 이런 곳에서 만날 수 있어요: ${term.appears_in.map((a) => APPEARS_KO[a]).join(', ')}`;
}

function gridCard(term, entry) {
  const st = stateOf(entry);
  return h('button', {
    type: 'button', class: `codex-card codex-${st}${term.id === codexSelected ? ' is-selected' : ''}`, 'data-term': term.id,
    'aria-pressed': term.id === codexSelected ? 'true' : 'false',
    onclick: () => { codexSelected = term.id; store.refresh(); },
  },
    h('span', { class: 'codex-name' }, st === 'unseen' ? '???' : term.term_ko),
    h('span', { class: 'codex-stars', 'aria-label': st === 'unseen' ? '아직 발견하지 못했어요' : `별 ${starsOf(entry)}개` }, starText(starsOf(entry))),
    st === 'unseen' ? h('span', { class: 'dim codex-sub' }, CATEGORY_KO[term.category]) : null);
}

function detailPanel(terms) {
  const term = terms.get(codexSelected);
  if (!term) return h('section', { class: 'card codex-detail' }, h('p', { class: 'dim' }, '왼쪽에서 용어를 골라 보세요. 메일이나 화면에서 점선 밑줄이 그어진 말을 누르면 도감에 모여요.'));
  const entry = getCodex().entries[term.id];
  const st = stateOf(entry);
  if (st === 'unseen') {
    return h('section', { class: 'card codex-detail' },
      h('h2', {}, '???'),
      h('p', {}, '아직 만나지 못한 용어예요.'),
      h('p', { class: 'dim' }, hintText(term)));
  }
  const l3 = term.level3;
  const related = term.related.map((id) => terms.get(id)).filter(Boolean);
  const inner = new Set([term.id]);
  return h('section', { class: 'card codex-detail', 'aria-label': `${term.term_ko} 상세` },
    h('header', { class: 'term-head' },
      h('div', {},
        h('h2', {}, term.term_ko),
        term.term_en ? h('p', { class: 'dim term-en', lang: 'en' }, term.term_en) : null),
      h('span', { class: 'term-stars', role: 'img', 'aria-label': `별 3개 중 ${starsOf(entry)}개` }, starText(starsOf(entry)))),
    st === 'mastered' ? h('p', {}, h('span', { class: 'tag' }, '마스터')) : h('p', { class: 'dim' }, '카드에서 비유와 실무 표현까지 펼쳐 읽으면 별이 채워져요. 여기서 보는 것은 별을 올리지 않아요.'),
    levelSection('①', '한 줄 설명', h('p', {}, richText(term.level1_ko, { scope: inner }))),
    levelSection('②', '일상 비유', h('p', {}, richText(term.level2_ko, { scope: inner }))),
    levelSection('③', '실무 표현과 게임 속 예시',
      h('p', {}, richText(l3.industry_ko, { scope: inner })),
      l3.industry_en.length > 0 ? h('ul', { class: 'term-en-list', lang: 'en' }, l3.industry_en.map((e) => h('li', {}, e))) : null,
      h('p', { class: 'term-game' }, h('strong', {}, '게임 속 예시 '), richText(l3.game_example_ko, { scope: inner }))),
    term.aliases.length > 0 ? h('p', { class: 'dim' }, `다른 말: ${term.aliases.join(', ')}`) : null,
    related.length > 0 ? h('div', { class: 'term-related' },
      h('span', { class: 'dim' }, '관련 용어'),
      related.map((r) => {
        const seen = stateOf(getCodex().entries[r.id]) !== 'unseen';
        return h('button', {
          type: 'button', class: 'chip', disabled: seen ? null : true, title: seen ? null : '아직 만나지 못했어요',
          onclick: () => { codexSelected = r.id; store.refresh(); },
        }, seen ? r.term_ko : '???');
      })) : null);
}

export function renderCodex() {
  const list = store.getData().glossary;
  const terms = termIndex();
  const codex = getCodex();
  const prog = progressOf(codex, list.map((t) => t.id));
  const pct = prog.total === 0 ? 0 : Math.round((prog.seen / prog.total) * 100);

  const search = h('input', {
    type: 'search', id: 'codex-search', class: 'codex-search', value: codexQuery, placeholder: '용어·영어·다른 말로 찾기',
    'aria-label': '도감 검색',
    oninput: (ev) => { codexQuery = ev.target.value; codexScroll = 0; listHost.scrollTop = 0; drawList(); },
  });
  const listHost = h('div', { class: 'codex-list-host', role: 'region', 'aria-label': '용어 목록', tabindex: '0' });
  listHost.addEventListener('scroll', () => { codexScroll = listHost.scrollTop; });
  requestAnimationFrame(() => { listHost.scrollTop = codexScroll; });
  const chips = (items, current, set) => items.map(([id, label]) => h('button', {
    type: 'button', class: `chip${current === id ? ' is-active' : ''}`, 'aria-pressed': current === id ? 'true' : 'false',
    onclick: () => { set(id); store.refresh(); },
  }, label));

  function drawList() {
    const rows = searchTerms(list, getCodex(), { query: codexQuery, category: codexCategory, status: codexStatus });
    listHost.replaceChildren(
      h('p', { class: 'dim codex-count', role: 'status' }, `${rows.length}개`),
      rows.length === 0
        ? h('p', { class: 'dim' }, '조건에 맞는 용어가 없어요. 아직 만나지 못한 용어는 이름으로 찾을 수 없어요.')
        : h('div', { class: 'codex-grid' }, rows.map((t) => gridCard(t, getCodex().entries[t.id]))));
  }
  drawList();

  return h('div', { class: 'screen screen-wide' },
    h('h1', {}, '용어 도감'),
    h('p', { class: 'dim' }, '메일과 화면에서 점선 밑줄이 그어진 말을 누르면 뜻이 카드로 나오고, 읽은 용어가 여기에 모여요. 도감은 새 게임을 시작해도 남아요.'),
    h('section', { class: 'card codex-progress', 'aria-label': '수집 현황' },
      h('p', {}, h('strong', {}, `발견 ${prog.seen} / ${prog.total}`), h('span', { class: 'dim' }, ` · 마스터 ${prog.mastered}`)),
      gauge(pct)),
    h('div', { class: 'filters', role: 'group', 'aria-label': '카테고리' },
      chips([['all', `전체 ${list.length}`], ...CATEGORIES.filter((c) => list.some((t) => t.category === c)).map((c) => [c, `${CATEGORY_KO[c]} ${list.filter((t) => t.category === c).length}`])], codexCategory, (v) => { codexCategory = v; codexScroll = 0; })),
    h('div', { class: 'filters', role: 'group', 'aria-label': '상태' }, chips(STATUS_FILTERS, codexStatus, (v) => { codexStatus = v; codexScroll = 0; })),
    h('div', { class: 'field codex-search-field' }, h('label', { for: 'codex-search' }, '검색'), search),
    h('div', { class: 'codex' }, listHost, detailPanel(terms)));
}
