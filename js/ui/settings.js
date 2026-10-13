// 설정 화면: 세이브 슬롯, 파일 백업, 게임 정보, M0 점검용 난수 도구.
// 슬롯 목록과 가져오기 버튼은 시작 화면도 같이 쓴다.

import * as store from '../store.js';
import { describeTurn, turnLabel } from '../calendar.js';
import { h, toast, confirmDialog, navigate, formatUsdM, formatDateTime } from './components.js';

const SLOT_NAMES = { auto: '자동 저장', 1: '슬롯 1', 2: '슬롯 2', 3: '슬롯 3' };
const slotName = (slot) => SLOT_NAMES[slot];

function summaryText(info) {
  const { calendar } = store.getData();
  const desc = describeTurn(calendar, info.turn);
  const when = desc ? `${turnLabel(desc)} (턴 ${info.turn}/${calendar.turns})` : `턴 ${info.turn}`;
  return `${when} · 현금 ${formatUsdM(info.cash_usd_m)} · ${formatDateTime(info.saved_at)}`;
}

// 진행 중인 게임이 있을 때만 "사라진다"는 경고를 띄운다.
async function okToReplaceGame() {
  if (!store.hasGame()) return true;
  return confirmDialog({
    title: '진행 중인 게임이 있어요',
    message: '지금 게임을 저장하지 않았다면 이 작업 후에는 되돌릴 수 없어요. 계속할까요?',
    confirmLabel: '계속',
    danger: true,
  });
}

export function renderSlotList() {
  const root = h('ul', { class: 'slot-list' });

  const refresh = () => {
    const gameActive = store.hasGame();
    root.replaceChildren(...store.listSlots().map((info) => {
      const name = slotName(info.slot);
      const isAuto = info.slot === 'auto';
      let body;
      if (info.status === 'ok') body = h('span', { class: 'slot-summary' }, summaryText(info));
      else if (info.status === 'empty') body = h('span', { class: 'slot-summary dim' }, '비어 있음');
      else body = h('span', { class: 'slot-summary slot-error' }, info.status === 'broken' ? `읽을 수 없는 저장이에요 — ${info.error}` : info.error);

      const actions = [];
      if (!isAuto && gameActive) {
        actions.push(h('button', {
          class: 'btn', type: 'button', 'aria-label': `${name}에 저장`,
          onclick: async () => {
            if (info.status !== 'empty') {
              const yes = await confirmDialog({ title: `${name}에 덮어쓸까요?`, message: '이 슬롯에 저장된 내용은 사라져요.', confirmLabel: '덮어쓰기', danger: true });
              if (!yes) return;
            }
            const res = store.save(info.slot);
            toast(res.ok ? `${name}에 저장했어요` : res.error, res.ok ? 'ok' : 'error');
            refresh();
          },
        }, '저장'));
      }
      if (info.status === 'ok') {
        actions.push(h('button', {
          class: 'btn', type: 'button', 'aria-label': `${name} 불러오기`,
          onclick: async () => {
            if (!(await okToReplaceGame())) return;
            const res = store.load(info.slot);
            if (!res.ok) { toast(res.error, 'error'); refresh(); return; }
            toast(`${name}을(를) 불러왔어요`, 'ok');
            if (!location.hash || location.hash === '#/start') navigate('inbox');
          },
        }, '불러오기'));
      }
      if (info.status === 'ok' || info.status === 'broken') {
        actions.push(h('button', {
          class: 'btn btn-danger', type: 'button', 'aria-label': `${name} 삭제`,
          onclick: async () => {
            const yes = await confirmDialog({ title: `${name}을(를) 삭제할까요?`, message: '삭제하면 되돌릴 수 없어요.', confirmLabel: '삭제', danger: true });
            if (!yes) return;
            const res = store.deleteSlot(info.slot);
            toast(res.ok ? `${name}을(를) 삭제했어요` : res.error, res.ok ? 'ok' : 'error');
            refresh();
          },
        }, '삭제'));
      }
      return h('li', { class: 'slot-row' },
        h('div', { class: 'slot-main' }, h('strong', {}, name), body),
        h('div', { class: 'slot-actions' }, actions));
    }));
  };

  refresh();
  return root;
}

// 파일에서 가져오기. 가져온 세이브는 바로 "현재 게임"이 되고, 슬롯에 저장하려면 따로 저장해야 한다.
export function renderImportControl() {
  const input = h('input', {
    type: 'file', class: 'visually-hidden', accept: '.json,application/json',
    onchange: async () => {
      const file = input.files[0];
      input.value = ''; // 같은 파일을 다시 골라도 동작하게
      if (!file) return;
      if (file.size > 2_000_000) { toast('파일이 너무 커요(2MB 이하만 가져올 수 있어요)', 'error'); return; }
      if (!(await okToReplaceGame())) return;
      const res = store.importJson(await file.text());
      if (!res.ok) { toast(`가져오지 못했어요 — ${res.error}`, 'error'); return; }
      toast('파일에서 게임을 가져왔어요. 슬롯에 저장하려면 [저장]을 눌러 주세요', 'ok');
      if (!location.hash || location.hash === '#/start') navigate('inbox');
    },
  });
  return h('label', { class: 'btn file-btn' }, '파일에서 가져오기', input);
}

