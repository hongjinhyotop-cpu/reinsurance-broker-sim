// 게임 상태 보관 + localStorage 세이브/로드/마이그레이션(design.md §10.9).
// 상태를 바꾸는 코드는 이 파일(과 이후의 effects)만 가진다. 저장소 접근은 전부 try/catch.

import { nextFloat, normalizeSeed } from './rng.js';

export const SAVE_VERSION = 4; // 세이브 "구조"의 버전. 구조를 바꾸면 올리고 MIGRATIONS에 변환을 추가한다.
export const SLOTS = ['auto', '1', '2', '3'];
export const MANUAL_SLOTS = ['1', '2', '3'];
const KEY_PREFIX = 'rbs:save:v1:'; // 키 형식 버전(구조 버전과 별개)
const MAX_SAVE_CHARS = 2_000_000; // 가져오기 파일 크기 방어선

// 구조가 바뀔 때마다 { [옛 버전]: (state) => 새 구조 } 를 한 줄씩 추가한다.
// v1→v2(M3): 비어 있던 entities에 고객·재보험사의 동적 상태를 채운다.
// v2→v3(M5b): 비어 있던 treaties에 트리티별 협상 상태를 채우고, 재보험사에 patience 자리를 보장한다.
// v3→v4: 트리티에 고객 반응의 이유 종류(verdict_reason)를 더한다.
export const MIGRATIONS = {
  1: (s) => fillEntities({ ...s, entities: { clients: { ...s.entities?.clients }, reinsurers: { ...s.entities?.reinsurers } } }),
  2: (s) => fillTreaties({
    ...s,
    entities: { ...s.entities, reinsurers: Object.fromEntries(Object.entries(s.entities?.reinsurers ?? {}).map(([id, e]) => [id, { patience: {}, ...e }])) },
    treaties: { ...s.treaties },
  }),
  3: (s) => ({
    ...s,
    treaties: Object.fromEntries(Object.entries(s.treaties ?? {}).map(([id, t]) => [id, { verdict_reason: null, ...t }])),
  }),
};

let ctx = null; // { config, calendar } — loader가 검증한 정적 데이터
let state = null;
let generation = 0; // 게임이 통째로 바뀔 때마다 +1 (화면이 임시 표시를 비울 때 쓴다)
let storageOverride = null; // 테스트가 가짜 저장소를 꽂는 자리
const listeners = new Set();

export function configure(data) {
  ctx = data;
}
export function getData() {
  return ctx;
}
export function getState() {
  return state;
}
export function hasGame() {
  return state !== null;
}
export function getGeneration() {
  return generation;
}
export function useStorage(adapter) {
  storageOverride = adapter;
}

// 'game' = 게임이 새로 시작/교체됨, 'state' = 진행 중인 게임 안에서 값이 바뀜, 'slots' = 저장 슬롯 내용이 바뀜
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(type) {
  for (const fn of listeners) {
    try {
      fn(type);
    } catch (e) {
      console.error('store listener 오류', e);
    }
  }
}

// ---------- 저장소 접근 ----------

function getStorage() {
  if (storageOverride) return storageOverride;
  try {
    return window.localStorage;
  } catch {
    return null; // 개인정보 보호 모드·쿠키 차단 등
  }
}

export function storageAvailable() {
  const st = getStorage();
  if (!st) return false;
  try {
    st.setItem('rbs:probe', '1');
    st.removeItem('rbs:probe');
    return true;
  } catch {
    return false;
  }
}

function readSlotText(slot) {
  const st = getStorage();
  if (!st) return { ok: false, error: '이 브라우저에서는 저장소를 쓸 수 없어요' };
  try {
    return { ok: true, text: st.getItem(KEY_PREFIX + slot) };
  } catch {
    return { ok: false, error: '저장소를 읽지 못했어요' };
  }
}

// ---------- 새 게임 / 난수 ----------

// 정적 데이터의 initial에서 고객·재보험사의 동적 상태를 만든다. 이미 있는 항목은 건드리지 않는다(새로 생긴 id만 채움).
function fillEntities(s) {
  for (const [group, list, extra] of [['clients', ctx.clients ?? [], () => ({})], ['reinsurers', ctx.reinsurers ?? [], () => ({ patience: {} })]]) {
    for (const e of list) {
      if (s.entities[group][e.id]) continue;
      // 재보험사마다 patience 객체가 따로여야 한다(공유하면 한 곳의 인내심이 모두에게 번진다).
      s.entities[group][e.id] = { relationship: e.initial.relationship, meetings: 0, notes: '', ...extra(), scout: { ...e.initial.scout } };
    }
  }
  return s;
}

