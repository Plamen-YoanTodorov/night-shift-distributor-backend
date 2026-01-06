import { db } from "../db";
import { computeMonth, parserVersion } from "../lib/scheduleParser";

type SavedSchedule = {
  id: number;
  position: string;
  month: string;
  payload: string;
  meta: string | null;
  uploadedAt: string;
  parserVersion: string | null;
};

export function saveParsedSchedule(
  position: string,
  month: string,
  payload: any,
  meta: Record<string, any>
) {
  const now = new Date().toISOString();
  const stmt = db.prepare(
    `INSERT INTO schedules (position, month, payload, meta, uploadedAt, parserVersion)
     VALUES (@position, @month, @payload, @meta, @uploadedAt, @parserVersion)
     ON CONFLICT(position, month) DO UPDATE SET payload=excluded.payload, meta=excluded.meta, uploadedAt=excluded.uploadedAt, parserVersion=excluded.parserVersion`
  );
  stmt.run({
    position,
    month,
    payload: JSON.stringify(payload),
    meta: JSON.stringify(meta),
    uploadedAt: now,
    parserVersion: parserVersion(),
  });
}

export function getSchedule(position: string, month: string) {
  const row = db
    .prepare("SELECT * FROM schedules WHERE position = ? AND month = ?")
    .get(position, month) as SavedSchedule | undefined;
  if (!row) return null;
  return {
    position: row.position,
    month: row.month,
    payload: JSON.parse(row.payload),
    meta: row.meta ? JSON.parse(row.meta) : null,
    uploadedAt: row.uploadedAt,
    parserVersion: row.parserVersion,
  };
}

export function listSchedules() {
  const rows = db
    .prepare("SELECT * FROM schedules ORDER BY uploadedAt DESC")
    .all() as SavedSchedule[];
  return rows.map((r) => ({
    position: r.position,
    month: r.month,
    payload: JSON.parse(r.payload),
    meta: r.meta ? JSON.parse(r.meta) : null,
    uploadedAt: r.uploadedAt,
    parserVersion: r.parserVersion,
  }));
}

export function deleteAllSchedules() {
  db.prepare("DELETE FROM schedules").run();
}

export function deleteScheduleMonth(month: string) {
  db.prepare("DELETE FROM schedules WHERE month = ?").run(month);
}
