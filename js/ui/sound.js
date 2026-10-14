// 효과음(design.md §6.0.3 D3). 파일 없이 Web Audio로 그 자리에서 합성한다 — 외부 파일·주소 없음.
// 기본은 꺼짐이고(prefs.sound), 켜져 있지 않으면 어떤 소리도 만들지 않는다. 표시 전용이라 상태·규칙·세이브를 모른다.
// 소리를 만들 수 없는 환경이거나 오류가 나도 조용히 건너뛴다(게임은 멈추지 않는다).

import { soundOn, setPref } from '../prefs.js';
import { nextFloat } from '../rng.js';

const MASTER_GAIN = 0.12; // 작게. 각 소리는 이 안에서 더 작다
const NOISE_SEED = 20240611; // 잡음도 rng.js의 시드 함수로 만든다(저장 재현성 규칙을 소리에도 지킨다, 항상 같은 소리)

let ctx = null;
let master = null;
let noise = null;

function audio() {
  if (ctx) return ctx;
  const AC = window.AudioContext ?? window.webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = MASTER_GAIN;
    master.connect(ctx.destination);
  } catch {
    ctx = null;
  }
  return ctx;
}

// 0.4초짜리 흰 잡음 한 조각을 만들어 여러 소리가 돌려 쓴다.
function noiseBuffer(c) {
  if (noise) return noise;
  const len = Math.floor(c.sampleRate * 0.4);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  let state = NOISE_SEED;
  for (let i = 0; i < len; i++) {
    const r = nextFloat(state);
    state = r.state;
    data[i] = r.value * 2 - 1;
  }
  noise = buf;
  return buf;
}

// 부드럽게 시작해 지수로 사라지는 소리 높이(클릭 잡음이 안 나게 0에서 곧바로 시작하지 않는다)
function envelope(g, t0, dur, peak) {
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(0.01, dur / 4));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
}

function tone(c, t0, { f0, f1 = f0, dur, peak, type = 'sine' }) {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t0);
  if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
  envelope(g, t0, dur, peak);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function hiss(c, t0, { dur, peak, filter = 'bandpass', f0, f1 = f0, q = 1 }) {
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  const flt = c.createBiquadFilter();
  flt.type = filter;
  flt.Q.value = q;
  flt.frequency.setValueAtTime(f0, t0);
  if (f1 !== f0) flt.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
  const g = c.createGain();
  envelope(g, t0, dur, peak);
  src.connect(flt).connect(g).connect(master);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

// 소리 이름 → 합성법. 모두 0.5초 이하.
const RECIPES = {
  // 도장: 낮게 쿵 떨어지는 소리 + 짧은 "탁"
  stamp: (c, t) => {
    tone(c, t, { f0: 140, f1: 55, dur: 0.16, peak: 0.9 });
    hiss(c, t, { dur: 0.05, peak: 0.45, filter: 'lowpass', f0: 1800 });
  },
  // 봉투 도착: 종이가 스치는 소리 두 번
  envelope: (c, t) => {
    hiss(c, t, { dur: 0.07, peak: 0.35, f0: 3200, q: 0.8 });
    hiss(c, t + 0.1, { dur: 0.09, peak: 0.3, f0: 2600, q: 0.8 });
  },
  // 주 넘김: 위로 쓸어 올리는 "싹"
  page: (c, t) => {
    hiss(c, t, { dur: 0.15, peak: 0.3, f0: 700, f1: 3400, q: 1.2 });
  },
  // 사건 알림: 부드러운 두 음
  alert: (c, t) => {
    tone(c, t, { f0: 880, dur: 0.09, peak: 0.4 });
    tone(c, t + 0.1, { f0: 1175, dur: 0.12, peak: 0.4 });
  },
};

export const SOUND_NAMES = Object.keys(RECIPES);

export function soundAvailable() {
  return typeof window !== 'undefined' && !!(window.AudioContext ?? window.webkitAudioContext);
}

// delay: 초. 꺼져 있으면 아무것도 만들지 않고 false를 돌려준다.
export function play(name, { delay = 0 } = {}) {
  if (!soundOn() || !(name in RECIPES)) return false;
  try {
    const c = audio();
    if (!c) return false;
    if (c.state === 'suspended') c.resume().catch(() => {});
    RECIPES[name](c, c.currentTime + 0.01 + delay);
    return true;
  } catch {
    return false;
  }
}

// 켜기/끄기. 켤 때는 브라우저가 소리를 허락하는 "사용자가 누른 순간"이라 확인용으로 도장 소리를 한 번 낸다.
export function setSoundOn(on) {
  const res = setPref('sound', on);
  if (on) play('stamp');
  return res;
}
