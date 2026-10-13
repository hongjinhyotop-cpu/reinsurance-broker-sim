// 플레이스먼트 협상 계산식. design.md §7. DOM·저장소를 모르는 순수 함수 — 상태 변경은 호출자(M5의 보드)가 한다.
// 계수는 모두 data/config.json의 negotiation 블록에서 받는다.

import { hashUnit } from './reveal.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;

// ---------- 시장 ----------

// 용량 계수 cf(M): 하드할수록 가용 라인이 준다.
export function capacityFactor(marketIndex, cfg) {
  return 1 - cfg.capacity_k * (marketIndex - 50) / 50;
}

// 시장 벤치마크 = A_market + A_line (고객 공정가의 기준, §7.5)
export function marketBenchmark(marketIndex, line, cfg) {
  return cfg.market_k * (marketIndex - 50) + cfg.line_adj[line];
}

// ---------- 7.1 재보험사 가격 하한 ----------

// 트리티 손해율 3년 가중. 사고 이벤트(lrExtra)는 y0에 더한다.
export function expectedLossRatio(hist, lrExtra, cfg) {
  const [w2, w1, w0] = cfg.lr_weights;
  return w2 * hist[0] + w1 * hist[1] + w0 * (hist[2] + lrExtra);
}

// 불확실성 N ∈ [0,1]: 처음 보는 조건일수록 크고, 자료를 잘 준비할수록 작다.
export function uncertainty({ newReinsurer, broadTerms, bigLoss, prepQuality }, cfg) {
  const u = cfg.uncertainty;
  const n = u.base + u.new_reinsurer * (newReinsurer ? 1 : 0) + u.broad_terms * (broadTerms ? 1 : 0)
    + u.big_loss * (bigLoss ? 1 : 0) - u.prep * prepQuality / 100;
  return clamp(n, 0, 1);
}

export function goodwill(relationship, loyalty, cfg) {
  return relationship * (cfg.goodwill_base + cfg.goodwill_loyalty * loyalty / 100);
}

// 재보험사 한 곳의 가격 하한 F_r(RC, %p)과 항별 내역.
// input: { market, line, lossHist[3], lrExtra, targetLr, conservatism, loyalty, relationship, terms,
//          newReinsurer, bigLoss, prepQuality, bundles, structureAdj, quote }
//   quote: 실제로 가진 타사 견적(RC). 허세는 탐지되지 않았을 때만 같은 값으로 넘긴다(bluffChance 참고).
export function priceFloor(input, cfg) {
  const lrExp = expectedLossRatio(input.lossHist, input.lrExtra ?? 0, cfg);
  const N = uncertainty({
    newReinsurer: input.newReinsurer, broadTerms: input.terms === 'broad', bigLoss: input.bigLoss, prepQuality: input.prepQuality ?? 0,
  }, cfg);
  const parts = {
    market: cfg.market_k * (input.market - 50),
    line: cfg.line_adj[input.line],
    loss: clamp(cfg.loss_k * (lrExp - input.targetLr), cfg.loss_min, cfg.loss_max),
    cons: (input.conservatism / 100) * cfg.cons_k * N,
    terms: cfg.terms_adj[input.terms],
    rel: goodwill(input.relationship, input.loyalty, cfg) / 100 * cfg.rel_k,
    bundle: Math.min(cfg.bundle_max, cfg.bundle_each * (input.bundles ?? 0)),
    structure: input.structureAdj ?? 0,
    quote: 0,
  };
  let floor = parts.market + parts.line + parts.loss + parts.cons + parts.terms - parts.rel - parts.bundle + parts.structure;
  if (input.quote !== undefined && input.quote !== null) {
    parts.quote = -Math.min(cfg.quote_cap, Math.max(0, cfg.quote_k * (floor - input.quote)));
    floor += parts.quote;
  }
  return { floor, N, lrExp, parts };
}

