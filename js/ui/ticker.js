// 뉴스 띠(design.md §6.0.3 D6 ④): 상단 바 아래 한 줄. 표시 전용이고 게임 상태를 바꾸지 않는다.
// 헤드라인은 rotate_seconds마다 통째로 바뀐다. 화면을 다시 그리지 않고 글자만 바꿔서 초점·스크롤을 건드리지 않는다.
// 연출 줄이기면 바뀌지 않는 한 줄, 마우스를 올리거나 띠 안에 초점이 있거나 탭이 숨어 있으면 멈춘다.

import * as store from '../store.js';
import { pickHeadlines } from '../news.js';
import { newsTickerOn, setPref } from '../prefs.js';
import { h, toast } from './components.js';
import { reducedMotion } from './motion.js';

let pos = 0; // 이번 주 목록에서 지금 보이는 자리. 다시 그려도 이어진다
let listKey = null;
let timer = null;

function headlines() {
  const state = store.getState();
  const list = pickHeadlines(store.getData(), state);
  const key = `${state.seed}:${state.turn}:${list.join('|')}`;
  if (key !== listKey) { listKey = key; pos = 0; } // 주가 바뀌면 그 주의 첫 헤드라인부터
  return list;
}

function tick() {
  if (document.hidden || reducedMotion() || !store.hasGame()) return;
  const bar = document.querySelector('.news-ticker');
  if (!bar || bar.matches(':hover') || bar.matches(':focus-within')) return;
  const text = bar.querySelector('.news-text');
  const list = headlines();
  if (!text || list.length < 2) return;
  pos = (pos + 1) % list.length;
  text.textContent = list[pos];
  text.classList.remove('is-new');
  void text.offsetWidth; // 같은 애니메이션을 다시 시작하려면 한 번 배치를 읽어야 한다
  text.classList.add('is-new');
}

function ensureTimer(seconds) {
  if (timer === null) timer = setInterval(tick, seconds * 1000);
}

function turnOff() {
  const res = setPref('news_ticker', false);
  toast(res.ok ? '뉴스 띠를 껐어요. 설정 화면에서 다시 켤 수 있어요' : '뉴스 띠를 껐어요(이 브라우저에서는 저장되지 않아, 새로 열면 다시 나타나요)', res.ok ? 'info' : 'warn');
  store.refresh();
}

export function renderTicker() {
  if (!newsTickerOn() || !store.hasGame()) return null;
  const list = headlines();
  if (list.length === 0) return null;
  if (reducedMotion()) pos = 0;
  ensureTimer(store.getData().news.rotate_seconds);
  return h('section', { class: 'news-ticker', 'aria-label': '시장 소식' },
    h('span', { class: 'news-label' }, '시장 소식'),
    h('p', { class: 'news-text' }, list[pos % list.length]),
    h('button', { class: 'btn news-off', type: 'button', title: '끄면 설정 화면에서 다시 켤 수 있어요', onclick: turnOff }, '소식 끄기'));
}