// 트리티마다 협상 상태 한 칸. 이미 있는 항목은 건드리지 않는다.
export function initialTreatyState(t) {
  return {
    phase: 'open', prep_quality: 0, target_rc: t.target_rc, terms: t.terms.preferred, structure_option: '', panel: [],
    retry_turn: 0, renegotiations: 0, rejections: 0, moves: 0, verdict: null, verdict_reason: null, final_rc: null, obligations: [],
  };
}

function fillTreaties(s) {
  for (const t of ctx.treaties ?? []) if (!s.treaties[t.id]) s.treaties[t.id] = initialTreatyState(t);
  return s;
}

export function newGame({ seed } = {}) {
  const g = ctx.config.game;
  const s = normalizeSeed(seed);
  state = {
    version: SAVE_VERSION,
    seed: s,
    rng_state: s,
    turn: g.start_turn,
    ap: g.ap_per_week,
    player: {
      firm: g.firm_name,
      cash_usd_m: g.start_cash_usd_m,
      reputation: g.start_reputation,
      compliance: g.start_compliance,
      board_confidence: g.start_board_confidence,
      market_intel: g.start_market_intel,
      flags: [],
    },
    market: { index: g.start_market_index },
    entities: { clients: {}, reinsurers: {} },
    treaties: {},
    mails: [],
    scheduled: [],
    fired_events: [],
    modifiers: [],
    log: [],
  };
  fillEntities(state);
  fillTreaties(state);
  generation += 1;
  emit('game');
  return state;
}

// 게임 규칙에서 난수가 필요하면 반드시 이 함수를 쓴다(상태가 세이브에 같이 들어간다).
export function random() {
  if (!state) throw new Error('진행 중인 게임이 없어요');
  const r = nextFloat(state.rng_state);
  state.rng_state = r.state;
  return r.value;
}

// 진행 중인 게임의 상태를 바꾸는 유일한 문. fn(state) 안에서 고치고, 끝나면 화면에 알린다.
// quiet: 입력칸 편집처럼 호출한 화면이 스스로 다시 그릴 때(전체 화면 갱신이 입력 중 포커스를 빼앗지 않게) 알림을 생략한다.
export function commit(fn, { quiet = false } = {}) {
  if (!state) throw new Error('진행 중인 게임이 없어요');
  const result = fn(state);
  if (!quiet) emit('state');
  return result;
}

// 화면 쪽 선택(고른 메일·필터)이 바뀌어 다시 그려야 할 때. 게임 상태는 건드리지 않는다.
export function refresh() {
  emit('state');
}

export function quitToStart() {
  state = null;
  generation += 1;
  emit('game');
}

// ---------- 검증 / 마이그레이션 ----------

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const isNum = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

const TREATY_PHASES = ['open', 'placed'];
const ROW_STATUSES = ['draft', 'accepted', 'countered', 'rejected'];
const VERDICTS = ['delighted', 'accept', 'renegotiate', 'reject'];
const VERDICT_REASONS = ['price', 'security', 'continuity', 'terms', 'service', 'structure'];

