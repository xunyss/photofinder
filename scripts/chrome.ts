// 원격 디버깅 포트를 연 전용 Chrome 을 띄운다. (macOS / Windows / Linux)
// 프로필은 프로젝트 안(.chrome-profile)에 두어 평소 쓰는 Chrome 과 분리한다.
// 최초 1회 이 창에서 구글 계정에 직접 로그인한다.
// Chrome 이 기본 위치에 없으면 CHROME_PATH 환경변수로 실행 파일 경로를 지정한다.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = process.env.CDP_PORT ?? '9222';
const PROFILE = resolve(import.meta.dirname, '..', '.chrome-profile');

function chromeCandidates(): string[] {
  const env = process.env;
  switch (process.platform) {
    case 'darwin':
      return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
    case 'win32':
      return [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA]
        .filter((dir): dir is string => !!dir)
        .map((dir) => join(dir, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    default:
      return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'];
  }
}

const chrome = [process.env.CHROME_PATH, ...chromeCandidates()].find((p) => p && existsSync(p));
if (!chrome) {
  console.error('Chrome 실행 파일을 찾지 못했습니다. CHROME_PATH 환경변수로 경로를 지정하세요.');
  console.error('찾아본 위치:\n  ' + chromeCandidates().join('\n  '));
  process.exit(1);
}

console.log(`Chrome 실행: ${chrome}\n디버깅 포트: ${PORT}\n프로필: ${PROFILE}`);
spawn(
  chrome,
  [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--no-first-run',
    '--no-default-browser-check',
    'https://photos.google.com/',
  ],
  { stdio: 'ignore', detached: true },
).unref();
