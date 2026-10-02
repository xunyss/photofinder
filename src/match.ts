import type { PhotoInfo } from './extract.ts';

/** 스토리지를 차지하지 않는 사진의 "백업됨" 아래에 붙는 문구 */
const FREE_NOTICE = '계정 스토리지의 공간을 차지하지 않습니다';

/**
 * 찾고 싶은 사진의 조건: 위 문구가 없는 사진 (= 계정 스토리지를 차지하는 사진).
 * 줄바꿈/공백 차이에 흔들리지 않도록 공백을 지우고 비교한다.
 */
export function isMatch(info: PhotoInfo): boolean {
  const strip = (s: string) => s.replace(/\s+/g, '');
  return !strip(info.rawText).includes(strip(FREE_NOTICE));
}
