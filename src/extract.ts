import type { Page } from 'playwright-core';

export type PhotoInfo = {
  /** 예: "2019년 4월 27일" (올해 사진은 "10월 1일") */
  date: string | null;
  /** 예: "토 오후 5:10 GMT+09:00" */
  time: string | null;
  device: string | null;
  filename: string | null;
  dimensions: string | null;
  /** "백업됨" 줄 원문. 예: "백업됨", "백업됨(1.2MB)" */
  backup: string | null;
  /** "백업됨(...)" 괄호 안의 값. 없으면 null */
  backupSize: string | null;
  /** 정보 패널 전체 텍스트. 파싱 규칙을 나중에 고칠 때 재처리용으로 보관한다 */
  rawText: string;
};

/** URL 에서 사진 ID 를 뽑는다. /photo/<ID> 와 /album/<A>/photo/<ID> 둘 다 처리 */
export function photoIdFromUrl(url: string): string | null {
  return url.match(/\/photo\/([^/?#]+)/)?.[1] ?? null;
}

/**
 * 화면에 보이는 정보 패널의 텍스트를 가져온다.
 * Google Photos 는 앞뒤 사진의 패널을 DOM 에 미리 만들어 두므로, 보이는 것만 골라야 한다.
 * 클래스명은 난독화되어 자주 바뀌므로 "세부정보" 라는 텍스트를 기준점으로 삼는다.
 */
export async function readInfoPanelText(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const anchors = [...document.querySelectorAll<HTMLElement>('*')].filter(
      (el) => el.childElementCount === 0 && el.textContent?.trim() === '세부정보' && el.checkVisibility(),
    );
    for (const anchor of anchors) {
      // 세부정보 항목들을 모두 품는 조상까지 올라간다
      let el: HTMLElement | null = anchor;
      while (el && !/백업|업로드됨/.test(el.innerText)) el = el.parentElement;
      if (el) return el.innerText;
    }
    return null;
  });
}

export async function isInfoPanelOpen(page: Page): Promise<boolean> {
  return (await readInfoPanelText(page)) !== null;
}

/** 패널 텍스트를 필드로 나눈다. 실제 화면을 보며 계속 다듬을 부분 */
export function parseInfo(rawText: string): PhotoInfo {
  const lines = rawText.split('\n').map((l) => l.trim()).filter(Boolean);
  const find = (re: RegExp) => lines.find((l) => re.test(l)) ?? null;

  const backup = find(/^백업/);
  const backupSize = backup?.match(/\(([^)]+)\)/)?.[1] ?? null;
  const filename = find(/\.(jpe?g|png|heic|heif|gif|webp|mp4|mov|dng|raw)$/i);
  const dimensions = find(/\d+\s*[x×]\s*\d+/);
  const dateIdx = lines.findIndex((l) => /^\d{4}년|^\d{1,2}월 \d{1,2}일/.test(l));
  const date = dateIdx >= 0 ? lines[dateIdx] : null;
  // 날짜 다음 줄이 시간, 그 다음 줄이 따로 떨어진 "GMT+09:00" 일 수 있다
  const timeParts = dateIdx >= 0 ? lines.slice(dateIdx + 1, dateIdx + 3) : [];
  const time = timeParts.length ? (/^GMT/.test(timeParts[1] ?? '') ? timeParts.join(' ') : timeParts[0]) : null;
  const device = find(/ƒ\/|ISO\d+/) ? lines[lines.findIndex((l) => /ƒ\/|ISO\d+/.test(l)) - 1] ?? null : null;

  return { date, time, device, filename, dimensions, backup, backupSize, rawText };
}
