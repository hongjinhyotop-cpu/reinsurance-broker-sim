// 난수는 전부 이 모듈을 거친다(Math.random 금지).
// 상태를 값으로 주고받는 순수 함수라, 세이브에 rng_state만 넣으면 같은 흐름이 이어진다.

const TWO_32 = 4294967296;

// mulberry32: 32비트 상태 하나로 도는 작은 PRNG. 게임 용도로 충분하고 구현이 짧다.
export function nextFloat(state) {
  const s = ((state >>> 0) + 0x6d2b79f5) >>> 0;
  let t = Math.imul(s ^ (s >>> 15), s | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { value: ((t ^ (t >>> 14)) >>> 0) / TWO_32, state: s };
}

// 어떤 숫자가 와도 0 ~ 2^32-1 정수로 맞춘다.
export function normalizeSeed(n) {
  return Number.isFinite(n) ? Math.trunc(n) >>> 0 : 0;
}

// 사용자가 입력한 시드. 숫자면 그대로, 그 밖의 글자는 해시로 바꿔 누구나 단어로도 시드를 쓸 수 있게 한다.
// 비어 있으면 null(= 무작위로 정하라는 뜻).
export function seedFromText(text) {
  const t = String(text ?? '').trim();
  if (t === '') return null;
  if (/^\d{1,30}$/.test(t)) return Number(BigInt(t) % 4294967296n);
  let hash = 0x811c9dc5; // FNV-1a
  for (let i = 0; i < t.length; i++) {
    hash ^= t.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

// 새 게임의 시드. 게임 규칙에 쓰는 난수가 아니라 "처음 한 번"의 출발점이라 브라우저 엔트로피를 쓴다.
export function newSeed() {
  try {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0];
  } catch {
    return Date.now() >>> 0;
  }
}
