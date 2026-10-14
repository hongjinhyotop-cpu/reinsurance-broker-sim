// 설정 화면: 세이브 슬롯, 파일 백업, 도감 초기화, 게임 정보, 사건 시험대.
// 슬롯 목록과 가져오기 버튼은 시작 화면도 같이 쓴다.

import * as store from '../store.js';
import { getCodex, progressOf, resetCodex } from '../glossary.js';
import { describeTurn, turnLabel } from '../calendar.js';
import { getPrefs, setPref, reduceMotionChoice, soundOn } from '../prefs.js';
import { forceEvent } from '../turn.js';
import { difficultyLabel } from '../difficulty.js';
import { h, toast, confirmDialog, navigate, formatUsdM, formatDateTime } from './components.js';
import { glossaryLink } from './glossary_view.js';
import { reducedMotion, syncMotionAttr } from './motion.js';
import { setSoundOn, soundAvailable } from './sound.js';

const SLOT_NAMES = { auto: '자동 저장', 1: '슬롯 1', 2: '슬롯 2', 3: '슬롯 3' };
const slotName = (slot) => SLOT_NAMES[slot];

function summaryText(info) {
  const { calendar } = store.getData();
  const desc = describeTurn(calendar, info.turn);
  const when = desc ? `${turnLabel(desc)} (턴 ${info.turn}/${calendar.turns})` : `턴 ${info.turn}`;
  const level = store.getData().config.difficulty.profiles[info.difficulty]?.label_ko ?? '보통';
  return `${when} · 난이도 ${level} · 현금 ${formatUsdM(info.cash_usd_m)} · ${formatDateTime(info.saved_at)}`;
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

function renderCodexReset() {
  const ids = store.getData().glossary.map((t) => t.id);
  const prog = progressOf(getCodex(), ids);
  return h('section', { class: 'card' },
    h('h2', {}, '용어 도감'),
    h('p', { class: 'dim' }, `지금까지 ${prog.seen}개를 만났고 ${prog.mastered}개를 마스터했어요. 도감은 세이브와 따로 저장돼서 새 게임을 시작해도 남아요.`),
    h('button', {
      class: 'btn btn-danger', type: 'button',
      onclick: async () => {
        const yes = await confirmDialog({ title: '도감을 초기화할까요?', message: '모은 용어와 별이 모두 사라지고 되돌릴 수 없어요. 게임 진행은 그대로예요.', confirmLabel: '초기화', danger: true });
        if (!yes) return;
        const res = resetCodex();
        toast(res.ok ? '도감을 초기화했어요' : '도감을 비웠지만 저장소에 쓰지 못했어요(이번에 켜 둔 동안만 비어 있어요)', res.ok ? 'ok' : 'warn');
        store.refresh();
      },
    }, '도감 초기화'));
}

function renderGuideSetting() {
  const on = getPrefs().guide_strip;
  return h('section', { class: 'card' },
    h('h2', {}, '안내띠'),
    h('p', { class: 'dim' }, '화면 맨 위에 "다음으로 할 일"을 한 줄로 보여 줘요. 답을 알려 주는 게 아니라 길을 잃었을 때 돌아올 자리예요. 이 설정은 세이브와 따로 저장돼서 새 게임을 시작해도 남아요.'),
    h('label', { class: 'check', for: 'pref-guide' },
      h('input', {
        type: 'checkbox', id: 'pref-guide', checked: on ? true : null,
        onchange: (ev) => {
          const res = setPref('guide_strip', ev.target.checked);
          if (!res.ok) toast('저장하지 못했어요. 이번에 켜 둔 동안만 적용돼요', 'warn');
          store.refresh();
        },
      }),
      ' 안내띠 보기'),
  );
}

// 연출 줄이기·효과음(design.md §6.0.3 D3). 둘 다 세이브가 아니라 rbs:prefs:v1에 저장돼 새 게임에도 유지된다.
function renderDisplaySettings() {
  const followsDevice = reduceMotionChoice() === null;
  const saveFailed = () => toast('저장하지 못했어요. 이번에 켜 둔 동안만 적용돼요', 'warn');
  return h('section', { class: 'card' },
    h('h2', {}, '화면과 소리'),
    h('p', { class: 'dim' }, '이 설정은 세이브와 따로 저장돼서 새 게임을 시작해도 남아요.'),
    h('div', { class: 'field' },
      h('label', { class: 'check', for: 'pref-reduce-motion' },
        h('input', {
          type: 'checkbox', id: 'pref-reduce-motion', checked: reducedMotion() ? true : null,
          onchange: (ev) => {
            if (!setPref('reduce_motion', ev.target.checked).ok) saveFailed();
            syncMotionAttr();
            store.refresh();
          },
        }),
        ' 연출 줄이기'),
      h('small', { class: 'dim' }, followsDevice
        ? '봉투 열기, 도장 찍힘, 뒤집힘 같은 움직임을 줄여요. 지금은 기기(OS)의 "움직임 줄이기" 설정을 따르고 있어요. 체크를 바꾸면 그 선택이 우선해요.'
        : '봉투 열기, 도장 찍힘, 뒤집힘 같은 움직임을 줄여요. 직접 고른 값을 쓰고 있어요.'),
      followsDevice ? null : h('button', {
        class: 'btn', type: 'button',
        onclick: () => {
          if (!setPref('reduce_motion', null).ok) saveFailed();
          syncMotionAttr();
          store.refresh();
        },
      }, '기기 설정 따르기')),
    h('div', { class: 'field' },
      h('label', { class: 'check', for: 'pref-sound' },
        h('input', {
          type: 'checkbox', id: 'pref-sound', checked: soundOn() ? true : null,
          onchange: (ev) => {
            if (ev.target.checked && !soundAvailable()) { toast('이 브라우저에서는 소리를 낼 수 없어요', 'warn'); store.refresh(); return; }
            if (!setSoundOn(ev.target.checked).ok) saveFailed();
            store.refresh();
          },
        }),
        ' 효과음'),
      h('small', { class: 'dim' }, '도장·봉투·주 넘김·사건 알림의 짧고 작은 소리예요. 기본은 꺼져 있어요. 화면 위쪽의 버튼으로도 켜고 끌 수 있어요.')));
}

// 사건 시험대(design.md §6.9, §8.3 ⑧): 창구·확률·조건을 건너뛰고 사건을 지금 일으켜 본다. 정식 규칙이 아니라 점검용이다.
const LAB_EVENTS = [
  { id: 'evt_mas_inspection', label: 'MAS 점검 (컴플라이언스 점수로 통과/경고/과태료)', opts: {} },
  { id: 'evt_shariah_ruling', label: '샤리아 상한 변경 (누산타라, 일반 재보험사 합 상한이 줄어듦)', opts: {} },
  { id: 'evt_jurong_explosion', label: '주롱섬 폭발 → 3주 뒤 템스 키 강등까지 확정', opts: { cascade: true } },
  { id: 'evt_reinsurer_downgrade', label: '템스 키 강등 바로 일으키기 (A- → BBB+)', opts: {} },
];

function renderEventLab() {
  const data = store.getData();
  const state = store.getState();
  const used = state.player.flags.includes('debug_events_used');
  const fire = async (ev, extra = {}, what = ev.label) => {
    const yes = await confirmDialog({ title: '사건을 지금 일으킬까요?', message: `${what}\n이 게임은 시험용으로 표시되고, 되돌릴 수 없어요. 연습하려면 새 게임이나 저장 슬롯을 따로 쓰세요.`, confirmLabel: '일으키기', danger: true });
    if (!yes) return;
    const res = forceEvent(ev.id, { ...ev.opts, ...extra });
    if (!res.ok) { toast(res.error, 'error'); return; }
    const voided = res.voided.length > 0 ? ` · 확정이 취소된 지분 ${res.voided.length}건` : '';
    toast(`사건을 일으켰어요 — 인박스에 새 메일이 와 있어요${voided}`, 'ok');
  };
  const clientSel = h('select', { id: 'lab-client', class: 'pl-select', 'aria-label': 'BOR 레터를 받을 고객' },
    data.clients.map((c) => h('option', { value: c.id }, c.name_ko)));
  return h('details', { class: 'card dev-card' },
    h('summary', {}, h('strong', {}, '사건 시험대 (연습용)')),
    h('p', { class: 'dim' }, '사건이 실제로 플레이를 바꾸는지 눌러서 확인하는 곳이에요. 누르면 창구·확률을 건너뛰고 사건이 지금 일어나요.'),
    h('p', { class: 'dim' }, '연습할 수 있는 사건: ', glossaryLink('gl_regulatory_inspection', { label: '금융감독 점검' }), ', ', glossaryLink('gl_shariah_board', { label: '샤리아 위원회' }), ' 결정, ', glossaryLink('gl_downgrade', { label: '재보험사 등급 강등' }), ', ', glossaryLink('gl_bor_letter', { label: 'BOR 레터' }), '예요.'),
    used ? h('p', { class: 'notice notice-warn', role: 'status' }, '이 게임은 사건 시험대를 써서 시험용으로 표시됐어요.') : null,
    h('ul', { class: 'plain-list' }, LAB_EVENTS.map((ev) => h('li', {},
      h('button', { class: 'btn', type: 'button', onclick: () => fire(ev) }, ev.label)))),
    h('div', { class: 'row' },
      h('label', { for: 'lab-client' }, 'BOR 레터(경쟁 브로커의 변경 요청)를 받을 고객'),
      clientSel,
      h('button', {
        class: 'btn', type: 'button',
        onclick: () => fire({ id: 'evt_bor_letter', opts: {} }, { client: clientSel.value }, `${clientSel.selectedOptions[0].textContent}에 BOR 레터 도착`),
      }, 'BOR 레터 일으키기')),
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
        h('dt', {}, '난이도'), h('dd', {}, difficultyLabel(store.getData(), state)),
        h('dt', {}, '세이브 구조 버전'), h('dd', {}, `v${state.version}`),
      ),
      h('p', { class: 'dim' }, '같은 시드로 새 게임을 시작하면 같은 난수 흐름으로 시작해요.'),
    ),
    renderGuideSetting(),
    renderDisplaySettings(),
    renderCodexReset(),
    renderEventLab(),
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
