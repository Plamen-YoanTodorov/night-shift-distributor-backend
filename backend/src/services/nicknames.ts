import { db } from "../db";

export type NicknameRow = { name: string; nickname: string };

export function getNicknames(): NicknameRow[] {
  const rows = db.prepare("SELECT name, nickname FROM nicknames").all() as NicknameRow[];
  return rows;
}

export function saveNicknames(list: NicknameRow[]) {
  const now = new Date().toISOString();
  const stmt = db.prepare(
    `INSERT INTO nicknames (name, nickname, createdAt)
     VALUES (@name, @nickname, @createdAt)
     ON CONFLICT(name) DO UPDATE SET nickname=excluded.nickname, createdAt=excluded.createdAt`
  );
  const trx = db.transaction((items: NicknameRow[]) => {
    items.forEach((item) => stmt.run({ ...item, createdAt: now }));
  });
  trx(list);
}
