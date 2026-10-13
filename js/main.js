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
import { toast } from './ui/components.js';

const GAME_TITLE = '싱가포르 재보험 브로커 시뮬레이션';
const app = document.getElementById('app');
const screenIds = NAV.map((n) => n.id);

function currentRoute() {
  const match = /^#\/([a-z]+)$/.exec(location.hash);
  return match && screenIds.includes(match[1]) ? match[1] : 'inbox';
}

// 그리는 도중(포커스가 사라지며 change가 터지는 등)에 다시 그리기를 요청하면 끝난 뒤에 한 번 더 그린다.
let rendering = false;
let pending = null;

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
  app.replaceChildren();
  if (!store.hasGame()) {
    app.append(renderStart());
    document.title = GAME_TITLE;
    return;
  }
  const route = currentRoute();
  const screens = { settings: renderSettings, inbox: renderInbox, calendar: renderCalendar, database: renderDatabase, placement: renderPlacement };
  const content = screens[route] ? screens[route]() : renderPlaceholder(route);
  app.append(renderShell(route, content));
  document.title = `${screenTitle(route)} · ${GAME_TITLE}`;
  if (focusMain) document.getElementById('main')?.focus();
  else if (keepScroll > 0) window.scrollTo(0, keepScroll);
}

async function boot() {
  app.replaceChildren(document.createTextNode('불러오는 중…'));
  const result = await loadData();
  if (!result.ok) {
    app.replaceChildren(renderLoadError(result.errors, boot));
    return;
  }
  store.configure(result.data);
  render();
}

// 게임이 새로 시작/교체되거나(game) 진행 중 값이 바뀔 때(state) 전체를 다시 그린다. 슬롯 목록은 각자 갱신한다.
store.subscribe((type) => { if (type === 'game' || type === 'state') render(); });
window.addEventListener('hashchange', () => render({ focusMain: true }));

// 조용히 멈추는 것보다 알려 주는 편이 낫다(상세는 콘솔).
window.addEventListener('error', (e) => { if (e.error) toast('예상치 못한 오류가 났어요. F12 → 콘솔을 확인해 주세요.', 'error'); });
window.addEventListener('unhandledrejection', () => toast('예상치 못한 오류가 났어요. F12 → 콘솔을 확인해 주세요.', 'error'));

boot();