// 가용 지분 상한: 용량·식욕·시장·불확실성으로 줄어든 라인을 한도로 나눈 값에 단일 한도를 겹친다.
export function maxShare({ capacity, appetite, marketIndex, conservatism, N, limit, reinsurerMaxShare, clientMaxShare }, cfg) {
  const maxLine = capacity * appetite * capacityFactor(marketIndex, cfg) * (1 - cfg.cons_capacity_k * conservatism / 100 * N);
  return Math.max(0, Math.min(maxLine / limit, reinsurerMaxShare, clientMaxShare));
}

// 허세 견적이 들킬 확률. 보수적인 재보험사일수록 확인한다.
export function bluffChance(conservatism, cfg) {
  return clamp(cfg.bluff_base + cfg.bluff_cons_k * conservatism / 100, 0, 1);
}

// ---------- 7.2 재보험사 응답 ----------

export function theta(priceSensitivity, cfg) {
  return cfg.theta_base + cfg.theta_span * (1 - priceSensitivity / 100);
}

// 제안 RC p와 요청 지분 sReq에 대한 응답.
// input: { floor, p, sReq, maxShare, weeksLeft, priceSensitivity, appetite, shariahBlocked, noise }
//   noise ∈ [-1,1]: 호출자가 시드로 뽑아 넘긴다(세이브 재현성). 여기서는 noise_pp를 곱해 F에 더할 뿐이다.
// 돌려주는 값: { kind: 'accept'|'counter'|'reject'|'decline', rc, share, support, limited, reason, patienceDelta, relationshipDelta, gap }
export function respond(input, cfg) {
  if (input.appetite <= 0) return decline('no_appetite');
  if (input.shariahBlocked) return decline('shariah');

  const floor = input.floor + (input.noise ?? 0) * cfg.noise_pp;
  const gap = input.p - floor;
  const th = theta(input.priceSensitivity, cfg);
  const share = Math.min(input.sReq, input.maxShare);
  const limited = input.sReq > input.maxShare + 1e-9;
  const base = { rc: null, share: 0, support: 0, limited, reason: null, patienceDelta: 0, relationshipDelta: 0, gap };

  if (gap >= 0) {
    const support = gap >= cfg.support_gap ? Math.max(0, Math.min(cfg.support_max_extra, input.maxShare - share)) : 0;
    return { ...base, kind: 'accept', rc: input.p, share, support };
  }
  if (gap >= -th) {
    // 마감이 가까울수록 양보한다.
    const m = input.weeksLeft / cfg.counter_weeks_divisor;
    return { ...base, kind: 'counter', rc: floor + m, share };
  }
  return { ...base, kind: 'reject', patienceDelta: cfg.reject_patience, relationshipDelta: cfg.reject_relationship };
}

function decline(reason) {
  return { kind: 'decline', rc: null, share: 0, support: 0, limited: false, reason, patienceDelta: 0, relationshipDelta: 0, gap: null };
}

// 플레이어에게 보여 줄 정성 힌트. 가격 민감도 스카우트 값이 낮을수록 폭(errPp)이 커서 틀리기 쉽다.
// jitter ∈ [-1,1]는 (세이브 시드, 트리티, 재보험사)로 고정해서 넘긴다.
export function priceHint({ gap, sPrice, jitter }, cfg) {
  const errPp = cfg.hint_err_k * (1 - sPrice / 100);
  const seen = gap + jitter * errPp;
  const level = seen >= 0 ? 'good' : seen >= -cfg.hint_near_pp ? 'near' : 'far';
  return { level, errPp };
}

// ---------- 7.6 고객 기대 관리 ----------

// 목표 RC를 시장 벤치마크 쪽으로 옮긴다. 가격 민감도가 높은 고객에게는 관계 비용이 따른다.
export function manageExpectation({ targetRc, benchmark, relationship, priceSensitivity }, cfg) {
  const e = cfg.expectation;
  const step = e.base + e.relationship_k * relationship / 100;
  return {
    targetRc: targetRc + (benchmark - targetRc) * step,
    relationshipDelta: priceSensitivity >= e.high_ps ? e.high_ps_relationship : 0,
    cooldownWeeks: e.cooldown_weeks,
  };
}

// ---------- 7.5 고객 평가 ----------

export function ratingScore(rating, cfg) {
  return cfg.rating_score[rating] ?? cfg.rating_score._default;
}