// 트리티 협상 상태(M5b)와 재보험사 인내심의 모양을 확인한다.
function validateTreatyStates(s, bad) {
  const known = new Set((ctx.treaties ?? []).map((t) => t.id));
  const reIds = new Set((ctx.reinsurers ?? []).map((r) => r.id));
  for (const [id, t] of Object.entries(s.treaties)) {
    const p = `treaties.${id}`;
    if (!isObj(t)) { bad(p, '객체여야 해요'); continue; }
    if (ctx.treaties && !known.has(id)) bad(p, '없는 트리티 id예요');
    if (!TREATY_PHASES.includes(t.phase)) bad(`${p}.phase`, `${TREATY_PHASES.join(' / ')} 중 하나여야 해요`);
    if (typeof t.terms !== 'string') bad(`${p}.terms`, '글자여야 해요');
    if (typeof t.structure_option !== 'string') bad(`${p}.structure_option`, '글자여야 해요');
    if (!isNum(t.target_rc, -100, 100)) bad(`${p}.target_rc`, '숫자여야 해요');
    if (!isInt(t.retry_turn, 0, 999)) bad(`${p}.retry_turn`, '0 이상 정수여야 해요');
    for (const k of ['renegotiations', 'rejections', 'moves']) if (!isInt(t[k], 0, 9999)) bad(`${p}.${k}`, '0 이상 정수여야 해요');
    if (t.verdict !== null && !VERDICTS.includes(t.verdict)) bad(`${p}.verdict`, '고객 반응 라벨이거나 null이어야 해요');
    if (t.verdict_reason !== null && !VERDICT_REASONS.includes(t.verdict_reason)) bad(`${p}.verdict_reason`, '이유 종류이거나 null이어야 해요');
    if (t.final_rc !== null && !isNum(t.final_rc, -100, 100)) bad(`${p}.final_rc`, '숫자 또는 null이어야 해요');
    if (!Array.isArray(t.panel)) { bad(`${p}.panel`, '목록이어야 해요'); continue; }
    const seen = new Set();
    t.panel.forEach((row, i) => {
      const q = `${p}.panel[${i}]`;
      if (!isObj(row)) return bad(q, '객체여야 해요');
      if (typeof row.re !== 'string' || (ctx.reinsurers && !reIds.has(row.re))) bad(`${q}.re`, '없는 재보험사 id예요');
      else if (seen.has(row.re)) bad(`${q}.re`, '같은 재보험사가 두 번 들어 있어요');
      else seen.add(row.re);
      if (!isNum(row.share_req, 0, 1)) bad(`${q}.share_req`, '0~1 사이 숫자여야 해요');
      if (!isNum(row.share_signed, 0, 1)) bad(`${q}.share_signed`, '0~1 사이 숫자여야 해요');
      if (!isNum(row.rc_req, -100, 100)) bad(`${q}.rc_req`, '숫자여야 해요');
      if (!ROW_STATUSES.includes(row.status)) bad(`${q}.status`, `${ROW_STATUSES.join(' / ')} 중 하나여야 해요`);
      if (row.cap_known !== null && !isNum(row.cap_known, 0, 1)) bad(`${q}.cap_known`, '0~1 사이 숫자 또는 null이어야 해요');
      if (!Array.isArray(row.history)) bad(`${q}.history`, '목록이어야 해요');
    });
  }
  for (const [id, e] of Object.entries(s.entities?.reinsurers ?? {})) {
    if (!isObj(e) || e.patience === undefined) continue;
    if (!isObj(e.patience)) { bad(`entities.reinsurers.${id}.patience`, '객체여야 해요'); continue; }
    for (const [tid, n] of Object.entries(e.patience)) if (!isInt(n, 0, 99)) bad(`entities.reinsurers.${id}.patience.${tid}`, '0 이상 정수여야 해요');
  }
}

