// data/*.json 로드 + 검증. 하나라도 잘못되면 시작하지 않고, 어느 파일의 어느 항목인지 전부 알려 준다.
// 새 정적 파일(clients 등)은 마일스톤마다 DATA_FILES에 한 줄 + 검증 함수로 추가한다.

import { REASONS_GOOD, REASONS_BAD } from './negotiation.js';
import { parseMarkup, termIdsIn, CATEGORIES, APPEARS_IN, UI_TERM_IDS } from './glossary.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function show(v) {
  const text = typeof v === 'string' ? JSON.stringify(v) : (JSON.stringify(v) ?? String(v));
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

function rangeText(min, max) {
  const lo = Number.isFinite(min);
  const hi = Number.isFinite(max);
  if (lo && hi) return `${min}~${max} 사이의`;
  if (lo) return `${min} 이상의`;
  if (hi) return `${max} 이하의`;
  return '';
}

// 검증 도우미: 실패하면 errors에 쌓고 false를 돌려준다.
function checker(file, errors) {
  const fail = (path, msg, val) => {
    const tail = val === undefined ? '' : ` (지금 값: ${show(val)})`;
    errors.push({ file, path, message: `${file} › ${path} — ${msg}${tail}` });
  };
  return {
    fail,
    object(v, path) {
      if (isObj(v)) return true;
      fail(path, '객체({ … })여야 해요', v);
      return false;
    },
    array(v, path, min = 0) {
      if (Array.isArray(v) && v.length >= min) return true;
      fail(path, min > 0 ? `항목이 ${min}개 이상인 목록이어야 해요` : '목록([ … ])이어야 해요', v);
      return false;
    },
    int(v, path, min = -Infinity, max = Infinity) {
      if (Number.isInteger(v) && v >= min && v <= max) return true;
      fail(path, `${rangeText(min, max)} 정수여야 해요`.replace(/^ /, ''), v);
      return false;
    },
    num(v, path, min = -Infinity, max = Infinity) {
      if (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max) return true;
      fail(path, `${rangeText(min, max)} 숫자여야 해요`.replace(/^ /, ''), v);
      return false;
    },
    str(v, path, max = 200) {
      if (typeof v === 'string' && v.trim() !== '' && v.length <= max) return true;
      fail(path, `비어 있지 않은 글자(최대 ${max}자)여야 해요`, v);
      return false;
    },
  };
}

export const MARKET_BANDS = ['soft', 'neutral', 'hard'];

export function validateConfig(cfg, file = 'config.json') {
  const errors = [];
  const c = checker(file, errors);
  if (!c.object(cfg, '(최상위)')) return errors;

  if (c.object(cfg.game, 'game')) {
    const g = cfg.game;
    const startOk = c.int(g.start_turn, 'game.start_turn', 1);
    const totalOk = c.int(g.total_turns, 'game.total_turns', 1);
    if (startOk && totalOk && g.start_turn > g.total_turns) {
      c.fail('game.start_turn', 'total_turns보다 클 수 없어요', g.start_turn);
    }
    c.int(g.ap_per_week, 'game.ap_per_week', 0, 99);
    c.num(g.start_cash_usd_m, 'game.start_cash_usd_m', 0);
    c.num(g.weekly_overhead_usd_m, 'game.weekly_overhead_usd_m', 0);
    for (const key of ['start_market_index', 'start_board_confidence', 'start_reputation', 'start_compliance', 'start_market_intel']) {
      c.num(g[key], `game.${key}`, 0, 100);
    }
    c.str(g.firm_name, 'game.firm_name', 60);
  }

  if (c.object(cfg.turn, 'turn')) {
    c.int(cfg.turn.deadline_warning_weeks, 'turn.deadline_warning_weeks', 0, 10);
  }

  // 길잡이(design.md §6.0.1, §6.3)
  if (c.object(cfg.guide, 'guide')) {
    c.int(cfg.guide.scout_min_meetings, 'guide.scout_min_meetings', 0, 99);
    c.num(cfg.guide.counter_close_pp, 'guide.counter_close_pp', 0, 20);
    c.int(cfg.guide.careful_patience, 'guide.careful_patience', 0, 9);
    c.int(cfg.guide.year_end_weeks, 'guide.year_end_weeks', 0, 58);
  }

  if (c.object(cfg.scouting, 'scouting')) {
    const sc = cfg.scouting;
    c.int(sc.meeting_ap, 'scouting.meeting_ap', 0, 6);
    c.num(sc.meeting_focus_gain, 'scouting.meeting_focus_gain', 0, 100);
    c.num(sc.meeting_other_gain, 'scouting.meeting_other_gain', 0, 100);
    c.num(sc.damping_divisor, 'scouting.damping_divisor', 100, 1000); // 100 미만이면 100에 가까워질 때 증가분이 음수가 된다
    c.num(sc.meeting_relationship_gain, 'scouting.meeting_relationship_gain', 0, 100);
    c.num(sc.relationship_damping, 'scouting.relationship_damping', 100, 1000);
    c.num(sc.err_k, 'scouting.err_k', 0, 100);
    c.num(sc.jitter_ratio, 'scouting.jitter_ratio', 0, 1); // 1을 넘으면 실제 값이 표시 범위 밖으로 나갈 수 있다
    if (c.object(sc.stage_thresholds, 'scouting.stage_thresholds')) {
      const t = sc.stage_thresholds;
      const ok = ['blurred', 'sharp', 'exact'].map((k) => c.num(t[k], `scouting.stage_thresholds.${k}`, 0, 100));
      if (ok.every(Boolean) && !(t.blurred < t.sharp && t.sharp < t.exact)) {
        c.fail('scouting.stage_thresholds', 'blurred < sharp < exact 순서여야 해요', t);
      }
    }
    if (c.object(sc.label_bands, 'scouting.label_bands')) {
      const lo = c.num(sc.label_bands.low_below, 'scouting.label_bands.low_below', 0, 100);
      const hi = c.num(sc.label_bands.high_above, 'scouting.label_bands.high_above', 0, 100);
      if (lo && hi && sc.label_bands.low_below >= sc.label_bands.high_above) {
        c.fail('scouting.label_bands', 'low_below가 high_above보다 작아야 해요', sc.label_bands);
      }
    }
  }

  if (c.object(cfg.market, 'market')) {
    const m = cfg.market;
    c.num(m.intel_error_k, 'market.intel_error_k', 0, 100);
    if (c.array(m.labels, 'market.labels', 1)) {
      let prev = -Infinity;
      m.labels.forEach((band, i) => {
        const p = `market.labels[${i}]`;
        if (!c.object(band, p)) return;
        c.str(band.label_ko, `${p}.label_ko`, 20);
        if (c.num(band.max, `${p}.max`, 0, 100)) {
          // 구간은 오름차순이어야 "index ≤ max" 판정이 맞다.
          if (band.max <= prev) c.fail(`${p}.max`, '앞 구간보다 커야 해요(오름차순)', band.max);
          prev = band.max;
        }
      });
      const last = m.labels[m.labels.length - 1];
      if (isObj(last) && last.max !== 100) {
        c.fail(`market.labels[${m.labels.length - 1}].max`, '마지막 구간은 100까지 덮어야 해요', last.max);
      }
    }
    // 분기 드리프트(design.md §3, M6a). revert가 1을 넘으면 평균 회귀가 평균을 지나쳐 진동한다.
    if (c.object(m.cycle, 'market.cycle')) {
      c.num(m.cycle.center, 'market.cycle.center', 0, 100);
      c.num(m.cycle.revert, 'market.cycle.revert', 0, 1);
      c.num(m.cycle.noise_sd, 'market.cycle.noise_sd', 0, 50);
    }
    if (c.object(m.family, 'market.family')) {
      const softOk = c.num(m.family.soft_max, 'market.family.soft_max', 0, 100);
      const hardOk = c.num(m.family.hard_min, 'market.family.hard_min', 0, 100);
      if (softOk && hardOk && m.family.soft_max >= m.family.hard_min) {
        c.fail('market.family', 'soft_max가 hard_min보다 작아야 해요', m.family);
      }
      if (c.object(m.family.mails, 'market.family.mails')) {
        for (const band of MARKET_BANDS) c.str(m.family.mails[band], `market.family.mails.${band}`, 80);
      }
    }
  }

  if (c.object(cfg.season, 'season') && c.object(cfg.season.gap, 'season.gap')) {
    const g = cfg.season.gap; // 인셉션 다음 주 공백 벌칙(design.md §8.3 ⑤)
    c.num(g.relationship, 'season.gap.relationship', -100, 0);
    c.num(g.reputation, 'season.gap.reputation', -100, 0);
    c.num(g.board_confidence, 'season.gap.board_confidence', -100, 0);
    c.str(g.mail, 'season.gap.mail', 80);
  }
  if (c.object(cfg.negotiation, 'negotiation')) validateNegotiation(c, cfg.negotiation);
  validateFinanceConfig(c, cfg);
  return errors;
}

export const PART_IDS = ['revenue', 'retention', 'rank', 'compliance', 'reputation'];
export const GRADE_LETTERS = ['S', 'A', 'B', 'C', 'D'];
export const RANK_MAIL_KEYS = ['top_up', 'top_down', 'mid_up', 'mid_down', 'low_up', 'low_down'];

