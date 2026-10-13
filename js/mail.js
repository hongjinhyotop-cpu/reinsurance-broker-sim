// 메일 순수 함수: 치환, 마감 계산, 선택 가능 여부. DOM·저장소를 모른다(design.md §10.5).

// {market.label} 같은 화이트리스트 변수만 치환한다. 모르는 변수는 그대로 둔다(로더가 미리 걸러 둔다).
export function fillText(text, vars) {
  return text.replace(/\{([a-z_.]+)\}/g, (whole, key) => (Object.hasOwn(vars, key) ? String(vars[key]) : whole));
}

export function findTemplate(templates, id) {
  return templates.find((t) => t.id === id) ?? null;
}

// 마감 턴 = 도착 턴 + deadline_weeks. 마감이 없으면 null.
export function deadlineTurn(template, arrivalTurn) {
  return template.deadline_weeks === undefined ? null : arrivalTurn + template.deadline_weeks;
}

export function scheduledFor(templates, turn) {
  return templates.filter((t) => t.schedule?.turn === turn);
}

export function nextMailId(mails) {
  let max = 0;
  for (const m of mails) {
    const n = Number(/^m_(\d+)$/.exec(m.id)?.[1]);
    if (n > max) max = n;
  }
  return `m_${String(max + 1).padStart(4, '0')}`;
}

export function isOpen(mail) {
  return mail.answered === null;
}

// 답이 필요한 메일: 아직 답하지 않았고 선택지가 있다.
export function needsReply(mail, template) {
  return isOpen(mail) && template.choices.length > 0;
}

export function choiceBlockReason(choice, ap) {
  return choice.ap_cost > ap ? `행동 점수가 부족해요(필요 ${choice.ap_cost}, 남음 ${ap})` : null;
}

// 인박스 필터. 'todo'는 답이 필요한 메일.
export const MAIL_FILTERS = [
  { id: 'all', label: '전체' },
  { id: 'todo', label: '요청 필요' },
  { id: 'client', label: '고객' },
  { id: 'reinsurer', label: '재보험사' },
  { id: 'regulator', label: '규제' },
  { id: 'market', label: '시장' },
  { id: 'system', label: '시스템' },
  { id: 'mentor', label: '선배' },
];

export function matchesFilter(filterId, mail, template) {
  if (filterId === 'all') return true;
  if (filterId === 'todo') return needsReply(mail, template);
  return template.from.kind === filterId;
}