// 세이브 내용이 게임이 기대하는 모양인지 확인한다. 문제 목록을 돌려준다(비어 있으면 정상).
export function validateState(s) {
  if (!ctx) throw new Error('store.configure()를 먼저 호출해야 해요');
  const errors = [];
  const bad = (path, msg) => errors.push(`${path}: ${msg}`);
  if (!isObj(s)) return ['최상위: 객체가 아니에요'];

  if (!isInt(s.seed, 0, 4294967295)) bad('seed', '0 이상 정수여야 해요');
  if (!isInt(s.rng_state, 0, 4294967295)) bad('rng_state', '0 이상 정수여야 해요');
  if (!isInt(s.turn, 1, ctx.calendar.turns)) bad('turn', `1~${ctx.calendar.turns} 사이 정수여야 해요`);
  if (!isInt(s.ap, 0, 99)) bad('ap', '0~99 사이 정수여야 해요');

  if (!isObj(s.player)) {
    bad('player', '객체여야 해요');
  } else {
    const p = s.player;
    if (typeof p.firm !== 'string' || p.firm.trim() === '' || p.firm.length > 80) bad('player.firm', '1~80자 글자여야 해요');
    if (!isNum(p.cash_usd_m, -1e6, 1e6)) bad('player.cash_usd_m', '숫자여야 해요');
    for (const key of ['reputation', 'compliance', 'board_confidence', 'market_intel']) {
      if (!isNum(p[key], 0, 100)) bad(`player.${key}`, '0~100 사이 숫자여야 해요');
    }
    if (!Array.isArray(p.flags) || !p.flags.every((f) => typeof f === 'string')) bad('player.flags', '글자 목록이어야 해요');
  }

  if (!isObj(s.market) || !isNum(s.market.index, 0, 100)) bad('market.index', '0~100 사이 숫자여야 해요');

  if (!isObj(s.entities) || !isObj(s.entities.clients) || !isObj(s.entities.reinsurers)) {
    bad('entities', 'clients·reinsurers 객체가 필요해요');
  } else {
    for (const group of ['clients', 'reinsurers']) {
      for (const [id, e] of Object.entries(s.entities[group])) {
        const p = `entities.${group}.${id}`;
        if (!isObj(e)) { bad(p, '객체여야 해요'); continue; }
        if (!isNum(e.relationship, 0, 100)) bad(`${p}.relationship`, '0~100 사이 숫자여야 해요');
        if (!isInt(e.meetings, 0, 99999)) bad(`${p}.meetings`, '0 이상 정수여야 해요');
        if (typeof e.notes !== 'string') bad(`${p}.notes`, '글자여야 해요');
        if (!isObj(e.scout)) bad(`${p}.scout`, '객체여야 해요');
        else for (const a of ['conservatism', 'price_sensitivity', 'loyalty']) if (!isNum(e.scout[a], 0, 100)) bad(`${p}.scout.${a}`, '0~100 사이 숫자여야 해요');
      }
    }
  }
  if (!isObj(s.treaties)) bad('treaties', '객체여야 해요');
  else validateTreatyStates(s, bad);
  for (const key of ['mails', 'scheduled', 'fired_events', 'modifiers', 'log']) {
    if (!Array.isArray(s[key])) bad(key, '목록이어야 해요');
  }
  if (Array.isArray(s.mails)) {
    s.mails.forEach((m, i) => {
      const p = `mails[${i}]`;
      if (!isObj(m)) return bad(p, '객체여야 해요');
      if (typeof m.id !== 'string' || m.id === '') bad(`${p}.id`, '글자여야 해요');
      if (typeof m.template !== 'string' || m.template === '') bad(`${p}.template`, '글자여야 해요');
      if (!isInt(m.turn, 1, ctx.calendar.turns)) bad(`${p}.turn`, '턴 번호여야 해요');
      if (m.deadline_turn !== null && !isInt(m.deadline_turn, 1, 999)) bad(`${p}.deadline_turn`, '정수 또는 null이어야 해요');
      if (typeof m.read !== 'boolean') bad(`${p}.read`, 'true 또는 false여야 해요');
      if (m.answered !== null && typeof m.answered !== 'string') bad(`${p}.answered`, '글자 또는 null이어야 해요');
      if (typeof m.auto !== 'boolean') bad(`${p}.auto`, 'true 또는 false여야 해요');
    });
  }
  if (Array.isArray(s.scheduled)) {
    s.scheduled.forEach((q, i) => {
      if (!isObj(q) || !isInt(q.turn, 1, 999) || typeof q.kind !== 'string' || typeof q.ref !== 'string') {
        bad(`scheduled[${i}]`, '{ turn, kind, ref } 모양이어야 해요');
      }
    });
  }
  if (s.saved_at !== undefined && typeof s.saved_at !== 'string') bad('saved_at', '글자여야 해요');
  return errors;
}

// 옛 버전 세이브를 현재 구조로 끌어올린다. 더 새로운 버전은 읽지 않는다(데이터를 망가뜨리지 않으려고).
export function migrate(raw, { current = SAVE_VERSION, migrations = MIGRATIONS } = {}) {
  if (!Number.isInteger(raw.version) || raw.version < 1) {
    return { ok: false, error: '세이브 버전 정보가 없거나 잘못됐어요' };
  }
  if (raw.version > current) {
    return { ok: false, error: `더 새로운 버전(v${raw.version})에서 만든 세이브예요. 이 게임은 v${current}까지 읽을 수 있어요` };
  }
  let cur = raw;
  while (cur.version < current) {
    const step = migrations[cur.version];
    if (typeof step !== 'function') {
      return { ok: false, error: `v${cur.version} 세이브를 올릴 변환 규칙이 없어요` };
    }
    const from = cur.version;
    const next = step(cur);
    if (!isObj(next)) return { ok: false, error: `v${from} 세이브 변환에 실패했어요` };
    // 변환 규칙이 같은 객체를 돌려줘도 호출자의 입력을 바꾸지 않도록 복사해서 버전을 올린다.
    cur = { ...next, version: from + 1 };
  }
  return { ok: true, state: cur };
}

