// 라이벌 브로커 시뮬(design.md §9.3). DOM·저장소·store를 모르는 순수 함수.
// 라이벌 난수는 플레이어의 사건 난수 흐름(store.random)과 섞지 않는다: 세이브 시드·분기 번호·라이벌 번호로 따로 만든다.

import { nextFloat, normalizeSeed } from './rng.js';
import { gaussian } from './market.js';

const round4 = (x) => Math.round(x * 1e4) / 1e4;

// 표준정규 z 하나. 같은 (시드, 분기, 라이벌)이면 언제나 같은 값이다.
export function rivalNoise(seed, quarterIndex, rivalIndex) {
  const mixed = (seed ^ Math.imul(quarterIndex + 1, 0x9e3779b1) ^ Math.imul(rivalIndex + 1, 0x85ebca6b)) >>> 0;
  const a = nextFloat(normalizeSeed(mixed));
  const b = nextFloat(a.state);
  return gaussian(a.value, b.value);
}

// 분기 수익 = (연 수익/4) × (1 + market_k × beta × (M − 50)) × (1 + 변동성 × z), 0 미만으로는 내려가지 않는다.
export function rivalQuarterIncome(def, marketIndex, z, cfg) {
  const base = def.base_income_usd_m / 4;
  const value = base * (1 + cfg.market_k * def.market_beta * (marketIndex - 50)) * (1 + def.volatility * z);
  return round4(Math.max(0, value));
}

// 라이벌이 플레이어보다 "더 커야" 앞선다(동률이면 플레이어가 앞).
export function rankOf(playerYtd, rivalYtds) {
  return 1 + rivalYtds.filter((y) => y > playerYtd).length;
}

// 분기 결산 스냅샷(세이브 standings.quarters 한 칸). player는 { q, ytd, placed_premium_usd_m, clients }.
export function buildSnapshot({ defs, prev, quarter, quarterIndex, seed, marketIndex, player, cfg }) {
  const rivals = {};
  defs.forEach((def, i) => {
    const q = rivalQuarterIncome(def, marketIndex, rivalNoise(seed, quarterIndex, i), cfg);
    const before = prev?.rivals?.[def.id]?.ytd ?? 0;
    rivals[def.id] = { q, ytd: round4(before + q) };
  });
  return {
    id: quarter.id,
    turn: quarter.to,
    rank: rankOf(player.ytd, Object.values(rivals).map((r) => r.ytd)),
    prev_rank: prev ? prev.rank : null,
    player,
    rivals,
  };
}

// 순위표 한 줄씩(내림차순). 플레이어는 isPlayer 표시. 동률이면 플레이어가 앞선다.
// dq = 이번 분기 수익 − 직전 분기 수익(첫 분기는 null).
export function tableRows(defs, snapshot, { firm, reputation, prev = null }) {
  if (!snapshot) return null;
  const rows = defs.map((d) => {
    const r = snapshot.rivals[d.id];
    return {
      id: d.id, name_ko: d.name_ko, tag_ko: d.tag_ko, isPlayer: false, ytd: r.ytd, q: r.q,
      dq: prev ? round4(r.q - (prev.rivals[d.id]?.q ?? 0)) : null,
      placed_premium_usd_m: d.commission_rate > 0 ? round4(r.ytd / d.commission_rate) : 0,
      clients: d.clients, reputation: d.reputation,
    };
  });
  rows.push({
    id: 'player', name_ko: firm, tag_ko: '', isPlayer: true, ytd: snapshot.player.ytd, q: snapshot.player.q,
    dq: prev ? round4(snapshot.player.q - prev.player.q) : null,
    placed_premium_usd_m: snapshot.player.placed_premium_usd_m, clients: snapshot.player.clients, reputation,
  });
  rows.sort((a, b) => (b.ytd - a.ytd) || (a.isPlayer ? -1 : b.isPlayer ? 1 : 0));
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}
