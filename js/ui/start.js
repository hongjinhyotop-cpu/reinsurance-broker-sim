// 시작 화면(새 게임 / 저장된 게임 / 데이터 오류 화면).

import * as store from '../store.js';
import { newSeed, seedFromText } from '../rng.js';
import { startGame } from '../turn.js';
import { h, toast, navigate } from './components.js';
import { renderSlotList, renderImportControl } from './settings.js';
import { skylineEl, coverSealEl } from './seals.js';

function cover() {
  const sky = skylineEl();
  sky.classList.add('cover-skyline');
  return sky;
}

export function renderStart() {
  const seedInput = h('input', {
    id: 'seed-input', type: 'text', maxlength: '30', autocomplete: 'off',
    placeholder: '비워 두면 무작위',
  });

  // 난이도(design.md §9.5): 시작할 때 한 번 고르고 도중에는 바꾸지 않는다.
  const { profiles, order, default: dflt } = store.getData().config.difficulty;
  const levelRadios = order.map((id) => h('input', {
    type: 'radio', name: 'difficulty', id: `level-${id}`, value: id, checked: id === dflt,
  }));
  const chosenLevel = () => levelRadios.find((r) => r.checked)?.value ?? dflt;

  const startNewGame = () => {
    const seed = seedFromText(seedInput.value) ?? newSeed();
    store.newGame({ seed, difficulty: chosenLevel() });
    startGame(); // 첫 주에 도착할 메일
    const saved = store.autosave();
    if (!saved.ok) toast(`자동 저장을 하지 못했어요 — ${saved.error}`, 'warn');
    navigate('inbox');
  };

  return h('main', { class: 'start', id: 'main' },
    // 게임 박스 표지(design.md §6.0.3 D3): 스카이라인 실루엣 · 인장 · 제목. 그림은 모두 장식이고 제목과 소개 글이 내용을 말한다.
    h('header', { class: 'cover' },
      cover(),
      h('div', { class: 'cover-seal-wrap' }, coverSealEl({ size: 92 })),
      h('h1', { class: 'cover-title' }, '마리나 베이 데스크'),
      h('p', { class: 'cover-sub' }, '싱가포르 재보험 브로커 시뮬레이션'),
      h('p', { class: 'lead' }, '작은 중개회사의 책임자가 되어, 58주 동안 보험회사와 재보험사 사이를 이어 주는 게임이에요.')),
    h('p', { class: 'dim' }, '메일에 답하고, 상대를 알아 가고, 재보험사들과 가격을 맞춰 계약을 확정해요. 해가 끝나면 이사회가 성적표를 줘요.'),
    !store.storageAvailable()
      ? h('p', { class: 'notice notice-warn', role: 'alert' }, '이 브라우저에서는 저장소를 쓸 수 없어요(개인정보 보호 모드일 수 있어요). 게임은 시작할 수 있지만 저장·불러오기는 되지 않아요.')
      : null,
    h('section', { class: 'card card-ledger' },
      h('h2', {}, '새 게임'),
      h('fieldset', { class: 'level-pick' },
        h('legend', {}, '난이도'),
        ...order.map((id, i) => h('div', { class: 'level-option' },
          levelRadios[i],
          h('label', { for: `level-${id}` }, h('strong', {}, profiles[id].label_ko), h('span', { class: 'dim' }, ` — ${profiles[id].summary_ko}`)))),
        h('small', { class: 'dim' }, '시작할 때 한 번 고르면 게임 도중에는 바꿀 수 없어요. 바꾸려면 새 게임을 시작하세요.')),
      h('div', { class: 'field' },
        h('label', { for: 'seed-input' }, '시드(선택)'),
        seedInput,
        h('small', { class: 'dim' }, '숫자나 단어를 넣으면 같은 난수 흐름으로 다시 시작할 수 있어요.'),
      ),
      h('button', { class: 'btn btn-primary btn-large', type: 'button', onclick: startNewGame }, '새 게임 시작'),
    ),
    h('section', { class: 'card' },
      h('h2', {}, '저장된 게임'),
      renderSlotList(),
      h('div', { class: 'row' }, renderImportControl()),
    ),
  );
}

// 데이터 파일이 잘못됐을 때 보여 주는 화면. 게임은 시작하지 않는다.
export function renderLoadError(errors, retry) {
  const onFile = location.protocol === 'file:';
  return h('main', { class: 'start', id: 'main' },
    h('h1', {}, '게임 데이터를 불러오지 못했어요'),
    onFile
      ? h('p', { class: 'notice notice-warn' }, '주소가 file:// 로 시작해요. 브라우저가 파일을 직접 열면 데이터를 읽을 수 없어요. 폴더에서 `python3 -m http.server 8000`을 실행한 뒤 http://localhost:8000 으로 열어 주세요.')
      : null,
    h('section', { class: 'card' },
      h('h2', {}, `문제 ${errors.length}건`),
      h('ul', { class: 'error-list' }, errors.map((e) => h('li', {}, e.message))),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: retry }, '다시 시도'),
    ),
  );
}