// 재무·라이벌·이사회 계수(design.md §9, §10.7, M7a)
function validateFinanceConfig(c, cfg) {
  if (c.object(cfg.finance, 'finance')) {
    c.int(cfg.finance.cash_delay_weeks, 'finance.cash_delay_weeks', 0, 20);
    c.num(cfg.finance.negative_cash_penalty, 'finance.negative_cash_penalty', -100, 0);
  }
  if (c.object(cfg.rivals, 'rivals')) {
    c.num(cfg.rivals.market_k, 'rivals.market_k', 0, 1);
    if (c.array(cfg.rivals.quarters, 'rivals.quarters', 1)) cfg.rivals.quarters.forEach((q, i) => c.str(q, `rivals.quarters[${i}]`, 20)); // 존재 여부는 validateCross가 본다
  }
  if (!c.object(cfg.board, 'board')) return;
  const b = cfg.board;
  if (c.object(b.targets, 'board.targets')) {
    c.num(b.targets.brokerage_usd_m, 'board.targets.brokerage_usd_m', 0.01, 1000); // 0이면 수익 비율을 나눌 수 없다
    c.int(b.targets.rank_max, 'board.targets.rank_max', 1, 20);
    c.int(b.targets.clients_kept, 'board.targets.clients_kept', 0, 99);
    c.num(b.targets.compliance_min, 'board.targets.compliance_min', 0, 100);
  }
  c.num(b.fired_below, 'board.fired_below', 0, 100);
  if (c.object(b.score, 'board.score')) {
    if (c.object(b.score.weights, 'board.score.weights')) {
      let sum = 0;
      for (const id of PART_IDS) if (c.num(b.score.weights[id], `board.score.weights.${id}`, 0, 100)) sum += b.score.weights[id];
      if (Math.abs(sum - 100) > 1e-9) c.fail('board.score.weights', '다섯 항목의 합이 100이어야 점수가 100점 만점이에요', sum);
    }
    c.num(b.score.revenue_cap, 'board.score.revenue_cap', 0, 1);
    c.num(b.score.rank_unknown_fraction, 'board.score.rank_unknown_fraction', 0, 1);
    if (c.array(b.score.rank_fraction, 'board.score.rank_fraction', 1)) b.score.rank_fraction.forEach((x, i) => c.num(x, `board.score.rank_fraction[${i}]`, 0, 1));
  }
  if (c.array(b.grades, 'board.grades', 1)) {
    let prev = Infinity;
    b.grades.forEach((g, i) => {
      const p = `board.grades[${i}]`;
      if (!c.object(g, p)) return;
      if (!GRADE_LETTERS.includes(g.grade)) c.fail(`${p}.grade`, `${GRADE_LETTERS.join(' / ')} 중 하나여야 해요`, g.grade);
      if (c.num(g.min, `${p}.min`, 0, 100)) {
        if (g.min >= prev) c.fail(`${p}.min`, '앞 등급보다 작아야 해요(높은 등급부터)', g.min);
        prev = g.min;
      }
    });
    const last = b.grades[b.grades.length - 1];
    if (isObj(last) && last.min !== 0) c.fail(`board.grades[${b.grades.length - 1}].min`, '마지막 등급은 0점부터여야 모든 점수가 등급을 받아요', last.min);
    const letters = b.grades.map((g) => g?.grade);
    if (GRADE_LETTERS.some((g) => !letters.includes(g))) c.fail('board.grades', 'S A B C D 다섯 등급이 모두 있어야 해요', letters);
  }
  if (c.object(b.grade_delta, 'board.grade_delta')) for (const g of GRADE_LETTERS) c.num(b.grade_delta[g], `board.grade_delta.${g}`, -100, 100);
  if (c.object(b.report, 'board.report')) {
    c.num(b.report.tier_good, 'board.report.tier_good', 0, 1);
    c.num(b.report.tier_weak, 'board.report.tier_weak', 0, 1);
    c.num(b.report.tip_below, 'board.report.tip_below', 0, 1);
    c.int(b.report.tip_max, 'board.report.tip_max', 0, 5);
    if (Number.isFinite(b.report.tier_good) && Number.isFinite(b.report.tier_weak) && b.report.tier_weak > b.report.tier_good) c.fail('board.report.tier_weak', 'tier_good보다 클 수 없어요', b.report.tier_weak);
  }
  if (c.object(b.rank_buckets, 'board.rank_buckets')) c.int(b.rank_buckets.top_max, 'board.rank_buckets.top_max', 1, 20);
  if (c.object(b.mails, 'board.mails')) {
    if (c.object(b.mails.rank, 'board.mails.rank')) for (const k of RANK_MAIL_KEYS) c.str(b.mails.rank[k], `board.mails.rank.${k}`, 80);
    if (c.object(b.mails.grade, 'board.mails.grade')) for (const g of GRADE_LETTERS) c.str(b.mails.grade[g], `board.mails.grade.${g}`, 80);
    for (const k of ['fired', 'cash_warning', 'cash_penalty']) c.str(b.mails[k], `board.mails.${k}`, 80);
  }
}

// 협상 계수(design.md §10.7). 범위는 "식이 깨지지 않는" 정도만 막고, 값 튜닝은 자유롭게 둔다.
function validateNegotiation(c, n) {
  const P = 'negotiation';
  for (const k of ['market_k', 'loss_k', 'cons_k', 'theta_base', 'theta_span', 'noise_pp', 'support_gap', 'quote_k', 'quote_cap', 'bundle_each', 'bundle_max', 'hint_err_k', 'hint_near_pp', 'onshore_bonus']) {
    c.num(n[k], `${P}.${k}`, 0, 1000);
  }
  for (const k of ['capacity_k', 'cons_capacity_k', 'goodwill_base', 'goodwill_loyalty', 'rel_k', 'bluff_base', 'bluff_cons_k', 'support_max_extra', 'share_tolerance']) {
    c.num(n[k], `${P}.${k}`, 0, 100);
  }
  c.num(n.counter_weeks_divisor, `${P}.counter_weeks_divisor`, 1, 100); // 나눗셈이라 0이면 안 된다
  c.num(n.reject_patience, `${P}.reject_patience`, -20, 20);
  c.num(n.reject_relationship, `${P}.reject_relationship`, -100, 100);
  c.num(n.loss_min, `${P}.loss_min`, -1000, 1000);
  c.num(n.loss_max, `${P}.loss_max`, -1000, 1000);
  if (Number.isFinite(n.loss_min) && Number.isFinite(n.loss_max) && n.loss_min > n.loss_max) c.fail(`${P}.loss_min`, 'loss_max보다 클 수 없어요', n.loss_min);

  if (c.array(n.lr_weights, `${P}.lr_weights`, 3) && n.lr_weights.length === 3) n.lr_weights.forEach((w, i) => c.num(w, `${P}.lr_weights[${i}]`, 0, 1));
  else if (Array.isArray(n.lr_weights)) c.fail(`${P}.lr_weights`, '손해율 가중치는 정확히 3개(y-2, y-1, y0)여야 해요', n.lr_weights);

  if (c.object(n.line_adj, `${P}.line_adj`)) for (const l of LINES) c.num(n.line_adj[l], `${P}.line_adj.${l}`, -100, 100);
  if (c.object(n.uncertainty, `${P}.uncertainty`)) for (const k of ['base', 'new_reinsurer', 'broad_terms', 'big_loss', 'prep']) c.num(n.uncertainty[k], `${P}.uncertainty.${k}`, 0, 10);
  if (c.array(n.terms_order, `${P}.terms_order`, 2)) n.terms_order.forEach((t, i) => c.str(t, `${P}.terms_order[${i}]`, 20));
  if (c.object(n.terms_adj, `${P}.terms_adj`) && Array.isArray(n.terms_order)) {
    for (const t of n.terms_order) c.num(n.terms_adj[t], `${P}.terms_adj.${t}`, -100, 100);
  }
  if (c.object(n.rating_score, `${P}.rating_score`)) {
    for (const [k, v] of Object.entries(n.rating_score)) c.num(v, `${P}.rating_score.${k}`, 0, 100);
    c.num(n.rating_score._default, `${P}.rating_score._default`, 0, 100);
  }

  if (c.object(n.board, `${P}.board`)) {
    const b = n.board;
    for (const k of ['ask_ap', 'propose_ap', 'retry_weeks']) c.num(b[k], `${P}.board.${k}`, 0, 20);
    c.num(b.patience_start, `${P}.board.patience_start`, 1, 20);
    c.num(b.urgent_weeks, `${P}.board.urgent_weeks`, 0, 20);
    c.num(b.counter_valid_weeks, `${P}.board.counter_valid_weeks`, 1, 20);
    if (c.object(b.verdict_effects, `${P}.board.verdict_effects`)) {
      for (const v of ['delighted', 'accept']) {
        if (!c.object(b.verdict_effects[v], `${P}.board.verdict_effects.${v}`)) continue;
        c.num(b.verdict_effects[v].client_relationship, `${P}.board.verdict_effects.${v}.client_relationship`, -100, 100);
        c.num(b.verdict_effects[v].reputation, `${P}.board.verdict_effects.${v}.reputation`, -100, 100);
      }
    }
  }

  if (c.object(n.client, `${P}.client`)) {
    const cl = n.client;
    c.num(cl.price_slope, `${P}.client.price_slope`, 0, 1000);
    c.num(cl.continuity_k, `${P}.client.continuity_k`, 0, 1000);
    c.num(cl.terms_step, `${P}.client.terms_step`, 0, 100);
    c.num(cl.structure_k, `${P}.client.structure_k`, 0, 100);
    c.num(cl.accept_threshold_base, `${P}.client.accept_threshold_base`, 0, 100);
    c.num(cl.accept_threshold_goodwill_k, `${P}.client.accept_threshold_goodwill_k`, 0, 10);
    c.num(cl.delighted_margin, `${P}.client.delighted_margin`, 0, 100);
    c.num(cl.renegotiate_margin, `${P}.client.renegotiate_margin`, 0, 100);
    if (c.object(cl.weights, `${P}.client.weights`)) {
      for (const k of ['price_base', 'price_ps', 'security', 'continuity_base', 'continuity_cons', 'terms', 'service']) c.num(cl.weights[k], `${P}.client.weights.${k}`, 0, 10);
    }
  }
  if (c.object(n.expectation, `${P}.expectation`)) {
    const e = n.expectation;
    c.num(e.base, `${P}.expectation.base`, 0, 1);
    c.num(e.relationship_k, `${P}.expectation.relationship_k`, 0, 1);
    c.num(e.high_ps, `${P}.expectation.high_ps`, 0, 100);
    c.num(e.high_ps_relationship, `${P}.expectation.high_ps_relationship`, -100, 100);
    c.int(e.cooldown_weeks, `${P}.expectation.cooldown_weeks`, 0, 20);
  }
}

