// 화면 설정(안내띠 켜기/끄기·효과음·연출 줄이기) 저장: rbs:prefs:v1. design.md §10.9 "화면 설정".
// 게임 진행이 아니라 보는 방식이라 세이브와 따로 둔다(새 게임·불러오기와 무관하게 유지). 저장소 접근은 전부 try/catch.

export const PREFS_KEY = 'rbs:prefs:v1';
export const PREFS_VERSION = 1;
export const defaultPrefs = () => ({ version: PREFS_VERSION, guide_strip: true });

let storageOverride = null; // 테스트가 가짜 저장소를 꽂는 자리
let current = null;
let writable = true; // 모르는 버전의 값이 있으면 덮어쓰지 않는다

export function usePrefsStorage(adapter) {
  storageOverride = adapter;
  current = null;
  writable = true;
}

function getStorage() {
  if (storageOverride) return storageOverride;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// 선택 칸(D3): 없으면 기본값으로 읽는다 — sound는 꺼짐, reduce_motion은 기기(OS) 설정을 따름.
// 사용자가 바꾼 칸만 저장해서, 안 바꾼 사람의 저장 값은 예전과 똑같다.
const OPTIONAL_BOOLEANS = ['sound', 'reduce_motion'];

// 저장소에서 읽은 값을 점검한다. 모양이 틀린 칸은 기본값으로 둔다. 모르는 버전이면 null.
export function sanitizePrefs(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (raw.version !== PREFS_VERSION) return null;
  const clean = { version: PREFS_VERSION, guide_strip: typeof raw.guide_strip === 'boolean' ? raw.guide_strip : true };
  for (const key of OPTIONAL_BOOLEANS) if (typeof raw[key] === 'boolean') clean[key] = raw[key];
  return clean;
}

export const soundOn = () => getPrefs().sound === true;
// true/false는 사용자가 직접 고른 값, null은 아직 고르지 않아 OS 설정을 따른다는 뜻.
export const reduceMotionChoice = () => (typeof getPrefs().reduce_motion === 'boolean' ? getPrefs().reduce_motion : null);

export function loadPrefs() {
  const st = getStorage();
  let text = null;
  if (st) {
    try {
      text = st.getItem(PREFS_KEY);
    } catch {
      text = null;
    }
  }
  writable = true;
  current = defaultPrefs();
  if (text === null || text === undefined) return current;
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  const clean = sanitizePrefs(parsed);
  if (clean) current = clean;
  else if (parsed && typeof parsed === 'object' && Number.isInteger(parsed.version) && parsed.version > PREFS_VERSION) writable = false; // 더 새로운 버전은 건드리지 않는다
  return current;
}

export function getPrefs() {
  return current ?? loadPrefs();
}

// 값을 바꾸고 저장한다. 저장에 실패해도 이번 세션 동안은 메모리에 남는다.
// reduce_motion에 null을 주면 직접 고른 값을 지우고 다시 OS 설정을 따른다.
export function setPref(key, value) {
  const known = key === 'guide_strip' || OPTIONAL_BOOLEANS.includes(key);
  if (!known || (typeof value !== 'boolean' && !(key === 'reduce_motion' && value === null))) return { ok: false };
  current = { ...getPrefs(), [key]: value };
  if (value === null) delete current[key];
  if (!writable) return { ok: false };
  const st = getStorage();
  try {
    if (!st) throw new Error('no storage');
    st.setItem(PREFS_KEY, JSON.stringify(current));
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
