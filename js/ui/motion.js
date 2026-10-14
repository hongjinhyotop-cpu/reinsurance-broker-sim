// 작은 움직임(design.md §6.0.3 "작은 움직임"). 모두 장식이고 표시 전용이다 — 상태·규칙·세이브를 건드리지 않는다.
// "움직임 줄이기"(prefers-reduced-motion)가 켜져 있으면 숫자는 곧바로 최종 값이 되고, 봉투는 만들지 않는다. CSS 쪽 애니메이션은 base.css가 끈다.

import { envelopeEl } from './seals.js';

export function reducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return true; // 알 수 없으면 움직이지 않는 쪽이 안전하다
  }
}

// ---------- 숫자 올라가기 ----------

// 화면을 통째로 다시 그려도 "직전에 보여 준 값"이 남도록 모듈에 둔다. key마다 하나.
const shown = new Map();
const COUNT_MS = 600;

// key를 주면 그 값만, 안 주면 전부 잊는다(새 게임·불러오기 때 이전 판의 값에서 세지 않도록).
export function resetShown(key) {
  if (key === undefined) shown.clear();
  else shown.delete(key);
}

export function hasShown(key) {
  return shown.has(key);
}

// el의 글자를 from → to로 센다. format(n)이 글자 모양을 정한다. 센 뒤의 글자는 항상 format(to)와 같다.
// from을 주지 않으면 직전에 보여 준 값에서 시작하고(처음이면 애니메이션 없음), 값이 같으면 아무것도 하지 않는다.
export function countUp(el, key, to, format, { from } = {}) {
  const start = from ?? shown.get(key);
  shown.set(key, to);
  el.textContent = format(to);
  if (reducedMotion() || start === undefined || start === to || typeof window.requestAnimationFrame !== 'function') return;
  const t0 = performance.now();
  const step = (now) => {
    if (!el.isConnected) return; // 화면이 다시 그려져 사라졌다면 멈춘다(새 요소가 자기 몫을 한다)
    const t = Math.min(1, (now - t0) / COUNT_MS);
    const eased = 1 - (1 - t) ** 3;
    el.textContent = format(t >= 1 ? to : start + (to - start) * eased);
    if (t < 1) requestAnimationFrame(step);
  };
  el.textContent = format(start);
  requestAnimationFrame(step);
}

// ---------- 달력 장 넘김 ----------

// 지금 화면에 있는 날짜 칸을 한 번 뒤집는다. 같은 칸에 다시 걸 수 있게 클래스를 뺐다가 다시 붙인다.
export function flipDate(el) {
  if (!el || reducedMotion()) return;
  el.classList.remove('is-flip');
  void el.offsetWidth; // 같은 애니메이션을 처음부터 다시 시작
  el.classList.add('is-flip');
}

// ---------- 봉투 도착 ----------

const ENVELOPE_MS = 1000;

export function arriveEnvelope() {
  if (reducedMotion()) return null;
  const el = document.createElement('div');
  el.className = 'envelope-fly';
  el.setAttribute('aria-hidden', 'true');
  el.append(envelopeEl({ size: 64 }));
  document.body.append(el);
  const remove = () => el.remove();
  el.addEventListener('animationend', remove, { once: true });
  setTimeout(remove, ENVELOPE_MS + 400); // animationend가 오지 않는 경우의 안전장치
  return el;
}
