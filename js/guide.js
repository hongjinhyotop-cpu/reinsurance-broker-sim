// 길잡이(design.md §2.6, §6.0.1, §6.3): 막혔을 때 돌아올 자리를 만드는 순수 함수들. DOM·저장소를 모른다.
// 정답을 알려 주지 않는다. 어느 화면의 어느 칸을 보면 되는지만 가리킨다.
// 읽는 값은 화면에 이미 보이는 상태(메일·행동 점수·미팅 횟수·제안 결과·남은 인내심·고객이 말한 이유)뿐이다.
// 상대의 속마음에 해당하는 값은 읽지도, 문구에 쓰지도 않는다(테스트가 이 파일에 그런 단어가 없는지 본다).

import { findTemplate, needsReply } from './mail.js';
import { submitBlockReason, actionBlockReason, counterWeeksLeft, isClosed, ratingShort, signedCheck } from './placement.js';
import { liveClient } from './live.js';

const action = (id, text, route = null) => ({ id, text, route });

// 열려 있는(아직 확정 안 된) 트리티 중 지금 시즌 창구 안에 있는 것
function treatiesInWindow(data, state) {
  return data.treaties.filter((t) => {
    if (isClosed(state.treaties[t.id] ?? { phase: 'open' })) return false;
    const s = seasonOf(data, t);
    return s && state.turn >= s.open_turn && state.turn <= s.inception_turn;
  });
}

function seasonOf(data, treaty) {
  return data.calendar.seasons.find((s) => s.id === treaty.season) ?? null;
}

function meetingsFor(data, state, treaty) {
  const clientMeetings = state.entities.clients[treaty.client]?.meetings ?? 0;
  const reinsurerMeetings = data.reinsurers
    .filter((r) => r.capacity_usd_m[treaty.line] > 0)
    .reduce((sum, r) => sum + (state.entities.reinsurers[r.id]?.meetings ?? 0), 0);
  return clientMeetings + reinsurerMeetings;
}

// ---------- 안내띠: 지금 할 일 한 줄 (§6.0.1) ----------

