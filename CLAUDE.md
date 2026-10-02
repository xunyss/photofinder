# photofinder

Google Photos 웹(photos.google.com)에서 사진을 한 장씩 넘기며 정보 패널을 읽고,
조건에 맞는 사진을 찾아 목록으로 만든다.

## 결정 사항 (2026-10-02)

- **공식 API 미사용**: 2025-03 이후 Library API 는 앱이 올린 사진만 읽을 수 있고,
  "백업됨(1.2MB)" 같은 스토리지 정보는 API 에 원래 없다 → 브라우저 자동화로 간다.
- **스택**: TypeScript + `playwright-core` + `node:sqlite` (Node 24, mise).
  - `playwright-core` 만 쓴다. 브라우저를 받지 않고 실제 Chrome 에 CDP 로 붙는다.
  - Node 24 의 타입 스트리핑으로 `.ts` 를 바로 실행한다 (빌드 없음, `tsc` 는 타입 검사용).
    그래서 enum/namespace 등 erasable 하지 않은 문법은 쓰지 않는다. import 는 `.ts` 확장자 포함.
- **로그인**: Playwright 가 띄운 브라우저는 구글 로그인이 막히므로, `npm run chrome` 으로
  디버깅 포트를 연 전용 Chrome(프로필 `.chrome-profile/`, 프로젝트 내부)을 띄워 사용자가 직접 로그인한다.
- **macOS / Windows 공용**: npm 스크립트에 셸 명령(`rm`, `.sh`)을 쓰지 않는다. Windows 는 npm 이
  cmd.exe 로 실행하므로, 파일 조작·프로세스 실행은 전부 Node 스크립트(`scripts/*.ts`)로 한다.
  Chrome 경로는 OS 별 기본 위치를 찾고, 없으면 `CHROME_PATH` 환경변수로 지정.
  Windows 는 실기 테스트 전 (2026-10-02 기준 macOS 에서만 확인).
- **이어하기**: 사진 ID(URL 의 `/photo/<ID>`)를 키로 SQLite(`data/photos.db`)에 저장.
  이미 본 사진은 패널을 다시 읽지 않고 저장된 결과를 쓴다 (일치하면 `(이전 기록)` 표시와 함께 출력·집계). 패널 원문(`rawText`)도 저장해 파싱 규칙을 바꿔도 재수집 없이 재처리 가능.

## 사용법

```bash
npm run chrome          # 전용 Chrome 실행 → 최초 1회 로그인 → 시작할 사진을 연다
npm run scan            # 열린 사진부터 → 방향으로 끝까지 순회
npm run scan -- --limit 20 --delay 600   # 20장만, 대기 600ms(+지터)
npm run scan -- --rescan                 # DB 에 있는 사진도 다시 읽기
npm run scan -- --until 20261001         # 이 날짜(yyyymmdd)보다 과거 사진이 나오면 멈춤 (그 사진은 저장 안 함)
npm run report          # 일치한 사진 → data/matches.csv
npm run reset           # data/photos.db, data/matches.csv 삭제 (처음부터 다시)
npm run typecheck
```

## 구조

- `src/extract.ts` — 정보 패널 텍스트 추출 + 파싱. **DOM 변경 시 여기만 고친다.**
  보이는 패널만 고르고(앞뒤 사진 패널이 DOM 에 미리 있음), 클래스명 대신 "세부정보" 텍스트를 기준점으로 쓴다.
- `src/match.ts` — 찾을 조건. 현재: 패널에 "이 항목은 계정 스토리지의 공간을 차지하지 않습니다"
  문구가 **없는** 사진 (= 스토리지를 차지하는 사진). 일치하면 1초 뒤 재확인한다(로딩 지연 대비).
- `src/scan.ts` — CDP 연결, 순회 루프(→ 키, URL 변경 대기), Ctrl+C 시 안전 중단.
  빠르게 넘기면 정보 패널이 아예 안 그려지는 경우가 있다(사용자 관찰) → 5초 안에 안 나오면
  새로고침으로 같은 사진을 재요청, 최대 3회. 그래도 실패하면 저장하지 않고 넘어가 다음 실행 때 재시도.
  끝 판단: 마지막 사진에서는 `[aria-label="다음 사진 보기"]` 가 숨겨진다(실측). 3초 안에 안 보이면 종료.
  버튼은 있는데 → 키로 10초간 안 넘어가면 경고 후 멈춤. (한국어 UI 기준 라벨)
- `src/db.ts`, `src/report.ts` — 저장과 CSV 출력.
- `scripts/chrome.ts`, `scripts/reset.ts` — Chrome 실행, DB/CSV 삭제 (OS 공용).

## 확인된 사실 (2026-10-02 실측)

- "세부정보" 기준 추출은 실제 DOM 에서 동작한다. 날짜 / 시간 / `GMT+09:00` 이 각각 별도 줄로 나온다.
- 날짜 줄은 "2019년 4월 27일", 올해 사진은 연도 없이 "10월 1일" → `dateKey()` 가 올해로 보정.
  → 방향은 최신 → 과거 순이라 `--until` 은 처음 만나는 과거 사진에서 멈추면 된다.
- 시작 사진 `AF1QipOLqHSbmnuo5aUr4c5xu86wHxkdWUvMLVspKBGx` 부터 6장 중
  `20190427_171007-PANO.jpg`(파노라마, 5319×1675)가 문구 없음 → 일치. 이 사진은 "저장용량 절약" 화질 줄도 없었다.

## 남은 일 / 미확인

- "백업됨(1.2MB)" 형태의 실제 표기는 아직 못 봤다 (`backupSize` 파싱은 추정).
- 동영상, 공유 앨범 사진 등 패널 구성이 다른 경우 확인 필요.