export function validateCalendar(cal, file = 'calendar.json') {
  const errors = [];
  const c = checker(file, errors);
  if (!c.object(cal, '(최상위)')) return errors;

  const turnsOk = c.int(cal.turns, 'turns', 1);

  if (c.array(cal.quarters, 'quarters', 1)) {
    const ids = new Set();
    let expectedFrom = 1;
    cal.quarters.forEach((q, i) => {
      const p = `quarters[${i}]`;
      if (!c.object(q, p)) return;
      if (c.str(q.id, `${p}.id`, 40)) {
        if (ids.has(q.id)) c.fail(`${p}.id`, '다른 분기와 겹쳐요', q.id);
        ids.add(q.id);
      }
      c.str(q.label_ko, `${p}.label_ko`, 20);
      const fromOk = c.int(q.from, `${p}.from`, 1);
      const toOk = c.int(q.to, `${p}.to`, 1);
      if (fromOk && toOk) {
        if (q.to < q.from) c.fail(`${p}.to`, 'from보다 작을 수 없어요', q.to);
        // 분기들이 빈틈·겹침 없이 1턴부터 이어져야 모든 턴이 어떤 분기에 속한다.
        if (q.from !== expectedFrom) c.fail(`${p}.from`, `앞 분기에 이어 ${expectedFrom}이어야 해요(빈틈·겹침 금지)`, q.from);
        expectedFrom = q.to + 1;
      }
    });
    if (turnsOk && expectedFrom - 1 !== cal.turns) {
      c.fail('quarters', `마지막 분기가 turns(${cal.turns})까지 이어져야 해요`, expectedFrom - 1);
    }
  }

  if (c.array(cal.seasons, 'seasons')) {
    const ids = new Set();
    cal.seasons.forEach((s, i) => {
      const p = `seasons[${i}]`;
      if (!c.object(s, p)) return;
      if (c.str(s.id, `${p}.id`, 40)) {
        if (ids.has(s.id)) c.fail(`${p}.id`, '다른 시즌과 겹쳐요', s.id);
        ids.add(s.id);
      }
      c.str(s.label, `${p}.label`, 20);
      const openOk = c.int(s.open_turn, `${p}.open_turn`, 1);
      const incOk = c.int(s.inception_turn, `${p}.inception_turn`, 1, turnsOk ? cal.turns : Infinity);
      if (openOk && incOk && s.open_turn >= s.inception_turn) {
        c.fail(`${p}.open_turn`, 'inception_turn보다 앞이어야 해요', s.open_turn);
      }
    });
  }
  return errors;
}

// ---------- 메일 (design.md §10.5, §10.8) ----------

export const MAIL_TYPES = ['client_request', 'reinsurer_response', 'event', 'regulatory', 'market_report', 'board', 'system', 'mentor'];
export const MAIL_FROM_KINDS = ['client', 'reinsurer', 'regulator', 'market', 'board', 'system', 'mentor'];
export const MAIL_PRIORITIES = ['urgent', 'normal', 'low'];
// M1에서 쓸 수 있는 치환 변수. {client.*} 등은 해당 데이터가 생기는 마일스톤에서 추가한다.
export const MAIL_VARS = ['market.label', 'turn.label', 'player.firm', 'report.grade', 'report.strong', 'report.weak'];
// 효과 연산자: 닫힌 집합(§10.8). 아직 구현하지 않은 연산자는 별도로 안내한다.
export const EFFECT_OPS = ['add', 'set', 'mul', 'flag_set', 'flag_clear', 'mail_send', 'cash', 'event_schedule', 'modifier_add'];
const LATER_OPS = {};
// 효과가 닿을 수 있는 곳. player / market 은 수치 필드, client:<id> / reinsurer:<id> 는 관계도와 스카우트 값(M6a부터 데이터에서도 가능).
export const EFFECT_FIELDS = {
  player: ['reputation', 'compliance', 'board_confidence', 'market_intel'],
  market: ['index'],
};
const ENTITY_TARGET_RE = /^(client|reinsurer):([a-z][a-z0-9_]*)$/;
const ENTITY_FIELD_RE = /^(relationship|scout\.(conservatism|price_sensitivity|loyalty))$/;
const TREATY_TARGET_RE = /^treaty:(trt_[a-z0-9_]+)$/;
const TREATY_FIELDS = ['lr_extra', 'big_loss', 'structure_option', 'phase'];
const MODIFIER_FIELD_RE = /^(capacity(\.(property_energy|marine_cargo|takaful_general))?|max_single_share|price_floor)$/;
const ID_RE = /^[a-z][a-z0-9_]*$/;

// 용어 마크업 [[id|문구]] 검사. 짝이 안 맞거나 모르는 용어 id면 막는다(terms가 Set일 때만 id 존재를 본다).
function checkMarkup(c, text, path, terms) {
  const { segments, problems } = parseMarkup(text);
  for (const pr of problems) {
    if (pr.kind === 'bad_id') c.fail(path, `용어 id는 gl_로 시작하는 소문자 snake_case여야 해요(${pr.id})`, text);
    else if (pr.kind === 'empty_label') c.fail(path, `[[${pr.id}|…]]의 표시문구가 비어 있어요`, text);
    else c.fail(path, '[[ ]] 짝이 맞지 않아요', text);
  }
  if (terms instanceof Set) {
    for (const seg of segments) if (seg.term && !terms.has(seg.term)) c.fail(path, `glossary.json에 없는 용어 id예요: ${seg.term}`, text);
  }
}

// markup: false = 이 칸에서는 용어 표시를 못 쓴다(기본) / true = 쓸 수 있다(id 존재는 안 봄) / Set = 쓸 수 있고 id가 Set에 있어야 한다.
function validateText(c, text, path, markup = false) {
  if (typeof text !== 'string') return;
  if (text.includes('[[') || text.includes(']]')) {
    if (markup === false) c.fail(path, '이 칸에서는 용어 표시 [[…]]를 쓸 수 없어요(쓸 수 있는 칸은 design.md §5.3)', text);
    else checkMarkup(c, text, path, markup);
  }
  for (const m of text.matchAll(/\{([^{}]*)\}/g)) {
    if (!MAIL_VARS.includes(m[1])) c.fail(path, `쓸 수 없는 치환 변수 {${m[1]}} — 지금은 ${MAIL_VARS.map((v) => `{${v}}`).join(' ')}만 돼요`);
  }
}

function validateEffects(c, effects, path, mailIds) {
  if (!c.array(effects, path)) return;
  effects.forEach((ef, i) => {
    const p = `${path}[${i}]`;
    if (!c.object(ef, p)) return;
    if (LATER_OPS[ef.op]) {
      c.fail(`${p}.op`, `${ef.op}는 ${LATER_OPS[ef.op]} 단계에서 지원해요`, ef.op);
      return;
    }
    if (!EFFECT_OPS.includes(ef.op)) {
      c.fail(`${p}.op`, `알 수 없는 연산자예요(${EFFECT_OPS.join(' / ')} 중 하나)`, ef.op);
      return;
    }
    if (ef.op === 'modifier_add') {
      // 기간 한정 보정(design.md §8.3 ①): 재보험사만 대상이고 필드는 닫힌 집합이다.
      if (typeof ef.target !== 'string' || !/^reinsurer:[a-z][a-z0-9_]*$/.test(ef.target)) c.fail(`${p}.target`, 'reinsurer:<id>여야 해요', ef.target);
      if (!MODIFIER_FIELD_RE.test(String(ef.field))) c.fail(`${p}.field`, 'capacity · capacity.<라인> · max_single_share · price_floor 중 하나여야 해요', ef.field);
      if (ef.mult === undefined && ef.add === undefined) c.fail(`${p}.mult`, 'mult와 add 중 하나는 있어야 해요');
      if (ef.mult !== undefined) c.num(ef.mult, `${p}.mult`, 0, 10);
      if (ef.add !== undefined) c.num(ef.add, `${p}.add`, -1000, 1000);
      if ((ef.field === 'max_single_share' || ef.field === 'price_floor') && ef.mult !== undefined) c.fail(`${p}.mult`, `${ef.field}는 add만 쓸 수 있어요`, ef.mult);
      c.int(ef.duration_weeks, `${p}.duration_weeks`, 1, 60);
    } else if ((ef.op === 'add' || ef.op === 'set' || ef.op === 'mul') && typeof ef.target === 'string' && TREATY_TARGET_RE.test(ef.target)) {
      // 트리티 대상(design.md §8.3 ②)
      if (!TREATY_FIELDS.includes(ef.field)) c.fail(`${p}.field`, `트리티에서 쓸 수 있는 필드는 ${TREATY_FIELDS.join(' / ')}예요`, ef.field);
      else if (ef.field === 'lr_extra') c.num(ef.value, `${p}.value`, 0, 100);
      else if (ef.op !== 'set') c.fail(`${p}.op`, `${ef.field}는 set만 쓸 수 있어요`, ef.op);
      else if (ef.field === 'big_loss' && typeof ef.value !== 'boolean') c.fail(`${p}.value`, 'true 또는 false여야 해요', ef.value);
      else if (ef.field === 'structure_option' && typeof ef.value !== 'string') c.fail(`${p}.value`, '구조 옵션 id(또는 빈 글자)여야 해요', ef.value);
      else if (ef.field === 'phase' && ef.value !== 'lost') c.fail(`${p}.value`, 'lost만 쓸 수 있어요', ef.value);
    } else if ((ef.op === 'set') && typeof ef.target === 'string' && /^reinsurer:/.test(ef.target) && ef.field === 'rating') {
      c.str(ef.value, `${p}.value`, 10); // 덮어쓰는 등급(글자)
    } else if ((ef.op === 'set') && typeof ef.target === 'string' && /^client:/.test(ef.target) && ef.field === 'requirements.min_rating') {
      c.str(ef.value, `${p}.value`, 10); // 한시적 등급 예외: 고객의 최소 등급을 덮어쓴다
    } else if ((ef.op === 'set') && typeof ef.target === 'string' && /^client:/.test(ef.target) && ef.field === 'requirements.shariah_conventional_cap') {
      c.num(ef.value, `${p}.value`, 0, 1);
    } else if (ef.op === 'add' || ef.op === 'set' || ef.op === 'mul') {
      if (typeof ef.target === 'string' && ENTITY_TARGET_RE.test(ef.target)) {
        if (!ENTITY_FIELD_RE.test(String(ef.field))) c.fail(`${p}.field`, `${ef.target.split(':')[0]}에서 쓸 수 있는 필드는 relationship / scout.conservatism / scout.price_sensitivity / scout.loyalty예요`, ef.field);
      } else if (ef.target !== 'player' && ef.target !== 'market') {
        c.fail(`${p}.target`, 'player · market · client:<id> · reinsurer:<id> 중 하나여야 해요', ef.target);
      } else if (!EFFECT_FIELDS[ef.target].includes(ef.field)) {
        c.fail(`${p}.field`, `${ef.target}에서 쓸 수 있는 필드는 ${EFFECT_FIELDS[ef.target].join(' / ')}예요`, ef.field);
      }
      c.num(ef.value, `${p}.value`);
      if (ef.min !== undefined) c.num(ef.min, `${p}.min`);
      if (ef.max !== undefined) c.num(ef.max, `${p}.max`);
    } else if (ef.op === 'cash') {
      c.num(ef.value, `${p}.value`);
      if (ef.kind !== undefined && ef.kind !== 'fine') c.fail(`${p}.kind`, 'fine만 쓸 수 있어요(과태료로 기록)', ef.kind);
    } else if (ef.op === 'flag_set' || ef.op === 'flag_clear') {
      if (c.str(ef.flag, `${p}.flag`, 60) && !ID_RE.test(ef.flag)) c.fail(`${p}.flag`, 'snake_case 영문이어야 해요', ef.flag);
    } else if (ef.op === 'mail_send') {
      if (c.str(ef.mail, `${p}.mail`, 80) && !mailIds.has(ef.mail)) c.fail(`${p}.mail`, 'mails.json에 없는 메일 id예요', ef.mail);
      if (ef.delay_weeks !== undefined) c.int(ef.delay_weeks, `${p}.delay_weeks`, 0, 60);
    } else if (ef.op === 'event_schedule') {
      c.str(ef.event, `${p}.event`, 80); // 존재 여부는 validateCross가 본다
      c.int(ef.delay_weeks, `${p}.delay_weeks`, 0, 60);
      if (ef.prob !== undefined) c.num(ef.prob, `${p}.prob`, 0, 1);
    }
  });
}

