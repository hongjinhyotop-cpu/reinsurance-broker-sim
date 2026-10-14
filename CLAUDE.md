# CLAUDE.md

싱가포르 재보험 브로커 경영 시뮬레이션(Football Manager 스타일, 싱글 플레이). 설계의 단일 출처는 `docs/design.md`다. 설계가 바뀌면 코드보다 문서를 먼저 고친다.

## 기술 제약 (어기지 말 것)
- 바닐라 HTML/CSS/JS(ES Modules). **빌드 도구·npm·외부 라이브러리·CDN 없음.**
- 세이브는 `localStorage`. 콘텐츠는 `data/*.json`. **런타임 외부 API 호출 없음**(LLM 포함, 완전 오프라인).
- `file://`에서는 모듈·fetch가 막히므로 `python3 -m http.server 8000`으로 확인한다.

## 1차 범위 (고정)
- 1년 4분기 + 프리시즌, 고객 3 · 재보험사 5 · 이벤트 10.
- 핵심 기능 3가지: ① 용어집(3단계 카드·도감. Anki CSV는 보류 — design.md §13.1) ② 숨겨진 속성 스카우팅(미팅할수록 공개) ③ 라인 구성 보드(리스크 100%를 재보험사들이 나눠 채움).
- 직원 육성, 경쟁 브로커 이직 오퍼, 시장 사이클 그래프, 딜 복기, 상황별 멘토 메일, 엔딩 분기는 **2차 확장**이다. 요청 없이 구현하지 않는다. (프리시즌 선배 메일 4통·안내띠·"다음엔 이렇게"는 길잡이로 v1에 들어왔다 — design.md §2.6·§6.0.1·§6.3)

## 파일 구조
```
index.html            진입점
docs/design.md        설계 문서
css/                  base.css(디자인 토큰·공통 컴포넌트·셸), screens.css
fonts/                로컬 글꼴 woff2 + LICENSES.md (외부 글꼴 주소 금지, CSP font-src 'self')
js/                   main, loader, store, rng, calendar, market, negotiation, placement, reveal,
                      scouting, glossary, anki, effects, events, mail, turn, finance, rivals, season, guide, prefs, difficulty
js/ui/                components, shell, focus, start, settings, inbox, database,
                      placement_view, glossary_view, calendar_view, standings, review, seals
data/                 config, calendar, clients, reinsurers, treaties, events, mails,
                      glossary, brokers, report  (.json)
tests/index.html      브라우저 실행 간이 테스트 러너 (서버로 연 뒤 /tests/ 접속)
tests/balance/        밸런싱 도구(Node: `node tests/balance/sim.mjs 300 normal,easy`). 게임 실행에는 쓰이지 않는다 — design.md §9.6
```

## 디자인 (design.md §6.0.3)
- "종이와 잉크" 한 가지 테마(밝은 크림). 어두운 테마 금지. 색·글꼴·간격·그림자·모서리는 `css/base.css`의 `:root` 토큰에만 두고 다른 CSS는 `var(--…)`만 쓴다.
- `--bg`·`--text`·`--accent` 같은 옛 이름은 임시 별칭이다. 화면을 개편할 때 새 이름으로 바꾼다.

## 코드 규칙
- 식별자·파일명은 영어, UI 문구·데이터 텍스트·문서·주석은 한국어. 주석은 "왜"만 짧게.
- 규칙 계산(`negotiation`, `reveal`, `scouting`, `market`, `anki`)은 **DOM·localStorage를 모르는 순수 함수**. 상태 변경은 `store`와 `effects`를 통해서만.
- 난수는 `rng.js`의 시드 RNG만 쓴다. `Math.random()` 금지(세이브 재현성).
- 계수·임계값은 코드에 박지 말고 `data/config.json`에 둔다.
- `ui/*` → 로직 모듈 방향으로만 의존한다.
- 누를 수 있는 것은 기본 컨트롤(`button`·`a`·`input`·`select`)만 쓰고 이름(글자·`aria-label`)을 단다. 화면을 다시 그려도 키보드 초점이 유지된다(`ui/focus.js`, design.md §6.0.2).
- DOM은 `ui/components.js`의 `h()`로 만든다. `innerHTML`·`style` 속성·인라인 스크립트 금지(`index.html`의 CSP가 외부 접속과 함께 막는다). 모양은 CSS 클래스로.

## 데이터 규칙
- 회사·인물 이름은 **가상**만. 실존 회사명 금지. 규제 조항 번호·실제 수치 인용 금지.
- 데이터는 선언만. `eval`·`Function`·표현식 금지. 조건·효과 op는 닫힌 집합(design.md §10.8).
- id는 `snake_case` + 접두어(`cli_ re_ trt_ evt_ mail_ gl_ brk_`). JSON에 주석 금지.
- 텍스트 속 용어는 `[[gl_id|표시문구]]` 마크업. 로더가 id 존재를 검증한다.
- 숨은 속성(`hidden.*`)의 원값을 UI에 직접 출력하지 않는다. 반드시 `reveal.js`를 거친다.

## 세이브 규칙
- 키 `rbs:save:v1:<slot>`, 도감은 별도 키 `rbs:codex:v1`(새 게임에도 유지), 화면 설정(안내띠 켜기/끄기)은 별도 키 `rbs:prefs:v1`.
- 세이브에는 동적 상태만 저장하고 정적 콘텐츠는 id로 참조한다.
- 난이도(`easy`/`normal`)는 세이브의 `difficulty`에 있고 게임 도중 바꾸지 않는다. 난이도별 숫자는 `data/config.json`의 `difficulty.profiles`에만 둔다(보통은 중립값 — 보통의 규칙·숫자는 바꾸지 않는다). 설계는 design.md §9.5.
- 구조를 바꾸면 `version`을 올리고 `store.js`에 마이그레이션을 추가한다. localStorage 접근은 try/catch로 감싼다.

## 작업 방식
- 변경은 작게, 문서와 코드가 어긋나면 문서를 먼저 맞춘다.
- 수치 튜닝은 `data/config.json`만 고친다. 계산식 구조를 바꾸면 design.md §7을 갱신한다. 숫자를 바꾸면 `tests/balance`로 등급·해고 분포가 어떻게 달라지는지 먼저 본다.
- 용어집·단서 문구 같은 콘텐츠 작업은 코드 작업과 별도 커밋으로 나눈다.
