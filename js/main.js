// 부트스트랩 + 화면 전환. 규칙 계산은 여기 두지 않는다.

import { loadData } from './loader.js';
import * as store from './store.js';
import { renderStart, renderLoadError } from './ui/start.js';
import { renderShell, renderPlaceholder, screenTitle, NAV } from './ui/shell.js';
import { renderSettings } from './ui/settings.js';
import { renderInbox } from './ui/inbox.js';
import { renderCalendar } from './ui/calendar_view.js';
import { renderDatabase } from './ui/database.js';
import { renderPlacement } from './ui/placement_view.js';
import { renderCodex, resetTermScope } from './ui/glossary_view.js';
import { renderStandings } from './ui/standings.js';
import { renderReview } from './ui/review.js';
import { toast } from './ui/components.js';
import { captureFocus, restoreFocus } from './ui/focus.js';
import { resetShown, syncMotionAttr } from './ui/motion.js';
import { busy as ceremonyBusy, lockControls, reset as resetCeremony } from './ui/ceremony.js';

const GAME_TITLE = '마리나 베이 데스크';
const GAME_SUBTITLE = '싱가포르 재보험 브로커 시뮬레이션';
const app = document.getElementById('app');
const screenIds = NAV.map((n) => n.id);

function currentRoute() {
  const match = /^#\/([a-z]+)$/.exec(location.hash);
  return match && screenIds.includes(match[1]) ? match[1] : 'inbox';
}

// 그리는 도중(포커스가 사라지며 change가 터지는 등)에 다시 그리기를 요청하면 끝난 뒤에 한 번 더 그린다.
let rendering = false;
let pending = null;
let lastView = null; // 마지막으로 그린 화면('start' 또는 화면 id)

function render(opts = {}) {
  if (rendering) { pending = opts; return; }
  rendering = true;
  try {
    renderNow(opts);
  } finally {
    rendering = false;
  }
  if (pending) { const next = pending; pending = null; render(next); }
}

function renderNow({ focusMain = false } = {}) {
  // 같은 화면에서 값만 바뀌어 다시 그릴 때(제안·제출 등) 보던 위치를 잃지 않게 한다.
  const keepScroll = !focusMain && store.hasGame() ? window.scrollY : 0;
  // 같은 화면을 다시 그릴 때만 키보드 초점을 되돌린다(화면이 바뀌면 hashchange가 본문으로 초점을 옮긴다).
  const view = store.hasGame() ? currentRoute() : 'start';
  const keepFocus = focusMain || view !== lastView ? null : captureFocus(app);
  lastView = view;
  app.replaceChildren();
  if (!store.hasGame()) {
    app.append(renderStart());
    document.title = `${GAME_TITLE} · ${GAME_SUBTITLE}`;
    restoreFocus(app, keepFocus);
    return;
  }
  const route = currentRoute();
  const screens = { settings: renderSettings, inbox: renderInbox, calendar: renderCalendar, database: renderDatabase, placement: renderPlacement, codex: renderCodex, standings: renderStandings, review: renderReview };
  if (route !== 'review') { resetShown('review-score'); resetShown('review-stamp'); resetShown('review-stamp-fired'); } // 성적표 점수·등급 도장은 화면을 열 때마다 처음부터
  resetTermScope(); // 화면 하나를 그리는 동안은 같은 용어를 첫 등장만 링크로 만든다
  const content = screens[route] ? screens[route]() : renderPlaceholder(route);
  app.append(renderShell(route, content));
  if (ceremonyBusy()) lockControls(app); // 봉투를 여는 동안은 모든 조작이 잠긴다(ceremony.js)
  document.title = `${screenTitle(route)} · ${GAME_TITLE}`;
  if (focusMain) document.getElementById('main')?.focus();
  else {
    restoreFocus(app, keepFocus);
    if (keepScroll > 0) window.scrollTo(0, keepScroll);
  }
}

async function boot() {
  app.replaceChildren(document.createTextNode('불러오는 중…'));
  const result = await loadData();
  if (!result.ok) {
    app.replaceChildren(renderLoadError(result.errors, boot));
    return;
  }
  for (const w of result.warnings ?? []) console.warn(w); // 콘텐츠 점검용(게임은 그대로 시작)
  syncMotionAttr(); // 저장된 "연출 줄이기" 선택을 CSS에 알린다
  store.configure(result.data);
  render();
}

// 게임이 새로 시작/교체되거나(game) 진행 중 값이 바뀔 때(state) 전체를 다시 그린다. 슬롯 목록은 각자 갱신한다.
store.subscribe((type) => {
  if (type === 'game') { resetShown(); resetCeremony(); } // 다른 판의 숫자에서 세어 올라가지 않게, 열리던 봉투도 버린다
  if (type === 'game' || type === 'state') render();
});
window.addEventListener('hashchange', () => render({ focusMain: true }));

// 조용히 멈추는 것보다 알려 주는 편이 낫다(상세는 콘솔).
window.addEventListener('error', (e) => { if (e.error) toast('예상치 못한 오류가 났어요. F12 → 콘솔을 확인해 주세요.', 'error'); });
window.addEventListener('unhandledrejection', () => toast('예상치 못한 오류가 났어요. F12 → 콘솔을 확인해 주세요.', 'error'));

boot();