export function validateMails(mails, file = 'mails.json', calendar = null, terms = true) {
  const errors = [];
  const c = checker(file, errors);
  if (!c.array(mails, '(최상위)')) return errors;

  const ids = new Set();
  for (const m of mails) if (isObj(m) && typeof m.id === 'string') ids.add(m.id);
  const seen = new Set();
  const turns = calendar?.turns ?? Infinity;

  mails.forEach((m, i) => {
    const p = `[${i}]`;
    if (!c.object(m, p)) return;
    const label = typeof m.id === 'string' ? `${p}(${m.id})` : p;
    if (c.str(m.id, `${label}.id`, 80)) {
      if (!/^mail_[a-z0-9_]+$/.test(m.id)) c.fail(`${label}.id`, 'mail_ 로 시작하는 snake_case여야 해요', m.id);
      if (seen.has(m.id)) c.fail(`${label}.id`, '다른 메일과 id가 겹쳐요', m.id);
      seen.add(m.id);
    }
    if (!MAIL_TYPES.includes(m.type)) c.fail(`${label}.type`, `${MAIL_TYPES.join(' / ')} 중 하나여야 해요`, m.type);
    if (c.object(m.from, `${label}.from`)) {
      if (!MAIL_FROM_KINDS.includes(m.from.kind)) c.fail(`${label}.from.kind`, `${MAIL_FROM_KINDS.join(' / ')} 중 하나여야 해요`, m.from.kind);
      c.str(m.from.name_ko, `${label}.from.name_ko`, 60);
    }
    if (c.str(m.subject_ko, `${label}.subject_ko`, 120)) validateText(c, m.subject_ko, `${label}.subject_ko`);
    if (c.array(m.body_ko, `${label}.body_ko`, 1)) {
      m.body_ko.forEach((line, j) => {
        if (c.str(line, `${label}.body_ko[${j}]`, 600)) validateText(c, line, `${label}.body_ko[${j}]`, terms);
      });
    }
    if (!MAIL_PRIORITIES.includes(m.priority)) c.fail(`${label}.priority`, `${MAIL_PRIORITIES.join(' / ')} 중 하나여야 해요`, m.priority);
    if (typeof m.blocking !== 'boolean') c.fail(`${label}.blocking`, 'true 또는 false여야 해요', m.blocking);

    const hasDeadline = m.deadline_weeks !== undefined;
    if (hasDeadline) c.int(m.deadline_weeks, `${label}.deadline_weeks`, 1, 20);
    if (m.schedule !== undefined && c.object(m.schedule, `${label}.schedule`)) {
      c.int(m.schedule.turn, `${label}.schedule.turn`, 1, turns);
    }

    if (!c.array(m.choices, `${label}.choices`)) return;
    const choiceIds = new Set();
    m.choices.forEach((ch, j) => {
      const cp = `${label}.choices[${j}]`;
      if (!c.object(ch, cp)) return;
      if (c.str(ch.id, `${cp}.id`, 40)) {
        if (!ID_RE.test(ch.id)) c.fail(`${cp}.id`, 'snake_case 영문이어야 해요', ch.id);
        if (choiceIds.has(ch.id)) c.fail(`${cp}.id`, '같은 메일의 다른 선택지와 겹쳐요', ch.id);
        choiceIds.add(ch.id);
      }
      if (c.str(ch.label_ko, `${cp}.label_ko`, 120)) validateText(c, ch.label_ko, `${cp}.label_ko`);
      c.int(ch.ap_cost, `${cp}.ap_cost`, 0, 6);
      validateEffects(c, ch.effects, `${cp}.effects`, ids);
      if (c.str(ch.result_ko, `${cp}.result_ko`, 400)) validateText(c, ch.result_ko, `${cp}.result_ko`, terms);
    });

    // 마감·기본 선택·막힘의 약속
    if (m.choices.length === 0) {
      if (m.blocking === true) c.fail(`${label}.blocking`, '선택지가 없는 메일은 막힘(blocking)일 수 없어요', m.blocking);
      if (hasDeadline) c.fail(`${label}.deadline_weeks`, '선택지가 없는 메일에는 마감이 필요 없어요', m.deadline_weeks);
      if (m.default_choice !== undefined) c.fail(`${label}.default_choice`, '선택지가 없는 메일에는 필요 없어요', m.default_choice);
    } else if (!hasDeadline) {
      if (m.blocking === true) c.fail(`${label}.blocking`, '막힘 메일은 deadline_weeks가 있어야 해요', m.blocking);
      if (m.default_choice !== undefined) c.fail(`${label}.default_choice`, 'deadline_weeks가 없으면 필요 없어요', m.default_choice);
    } else {
      const def = m.choices.find((ch) => isObj(ch) && ch.id === m.default_choice);
      if (!def) c.fail(`${label}.default_choice`, '선택지 id 중 하나여야 해요', m.default_choice);
      else if (def.ap_cost !== 0) c.fail(`${label}.default_choice`, '마감 자동 처리에는 행동 점수가 들지 않으니 ap_cost 0인 선택지여야 해요', m.default_choice);
    }
  });
  return errors;
}

// ---------- 고객·재보험사 (design.md §10.1, §10.2, §4) ----------

export const HIDDEN_ATTRS = ['conservatism', 'price_sensitivity', 'loyalty'];
export const LINES = ['property_energy', 'marine_cargo', 'takaful_general'];
export const CLIENT_KINDS = ['local_insurer', 'marine_specialist', 'takaful_group'];
export const REINSURER_KINDS = ['global_reinsurer', 'regional_reinsurer', 'syndicate', 'retakaful'];

// 두 파일이 공유하는 부분: id·이름·숨은 속성·초기 상태·단서 메모.
function validateEntityCommon(c, e, label, idPrefix) {
  if (c.str(e.id, `${label}.id`, 80)) {
    if (!new RegExp(`^${idPrefix}[a-z0-9_]+$`).test(e.id)) c.fail(`${label}.id`, `${idPrefix} 로 시작하는 snake_case여야 해요`, e.id);
  }
  c.str(e.name, `${label}.name`, 80);
  c.str(e.name_ko, `${label}.name_ko`, 60);
  c.str(e.hq, `${label}.hq`, 60);

  if (c.object(e.hidden, `${label}.hidden`)) {
    for (const a of HIDDEN_ATTRS) c.num(e.hidden[a], `${label}.hidden.${a}`, 0, 100);
  }
  if (c.object(e.initial, `${label}.initial`)) {
    c.num(e.initial.relationship, `${label}.initial.relationship`, 0, 100);
    if (c.object(e.initial.scout, `${label}.initial.scout`)) {
      for (const a of HIDDEN_ATTRS) c.num(e.initial.scout[a], `${label}.initial.scout.${a}`, 0, 100);
    }
  }
  // 미팅 반응 한 줄: 미팅 주제 4가지 모두에 있어야 한다(design.md §4.3).
  if (c.object(e.meeting_reactions, `${label}.meeting_reactions`)) {
    for (const topic of ['general', ...HIDDEN_ATTRS]) {
      const path = `${label}.meeting_reactions.${topic}`;
      if (c.str(e.meeting_reactions[topic], path, 200)) validateText(c, e.meeting_reactions[topic], path);
    }
  }
  // 단서 메모: 속성마다 문턱이 낮은 것부터 읽히므로 같은 속성 안에서는 min_scout이 오름차순이어야 한다.
  if (c.array(e.scout_notes, `${label}.scout_notes`, 1)) {
    const lastMin = {};
    e.scout_notes.forEach((n, j) => {
      const p = `${label}.scout_notes[${j}]`;
      if (!c.object(n, p)) return;
      if (!HIDDEN_ATTRS.includes(n.attr)) c.fail(`${p}.attr`, `${HIDDEN_ATTRS.join(' / ')} 중 하나여야 해요`, n.attr);
      if (c.num(n.min_scout, `${p}.min_scout`, 0, 100) && HIDDEN_ATTRS.includes(n.attr)) {
        if (n.min_scout <= (lastMin[n.attr] ?? -1)) c.fail(`${p}.min_scout`, '같은 속성의 앞 단서보다 커야 해요(오름차순)', n.min_scout);
        lastMin[n.attr] = n.min_scout;
      }
      if (c.str(n.text_ko, `${p}.text_ko`, 300)) validateText(c, n.text_ko, `${p}.text_ko`);
    });
  }
}

