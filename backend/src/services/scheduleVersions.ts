import { db } from '../db'

type VersionRow = {
  id: number
  name: string
  createdAt: string
  starred: number
  distributions: string
  schedules: string
}

function pad(value: number) {
  return String(value).padStart(2, '0')
}

function defaultVersionName(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
}

export function createScheduleVersion(name?: string) {
  const nowIso = new Date().toISOString()
  const finalName = (name || '').trim() || defaultVersionName()

  const distributions = db
    .prepare(
      `SELECT dataset_id, date, position, worker, role, isManual, createdAt
       FROM distributions
       ORDER BY date, position, worker`
    )
    .all()
  const schedules = db
    .prepare(
      `SELECT position, month, payload, meta, uploadedAt, parserVersion
       FROM schedules
       ORDER BY month, position`
    )
    .all()

  const insert = db.prepare(
    `INSERT INTO schedule_versions (name, createdAt, starred, distributions, schedules)
     VALUES (?, ?, 0, ?, ?)`
  )
  const pruneUnstarred = db.prepare(
    `DELETE FROM schedule_versions
     WHERE COALESCE(starred, 0) = 0
       AND id NOT IN (
       SELECT id
       FROM schedule_versions
       WHERE COALESCE(starred, 0) = 0
       ORDER BY createdAt DESC, id DESC
       LIMIT 10
     )`
  )

  const tx = db.transaction(() => {
    const info = insert.run(
      finalName,
      nowIso,
      JSON.stringify(distributions),
      JSON.stringify(schedules)
    )
    pruneUnstarred.run()
    return Number(info.lastInsertRowid)
  })

  const id = tx()
  return { id, name: finalName, createdAt: nowIso }
}

export function listScheduleVersions(limit = 10) {
  const safeLimit = Math.max(1, Math.min(50, Number(limit) || 10))
  const starredRows = db
    .prepare(
      `SELECT id, name, createdAt, 1 AS starred
       FROM schedule_versions
       WHERE COALESCE(starred, 0) = 1
       ORDER BY createdAt DESC, id DESC`
    )
    .all()
  const unstarredRows = db
    .prepare(
      `SELECT id, name, createdAt, 0 AS starred
       FROM schedule_versions
       WHERE COALESCE(starred, 0) = 0
       ORDER BY createdAt DESC, id DESC
       LIMIT ?`
    )
    .all(safeLimit)
  return [...starredRows, ...unstarredRows]
    .map((r: any) => ({
      id: Number(r.id),
      name: String(r.name),
      createdAt: String(r.createdAt),
      starred: !!r.starred,
    })) as Array<{ id: number; name: string; createdAt: string; starred: boolean }>
}

export function setScheduleVersionStarred(id: number, starred: boolean) {
  const update = db.prepare('UPDATE schedule_versions SET starred = ? WHERE id = ?')
  const pruneUnstarred = db.prepare(
    `DELETE FROM schedule_versions
     WHERE COALESCE(starred, 0) = 0
       AND id NOT IN (
       SELECT id
       FROM schedule_versions
       WHERE COALESCE(starred, 0) = 0
       ORDER BY createdAt DESC, id DESC
       LIMIT 10
     )`
  )

  const tx = db.transaction(() => {
    const info = update.run(starred ? 1 : 0, id)
    if (!info.changes) return false
    pruneUnstarred.run()
    return true
  })

  return tx()
}

export function restoreScheduleVersion(id: number) {
  const row = db
    .prepare(
      'SELECT id, name, createdAt, COALESCE(starred, 0) AS starred, distributions, schedules FROM schedule_versions WHERE id = ?'
    )
    .get(id) as VersionRow | undefined
  if (!row) return null

  let distributions: any[] = []
  let schedules: any[] = []
  try {
    distributions = JSON.parse(row.distributions || '[]')
    schedules = JSON.parse(row.schedules || '[]')
  } catch (err) {
    throw new Error(`Corrupt schedule version payload: ${(err as Error).message}`)
  }
  if (!Array.isArray(distributions) || !Array.isArray(schedules)) {
    throw new Error('Corrupt schedule version payload structure')
  }

  const now = new Date().toISOString()
  const insertDefaultDataset = db.prepare(
    'INSERT OR IGNORE INTO datasets (id, name, createdAt) VALUES (1, ?, ?)'
  )
  const deleteDistributions = db.prepare('DELETE FROM distributions')
  const insertDistribution = db.prepare(
    `INSERT INTO distributions (dataset_id, date, position, worker, role, isManual, createdAt)
     VALUES (@dataset_id, @date, @position, @worker, @role, @isManual, @createdAt)`
  )
  const deleteSchedules = db.prepare('DELETE FROM schedules')
  const insertSchedule = db.prepare(
    `INSERT INTO schedules (position, month, payload, meta, uploadedAt, parserVersion)
     VALUES (@position, @month, @payload, @meta, @uploadedAt, @parserVersion)`
  )

  const tx = db.transaction(() => {
    insertDefaultDataset.run('default', now)
    deleteDistributions.run()
    distributions.forEach((dist) => {
      insertDistribution.run({
        dataset_id: Number(dist.dataset_id ?? dist.datasetId ?? 1),
        date: dist.date,
        position: dist.position,
        worker: dist.worker,
        role: dist.role,
        isManual: dist.isManual ? 1 : 0,
        createdAt: dist.createdAt || now,
      })
    })

    deleteSchedules.run()
    schedules.forEach((schedule) => {
      insertSchedule.run({
        position: schedule.position,
        month: schedule.month,
        payload: schedule.payload,
        meta: schedule.meta ?? null,
        uploadedAt: schedule.uploadedAt || now,
        parserVersion: schedule.parserVersion ?? null,
      })
    })
  })

  tx()
  return { id: row.id, name: row.name, createdAt: row.createdAt, starred: !!row.starred }
}
