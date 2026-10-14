// DOM 헬퍼. 데이터·사용자가 넣은 글자는 항상 텍스트 노드로만 넣는다(innerHTML 사용 금지).

function append(el, children) {
  for (const child of children) {
    if (child == null || child === false) continue;
    if (Array.isArray(child)) append(el, child);
    else if (child instanceof Node) el.append(child);
    else el.append(document.createTextNode(String(child)));
  }
}

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, val] of Object.entries(attrs ?? {})) {
    if (val == null || val === false) continue;
    if (key === 'class') el.className = val;
    else if (key === 'value') el.value = val;
    // CSP가 style 속성을 막으므로 스타일은 CSSOM으로만 준다.
    else if (key === 'style' && typeof val === 'object') Object.assign(el.style, val);
    else if (key.startsWith('on') && typeof val === 'function') el.addEventListener(key.slice(2), val);
    else el.setAttribute(key, val === true ? '' : String(val));
  }
  append(el, children);
  return el;
}

export function navigate(screenId) {
  const next = `#/${screenId}`;
  if (location.hash === next) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = next;
}

// ---------- 알림 ----------

export function toast(message, kind = 'info') {
  const host = document.getElementById('toasts');
  if (!host) return;
  const el = h('div', { class: `toast toast-${kind}` }, message);
  host.append(el);
  while (host.children.length > 4) host.firstElementChild.remove();
  setTimeout(() => el.remove(), kind === 'error' ? 7000 : 4000);
}

let dialogSeq = 0;
export function confirmDialog({ title, message, confirmLabel = '확인', cancelLabel = '취소', danger = false }) {
  return new Promise((resolve) => {
    const titleId = `dlg-title-${++dialogSeq}`;
    let result = false;
    const dlg = h('dialog', { class: 'dialog', 'aria-labelledby': titleId },
      h('h2', { id: titleId }, title),
      h('p', {}, message),
      h('div', { class: 'dialog-actions' },
        // 되돌릴 수 없는 작업이 많아서 기본 초점은 "취소"에 둔다.
        h('button', { class: 'btn', type: 'button', autofocus: true, onclick: () => { result = false; dlg.close(); } }, cancelLabel),
        h('button', { class: danger ? 'btn btn-danger' : 'btn btn-primary', type: 'button', onclick: () => { result = true; dlg.close(); } }, confirmLabel),
      ),
    );
    dlg.addEventListener('close', () => { dlg.remove(); resolve(result); });
    document.body.append(dlg);
    dlg.showModal();
  });
}

// ---------- 표시 형식 ----------

export function formatUsdM(value) {
  const sign = value < 0 ? '-' : '';
  return `${sign}$${Math.abs(value).toFixed(2)}m`;
}

export function formatDateTime(iso) {
  if (!iso) return '시각 정보 없음';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '시각 정보 없음';
  return d.toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
}

// ---------- 막대 ----------

// 0~100 게이지. marks는 단계가 바뀌는 지점(눈금).
// decor: 옆에 같은 말이 글로 있을 때 숫자 이름 없이 장식으로만 둔다.
export function gauge(value, marks = [], { decor = false } = {}) {
  return h('span', decor ? { class: 'gauge', 'aria-hidden': 'true' } : { class: 'gauge', role: 'img', 'aria-label': `${Math.round(value)} / 100` },
    h('span', { class: 'gauge-fill', style: { width: `${Math.min(100, Math.max(0, value))}%` } }),
    marks.map((m) => h('span', { class: 'gauge-mark', style: { left: `${m}%` } })));
}
