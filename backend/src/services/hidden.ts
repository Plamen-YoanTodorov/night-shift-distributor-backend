import { db } from '../db'

export function getHidden(): string[] {
  const rows = db.prepare('SELECT name FROM hidden_workers').all() as { name: string }[]
  return rows.map((r) => r.name)
}

export function saveHidden(names: string[]) {
  const now = new Date().toISOString()
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM hidden_workers').run()
    const insert = db.prepare('INSERT INTO hidden_workers (name, createdAt) VALUES (?, ?)')
    names.forEach((n) => insert.run(n, now))
  })
  tx()
}
