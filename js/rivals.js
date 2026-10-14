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

// 평판 효과(§9.3): 평판이 문턱을 넘으면 라이벌 분기 수익에서 떼어 내는 비율. 상한이 있고 문턱 이하면 0이다.
export function flowRate(reputation, cfg) {
  const rf = cfg?.reputation_flow;
  if (!rf) return 0;
  return Math.max(0, Math.min(rf.max_rate, rf.per_point * (reputation - rf.threshold)));
}

// 라이벌이 플레이어보다 "더 커야" 앞선다(동률이면 플레이어가 앞).
export function rankOf(playerYtd, rivalYtds) {
  return 1 + rivalYtds.filter((y) => y > playerYtd).length;
}

// 분기 결산 스냅샷(세이브 standings.quarters 한 칸). player는 { q, ytd, placed_premium_usd_m, clients }.
// reputation: 플레이어 평판. 높으면 라이벌 각자의 분기 수익에서 일부(flowRate)가 플레이어의 flow_q로 넘어온다.
// 순위는 리그 수익(확정 브로커리지 누계 + flow_ytd)으로 정한다. 난수는 평판과 무관하게 같은 순서로 쓴다.
export function buildSnapshot({ defs, prev, quarter, quarterIndex, seed, marketIndex, player, cfg, reputation = 0 }) {
  const rate = flowRate(reputation, cfg);
  const rivals = {};
  let flowQ = 0;
  defs.forEach((def, i) => {
    const gross = rivalQuarterIncome(def, marketIndex, rivalNoise(seed, quarterIndex, i), cfg);
    const moved = round4(gross * rate);
    const q = round4(gross - moved);
    const before = prev?.rivals?.[def.id]?.ytd ?? 0;
    rivals[def.id] = { q, ytd: round4(before + q), moved };
    flowQ += moved;
  });
  flowQ = round4(flowQ);
  const flowYtd = round4((prev?.player?.flow_ytd ?? 0) + flowQ);
  return {
    id: quarter.id,
    turn: quarter.to,
    rank: rankOf(player.ytd + flowYtd, Object.values(rivals).map((r) => r.ytd)),
    prev_rank: prev ? prev.rank : null,
    player: { ...player, flow_q: flowQ, flow_ytd: flowYtd },
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
  // 리그 수익 = 확정 브로커리지 + 평판으로 넘어온 몫(없던 옛 스냅샷은 0). 정렬과 표시는 리그 수익으로 한다.
  const flowYtd = snapshot.player.flow_ytd ?? 0;
  const flowQ = snapshot.player.flow_q ?? 0;
  rows.push({
    id: 'player', name_ko: firm, tag_ko: '', isPlayer: true, ytd: round4(snapshot.player.ytd + flowYtd), q: round4(snapshot.player.q + flowQ),
    brokerage_ytd: snapshot.player.ytd, flow_ytd: flowYtd,
    dq: prev ? round4(snapshot.player.q + flowQ - (prev.player.q + (prev.player.flow_q ?? 0))) : null,
    placed_premium_usd_m: snapshot.player.placed_premium_usd_m, clients: snapshot.player.clients, reputation,
  });
  rows.sort((a, b) => (b.ytd - a.ytd) || (a.isPlayer ? -1 : b.isPlayer ? 1 : 0));
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}

// 라이벌 도발 메일(§9.3 D6)의 난수 둘. 게임 난수 흐름(rng_state)과 섞지 않고 시드·분기로 따로 만든다(라이벌 수익과도 다른 섞기 값).
export function tauntRoll(seed, quarterIndex) {
  const mixed = (seed ^ Math.imul(quarterIndex + 1, 0x27d4eb2f) ^ 0x5bd1e995) >>> 0;
  const a = nextFloat(normalizeSeed(mixed));
  const b = nextFloat(a.state);
  return [a.value, b.value];
}

// 이번 분기에 쪽지를 보낼 이웃 라이벌. { rival, side: 'ahead' | 'behind' } 또는 null.
// rows는 tableRows의 결과(리그 수익 순). ahead = 바로 위, behind = 바로 아래.
export function pickTaunt(rows, roll, prob) {
  if (!rows || !(roll[0] < prob)) return null;
  const i = rows.findIndex((r) => r.isPlayer);
  const options = [];
  if (i > 0) options.push({ rival: rows[i - 1].id, side: 'ahead' });
  if (i >= 0 && i < rows.length - 1) options.push({ rival: rows[i + 1].id, side: 'behind' });
  if (options.length === 0) return null;
  return options.length === 1 ? options[0] : options[roll[1] < 0.5 ? 0 : 1];
}
