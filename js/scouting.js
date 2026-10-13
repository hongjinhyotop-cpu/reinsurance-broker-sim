// 스카우트 값 증가 규칙과 단서 해금. design.md §4.3. DOM·저장소를 모르는 순수 함수(상태 변경은 turn.js의 meet이 한다).

import { ATTRS } from './reveal.js';

// 미팅 주제: 'general'은 주제 속성이 없고, 나머지는 속성 id가 곧 주제 id다.
export const TOPICS = ['general', ...ATTRS];

const round1 = (n) => Math.round(n * 10) / 10;

// 미팅 한 번 뒤의 새 스카우트 값(원본은 건드리지 않는다). 증가분은 s가 클수록 줄어든다.
export function applyMeeting(scout, topic, cfg) {
  if (!TOPICS.includes(topic)) throw new Error(`알 수 없는 미팅 주제: ${topic}`);
  const next = {};
  for (const attr of ATTRS) {
    const gain = attr === topic ? cfg.meeting_focus_gain : cfg.meeting_other_gain;
    next[attr] = round1(Math.min(100, scout[attr] + gain * (1 - scout[attr] / cfg.damping_divisor)));
  }
  return next;
}

// 미팅 한 번 뒤의 새 관계도(0~100). 이미 친할수록 덜 오른다.
export function relationshipAfterMeeting(relationship, cfg) {
  return round1(Math.min(100, relationship + cfg.meeting_relationship_gain * (1 - relationship / cfg.relationship_damping)));
}

// 지금 스카우트 값으로 읽을 수 있는 단서 메모.
export function unlockedNotes(notes, scout) {
  return notes.filter((n) => scout[n.attr] >= n.min_scout);
}

// 미팅으로 새로 읽을 수 있게 된 단서 메모.
export function newlyUnlocked(notes, before, after) {
  return notes.filter((n) => before[n.attr] < n.min_scout && after[n.attr] >= n.min_scout);
}
