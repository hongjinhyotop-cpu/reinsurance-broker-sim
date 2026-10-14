// 결과 뜸 들이기 — "봉투 열기"(design.md §6.0.3 D3). 표시 전용이다.
// 규칙은 버튼을 누른 순간 이미 끝나고 저장됐다(act()가 그 일을 한다). 여기서는 화면이 그 결과를 잠깐 가렸다가 보여 줄 뿐이다:
//  - 연출 동안 화면은 "누르기 직전의 상태"(snap)로 그려져 결과가 미리 새지 않는다.
//  - 모든 버튼·링크·입력칸이 잠기고, 아무 키나 눌러도 되고 화면을 눌러도 곧바로 끝난다.
//  - 끝나면 도장 소리가 나고, 그 결과의 도장은 한 번 찍히는 모습으로 그려진다(takeFresh).
// 연출 줄이기가 켜져 있으면 뜸 들이지 않고 곧바로 결과를 보여 준다.

import * as store from '../store.js';
import { reducedMotion } from './motion.js';
import { play } from './sound.js';

// 길이(ms). 설계의 "연출과 첫인상" 표와 같다.
export const OPEN_MS = { reinsurer: 600, client: 1000 };

let current = null; // { key, snap, timer, res, done }
const fresh = new Set(); // 막 열린 결과의 key — 도장이 찍히는 모습을 한 번만 그린다
let swallowUntil = 0; // 건너뛴 직후 같은 키의 keyup/키에서 나온 click이 새 화면을 누르지 않도록 잠깐 삼킨다
let hooked = false;

export const busy = () => current !== null;
export const isOpening = (key) => current?.key === key;

// 연출 중에는 누르기 직전의 상태를, 아니면 지금 상태를 돌려준다.
export function viewState(live) {
  return current ? current.snap : live;
}

// 막 열린 결과인지(한 번만 true). 도장이 찍히는 모습을 붙이는 데 쓴다.
export function takeFresh(key) {
  return fresh.delete(key);
}

export function reset() {
  if (current) clearTimeout(current.timer);
  current = null;
  fresh.clear();
}

function finish() {
  if (!current) return;
  const c = current;
  clearTimeout(c.timer);
  current = null;
  fresh.add(c.key);
  swallowUntil = performance.now() + 400;
  play('stamp');
  c.done?.(c.res);
  store.refresh(); // 이제 진짜 결과로 다시 그린다
}

export const skip = finish;

function hook() {
  if (hooked) return;
  hooked = true;
  // 연출 중 키 하나가 곧 "건너뛰기"다. 그 키의 원래 동작(Enter로 버튼 누르기 등)은 일어나지 않는다.
  window.addEventListener('keydown', (ev) => {
    if (!current) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    finish();
  }, true);
  window.addEventListener('keyup', (ev) => {
    if (performance.now() < swallowUntil) { ev.preventDefault(); ev.stopImmediatePropagation(); }
  }, true);
  window.addEventListener('click', (ev) => {
    const wasBusy = current !== null;
    // 건너뛴 직후에는 키(Space/Enter)에서 나온 클릭(detail 0)만 삼킨다. 마우스 클릭은 곧바로 통한다.
    if (!wasBusy && (performance.now() >= swallowUntil || ev.detail !== 0)) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    if (wasBusy) finish();
  }, true);
}

// 연출 중 화면을 잠근다: 버튼·링크는 aria-disabled(초점은 그대로 둔다), 입력칸은 disabled. main.js가 그릴 때마다 부른다.
export function lockControls(root) {
  for (const el of root.querySelectorAll('button, a[href], summary, input, select, textarea')) {
    el.setAttribute('data-locked', '');
    if (el.matches('input, select, textarea')) el.disabled = true;
    else el.setAttribute('aria-disabled', 'true');
  }
}

// key: 결과 자리의 이름(예: "row:re_nur"). act(): 규칙을 실제로 실행하고 결과를 돌려준다(실패하면 null/거짓값).
// done(res): 결과가 드러나는 순간(연출이 끝나거나 건너뛰었을 때) 부르는 알림 — 토스트처럼 결과를 말해 버리는 것을 여기에 둔다.
export function run(key, ms, act, done) {
  if (current) return null; // 잠겨 있어 오지 않는 길이지만, 겹치면 먼저 하던 것을 존중한다
  if (reducedMotion()) {
    const res = act();
    if (res) { play('stamp'); done?.(res); } // 연출이 없으니 도장 모습도 따로 없다
    return res;
  }
  hook();
  current = { key, snap: structuredClone(store.getState()), timer: null, res: null, done };
  let res;
  try {
    res = act();
  } catch (e) {
    current = null;
    throw e;
  }
  if (!res) { current = null; store.refresh(); return res; } // 실패한 행동: 안내는 이미 나갔고, 연출 상태로 그려진 화면만 되돌린다
  current.res = res;
  current.timer = setTimeout(finish, ms);
  store.refresh(); // 봉투가 보이도록 연출 상태로 한 번 더 그린다
  return res;
}
