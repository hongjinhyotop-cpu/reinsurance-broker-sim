// 턴 번호 → 분기·시즌 계산. 날짜는 연출용이고 계산은 턴 번호로만 한다(design.md §2.2).

export function describeTurn(calendar, turn) {
  if (!Number.isInteger(turn) || turn < 1 || turn > calendar.turns) return null;
  const quarter = calendar.quarters.find((q) => turn >= q.from && turn <= q.to);
  if (!quarter) return null;

  const season = calendar.seasons.find((s) => turn >= s.open_turn && turn <= s.inception_turn);
  let seasonInfo = null;
  if (season) {
    const weeksToInception = season.inception_turn - turn;
    seasonInfo = {
      id: season.id,
      label: season.label,
      phase: weeksToInception === 0 ? 'inception' : 'window',
      weeksToInception,
      windowWeek: turn - season.open_turn + 1,
      windowWeeks: season.inception_turn - season.open_turn,
    };
  }

  return {
    turn,
    totalTurns: calendar.turns,
    quarter: { id: quarter.id, label_ko: quarter.label_ko },
    weekInQuarter: turn - quarter.from + 1,
    quarterWeeks: quarter.to - quarter.from + 1,
    season: seasonInfo,
  };
}

export function turnLabel(desc) {
  return `${desc.quarter.label_ko} ${desc.weekInQuarter}주차`;
}

export function seasonLabel(desc) {
  const s = desc.season;
  if (!s) return '갱신 시즌 사이(비수기)';
  if (s.phase === 'inception') return `${s.label} 인셉션 주`;
  return `${s.label} 시즌 협상 ${s.windowWeek}/${s.windowWeeks}주차 · 인셉션까지 ${s.weeksToInception}주`;
}

// 새 분기가 시작되는 턴인가(프리시즌 시작인 턴 1 제외). 시장 드리프트가 이 턴에 한 번 적용된다(design.md §3).
export function isQuarterStart(calendar, turn) {
  return turn > 1 && calendar.quarters.some((q) => q.from === turn);
}
