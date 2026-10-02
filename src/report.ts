import { writeFileSync } from 'node:fs';
import { openDb } from './db.ts';
import { REPORT_PATH } from './report-path.ts';

const cols = ['filename', 'date', 'time', 'url'] as const;

const store = openDb();
const rows = store.matched();
store.close();

const esc = (v: unknown) => `"${String(v ?? '').replaceAll('"', '""')}"`;
const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
writeFileSync(REPORT_PATH, '﻿' + csv); // BOM: 엑셀에서 한글 깨짐 방지

console.log(`${rows.length}장 → ${REPORT_PATH}`);