// 약관 등급 차이 1단계마다 terms_step 감점.
function termsScore(actual, preferred, cfg) {
  const order = cfg.terms_order;
  return Math.max(0, 100 - cfg.client.terms_step * Math.abs(order.indexOf(actual) - order.indexOf(preferred)));
}

// 패키지 제출 평가.
// input: {
//   panel: [{ id, share, rc, rating, onshore, shariahOk, terms, maxShare }],
//   expiringIds: [만기 패널 재보험사 id],
//   client: { conservatism, priceSensitivity, loyalty, relationship, targetRc, minRating, maxSingleShare,
//             preferredTerms, shariahRequired, shariahConventionalCap },
//   benchmark }
// 돌려주는 값: { verdict, hardFails[], avgRc, scores, weights, U, theta, goodwill, turnover }
//   verdict: 'delighted' | 'accept' | 'renegotiate' | 'reject' | 'invalid'(하드 실패)
export function evaluatePackage({ panel, expiringIds, client, benchmark }, cfg) {
  const cc = cfg.client;
  const total = panel.reduce((s, m) => s + m.share, 0);
  const hardFails = [];

  if (Math.abs(total - 1) > cfg.share_tolerance) hardFails.push('share_total');
  const minScore = ratingScore(client.minRating, cfg);
  if (panel.some((m) => m.share > 0 && ratingScore(m.rating, cfg) < minScore)) hardFails.push('min_rating');
  if (panel.some((m) => m.share > Math.min(client.maxSingleShare, m.maxShare) + cfg.share_tolerance)) hardFails.push('single_share');
  if (client.shariahRequired) {
    const conventional = panel.filter((m) => !m.shariahOk).reduce((s, m) => s + m.share, 0);
    if (conventional > client.shariahConventionalCap + cfg.share_tolerance) hardFails.push('shariah_cap');
  }

  // 지분이 0이거나 합이 0이면 나눗셈을 피한다.
  const denom = total > 0 ? total : 1;
  const avgRc = panel.reduce((s, m) => s + m.share * m.rc, 0) / denom;
  const reference = lerp(benchmark, client.targetRc, client.priceSensitivity / 100);
  const gw = goodwill(client.relationship, client.loyalty, cfg);
  const expiring = new Set(expiringIds);
  const turnover = panel.filter((m) => !expiring.has(m.id)).reduce((s, m) => s + m.share, 0) / denom;

  const scores = {
    price: clamp(100 - cc.price_slope * (avgRc - reference), 0, 100),
    security: clamp(panel.reduce((s, m) => s + m.share * (ratingScore(m.rating, cfg) + (m.onshore ? cfg.onshore_bonus : 0)), 0) / denom, 0, 100),
    continuity: clamp(100 - (client.conservatism / 100) * cc.continuity_k * turnover, 0, 100),
    terms: panel.reduce((s, m) => s + m.share * termsScore(m.terms, client.preferredTerms, cfg), 0) / denom,
    service: gw,
  };

  const w = cc.weights;
  const raw = {
    price: w.price_base + w.price_ps * client.priceSensitivity / 100,
    security: w.security,
    continuity: w.continuity_base + w.continuity_cons * client.conservatism / 100,
    terms: w.terms,
    service: w.service,
  };
  const sum = Object.values(raw).reduce((a, b) => a + b, 0);
  const weights = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v / sum]));
  const U = Object.keys(scores).reduce((s, k) => s + weights[k] * scores[k], 0);
  const th = cc.accept_threshold_base - cc.accept_threshold_goodwill_k * gw;

  let verdict;
  if (hardFails.length > 0) verdict = 'invalid';
  else if (U >= th + cc.delighted_margin) verdict = 'delighted';
  else if (U >= th) verdict = 'accept';
  else if (U >= th - cc.renegotiate_margin) verdict = 'renegotiate';
  else verdict = 'reject';

  return { verdict, hardFails, avgRc, reference, scores, weights, U, theta: th, goodwill: gw, turnover };
}