const checkIntro = (c, text, path, terms) => { if (c.str(text, path, 400)) validateText(c, text, path, terms); };

function validateEntityList(list, file, { idPrefix, kinds, extra }, terms) {
  const errors = [];
  const c = checker(file, errors);
  if (!c.array(list, '(최상위)', 1)) return errors;
  const seen = new Set();
  list.forEach((e, i) => {
    const p = `[${i}]`;
    if (!c.object(e, p)) return;
    const label = typeof e.id === 'string' ? `${p}(${e.id})` : p;
    validateEntityCommon(c, e, label, idPrefix);
    if (typeof e.id === 'string') {
      if (seen.has(e.id)) c.fail(`${label}.id`, '다른 항목과 id가 겹쳐요', e.id);
      seen.add(e.id);
    }
    if (!kinds.includes(e.kind)) c.fail(`${label}.kind`, `${kinds.join(' / ')} 중 하나여야 해요`, e.kind);
    extra(c, e, label, terms);
  });
  return errors;
}

const lineMap = (c, v, path, min, max) => {
  if (!c.object(v, path)) return;
  for (const line of LINES) c.num(v[line], `${path}.${line}`, min, max);
};

export function validateClients(list, file = 'clients.json', terms = true) {
  return validateEntityList(list, file, {
    idPrefix: 'cli_',
    kinds: CLIENT_KINDS,
    extra(c, e, label, tm) {
      if (!c.object(e.profile, `${label}.profile`)) return;
      const pr = e.profile;
      checkIntro(c, pr.intro_ko, `${label}.profile.intro_ko`, tm);
      c.num(pr.gwp_usd_m, `${label}.profile.gwp_usd_m`, 0);
      c.str(pr.rating, `${label}.profile.rating`, 10);
      if (c.array(pr.lines, `${label}.profile.lines`, 1)) {
        pr.lines.forEach((l, j) => { if (!LINES.includes(l)) c.fail(`${label}.profile.lines[${j}]`, `${LINES.join(' / ')} 중 하나여야 해요`, l); });
      }
      if (c.object(pr.contact, `${label}.profile.contact`)) {
        for (const k of ['name', 'title', 'style']) c.str(pr.contact[k], `${label}.profile.contact.${k}`, 60);
      }
      if (c.array(e.treaties, `${label}.treaties`)) e.treaties.forEach((id, j) => c.str(id, `${label}.treaties[${j}]`, 80));
      if (c.object(e.requirements, `${label}.requirements`)) {
        const r = e.requirements;
        c.str(r.min_rating, `${label}.requirements.min_rating`, 10);
        c.num(r.max_single_share, `${label}.requirements.max_single_share`, 0, 1);
        c.str(r.preferred_terms, `${label}.requirements.preferred_terms`, 40);
        if (typeof r.shariah_required !== 'boolean') c.fail(`${label}.requirements.shariah_required`, 'true 또는 false여야 해요', r.shariah_required);
        if (r.shariah_conventional_cap !== null) c.num(r.shariah_conventional_cap, `${label}.requirements.shariah_conventional_cap`, 0, 1);
      }
      // 제출 결과 이유 한 줄: 좋은 이유(수락·매우 만족)와 나쁜 이유(재협상·거부)를 이유 종류마다 하나씩.
      if (c.object(e.verdict_reasons, `${label}.verdict_reasons`)) {
        for (const [side, keys] of [['good', REASONS_GOOD], ['bad', REASONS_BAD]]) {
          const path = `${label}.verdict_reasons.${side}`;
          if (!c.object(e.verdict_reasons[side], path)) continue;
          for (const k of keys) {
            if (c.str(e.verdict_reasons[side][k], `${path}.${k}`, 200)) validateText(c, e.verdict_reasons[side][k], `${path}.${k}`);
          }
        }
      }
    },
  }, terms);
}

export function validateReinsurers(list, file = 'reinsurers.json', terms = true) {
  return validateEntityList(list, file, {
    idPrefix: 're_',
    kinds: REINSURER_KINDS,
    extra(c, e, label, tm) {
      checkIntro(c, e.intro_ko, `${label}.intro_ko`, tm);
      c.str(e.rating, `${label}.rating`, 10);
      if (typeof e.onshore !== 'boolean') c.fail(`${label}.onshore`, 'true 또는 false여야 해요', e.onshore);
      if (typeof e.shariah_ok !== 'boolean') c.fail(`${label}.shariah_ok`, 'true 또는 false여야 해요', e.shariah_ok);
      c.num(e.target_lr, `${label}.target_lr`, 0, 200);
      lineMap(c, e.capacity_usd_m, `${label}.capacity_usd_m`, 0);
      lineMap(c, e.appetite, `${label}.appetite`, 0, 1);
      if (c.object(e.contact, `${label}.contact`)) {
        for (const k of ['name', 'title']) c.str(e.contact[k], `${label}.contact.${k}`, 60);
      }
      if (c.object(e.behavior, `${label}.behavior`)) {
        c.int(e.behavior.response_weeks, `${label}.behavior.response_weeks`, 0, 20);
        c.int(e.behavior.patience, `${label}.behavior.patience`, 0, 20);
        c.num(e.behavior.max_single_share, `${label}.behavior.max_single_share`, 0, 1);
      }
      // 제안 응답 한두 줄: 수락·반제·거절마다 하나씩.
      if (c.object(e.response_lines, `${label}.response_lines`)) {
        for (const k of ['accept', 'counter', 'reject']) {
          if (c.str(e.response_lines[k], `${label}.response_lines.${k}`, 200)) validateText(c, e.response_lines[k], `${label}.response_lines.${k}`);
        }
      }
    },
  }, terms);
}

// ---------- 용어집 (design.md §5, §10.6) ----------

export const GLOSSARY_HINT_LEN = { level1: 60, level2: 120 }; // 넘으면 경고(막지는 않는다)

function validateGlossaryText(c, text, path, ids) {
  if (/[{}]/.test(text)) c.fail(path, '용어집 글에는 { } 치환 변수를 쓸 수 없어요', text);
  checkMarkup(c, text, path, ids);
}

export function validateGlossary(list, file = 'glossary.json') {
  const errors = [];
  const c = checker(file, errors);
  if (!c.array(list, '(최상위)', 1)) return errors;
  const ids = new Set(list.filter((t) => isObj(t) && typeof t.id === 'string').map((t) => t.id));
  const seen = new Set();
  list.forEach((t, i) => {
    const p = `[${i}]`;
    if (!c.object(t, p)) return;
    const label = typeof t.id === 'string' ? `${p}(${t.id})` : p;
    if (c.str(t.id, `${label}.id`, 80)) {
      if (!/^gl_[a-z0-9_]+$/.test(t.id)) c.fail(`${label}.id`, 'gl_ 로 시작하는 snake_case여야 해요', t.id);
      if (seen.has(t.id)) c.fail(`${label}.id`, '다른 용어와 id가 겹쳐요', t.id);
      seen.add(t.id);
    }
    c.str(t.term_ko, `${label}.term_ko`, 40);
    const isGame = t.category === 'game';
    if (!isGame || t.term_en !== undefined) c.str(t.term_en, `${label}.term_en`, 60); // 게임 규칙 용어는 영어 이름이 없을 수 있다
    if (t.gloss_ko !== undefined) c.str(t.gloss_ko, `${label}.gloss_ko`, 20);
    if (c.array(t.aliases, `${label}.aliases`)) t.aliases.forEach((a, j) => c.str(a, `${label}.aliases[${j}]`, 40));
    if (!CATEGORIES.includes(t.category)) c.fail(`${label}.category`, `${CATEGORIES.join(' / ')} 중 하나여야 해요`, t.category);
    if (c.str(t.level1_ko, `${label}.level1_ko`, 200)) validateGlossaryText(c, t.level1_ko, `${label}.level1_ko`, ids);
    if (c.str(t.level2_ko, `${label}.level2_ko`, 400)) validateGlossaryText(c, t.level2_ko, `${label}.level2_ko`, ids);
    if (c.object(t.level3, `${label}.level3`)) {
      const l3 = t.level3;
      if (c.str(l3.industry_ko, `${label}.level3.industry_ko`, 800)) validateGlossaryText(c, l3.industry_ko, `${label}.level3.industry_ko`, ids);
      if (c.array(l3.industry_en, `${label}.level3.industry_en`, isGame ? 0 : 1)) l3.industry_en.forEach((e, j) => c.str(e, `${label}.level3.industry_en[${j}]`, 200));
      if (c.str(l3.game_example_ko, `${label}.level3.game_example_ko`, 500)) validateGlossaryText(c, l3.game_example_ko, `${label}.level3.game_example_ko`, ids);
    }
    if (c.array(t.related, `${label}.related`)) {
      t.related.forEach((r, j) => {
        if (!c.str(r, `${label}.related[${j}]`, 80)) return;
        if (r === t.id) c.fail(`${label}.related[${j}]`, '자기 자신은 넣을 수 없어요', r);
        else if (!ids.has(r)) c.fail(`${label}.related[${j}]`, 'glossary.json에 없는 용어 id예요', r);
      });
    }
    if (c.array(t.appears_in, `${label}.appears_in`, 1)) {
      t.appears_in.forEach((a, j) => { if (!APPEARS_IN.includes(a)) c.fail(`${label}.appears_in[${j}]`, `${APPEARS_IN.join(' / ')} 중 하나여야 해요`, a); });
    }
  });
  return errors;
}