// 글자 → 검증된 상태. 가져오기·불러오기가 같은 길을 지난다.
export function parseSave(text, options) {
  if (typeof text !== 'string' || text.trim() === '') return { ok: false, error: '내용이 비어 있어요' };
  if (text.length > MAX_SAVE_CHARS) return { ok: false, error: '파일이 너무 커요' };
  let raw;
  try {
    // __proto__ 키는 버린다(오염된 JSON이 나중에 Object.assign 등에 섞여도 안전하도록).
    raw = JSON.parse(text, (key, value) => (key === '__proto__' ? undefined : value));
  } catch {
    return { ok: false, error: 'JSON 형식이 아니에요' };
  }
  if (!isObj(raw)) return { ok: false, error: '세이브 파일의 모양이 아니에요' };

  const migrated = migrate(raw, options);
  if (!migrated.ok) return migrated;

  const errors = validateState(migrated.state);
  if (errors.length > 0) {
    const more = errors.length > 3 ? ` 외 ${errors.length - 3}건` : '';
    return { ok: false, error: `저장 내용이 올바르지 않아요 — ${errors.slice(0, 3).join(' / ')}${more}` };
  }
  return { ok: true, state: migrated.state };
}

// ---------- 슬롯 저장 / 불러오기 ----------

function writeSlot(slot) {
  if (!state) return { ok: false, error: '진행 중인 게임이 없어요' };
  const st = getStorage();
  if (!st) return { ok: false, error: '이 브라우저에서는 저장소를 쓸 수 없어요' };
  state.saved_at = new Date().toISOString();
  try {
    st.setItem(KEY_PREFIX + slot, JSON.stringify(state));
  } catch (e) {
    const quota = e && (e.name === 'QuotaExceededError' || e.code === 22);
    return { ok: false, error: quota ? '저장 공간이 가득 찼어요' : '저장하지 못했어요(브라우저가 저장을 막고 있을 수 있어요)' };
  }
  emit('slots');
  return { ok: true };
}

export function save(slot) {
  if (!MANUAL_SLOTS.includes(slot)) return { ok: false, error: '직접 저장은 슬롯 1~3에만 할 수 있어요' };
  return writeSlot(slot);
}

export function autosave() {
  return writeSlot('auto');
}

export function load(slot) {
  if (!SLOTS.includes(slot)) return { ok: false, error: '알 수 없는 슬롯이에요' };
  const read = readSlotText(slot);
  if (!read.ok) return read;
  if (read.text == null) return { ok: false, error: '비어 있는 슬롯이에요' };
  const parsed = parseSave(read.text);
  if (!parsed.ok) return parsed;
  replaceState(parsed.state);
  return { ok: true };
}

export function deleteSlot(slot) {
  if (!SLOTS.includes(slot)) return { ok: false, error: '알 수 없는 슬롯이에요' };
  const st = getStorage();
  if (!st) return { ok: false, error: '이 브라우저에서는 저장소를 쓸 수 없어요' };
  try {
    st.removeItem(KEY_PREFIX + slot);
  } catch {
    return { ok: false, error: '삭제하지 못했어요' };
  }
  emit('slots');
  return { ok: true };
}

// 슬롯 목록 표시용 요약. 손상된 슬롯도 목록에는 나오게 해서 사용자가 지울 수 있게 한다.
export function listSlots() {
  return SLOTS.map((slot) => {
    const read = readSlotText(slot);
    if (!read.ok) return { slot, status: 'unavailable', error: read.error };
    if (read.text == null) return { slot, status: 'empty' };
    const parsed = parseSave(read.text);
    if (!parsed.ok) return { slot, status: 'broken', error: parsed.error };
    const s = parsed.state;
    return { slot, status: 'ok', turn: s.turn, cash_usd_m: s.player.cash_usd_m, firm: s.player.firm, saved_at: s.saved_at ?? null };
  });
}

// ---------- 파일 백업 ----------

export function exportJson() {
  if (!state) return { ok: false, error: '진행 중인 게임이 없어요' };
  state.saved_at = new Date().toISOString();
  return { ok: true, filename: `rbs_save_turn${state.turn}.json`, text: JSON.stringify(state, null, 2) };
}

export function importJson(text) {
  const parsed = parseSave(text);
  if (!parsed.ok) return parsed;
  replaceState(parsed.state);
  return { ok: true };
}

function replaceState(next) {
  state = fillTreaties(fillEntities(next)); // 새 버전 데이터에 추가된 고객·재보험사가 있어도 이어서 할 수 있게 한다
  generation += 1;
  emit('game');
}
