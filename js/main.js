// 부트스트랩 + 화면 전환. 규칙 계산은 여기 두지 않는다.

import { loadData } from './loader.js';
import * as store from './store.js';
import { renderStart, renderLoadError } from './ui/start.js';
import { renderShell, renderPlaceholder, screenTitle, NAV } from './ui/shell.js';
import { renderSettings } from './ui/settings.js';
import { toast } from './ui/components.js';

const GAME_TITLE = '싱가포르 재보험 브로커 시뮬레이션';
const app = document.getElementById('app');
const screenIds = NAV.map((n) => n.id);

function currentRoute() {
  const match = /^#\/([a-z]+)$/.exec(location.hash);
  return match && screenIds.includes(match[1]) ? match[1] : 'inbox';
}

function render({ focusMain = false } = {}) {
  app.replaceChildren();
  if (!store.hasGame()) {
    app.append(renderStart());
    document.title = GAME_TITLE;
    return;
  }
  const route = currentRoute();
  const content = route === 'settings' ? renderSettings() : renderPlaceholder(route);
  app.append(renderShell(route, content));
  document.title = `${screenTitle(route)} · ${GAME_TITLE}`;
  if (focusMain) document.getElementById('main')?.focus();
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

// 게임이 새로 시작되거나 통째로 바뀔 때만 전체를 다시 그린다. 슬롯 목록은 각자 갱신한다.
store.subscribe((type) => { if (type === 'game') render(); });
window.addEventListener('hashchange', () => render({ focusMain: true }));

// 조용히 멈추는 것보다 알려 주는 편이 낫다(상세는 콘솔).
window.addEventListener('error', (e) => { if (e.error) toast('예상치 못한 오류가 났어요. F12 → 콘솔을 확인해 주세요.', 'error'); });
window.addEventListener('unhandledrejection', () => toast('예상치 못한 오류가 났어요. F12 → 콘솔을 확인해 주세요.', 'error'));

boot();
