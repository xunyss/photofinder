// 수집 결과(DB, CSV)를 지운다. 다음 scan 때 빈 DB 가 새로 만들어진다.
import { rmSync } from 'node:fs';
import { DB_PATH } from '../src/db.ts';
import { REPORT_PATH } from '../src/report-path.ts';

for (const file of [DB_PATH, REPORT_PATH]) rmSync(file, { force: true });
console.log('DB 와 CSV 를 지웠습니다.');
