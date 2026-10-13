// 시작 화면(새 게임 / 저장된 게임 / 데이터 오류 화면).

import * as store from '../store.js';
import { newSeed, seedFromText } from '../rng.js';
import { h, toast, navigate } from './components.js';
import { renderSlotList, renderImportControl } from './settings.js';

export function renderStart() {
  const seedInput = h('input', {
    id: 'seed-input', type: 'text', maxlength: '30', autocomplete: 'off',
    placeholder: '비워 두면 무작위',
  });

  const startNewGame = () => {
    const seed = seedFromText(seedInput.value) ?? newSeed();
    store.newGame({ seed });
    const saved = store.autosave();
    if (!saved.ok) toast(`자동 저장을 하지 못했어요 — ${saved.error}`, 'warn');
    navigate('inbox');
  };

  return h('main', { class: 'start', id: 'main' },
    h('h1', {}, '싱가포르 재보험 브로커 시뮬레이션'),
    h('p', { class: 'lead' }, '작은 중개회사의 책임자가 되어, 58주 동안 보험회사와 재보험사 사이를 이어 주는 게임이에요.'),
    h('p', { class: 'dim' }, '지금은 M0(뼈대) 단계예요. 새 게임을 시작하고, 저장하고, 불러오는 것까지만 할 수 있어요.'),
    !store.storageAvailable()
      ? h('p', { class: 'notice notice-warn', role: 'alert' }, '이 브라우저에서는 저장소를 쓸 수 없어요(개인정보 보호 모드일 수 있어요). 게임은 시작할 수 있지만 저장·불러오기는 되지 않아요.')
      : null,
    h('section', { class: 'card' },
      h('h2', {}, '새 게임'),
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
