// 키보드 초점 보존. 화면을 통째로 다시 그리면 방금 누른 버튼이 사라져 초점이 문서 맨 앞으로 돌아간다.
// 그리기 전에 초점의 자리를 적어 두고, 그린 뒤에 같은 컨트롤을 찾아 되돌린다(design.md §6.0.2).

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

// 컨트롤을 알아볼 수 있는 이름. 라벨·id·글자 순으로 쓴다.
function signatureOf(el) {
  return [el.getAttribute('aria-label'), el.id, el.getAttribute('name'), el.type, (el.textContent ?? '').trim().slice(0, 40)].join('|');
}

// root 안에 초점이 있으면 그 자리를 설명하는 값을, 없으면(또는 모달 안이면) null을 돌려준다.
export function captureFocus(root) {
  const el = document.activeElement;
  if (!el || el === document.body || !root.contains(el) || el.closest('dialog')) return null;
  const tag = el.tagName;
  const sig = signatureOf(el);
  const sameName = [...root.querySelectorAll(tag.toLowerCase())].filter((e) => signatureOf(e) === sig);
  return {
    tag, sig, ordinal: sameName.indexOf(el),
    index: [...root.querySelectorAll(FOCUSABLE)].indexOf(el),
    selection: typeof el.selectionStart === 'number' ? [el.selectionStart, el.selectionEnd] : null,
  };
}

// 같은 이름의 컨트롤을 먼저 찾고(몇 번째인지까지), 이름이 바뀌었으면(예: 읽은 메일의 "안 읽음" 표시가 사라짐) 같은 순서의 컨트롤로 되돌린다.
export function restoreFocus(root, saved) {
  if (!saved) return false;
  const sameName = [...root.querySelectorAll(saved.tag.toLowerCase())].filter((e) => signatureOf(e) === saved.sig);
  let target = sameName[Math.min(Math.max(saved.ordinal, 0), sameName.length - 1)] ?? null;
  if (!target && saved.index >= 0) {
    const all = [...root.querySelectorAll(FOCUSABLE)];
    const byIndex = all[Math.min(saved.index, all.length - 1)];
    if (byIndex && byIndex.tagName === saved.tag) target = byIndex;
  }
  if (!target) return false;
  target.focus({ preventScroll: true });
  if (saved.selection && typeof target.setSelectionRange === 'function') {
    try { target.setSelectionRange(saved.selection[0], saved.selection[1]); } catch { /* 숫자 입력칸 등은 선택 범위를 못 쓴다 */ }
  }
  return true;
}
