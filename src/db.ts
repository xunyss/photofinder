import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { PhotoInfo } from './extract.ts';

export const DB_PATH = 'data/photos.db';

export type PhotoRow = PhotoInfo & { id: string; url: string; matched: number; scannedAt: string };

export function openDb(path = DB_PATH) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS photos (
      id          TEXT PRIMARY KEY,
      url         TEXT NOT NULL,
      date        TEXT,
      time        TEXT,
      device      TEXT,
      filename    TEXT,
      dimensions  TEXT,
      backup      TEXT,
      backupSize  TEXT,
      rawText     TEXT NOT NULL,
      matched     INTEGER NOT NULL,
      scannedAt   TEXT NOT NULL
    )
  `);

  const upsert = db.prepare(`
    INSERT INTO photos (id, url, date, time, device, filename, dimensions, backup, backupSize, rawText, matched, scannedAt)
    VALUES (:id, :url, :date, :time, :device, :filename, :dimensions, :backup, :backupSize, :rawText, :matched, :scannedAt)
    ON CONFLICT(id) DO UPDATE SET
      url = excluded.url, date = excluded.date, time = excluded.time, device = excluded.device, filename = excluded.filename,
      dimensions = excluded.dimensions, backup = excluded.backup, backupSize = excluded.backupSize,
      rawText = excluded.rawText, matched = excluded.matched, scannedAt = excluded.scannedAt
  `);
  const get = db.prepare('SELECT * FROM photos WHERE id = ?');

  return {
    db,
    save(row: PhotoRow) {
      upsert.run(row);
    },
    get(id: string) {
      return get.get(id) as PhotoRow | undefined;
    },
    matched() {
      return db.prepare('SELECT * FROM photos WHERE matched = 1 ORDER BY scannedAt').all() as PhotoRow[];
    },
    close() {
      db.close();
    },
  };
}