// 위에서부터 처음 맞는 것 하나. 띄울 것이 없으면(마지막 턴) null.
export function nextAction(data, state) {
  // 끝난 게임은 다른 어떤 할 일보다 먼저 성적표를 가리킨다(§6.0.1 0a·0b).
  if (state.ending?.kind === 'fired') return action('fired', '이사회에서 해고가 결정됐어요 — 시즌 리뷰에서 결과를 확인하세요. 새 게임은 그 화면 아래에서 시작할 수 있어요', 'review');
  if (state.ending) return action('year_end', '한 해가 끝났어요 — 시즌 리뷰에서 성적표를 확인하세요. 이사회 의장의 편지도 인박스에 있어요', 'review');
  if (state.turn >= data.calendar.turns) return null;
  const { ap } = state;
  const meetingAp = data.config.scouting.meeting_ap;
  const board = data.config.negotiation.board;

  const open = state.mails
    .map((mail) => ({ mail, template: findTemplate(data.mails, mail.template) }))
    .filter(({ mail, template }) => template && needsReply(mail, template));

  const required = open.find(({ template }) => template.blocking);
  if (required) {
    const due = required.mail.deadline_turn !== null && required.mail.deadline_turn <= state.turn;
    return action('required_mail', `인박스의 필수 메일에 답하기${due ? ' — 이번 주가 마감이에요' : ''}`, 'inbox');
  }

  const unread = state.mails.filter((m) => !m.read).length;
  if (unread > 0) return action('unread_mail', `인박스에서 새 메일 읽기 (${unread}통)`, 'inbox');

  const warn = data.config.turn.deadline_warning_weeks;
  if (open.some(({ mail }) => mail.deadline_turn !== null && mail.deadline_turn - state.turn <= warn)) {
    return action('deadline_mail', '인박스에서 마감이 가까운 메일에 답하기', 'inbox');
  }

  const treaty = treatiesInWindow(data, state)[0];
  if (treaty) {
    const ts = state.treaties[treaty.id];
    if ((ts.verdict === 'renegotiate' || ts.verdict === 'reject') && state.turn < ts.retry_turn) {
      return action('wait_retry', 'Continue로 다음 주로 넘어가기 — 고객이 생각할 시간이 필요해요');
    }
    const counterDue = ts.panel.some((row) => counterWeeksLeft(row, state.turn) === 1
      && actionBlockReason(data, state, 'accept_counter', treaty.id, row.re) === null);
    if (counterDue) return action('counter_due', '플레이스먼트에서 이번 주까지인 반제를 받을지 정하기', 'placement');
    if (submitBlockReason(data, state, treaty.id) === null) return action('submit', '플레이스먼트에서 패키지를 고객에게 제출하기', 'placement');
    if (ap < Math.min(board.ask_ap, board.propose_ap)) return action('out_of_ap', '행동 점수를 다 썼어요 — Continue로 다음 주로 넘어가기');
    // M6b: 사건이 규칙을 바꿨다면 그 사실을 알린다(공개 정보만 읽는다 — 등급·상한·패널).
    const short = ratingShort(data, state, treaty);
    if (short.length > 0) {
      return action('swap_panel', `플레이스먼트에서 등급이 낮아진 ${short.map((r) => r.name_ko).join('·')} 대신 다른 재보험사로 지분을 채우기 — 이 고객의 최소 등급에 못 미쳐요. 채울 곳이 모자라면 인박스 메일에서 다른 길을 찾아보세요`, 'placement');
    }
    if (signedCheck(data, state, treaty.id).blockers.includes('shariah_cap')) {
      return action('over_shariah_cap', '플레이스먼트에서 일반 재보험사 지분을 줄이거나 샤리아 재보험사로 옮기기 — 샤리아 상한을 넘었어요', 'placement');
    }
    if (ts.panel.length === 0 && ap >= meetingAp && meetingsFor(data, state, treaty) < data.config.guide.scout_min_meetings) {
      return action('scout', '고객·재보험사 DB에서 상대와 미팅하기', 'database');
    }
    const client = liveClient(state, data.clients.find((c) => c.id === treaty.client));
    const cap = client.requirements.shariah_required ? client.requirements.shariah_conventional_cap : null;
    const staticCap = data.clients.find((c) => c.id === treaty.client).requirements.shariah_conventional_cap;
    const capNote = cap !== null && cap < staticCap ? ` — 샤리아 상한이 줄어서 일반 재보험사 합은 ${Math.round(cap * 100)}% 이하여야 해요` : '';
    return action('fill', `플레이스먼트에서 지분을 채워 제출하기${capNote}`, 'placement');
  }

  const overdue = data.treaties.some((t) => {
    const s = seasonOf(data, t);
    return s && state.turn > s.inception_turn && state.treaties[t.id]?.phase === 'open';
  });
  if (overdue) return action('overdue', '시즌이 지났는데 확정되지 않은 트리티가 있어요 — 플레이스먼트에서 확인하기', 'placement');

  if (data.calendar.turns - state.turn <= data.config.guide.year_end_weeks) {
    return action('year_end_near', '연말이 가까워요 — 순위표에서 이사회 목표를 점검해 보세요', 'standings');
  }

  if (ap >= meetingAp) return action('between', '다음 시즌까지 시간이 있어요 — DB에서 미팅으로 상대를 알아 두거나, Continue로 다음 주로 넘어가기', 'database');
  return action('between_idle', 'Continue로 다음 주로 넘어가기');
}

// ---------- 결과 밑 "다음엔 이렇게" (§6.3) ----------

const RAISE_RC = 'RC 칸을 올려 다시 제안하거나, 지분을 다른 재보험사로 옮겨 보세요';