// ---------- 정적 정의 + 동적 상태 → 계산 입력 (시험대와 M5 보드가 함께 쓴다) ----------

// 재보험사 한 곳에 제안을 한 번 보냈을 때의 전체 결과.
// ctx:  { treaty, client, reinsurer, relationship(재보험사), scoutPrice(가격 민감도 스카우트 값), seed }
// form: { market, p, sReq, weeksLeft, terms, structureOption(id|null), bundles, lrExtra, bigLoss, prepQuality }
export function quoteProposal({ treaty, client, reinsurer, relationship, scoutPrice, seed }, form, cfg) {
  const line = treaty.line;
  const option = treaty.structure_options.find((o) => o.id === form.structureOption) ?? null;
  const newReinsurer = !treaty.expiring.panel.some((m) => m.re === reinsurer.id);
  const floor = priceFloor({
    market: form.market, line, lossHist: treaty.loss_ratio_hist, lrExtra: form.lrExtra, targetLr: reinsurer.target_lr,
    conservatism: reinsurer.hidden.conservatism, loyalty: reinsurer.hidden.loyalty, relationship, terms: form.terms,
    newReinsurer, bigLoss: form.bigLoss, prepQuality: form.prepQuality, bundles: form.bundles, structureAdj: option?.f_adj ?? 0,
  }, cfg);
  const cap = maxShare({
    capacity: reinsurer.capacity_usd_m[line], appetite: reinsurer.appetite[line], marketIndex: form.market,
    conservatism: reinsurer.hidden.conservatism, N: floor.N, limit: treaty.limit_usd_m,
    reinsurerMaxShare: reinsurer.behavior.max_single_share, clientMaxShare: client.requirements.max_single_share,
  }, cfg);
  // 같은 제안이면 같은 노이즈(세이브 시드 + 제안값). 힌트의 흔들림은 (시드, 트리티, 재보험사)로 고정.
  const noise = hashUnit(`${seed}:noise:${treaty.id}:${reinsurer.id}:${form.p}:${form.sReq}`);
  const req = client.requirements;
  const response = respond({
    floor: floor.floor, p: form.p, sReq: form.sReq, maxShare: cap, weeksLeft: form.weeksLeft,
    priceSensitivity: reinsurer.hidden.price_sensitivity, appetite: reinsurer.appetite[line],
    shariahBlocked: req.shariah_required && !reinsurer.shariah_ok && req.shariah_conventional_cap === 0, noise,
  }, cfg);
  const hint = response.gap === null ? null : priceHint({
    gap: response.gap, sPrice: scoutPrice, jitter: hashUnit(`${seed}:hint:${treaty.id}:${reinsurer.id}`),
  }, cfg);
  return { floor, maxShare: cap, noise, response, hint, option };
}

// 만기 패널을 그대로, 모두 같은 RC·조건으로 제출했을 때의 고객 평가.
// ctx: { treaty, client, clientRelationship, reinsurers(전체 정의 목록) }
export function evaluateExpiringPanel({ treaty, client, clientRelationship, reinsurers }, { market, rc, terms, targetRc }, cfg) {
  const byId = new Map(reinsurers.map((r) => [r.id, r]));
  const panel = treaty.expiring.panel.map((m) => {
    const re = byId.get(m.re);
    return { id: re.id, share: m.share, rc, rating: re.rating, onshore: re.onshore, shariahOk: re.shariah_ok, terms, maxShare: re.behavior.max_single_share };
  });
  const req = client.requirements;
  return evaluatePackage({
    panel,
    expiringIds: treaty.expiring.panel.map((m) => m.re),
    client: {
      conservatism: client.hidden.conservatism, priceSensitivity: client.hidden.price_sensitivity, loyalty: client.hidden.loyalty,
      relationship: clientRelationship, targetRc: targetRc ?? treaty.target_rc, minRating: req.min_rating, maxSingleShare: req.max_single_share,
      preferredTerms: treaty.terms.preferred, shariahRequired: req.shariah_required, shariahConventionalCap: req.shariah_conventional_cap ?? 1,
    },
    benchmark: marketBenchmark(market, treaty.line, cfg),
  }, cfg);
}
