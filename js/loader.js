// data/*.json 로드 + 검증. 하나라도 잘못되면 시작하지 않고, 어느 파일의 어느 항목인지 전부 알려 준다.
// 새 정적 파일(clients 등)은 마일스톤마다 DATA_FILES에 한 줄 + 검증 함수로 추가한다.

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
  }
  return errors;
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

export const MAIL_TYPES = ['client_request', 'reinsurer_response', 'event', 'regulatory', 'market_report', 'board', 'system'];
export const MAIL_FROM_KINDS = ['client', 'reinsurer', 'regulator', 'market', 'board', 'system'];
export const MAIL_PRIORITIES = ['urgent', 'normal', 'low'];
// M1에서 쓸 수 있는 치환 변수. {client.*} 등은 해당 데이터가 생기는 마일스톤에서 추가한다.
export const MAIL_VARS = ['market.label', 'turn.label', 'player.firm'];
// 효과 연산자: 닫힌 집합(§10.8). 아직 구현하지 않은 연산자는 별도로 안내한다.
export const EFFECT_OPS = ['add', 'set', 'mul', 'flag_set', 'flag_clear', 'mail_send', 'cash'];
const LATER_OPS = { event_schedule: 'M6', modifier_add: 'M6' };
// M1에서 효과가 닿을 수 있는 곳: player / market 의 수치 필드뿐.
export const EFFECT_FIELDS = {
  player: ['reputation', 'compliance', 'board_confidence', 'market_intel'],
  market: ['index'],
};
const ID_RE = /^[a-z][a-z0-9_]*$/;

function validateText(c, text, path) {
  if (typeof text !== 'string') return;
  if (text.includes('[[')) c.fail(path, '용어 마크업 [[…]]은 M2(용어집)부터 쓸 수 있어요', text);
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
    if (ef.op === 'add' || ef.op === 'set' || ef.op === 'mul') {
      if (ef.target !== 'player' && ef.target !== 'market') {
        c.fail(`${p}.target`, '지금은 player 또는 market만 쓸 수 있어요', ef.target);
      } else if (!EFFECT_FIELDS[ef.target].includes(ef.field)) {
        c.fail(`${p}.field`, `${ef.target}에서 쓸 수 있는 필드는 ${EFFECT_FIELDS[ef.target].join(' / ')}예요`, ef.field);
      }
      c.num(ef.value, `${p}.value`);
      if (ef.min !== undefined) c.num(ef.min, `${p}.min`);
      if (ef.max !== undefined) c.num(ef.max, `${p}.max`);
    } else if (ef.op === 'cash') {
      c.num(ef.value, `${p}.value`);
    } else if (ef.op === 'flag_set' || ef.op === 'flag_clear') {
      if (c.str(ef.flag, `${p}.flag`, 60) && !ID_RE.test(ef.flag)) c.fail(`${p}.flag`, 'snake_case 영문이어야 해요', ef.flag);
    } else if (ef.op === 'mail_send') {
      if (c.str(ef.mail, `${p}.mail`, 80) && !mailIds.has(ef.mail)) c.fail(`${p}.mail`, 'mails.json에 없는 메일 id예요', ef.mail);
      if (ef.delay_weeks !== undefined) c.int(ef.delay_weeks, `${p}.delay_weeks`, 0, 60);
    }
  });
}

export function validateMails(mails, file = 'mails.json', calendar = null) {
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
        if (c.str(line, `${label}.body_ko[${j}]`, 600)) validateText(c, line, `${label}.body_ko[${j}]`);
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
      if (c.str(ch.result_ko, `${cp}.result_ko`, 400)) validateText(c, ch.result_ko, `${cp}.result_ko`);
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

const checkIntro = (c, text, path) => { if (c.str(text, path, 400)) validateText(c, text, path); };

function validateEntityList(list, file, { idPrefix, kinds, extra }) {
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
    extra(c, e, label);
  });
  return errors;
}

const lineMap = (c, v, path, min, max) => {
  if (!c.object(v, path)) return;
  for (const line of LINES) c.num(v[line], `${path}.${line}`, min, max);
};

export function validateClients(list, file = 'clients.json') {
  return validateEntityList(list, file, {
    idPrefix: 'cli_',
    kinds: CLIENT_KINDS,
    extra(c, e, label) {
      if (!c.object(e.profile, `${label}.profile`)) return;
      const pr = e.profile;
      checkIntro(c, pr.intro_ko, `${label}.profile.intro_ko`);
      c.num(pr.gwp_usd_m, `${label}.profile.gwp_usd_m`, 0);
      c.str(pr.rating, `${label}.profile.rating`, 10);
      if (c.array(pr.lines, `${label}.profile.lines`, 1)) {
        pr.lines.forEach((l, j) => { if (!LINES.includes(l)) c.fail(`${label}.profile.lines[${j}]`, `${LINES.join(' / ')} 중 하나여야 해요`, l); });
      }
      if (c.object(pr.contact, `${label}.profile.contact`)) {
        for (const k of ['name', 'title', 'style']) c.str(pr.contact[k], `${label}.profile.contact.${k}`, 60);
      }
      if (c.object(e.requirements, `${label}.requirements`)) {
        const r = e.requirements;
        c.str(r.min_rating, `${label}.requirements.min_rating`, 10);
        c.num(r.max_single_share, `${label}.requirements.max_single_share`, 0, 1);
        c.str(r.preferred_terms, `${label}.requirements.preferred_terms`, 40);
        if (typeof r.shariah_required !== 'boolean') c.fail(`${label}.requirements.shariah_required`, 'true 또는 false여야 해요', r.shariah_required);
        if (r.shariah_conventional_cap !== null) c.num(r.shariah_conventional_cap, `${label}.requirements.shariah_conventional_cap`, 0, 1);
      }
    },
  });
}

export function validateReinsurers(list, file = 'reinsurers.json') {
  return validateEntityList(list, file, {
    idPrefix: 're_',
    kinds: REINSURER_KINDS,
    extra(c, e, label) {
      checkIntro(c, e.intro_ko, `${label}.intro_ko`);
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
    },
  });
}

// 파일 사이의 약속(서로 다른 파일이 같은 값을 말해야 하는 것).
export function validateCross({ config, calendar }) {
  const errors = [];
  const c = checker('config.json', errors);
  if (config.game.total_turns !== calendar.turns) {
    c.fail('game.total_turns', `calendar.json의 turns(${calendar.turns})와 같아야 해요`, config.game.total_turns);
  }
  if (config.game.start_turn > calendar.turns) {
    c.fail('game.start_turn', `calendar.json의 turns(${calendar.turns}) 이하여야 해요`, config.game.start_turn);
  }
  return errors;
}

export const DATA_FILES = [
  { key: 'config', file: 'config.json', validate: validateConfig },
  { key: 'calendar', file: 'calendar.json', validate: validateCalendar },
  { key: 'mails', file: 'mails.json', validate: (mails, file, raw) => validateMails(mails, file, raw.calendar) },
  { key: 'clients', file: 'clients.json', validate: validateClients },
  { key: 'reinsurers', file: 'reinsurers.json', validate: validateReinsurers },
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
  return { ok: true, data: deepFreeze(raw) };
}
