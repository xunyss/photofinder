import { chromium, type Page } from 'playwright-core';
import { parseArgs } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import { openDb } from './db.ts';
import { dateKey, isInfoPanelOpen, parseInfo, photoIdFromUrl, readInfoPanelText } from './extract.ts';
import { isMatch } from './match.ts';

const { values: opts } = parseArgs({
  options: {
    port: { type: 'string', default: process.env.CDP_PORT ?? '9222' },
    limit: { type: 'string', default: '0' }, // 0 = 끝까지
    delay: { type: 'string', default: '400' }, // 사진 사이 기본 대기(ms). 여기에 랜덤 지터가 더해진다
    rescan: { type: 'boolean', default: false }, // DB 에 있는 사진도 다시 읽는다
    until: { type: 'string' }, // yyyymmdd. 이 날짜보다 과거 사진이 나오면 멈춘다
  },
});
const limit = Number(opts.limit);
const delay = Number(opts.delay);
if (opts.until !== undefined && !/^\d{8}$/.test(opts.until)) {
  console.error(`--until 은 yyyymmdd 형식이어야 합니다 (예: 20261001). 받은 값: ${opts.until}`);
  process.exit(1);
}
const until = opts.until ? Number(opts.until) : null;

/** --until 보다 과거 사진이면 true. 날짜를 못 읽으면 멈추지 않는다 */
function isBeforeUntil(date: string | null): boolean {
  const key = dateKey(date);
  return until !== null && key !== null && key < until;
}

async function findPhotoPage(port: string): Promise<Page> {
  const browser = await chromium.connectOverCDP(`http://localhost:${port}`);
  const pages = browser.contexts().flatMap((c) => c.pages());
  const page = pages.find((p) => photoIdFromUrl(p.url()) && p.url().includes('photos.google.com'));
  if (!page) {
    throw new Error('사진 상세 화면(photos.google.com/photo/...)이 열린 탭이 없습니다. 시작할 사진을 열어 두세요.');
  }
  await page.bringToFront();
  return page;
}

async function ensureInfoPanel(page: Page) {
  if (await isInfoPanelOpen(page)) return;
  await page.keyboard.press('i');
  await page.waitForFunction(() => document.body.innerText.includes('세부정보'), null, { timeout: 5000 });
}

const PANEL_TIMEOUT = 5000;
const MAX_RETRIES = 3;

/** 정보 패널이 현재 사진 내용으로 채워질 때까지 기다린다 */
async function waitForInfo(page: Page, timeoutMs = PANEL_TIMEOUT): Promise<string | null> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const text = await readInfoPanelText(page);
    if (text && /백업/.test(text)) return text;
    await sleep(150);
  }
  return readInfoPanelText(page);
}

/**
 * 빠르게 넘기면 정보 패널이 아예 그려지지 않는 경우가 있다.
 * 그럴 땐 페이지를 새로고침해 같은 사진을 다시 요청하고, 패널이 닫혀 있으면 연다.
 * 끝까지 실패하면 null — DB 에 저장하지 않으므로 다음 실행 때 다시 시도된다.
 */
async function readInfoWithRetry(page: Page, url: string): Promise<string | null> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      console.warn(`[retry ${attempt}/${MAX_RETRIES}] 정보 패널이 그려지지 않음 → 새로고침: ${url}`);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await sleep(1000 * attempt);
      // 열려 있는데 i 를 누르면 닫히므로, 패널이 아예 없을 때만 누른다
      if ((await waitForInfo(page, 3000)) === null) await page.keyboard.press('i');
    }
    const text = await waitForInfo(page);
    if (text && /백업/.test(text)) return text;
  }
  return null;
}

/**
 * 다음 사진이 있는지. 마지막 사진에서는 "다음 사진 보기" 버튼이 숨겨진다.
 * 사진을 막 넘긴 직후엔 버튼이 아직 안 그려졌을 수 있어 잠시 기다려 본다.
 */
async function hasNext(page: Page, timeoutMs = 3000): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const visible = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('[aria-label="다음 사진 보기"]')].some((el) => el.checkVisibility()),
    );
    if (visible) return true;
    await sleep(200);
  }
  return false;
}

/** 다음 사진으로 넘어간다. URL 이 안 바뀌면 false */
async function goNext(page: Page, currentId: string): Promise<boolean> {
  await page.keyboard.press('ArrowRight');
  try {
    await page.waitForURL((u) => photoIdFromUrl(u.toString()) !== currentId, { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const store = openDb();
  const page = await findPhotoPage(opts.port!);
  await ensureInfoPanel(page);

  let seen = 0;
  let found = 0;
  let skipped = 0;
  let cachedCount = 0;
  let stop = false;
  process.on('SIGINT', () => {
    console.log('\n중단 요청 — 현재 사진까지 저장하고 멈춥니다.');
    stop = true;
  });

  while (!stop) {
    const url = page.url();
    const id = photoIdFromUrl(url);
    if (!id) throw new Error(`사진 URL 이 아닙니다: ${url}`);

    const cached = opts.rescan ? undefined : store.get(id);
    if (cached) {
      if (isBeforeUntil(cached.date)) {
        console.log(`--until ${until} 보다 과거 사진(${cached.date})이 나와 멈춥니다.`);
        break;
      }
      // 이미 읽은 사진은 패널을 다시 읽지 않고 저장된 결과를 쓴다
      cachedCount++;
      if (cached.matched) {
        found++;
        console.log(`[match] ${cached.date} ${cached.time}  ${cached.filename ?? id}  ${url}  (이전 기록)`);
      }
    } else {
      const raw = await readInfoWithRetry(page, url);
      if (!raw) {
        skipped++;
        console.warn(`[skip] ${MAX_RETRIES}번 재시도해도 정보 패널을 읽지 못함 (다음 실행 때 다시 시도): ${url}`);
      } else {
        let info = parseInfo(raw);
        if (isBeforeUntil(info.date)) {
          console.log(`--until ${until} 보다 과거 사진(${info.date})이 나와 멈춥니다.`);
          break;
        }
        let matched = isMatch(info);
        if (matched) {
          // 패널 아래쪽 문구가 늦게 그려졌을 수 있으니 잠시 뒤 한 번 더 읽어 확인한다
          await sleep(1000);
          info = parseInfo((await readInfoPanelText(page)) ?? raw);
          matched = isMatch(info);
        }
        store.save({ ...info, id, url, matched: matched ? 1 : 0, scannedAt: new Date().toISOString() });
        if (matched) {
          found++;
          console.log(`[match] ${info.date} ${info.time}  ${info.filename ?? id}  ${url}`);
        }
      }
    }

    seen++;
    if (seen % 50 === 0) console.log(`… ${seen}장 확인, ${found}장 일치`);
    if (limit && seen >= limit) break;
    if (!(await hasNext(page))) {
      console.log('마지막 사진입니다.');
      break;
    }
    if (!(await goNext(page, id))) {
      console.warn(`다음 사진 버튼은 있는데 10초 동안 넘어가지 않아 멈춥니다. 다시 실행하면 이어서 진행합니다: ${url}`);
      break;
    }
    await sleep(delay + Math.random() * delay);
  }

  console.log(
    `완료: ${seen}장 확인 (새로 읽음 ${seen - cachedCount - skipped}, 이전 기록 ${cachedCount}, 실패 ${skipped}), ${found}장 일치`,
  );
  store.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