// 막지는 않지만 콘텐츠 점검에 쓰는 경고: 글이 길거나, 어디에서도 쓰이지 않는 용어.
export function glossaryWarnings(raw) {
  const warnings = [];
  const list = Array.isArray(raw.glossary) ? raw.glossary.filter(isObj) : [];
  for (const t of list) {
    if (typeof t.level1_ko === 'string' && t.level1_ko.length > GLOSSARY_HINT_LEN.level1) warnings.push(`glossary.json › ${t.id}.level1_ko — ${GLOSSARY_HINT_LEN.level1}자를 넘어요 (${t.level1_ko.length}자)`);
    if (typeof t.level2_ko === 'string' && t.level2_ko.length > GLOSSARY_HINT_LEN.level2) warnings.push(`glossary.json › ${t.id}.level2_ko — ${GLOSSARY_HINT_LEN.level2}자를 넘어요 (${t.level2_ko.length}자)`);
  }
  const used = new Set(UI_TERM_IDS);
  const walk = (v) => {
    if (typeof v === 'string') { if (v.includes('[[')) for (const id of termIdsIn(v)) used.add(id); }
    else if (Array.isArray(v)) v.forEach(walk);
    else if (isObj(v)) Object.values(v).forEach(walk);
  };
  walk(raw.mails); walk(raw.clients); walk(raw.reinsurers); walk(raw.report);
  for (const t of list) if (!used.has(t.id)) warnings.push(`glossary.json › ${t.id} — 어디에서도 쓰이지 않는 용어예요`);
  return warnings;
}

// ---------- 트리티 (design.md §10.3) ----------

export const STRUCTURES = ['xol', 'qs'];

// 고객·재보험사·시즌과의 연결은 validateCross가 본다. 여기서는 트리티 자체의 모양만 본다.
export function validateTreaties(list, file = 'treaties.json') {
  const errors = [];
  const c = checker(file, errors);
  if (!c.array(list, '(최상위)', 1)) return errors;
  const seen = new Set();
  list.forEach((t, i) => {
    const p = `[${i}]`;
    if (!c.object(t, p)) return;
    const label = typeof t.id === 'string' ? `${p}(${t.id})` : p;
    if (c.str(t.id, `${label}.id`, 80)) {
      if (!/^trt_[a-z0-9_]+$/.test(t.id)) c.fail(`${label}.id`, 'trt_ 로 시작하는 snake_case여야 해요', t.id);
      if (seen.has(t.id)) c.fail(`${label}.id`, '다른 트리티와 id가 겹쳐요', t.id);
      seen.add(t.id);
    }
    c.str(t.client, `${label}.client`, 80);
    c.str(t.name_ko, `${label}.name_ko`, 80);
    if (!LINES.includes(t.line)) c.fail(`${label}.line`, `${LINES.join(' / ')} 중 하나여야 해요`, t.line);
    if (!STRUCTURES.includes(t.structure)) c.fail(`${label}.structure`, `${STRUCTURES.join(' / ')} 중 하나여야 해요`, t.structure);
    c.str(t.season, `${label}.season`, 40);
    c.num(t.limit_usd_m, `${label}.limit_usd_m`, 0.001); // 지분 상한을 한도로 나누므로 0이면 안 된다
    c.num(t.attachment_usd_m, `${label}.attachment_usd_m`, 0);
    c.num(t.brokerage_rate, `${label}.brokerage_rate`, 0, 1);
    c.num(t.target_rc, `${label}.target_rc`, -100, 100);
    if (c.array(t.loss_ratio_hist, `${label}.loss_ratio_hist`, 3)) {
      if (t.loss_ratio_hist.length !== 3) c.fail(`${label}.loss_ratio_hist`, '3개(y-2, y-1, y0)여야 해요', t.loss_ratio_hist);
      t.loss_ratio_hist.forEach((v, j) => c.num(v, `${label}.loss_ratio_hist[${j}]`, 0, 300));
    }
    if (c.object(t.expiring, `${label}.expiring`)) {
      c.num(t.expiring.premium_usd_m, `${label}.expiring.premium_usd_m`, 0);
      if (c.array(t.expiring.panel, `${label}.expiring.panel`, 1)) {
        const reIds = new Set();
        let sum = 0;
        t.expiring.panel.forEach((m, j) => {
          const mp = `${label}.expiring.panel[${j}]`;
          if (!c.object(m, mp)) return;
          if (c.str(m.re, `${mp}.re`, 80)) {
            if (reIds.has(m.re)) c.fail(`${mp}.re`, '같은 재보험사가 두 번 들어 있어요', m.re);
            reIds.add(m.re);
          }
          if (c.num(m.share, `${mp}.share`, 0, 1)) sum += m.share;
        });
        if (Math.abs(sum - 1) > 1e-6) c.fail(`${label}.expiring.panel`, `지분 합이 1.0이어야 해요(지금 ${Math.round(sum * 1000) / 1000})`);
      }
    }
    if (c.array(t.structure_options, `${label}.structure_options`)) {
      const optIds = new Set();
      t.structure_options.forEach((o, j) => {
        const op = `${label}.structure_options[${j}]`;
        if (!c.object(o, op)) return;
        if (c.str(o.id, `${op}.id`, 40)) {
          if (!ID_RE.test(o.id)) c.fail(`${op}.id`, 'snake_case 영문이어야 해요', o.id);
          if (optIds.has(o.id)) c.fail(`${op}.id`, '같은 트리티의 다른 옵션과 겹쳐요', o.id);
          optIds.add(o.id);
        }
        c.str(o.label_ko, `${op}.label_ko`, 80);
        c.num(o.f_adj, `${op}.f_adj`, -100, 100);
        c.num(o.client_cons_penalty, `${op}.client_cons_penalty`, 0, 100);
      });
    }
    if (c.object(t.terms, `${label}.terms`)) c.str(t.terms.preferred, `${label}.terms.preferred`, 20);
  });
  return errors;
}

// 트리티가 다른 파일과 맞물리는 약속: 고객·재보험사·시즌 id, 라인, 단일 한도, 고객 쪽 목록과의 일치.
function validateTreatyLinks({ treaties, clients, reinsurers, calendar }) {
  const errors = [];
  const c = checker('treaties.json', errors);
  const clientById = new Map(clients.map((x) => [x.id, x]));
  const reById = new Map(reinsurers.map((x) => [x.id, x]));
  const seasons = new Set(calendar.seasons.map((s) => s.id));
  treaties.forEach((t, i) => {
    const label = `[${i}](${t.id})`;
    const client = clientById.get(t.client);
    if (!client) c.fail(`${label}.client`, 'clients.json에 없는 고객 id예요', t.client);
    else {
      if (!client.profile.lines.includes(t.line)) c.fail(`${label}.line`, `고객(${client.id})의 라인에 없어요`, t.line);
      if (!client.treaties.includes(t.id)) c.fail(`${label}.id`, `고객(${client.id})의 treaties 목록에 이 트리티가 없어요`, t.id);
    }
    if (!seasons.has(t.season)) c.fail(`${label}.season`, 'calendar.json에 없는 시즌 id예요', t.season);
    for (const [j, m] of t.expiring.panel.entries()) {
      const re = reById.get(m.re);
      if (!re) { c.fail(`${label}.expiring.panel[${j}].re`, 'reinsurers.json에 없는 재보험사 id예요', m.re); continue; }
      const cap = Math.min(re.behavior.max_single_share, client ? client.requirements.max_single_share : 1);
      if (m.share > cap + 1e-9) c.fail(`${label}.expiring.panel[${j}].share`, `단일 한도(${cap})를 넘어요`, m.share);
    }
  });
  // 반대 방향: 고객이 말하는 트리티가 실제로 있어야 한다.
  const treatyIds = new Set(treaties.map((t) => t.id));
  const owner = new Map(treaties.map((t) => [t.id, t.client]));
  for (const cl of clients) {
    cl.treaties.forEach((id, j) => {
      if (!treatyIds.has(id)) c.fail(`clients.json › ${cl.id}.treaties[${j}]`, 'treaties.json에 없는 트리티 id예요', id);
      else if (owner.get(id) !== cl.id) c.fail(`clients.json › ${cl.id}.treaties[${j}]`, '다른 고객의 트리티예요', id);
    });
  }
  return errors;
}

// ---------- 이벤트 (design.md §8, §10.4) ----------

export const EVENT_CATEGORIES = ['loss', 'regulatory', 'market', 'competition', 'sea'];
const CONDITION_FIELDS = {
  turn_between: ['from', 'to'], quarter_is: ['quarter'], market_gte: ['value'], market_lte: ['value'],
  flag_set: ['flag'], flag_absent: ['flag'], relationship_lt: ['target', 'value'], relationship_gte: ['target', 'value'],
  compliance_gte: ['value'], compliance_lt: ['value'],
};