// 재보험사 응답 밑 한 줄. 문구가 필요 없으면 null.
// view: { signedTotal(확정 지분 합, 0~1), patience(남은 인내심) }
export function responseHint(row, { signedTotal, patience }, cfg) {
  if (!row || !row.last) return null;
  const l = row.last;
  if (patience <= 0) return '이 트리티에서는 이 재보험사와 더 협상하지 않아요 — 이 행의 지분을 다른 곳으로 옮기세요';
  if (l.mode === 'ask') return null; // 의견 묻기에는 가격 감 문구가 이미 있다

  const accepted = row.status === 'accepted';
  if (accepted) {
    const rest = Math.round((1 - signedTotal) * 100);
    if (rest <= 0) return '확정 지분이 가득 찼어요 — 아래 \'고객에게 제출\'로 내려가 보세요';
    return l.limited
      ? `요청한 만큼은 맡지 못한다고 해요 — 모자란 몫을 포함해 남은 ${rest}%는 다른 재보험사 행에서 채워 보세요`
      : `남은 ${rest}%는 다른 재보험사 행에서 채워 보세요`;
  }
  if (l.kind === 'counter' && row.status === 'countered') {
    const gap = l.rc - row.rc_req;
    return gap <= cfg.counter_close_pp
      ? '내 RC와 차이가 작아요 — 값이 괜찮다면 무료인 \'반제 수락\'을 살펴보세요'
      : `내 RC와 차이가 커요 — ${RAISE_RC}`;
  }
  if (l.kind === 'reject') {
    if (patience <= cfg.careful_patience) return '인내심이 얼마 남지 않았어요 — 먼저 \'의견 묻기\'로 가격 감부터 들어 보세요';
    return l.hint === 'near' ? 'RC를 조금만 올려 다시 제안해 보세요' : `눈높이가 많이 멀어요 — ${RAISE_RC}`;
  }
  if (l.kind === 'decline') return '이 행의 지분을 0으로 비우고 다른 재보험사 행에서 채워 보세요';
  return null;
}

// 고객이 말한 이유 종류 → 보드에서 바꿔 볼 곳(어디를 볼지만 말한다)
export const REASON_NEXT = {
  price: '패널의 평균 RC가 걸려요 — 확정한 행의 RC 칸을 손봐서 다시 제안해 보세요. 받아 줄지는 \'의견 묻기\'로 가늠할 수 있어요',
  security: '등급 칩이 낮은 재보험사의 지분을 등급이 더 높은 곳으로 옮겨 보세요',
  continuity: '위쪽 흐린 \'만기\' 띠에 있던 재보험사들로 지분을 되돌려 보세요',
  terms: '맨 위 \'약관 조건\' 칸을 고객 요구의 \'선호 조건\'에 맞춰 보세요 (바꾸면 모든 행이 \'미제안\'으로 돌아가요)',
  service: '보드 안에서 풀기 어려운 일이에요 — 고객·재보험사 DB에서 고객과 미팅하며 관계를 쌓은 뒤 다시 내 보세요',
  structure: '\'구조 옵션\' 칸을 \'없음\'으로 되돌려 보세요',
};

// 지금 턴 이후 처음 열리는 시즌 창구(없으면 null)
export function nextSeason(data, turn) {
  return data.calendar.seasons.find((s) => s.open_turn > turn) ?? null;
}

// 고객 반응 밑 한 줄. verdict가 없으면 null.
export function verdictHint(data, state, treatyState) {
  const { verdict, verdict_reason: reason } = treatyState;
  if (verdict === 'delighted' || verdict === 'accept') {
    const next = nextSeason(data, state.turn);
    return next
      ? `다음 갱신 시즌(${next.label})의 협상 창구는 턴 ${next.open_turn}에 열려요 — 그 사이에 고객·재보험사 DB에서 미팅으로 상대를 알아 둘 수 있어요`
      : '이번 해 갱신은 모두 마쳤어요';
  }
  if (verdict === 'renegotiate' || verdict === 'reject') return REASON_NEXT[reason] ?? null;
  return null;
}
