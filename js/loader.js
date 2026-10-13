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
  for (const { key, validate } of DATA_FILES) {
    if (fetchErrors[key]) errors.push(fetchErrors[key]);
    else errors.push(...validate(raw[key]));
  }
  if (errors.length === 0) errors.push(...validateCross(raw));

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, data: deepFreeze(raw) };
}