function validateCondition(c, cond, path, quarterIds, turns) {
  if (!c.object(cond, path)) return;
  const fields = CONDITION_FIELDS[cond.type];
  if (!fields) { c.fail(`${path}.type`, `조건 종류는 ${Object.keys(CONDITION_FIELDS).join(' / ')} 중 하나여야 해요`, cond.type); return; }
  if (cond.type === 'turn_between') {
    const a = c.int(cond.from, `${path}.from`, 1, turns);
    const b = c.int(cond.to, `${path}.to`, 1, turns);
    if (a && b && cond.from > cond.to) c.fail(`${path}.from`, 'to보다 클 수 없어요', cond.from);
  } else if (cond.type === 'quarter_is') {
    if (c.str(cond.quarter, `${path}.quarter`, 40) && quarterIds && !quarterIds.has(cond.quarter)) c.fail(`${path}.quarter`, 'calendar.json에 없는 분기 id예요', cond.quarter);
  } else if (cond.type === 'compliance_gte' || cond.type === 'compliance_lt') {
    c.num(cond.value, `${path}.value`, 0, 100);
  } else if (cond.type === 'market_gte' || cond.type === 'market_lte') {
    c.num(cond.value, `${path}.value`, 0, 100);
  } else if (cond.type === 'flag_set' || cond.type === 'flag_absent') {
    if (c.str(cond.flag, `${path}.flag`, 60) && !ID_RE.test(cond.flag)) c.fail(`${path}.flag`, 'snake_case 영문이어야 해요', cond.flag);
  } else {
    if (c.str(cond.target, `${path}.target`, 80) && !ENTITY_TARGET_RE.test(cond.target)) c.fail(`${path}.target`, 'client:<id> 또는 reinsurer:<id>여야 해요', cond.target);
    c.num(cond.value, `${path}.value`, 0, 100);
  }
}

export function validateEvents(list, file = 'events.json', raw = {}) {
  const errors = [];
  const c = checker(file, errors);
  if (!c.array(list, '(최상위)', 1)) return errors;
  const turns = raw.calendar?.turns ?? Infinity;
  const quarterIds = Array.isArray(raw.calendar?.quarters) ? new Set(raw.calendar.quarters.map((q) => q.id)) : null;
  const mailIds = new Set(Array.isArray(raw.mails) ? raw.mails.filter(isObj).map((m) => m.id) : []);
  const seen = new Set();
  list.forEach((e, i) => {
    const p = `[${i}]`;
    if (!c.object(e, p)) return;
    const label = typeof e.id === 'string' ? `${p}(${e.id})` : p;
    if (c.str(e.id, `${label}.id`, 80)) {
      if (!/^evt_[a-z0-9_]+$/.test(e.id)) c.fail(`${label}.id`, 'evt_ 로 시작하는 snake_case여야 해요', e.id);
      if (seen.has(e.id)) c.fail(`${label}.id`, '다른 이벤트와 id가 겹쳐요', e.id);
      seen.add(e.id);
    }
    if (!EVENT_CATEGORIES.includes(e.category)) c.fail(`${label}.category`, `${EVENT_CATEGORIES.join(' / ')} 중 하나여야 해요`, e.category);
    if (c.object(e.trigger, `${label}.trigger`)) {
      const t = e.trigger;
      if (t.window !== undefined && c.object(t.window, `${label}.trigger.window`)) {
        const a = c.int(t.window.from_turn, `${label}.trigger.window.from_turn`, 2, turns); // 턴 1은 게임 시작이라 Continue로 닿지 않는다
        const b = c.int(t.window.to_turn, `${label}.trigger.window.to_turn`, 2, turns);
        if (a && b && t.window.from_turn > t.window.to_turn) c.fail(`${label}.trigger.window.from_turn`, 'to_turn보다 클 수 없어요', t.window.from_turn);
      }
      if (t.pick_client !== undefined) {
        // 고객 고르기(design.md §8.3 ④): 고정 확률(prob) 대신 고객마다 계산한다.
        if (t.window === undefined) c.fail(`${label}.trigger.pick_client`, '창구(window)가 있는 이벤트에만 쓸 수 있어요');
        if (c.object(t.pick_client, `${label}.trigger.pick_client`)) {
          c.num(t.pick_client.base, `${label}.trigger.pick_client.base`, 0, 1);
          c.num(t.pick_client.relationship_ref, `${label}.trigger.pick_client.relationship_ref`, 0, 100);
        }
        if (t.prob !== undefined) c.fail(`${label}.trigger.prob`, 'pick_client가 있으면 prob을 쓰지 않아요', t.prob);
      } else {
        c.num(t.prob, `${label}.trigger.prob`, 0, 1);
      }
      if (t.once !== undefined && typeof t.once !== 'boolean') c.fail(`${label}.trigger.once`, 'true 또는 false여야 해요', t.once);
      if (t.conditions !== undefined && c.array(t.conditions, `${label}.trigger.conditions`)) {
        t.conditions.forEach((cond, j) => validateCondition(c, cond, `${label}.trigger.conditions[${j}]`, quarterIds, turns));
      }
    }
    validateEffects(c, e.effects_on_fire, `${label}.effects_on_fire`, mailIds);
    if (e.mail !== undefined) c.str(e.mail, `${label}.mail`, 80); // 존재 여부는 validateCross가 본다
    if (e.mails_by_client !== undefined) {
      if (c.object(e.mails_by_client, `${label}.mails_by_client`)) for (const [cid, mid] of Object.entries(e.mails_by_client)) c.str(mid, `${label}.mails_by_client.${cid}`, 80);
    }
    if (e.trigger?.pick_client !== undefined && !isObj(e.mails_by_client)) c.fail(`${label}.mails_by_client`, 'pick_client가 있으면 고객별 메일이 필요해요');
    if (e.outcomes !== undefined && c.array(e.outcomes, `${label}.outcomes`, 1)) {
      e.outcomes.forEach((o, j) => {
        const op = `${label}.outcomes[${j}]`;
        if (!c.object(o, op)) return;
        if (c.array(o.conditions ?? [], `${op}.conditions`)) (o.conditions ?? []).forEach((cond, k) => validateCondition(c, cond, `${op}.conditions[${k}]`, quarterIds, turns));
        validateEffects(c, o.effects, `${op}.effects`, mailIds);
        c.str(o.mail, `${op}.mail`, 80);
        const last = j === e.outcomes.length - 1;
        if (last && (o.conditions ?? []).length > 0) c.fail(`${op}.conditions`, '마지막 결과는 조건이 없어야 해요(어느 것도 안 맞는 경우를 덮어요)');
        if (!last && (o.conditions ?? []).length === 0) c.fail(`${op}.conditions`, '마지막이 아닌 결과에는 조건이 있어야 해요');
      });
    }
    if (e.mail === undefined && e.mails_by_client === undefined && e.outcomes === undefined) c.fail(`${label}.mail`, 'mail · mails_by_client · outcomes 중 하나는 있어야 해요');
    if (e.followups !== undefined && c.array(e.followups, `${label}.followups`)) {
      e.followups.forEach((f, j) => {
        const fp = `${label}.followups[${j}]`;
        if (!c.object(f, fp)) return;
        c.str(f.event, `${fp}.event`, 80);
        c.int(f.delay_weeks, `${fp}.delay_weeks`, 0, 60);
        if (f.prob !== undefined) c.num(f.prob, `${fp}.prob`, 0, 1);
      });
    }
  });
  return errors;
}

// 이벤트·메일 효과가 가리키는 id가 실제로 있는지, 이벤트 메일이 존재하고 고정 도착 메일이 아닌지.
function validateEventLinks({ config, events, mails, clients, reinsurers, treaties }) {
  const errors = [];
  const c = checker('events.json', errors);
  const mailById = new Map(mails.map((m) => [m.id, m]));
  const eventIds = new Set(events.map((e) => e.id));
  const clientIds = new Set((clients ?? []).map((x) => x.id));
  const reinsurerIds = new Set((reinsurers ?? []).map((x) => x.id));

  const checkTarget = (target, path) => {
    const m = typeof target === 'string' ? ENTITY_TARGET_RE.exec(target) : null;
    if (!m) return;
    const known = m[1] === 'client' ? clientIds : reinsurerIds;
    if (clients && reinsurers && !known.has(m[2])) c.fail(path, `${m[1] === 'client' ? 'clients' : 'reinsurers'}.json에 없는 id예요`, target);
  };
  const treatyIds = new Set((treaties ?? []).map((x) => x.id));
  const checkEffects = (effects, path) => {
    (effects ?? []).forEach((ef, i) => {
      if (!isObj(ef)) return;
      checkTarget(ef.target, `${path}[${i}].target`);
      const tm = typeof ef.target === 'string' ? TREATY_TARGET_RE.exec(ef.target) : null;
      if (tm && treaties && !treatyIds.has(tm[1])) c.fail(`${path}[${i}].target`, 'treaties.json에 없는 트리티 id예요', ef.target);
      if (tm && ef.field === 'structure_option' && ef.value !== '' && treaties) {
        const opts = treaties.find((x) => x.id === tm[1])?.structure_options ?? [];
        if (!opts.some((o) => o.id === ef.value)) c.fail(`${path}[${i}].value`, '그 트리티에 없는 구조 옵션 id예요', ef.value);
      }
      if (ef.op === 'event_schedule' && !eventIds.has(ef.event)) c.fail(`${path}[${i}].event`, 'events.json에 없는 이벤트 id예요', ef.event);
    });
  };

  mails.forEach((m) => (m.choices ?? []).forEach((ch, j) => checkEffects(ch.effects, `mails.json › ${m.id}.choices[${j}].effects`)));
  events.forEach((e) => {
    const label = `${e.id}`;
    const checkMail = (id, path) => {
      const mail = mailById.get(id);
      if (!mail) c.fail(path, 'mails.json에 없는 메일 id예요', id);
      else if (mail.schedule !== undefined) c.fail(path, '이벤트 메일은 고정 턴(schedule)에 도착하면 안 돼요(이벤트가 보내요)', id);
    };
    if (e.mail !== undefined) checkMail(e.mail, `${label}.mail`);
    for (const [cid, mid] of Object.entries(e.mails_by_client ?? {})) {
      if (clients && !clientIds.has(cid)) c.fail(`${label}.mails_by_client.${cid}`, 'clients.json에 없는 고객 id예요', cid);
      checkMail(mid, `${label}.mails_by_client.${cid}`);
    }
    (e.outcomes ?? []).forEach((o, j) => { checkMail(o.mail, `${label}.outcomes[${j}].mail`); checkEffects(o.effects, `${label}.outcomes[${j}].effects`); });
    checkEffects(e.effects_on_fire, `${label}.effects_on_fire`);
    (e.trigger.conditions ?? []).forEach((cond, j) => checkTarget(cond.target, `${label}.trigger.conditions[${j}].target`));
    (e.followups ?? []).forEach((f, j) => { if (!eventIds.has(f.event)) c.fail(`${label}.followups[${j}].event`, 'events.json에 없는 이벤트 id예요', f.event); });
  });
  const gapMail = mailById.get(config.season?.gap?.mail);
  if (!gapMail) c.fail('config.json › season.gap.mail', 'mails.json에 없는 메일 id예요', config.season?.gap?.mail);
  else if (gapMail.schedule !== undefined) c.fail('config.json › season.gap.mail', '공백 알림 메일은 고정 턴(schedule)에 도착하면 안 돼요', gapMail.id);
  for (const band of MARKET_BANDS) {
    const id = config.market.family.mails[band];
    const mail = mailById.get(id);
    if (!mail) c.fail(`config.json › market.family.mails.${band}`, 'mails.json에 없는 메일 id예요', id);
    else if (mail.schedule !== undefined) c.fail(`config.json › market.family.mails.${band}`, '분위기 전환 메일은 고정 턴(schedule)에 도착하면 안 돼요', id);
  }
  return errors;
}

