// 용어집: [[id|표시문구]] 파싱, 도감 기록 규칙(순수), 도감 저장(rbs:codex:v1). design.md §5.
// 파싱·기록 규칙은 DOM을 모르는 순수 함수. 저장소 접근은 아래 "저장" 구역에만 있고 전부 try/catch다.

export const TERM_ID_RE = /^gl_[a-z0-9_]+$/;
export const CATEGORIES = ['basic', 'structure', 'placement', 'pricing', 'market', 'security', 'takaful', 'sg', 'game'];
export const CATEGORY_KO = {
  basic: '기본', structure: '구조', placement: '플레이스먼트', pricing: '가격', market: '시장·절차',
  security: '신용·규제', takaful: '타카풀', sg: '싱가포르', game: '게임 규칙',
};
export const APPEARS_IN = ['inbox', 'database', 'placement', 'calendar', 'settings', 'standings', 'review'];
export const APPEARS_KO = { inbox: '인박스 메일', database: '고객·재보험사 DB', placement: '플레이스먼트 보드', calendar: '캘린더', settings: '설정', standings: '순위표', review: '시즌 리뷰' };

// 화면 고정 문구(glossaryLink)에서 쓰는 용어 id. 데이터 글에는 안 나오는 용어가 "안 쓰임" 경고로 잡히지 않게 로더가 본다.
// UI에서 glossaryLink('gl_…')를 새로 쓰면 여기에도 적는다(테스트가 존재 여부를 검사한다).
export const UI_TERM_IDS = [
  'gl_rate_change', 'gl_line', 'gl_panel', 'gl_inception', 'gl_treaty', 'gl_single_share', 'gl_rating', 'gl_capacity',
  'gl_shariah', 'gl_ap', 'gl_cedant', 'gl_reinsurer', 'gl_retention', 'gl_xol', 'gl_quota_share', 'gl_counter_offer', 'gl_renewal',
  'gl_brokerage', 'gl_placed_premium', 'gl_compliance',
  // M7c: 순위표·시즌 리뷰·보드·DB·설정의 고정 문구
  'gl_limit', 'gl_expiring', 'gl_premium', 'gl_signed_line', 'gl_overhead', 'gl_fine', 'gl_receivable', 'gl_cover_gap',
  'gl_board_trust', 'gl_reputation', 'gl_report_card', 'gl_regulatory_inspection', 'gl_shariah_board', 'gl_downgrade',
  'gl_bor_letter', 'gl_primary_insurer', 'gl_rate_change',
];

// ---------- [[id|표시문구]] 파싱 ----------

const MARKUP_RE = /\[\[([^[\]|]*)(?:\|([^[\]|]*))?\]\]/g;

// 글을 { text } / { term, label } 조각으로 나눈다. problems는 로더가 보여 줄 문제 목록(없으면 []).
export function parseMarkup(text) {
  const segments = [];
  const problems = [];
  let last = 0;
  for (const m of text.matchAll(MARKUP_RE)) {
    if (m.index > last) segments.push({ text: text.slice(last, m.index) });
    const id = m[1].trim();
    const label = m[2] === undefined ? null : m[2];
    if (!TERM_ID_RE.test(id)) problems.push({ kind: 'bad_id', id });
    else if (label !== null && label.trim() === '') problems.push({ kind: 'empty_label', id });
    else segments.push({ term: id, label });
    last = m.index + m[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last) });
  // 정상 마크업을 걷어내고도 [[ 나 ]] 가 남아 있으면 짝이 안 맞는 것이다.
  const rest = text.replace(MARKUP_RE, '');
  if (rest.includes('[[') || rest.includes(']]')) problems.push({ kind: 'unbalanced' });
  return { segments, problems };
}

export function termIdsIn(text) {
  return parseMarkup(text).segments.filter((s) => s.term).map((s) => s.term);
}

export function indexTerms(list) {
  return new Map(list.map((t) => [t.id, t]));
}

// ---------- 도감 기록 규칙(순수) ----------

export const CODEX_VERSION = 1;
export const emptyCodex = () => ({ version: CODEX_VERSION, entries: {} });

export const starsOf = (entry) => (entry ? Math.min(3, Math.max(0, entry.levels)) : 0);
export const stateOf = (entry) => (starsOf(entry) >= 3 ? 'mastered' : starsOf(entry) >= 1 ? 'seen' : 'unseen');
export const starText = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);