function downloadText(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- M0 점검용 난수 도구 (게임 규칙이 아니라 "저장이 난수 흐름까지 기억하는지" 보는 임시 도구) ----------

let devGeneration = -1;
let devDraws = [];

function renderDevPanel() {
  if (devGeneration !== store.getGeneration()) {
    devGeneration = store.getGeneration();
    devDraws = [];
  }
  const state = store.getState();
  const stateOut = h('code', {}, String(state.rng_state));
  const drawsOut = h('p', { class: 'draws', 'aria-live': 'polite' }, devDraws.length ? devDraws.join('  ') : '아직 뽑지 않았어요');

  return h('section', { class: 'card dev-card' },
    h('h2', {}, '난수 점검 (M0 임시 도구)'),
    h('p', { class: 'dim' }, '저장이 "난수의 흐름"까지 기억하는지 확인하는 임시 도구예요. 게임이 만들어지면 지워요.'),
    h('ol', { class: 'plain-list' },
      h('li', {}, '[저장]으로 슬롯에 저장한다.'),
      h('li', {}, '[난수 3개 뽑기]를 누르고 숫자를 기억해 둔다.'),
      h('li', {}, '방금 슬롯을 [불러오기]한 뒤 다시 [난수 3개 뽑기]를 누른다.'),
      h('li', {}, '같은 숫자 3개가 다시 나오면 성공이에요.'),
    ),
    h('div', { class: 'row' },
      h('button', {
        class: 'btn btn-primary', type: 'button',
        onclick: () => {
          for (let i = 0; i < 3; i++) devDraws.push(store.random().toFixed(6));
          if (devDraws.length > 9) devDraws = devDraws.slice(-9);
          drawsOut.textContent = devDraws.join('  ');
          stateOut.textContent = String(store.getState().rng_state);
        },
      }, '난수 3개 뽑기'),
      h('span', { class: 'dim' }, '현재 난수 상태: ', stateOut),
    ),
    drawsOut,
  );
}

export function renderSettings() {
  const state = store.getState();
  const { calendar } = store.getData();
  const desc = describeTurn(calendar, state.turn);

  return h('div', { class: 'screen' },
    h('h1', {}, '설정'),
    !store.storageAvailable()
      ? h('p', { class: 'notice notice-warn', role: 'alert' }, '이 브라우저에서는 저장소를 쓸 수 없어서 저장·불러오기가 되지 않아요. 아래 [파일로 내보내기]로는 백업할 수 있어요.')
      : null,
    h('section', { class: 'card' },
      h('h2', {}, '저장 슬롯'),
      h('p', { class: 'dim' }, '[자동 저장]은 새 게임을 시작할 때 만들어져요. 슬롯 1~3은 직접 저장하는 칸이에요.'),
      renderSlotList(),
    ),
    h('section', { class: 'card' },
      h('h2', {}, '파일로 백업'),
      h('p', { class: 'dim' }, '세이브를 파일로 내보내 두면 브라우저 저장소를 지워도 복구할 수 있어요.'),
      h('div', { class: 'row' },
        h('button', {
          class: 'btn', type: 'button',
          onclick: () => {
            const res = store.exportJson();
            if (!res.ok) { toast(res.error, 'error'); return; }
            downloadText(res.filename, res.text);
            toast(`${res.filename} 파일을 내보냈어요`, 'ok');
          },
        }, '현재 게임을 파일로 내보내기'),
        renderImportControl(),
      ),
    ),
    h('section', { class: 'card' },
      h('h2', {}, '이 게임 정보'),
      h('dl', { class: 'info-list' },
        h('dt', {}, '시드'), h('dd', {}, String(state.seed)),
        h('dt', {}, '진행'), h('dd', {}, desc ? `${turnLabel(desc)} (턴 ${state.turn}/${calendar.turns})` : `턴 ${state.turn}`),
        h('dt', {}, '세이브 구조 버전'), h('dd', {}, `v${state.version}`),
      ),
      h('p', { class: 'dim' }, '같은 시드로 새 게임을 시작하면 같은 난수 흐름으로 시작해요.'),
    ),
    renderDevPanel(),
    h('section', { class: 'card' },
      h('h2', {}, '시작 화면으로'),
      h('p', { class: 'dim' }, '저장하지 않은 진행은 사라져요.'),
      h('button', {
        class: 'btn btn-danger', type: 'button',
        onclick: async () => {
          const yes = await confirmDialog({ title: '시작 화면으로 돌아갈까요?', message: '저장하지 않은 진행은 사라져요.', confirmLabel: '돌아가기', danger: true });
          if (yes) { location.hash = ''; store.quitToStart(); }
        },
      }, '시작 화면으로 돌아가기'),
    ),
  );
}