// ---------- 라이벌 브로커 (design.md §9.3, §10.7) ----------

export function validateBrokers(list, file = 'brokers.json') {
  const errors = [];
  const c = checker(file, errors);
  if (!c.array(list, '(최상위)', 1)) return errors;
  const seen = new Set();
  list.forEach((b, i) => {
    const p = `[${i}]`;
    if (!c.object(b, p)) return;
    const label = typeof b.id === 'string' ? `${p}(${b.id})` : p;
    if (c.str(b.id, `${label}.id`, 80)) {
      if (!/^brk_[a-z0-9_]+$/.test(b.id)) c.fail(`${label}.id`, 'brk_ 로 시작하는 snake_case여야 해요', b.id);
      if (seen.has(b.id)) c.fail(`${label}.id`, '다른 라이벌과 id가 겹쳐요', b.id);
      seen.add(b.id);
    }
    c.str(b.name, `${label}.name`, 60);
    c.str(b.name_ko, `${label}.name_ko`, 40);
    c.str(b.tag_ko, `${label}.tag_ko`, 40);
    c.num(b.base_income_usd_m, `${label}.base_income_usd_m`, 0.1, 100);
    c.num(b.volatility, `${label}.volatility`, 0, 1);
    c.num(b.market_beta, `${label}.market_beta`, 0, 3);
    c.num(b.commission_rate, `${label}.commission_rate`, 0.01, 1); // 플레이스드 프리미엄을 수익/수수료율로 어림하므로 0이면 안 된다
    c.int(b.clients, `${label}.clients`, 0, 999);
    c.num(b.reputation, `${label}.reputation`, 0, 100);
  });
  return errors;
}

// ---------- 성적표 문구 (design.md §10.7 report.json) ----------

export function validateReport(rep, file = 'report.json', terms = true) {
  const errors = [];
  const c = checker(file, errors);
  if (!c.object(rep, '(최상위)')) return errors;
  const text = (v, path, max) => { if (c.str(v, path, max)) validateText(c, v, path, terms); };
  if (c.object(rep.components, 'components')) {
    for (const id of PART_IDS) {
      const p = `components.${id}`;
      if (!c.object(rep.components[id], p)) continue;
      const comp = rep.components[id];
      c.str(comp.label_ko, `${p}.label_ko`, 20);
      c.str(comp.short_ko, `${p}.short_ko`, 20);
      for (const k of ['good_ko', 'mid_ko', 'weak_ko']) text(comp[k], `${p}.${k}`, 300);
      text(comp.tip_ko, `${p}.tip_ko`, 500);
    }
  }
  if (c.object(rep.grades, 'grades')) {
    for (const g of GRADE_LETTERS) {
      const p = `grades.${g}`;
      if (!c.object(rep.grades[g], p)) continue;
      text(rep.grades[g].title_ko, `${p}.title_ko`, 60);
      if (c.array(rep.grades[g].summary_ko, `${p}.summary_ko`, 1)) rep.grades[g].summary_ko.forEach((line, i) => text(line, `${p}.summary_ko[${i}]`, 400));
    }
  }
  if (c.object(rep.fired, 'fired')) {
    text(rep.fired.title_ko, 'fired.title_ko', 60);
    if (c.array(rep.fired.summary_ko, 'fired.summary_ko', 1)) rep.fired.summary_ko.forEach((line, i) => text(line, `fired.summary_ko[${i}]`, 400));
  }
  text(rep.keep_going_ko, 'keep_going_ko', 300);
  text(rep.preview_note_ko, 'preview_note_ko', 300);
  return errors;
}

// 파일 사이의 약속(서로 다른 파일이 같은 값을 말해야 하는 것).
export function validateCross({ config, calendar, clients, reinsurers, treaties, events, mails }) {
  const errors = [];
  const c = checker('config.json', errors);
  if (config.game.total_turns !== calendar.turns) {
    c.fail('game.total_turns', `calendar.json의 turns(${calendar.turns})와 같아야 해요`, config.game.total_turns);
  }
  if (config.game.start_turn > calendar.turns) {
    c.fail('game.start_turn', `calendar.json의 turns(${calendar.turns}) 이하여야 해요`, config.game.start_turn);
  }
  if (treaties && clients && reinsurers) errors.push(...validateTreatyLinks({ treaties, clients, reinsurers, calendar }));
  if (events && mails && config.market?.family) errors.push(...validateEventLinks({ config, events, mails, clients, reinsurers, treaties }));
  errors.push(...validateBoardLinks({ config, calendar, mails }));
  return errors;
}

// 이사회 메일 id가 mails.json에 있고 고정 도착이 아닌지, 라이벌 분기가 calendar에 있는지(M7a).
function validateBoardLinks({ config, calendar, mails }) {
  const errors = [];
  const c = checker('config.json', errors);
  const b = config.board;
  if (isObj(b) && isObj(b.mails) && Array.isArray(mails)) {
    const mailById = new Map(mails.map((m) => [m.id, m]));
    const check = (id, path) => {
      if (typeof id !== 'string') return;
      const mail = mailById.get(id);
      if (!mail) c.fail(`board.mails.${path}`, 'mails.json에 없는 메일 id예요', id);
      else if (mail.schedule !== undefined) c.fail(`board.mails.${path}`, '이사회 메일은 고정 턴(schedule)에 도착하면 안 돼요', id);
    };
    for (const [k, id] of Object.entries(b.mails.rank ?? {})) check(id, `rank.${k}`);
    for (const [k, id] of Object.entries(b.mails.grade ?? {})) check(id, `grade.${k}`);
    for (const k of ['fired', 'cash_warning', 'cash_penalty']) check(b.mails[k], k);
  }
  if (isObj(config.rivals) && Array.isArray(config.rivals.quarters) && Array.isArray(calendar?.quarters)) {
    const ids = new Set(calendar.quarters.map((q) => q.id));
    config.rivals.quarters.forEach((q, i) => { if (!ids.has(q)) c.fail(`rivals.quarters[${i}]`, 'calendar.json에 없는 분기 id예요', q); });
  }
  return errors;
}

// 용어집이 로드되지 않았다면 id 존재 검사는 건너뛴다(용어집 쪽 오류가 이미 안내된다).
const termSet = (raw) => (Array.isArray(raw.glossary) ? new Set(raw.glossary.filter(isObj).map((t) => t.id)) : true);

export const DATA_FILES = [
  { key: 'config', file: 'config.json', validate: validateConfig },
  { key: 'calendar', file: 'calendar.json', validate: validateCalendar },
  { key: 'glossary', file: 'glossary.json', validate: validateGlossary },
  { key: 'mails', file: 'mails.json', validate: (mails, file, raw) => validateMails(mails, file, raw.calendar, termSet(raw)) },
  { key: 'clients', file: 'clients.json', validate: (list, file, raw) => validateClients(list, file, termSet(raw)) },
  { key: 'reinsurers', file: 'reinsurers.json', validate: (list, file, raw) => validateReinsurers(list, file, termSet(raw)) },
  { key: 'treaties', file: 'treaties.json', validate: validateTreaties },
  { key: 'events', file: 'events.json', validate: validateEvents },
  { key: 'brokers', file: 'brokers.json', validate: validateBrokers },
  { key: 'report', file: 'report.json', validate: (rep, file, raw) => validateReport(rep, file, termSet(raw)) },
];

// 정적 콘텐츠를 실수로 고치는 코드를 바로 잡아내려고 통째로 얼린다.
function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

export async function loadData({ baseUrl = new URL('../data/', import.meta.url), fetchFn = (...args) => fetch(...args) } = {}) {
  const raw = {};
  const fetchErrors = {};

  await Promise.all(DATA_FILES.map(async ({ key, file }) => {
    try {
      const res = await fetchFn(new URL(file, baseUrl), { cache: 'no-cache' });
      if (!res.ok) {
        fetchErrors[key] = { file, path: '', message: `${file} — 파일을 불러오지 못했어요 (HTTP ${res.status})` };
        return;
      }
      raw[key] = await res.json();
    } catch (e) {
      const message = e instanceof SyntaxError
        ? `${file} — JSON 문법이 틀렸어요 (쉼표·따옴표·괄호를 확인하세요): ${e.message}`
        : `${file} — 불러오지 못했어요: ${e.message}`;
      fetchErrors[key] = { file, path: '', message };
    }
  }));

  // 오류 순서가 매번 같도록 DATA_FILES 순서로 모은다.
  const errors = [];
  for (const { key, file, validate } of DATA_FILES) {
    if (fetchErrors[key]) errors.push(fetchErrors[key]);
    else errors.push(...validate(raw[key], file, raw));
  }
  if (errors.length === 0) errors.push(...validateCross(raw));

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, data: deepFreeze(raw), warnings: glossaryWarnings(raw) };
}