// 카드를 level단계까지 읽었다고 기록한다. 가장 높이 본 단계만 남기고, 낮은 단계를 다시 열어도 내려가지 않는다.
export function recordLevel(codex, id, level, nowIso) {
  const prev = codex.entries[id];
  const levels = Math.max(prev?.levels ?? 0, level);
  if (prev && prev.levels === levels) return { codex, isNew: false, changed: false };
  const entry = { levels, first_seen: prev?.first_seen ?? nowIso };
  return { codex: { ...codex, entries: { ...codex.entries, [id]: entry } }, isNew: !prev, changed: true };
}

// 용어집에 있는 id만 센다(용어가 사라진 옛 기록은 지우지 않되 세지 않는다).
export function progressOf(codex, termIds) {
  let seen = 0;
  let mastered = 0;
  for (const id of termIds) {
    const st = stateOf(codex.entries[id]);
    if (st !== 'unseen') seen++;
    if (st === 'mastered') mastered++;
  }
  return { seen, mastered, total: termIds.length };
}

// 저장소에서 읽은 값을 점검한다. 모양이 틀린 항목은 버리고, 버전이 모르는 것이면 null을 돌려준다.
export function sanitizeCodex(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (raw.version !== CODEX_VERSION) return null;
  if (raw.entries === null || typeof raw.entries !== 'object' || Array.isArray(raw.entries)) return null;
  const entries = {};
  for (const [id, e] of Object.entries(raw.entries)) {
    if (!TERM_ID_RE.test(id) || id === '__proto__' || e === null || typeof e !== 'object') continue;
    if (!Number.isInteger(e.levels) || e.levels < 1 || e.levels > 3) continue;
    entries[id] = { levels: e.levels, first_seen: typeof e.first_seen === 'string' ? e.first_seen : '' };
  }
  return { version: CODEX_VERSION, entries };
}

// 도감 검색. 발견하지 못한 용어는 이름이 드러나지 않도록 검색에서 뺀다(카테고리 필터는 적용).
export function searchTerms(terms, codex, { query = '', category = 'all', status = 'all' } = {}) {
  const q = query.trim().toLowerCase();
  return terms.filter((t) => {
    const st = stateOf(codex.entries[t.id]);
    if (category !== 'all' && t.category !== category) return false;
    if (status === 'seen' && st === 'unseen') return false;
    if (status === 'mastered' && st !== 'mastered') return false;
    if (q === '') return true;
    if (st === 'unseen') return false;
    return [t.term_ko, t.term_en ?? '', ...t.aliases].some((s) => s.toLowerCase().includes(q));
  });
}

// ---------- 저장 (rbs:codex:v1) ----------

export const CODEX_KEY = 'rbs:codex:v1';
let storageOverride = null; // 테스트가 가짜 저장소를 꽂는 자리
let current = null; // 읽어 둔 도감(모듈이 들고 있는 단일 사본)
let writable = true; // 모르는 버전의 값이 있으면 덮어쓰지 않는다
let writeWarned = false;

export function useCodexStorage(adapter) {
  storageOverride = adapter;
  current = null;
  writable = true;
  writeWarned = false;
}

function getStorage() {
  if (storageOverride) return storageOverride;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadCodex() {
  const st = getStorage();
  let text = null;
  if (st) {
    try {
      text = st.getItem(CODEX_KEY);
    } catch {
      text = null;
    }
  }
  writable = true;
  current = emptyCodex();
  if (text === null || text === undefined) return current;
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  const clean = sanitizeCodex(parsed);
  if (clean) current = clean;
  else if (parsed && typeof parsed === 'object' && Number.isInteger(parsed.version) && parsed.version > CODEX_VERSION) writable = false; // 더 새로운 버전은 건드리지 않는다
  return current;
}

export function getCodex() {
  return current ?? loadCodex();
}

// 저장에 실패해도 이번 세션 동안은 메모리에 남는다. 처음 실패했을 때만 failedFirst=true.
function persist(codex) {
  current = codex;
  if (!writable) return { ok: false, failedFirst: false };
  const st = getStorage();
  try {
    if (!st) throw new Error('no storage');
    st.setItem(CODEX_KEY, JSON.stringify(codex));
    return { ok: true, failedFirst: false };
  } catch {
    const failedFirst = !writeWarned;
    writeWarned = true;
    return { ok: false, failedFirst };
  }
}

// 카드를 level단계까지 읽었다고 기록하고 저장한다.
export function collect(id, level, nowIso = new Date().toISOString()) {
  const res = recordLevel(getCodex(), id, level, nowIso);
  if (!res.changed) return { isNew: false, changed: false, save: { ok: true, failedFirst: false } };
  return { isNew: res.isNew, changed: true, save: persist(res.codex) };
}

export function resetCodex() {
  writable = true;
  return persist(emptyCodex());
}
