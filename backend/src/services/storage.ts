import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { uploadsDir } from '../db'
import type { UploadRecord } from '../types'
import { db } from '../db'

function removeUploadFile(storedName: string) {
  const storedPath = path.join(uploadsDir, storedName)
  if (fs.existsSync(storedPath)) {
    try {
      fs.unlinkSync(storedPath)
    } catch (e) {
      /* ignore */
    }
  }
}

export function saveUploadedFile(buffer: Buffer, originalName: string): UploadRecord {
  const existing = db
    .prepare('SELECT id, storedName FROM uploads WHERE originalName = ? ORDER BY createdAt DESC LIMIT 1')
    .get(originalName) as { id: number; storedName: string } | undefined

  const ts = new Date()
  const stamp = ts.toISOString().replace(/[-:T]/g, '').slice(0, 15)
  const random = crypto.randomBytes(4).toString('hex')
  const safeOriginal = originalName.replace(/[^a-zA-Z0-9_.-]/g, '_')
  const storedName = `${stamp}_${random}__${safeOriginal}`
  const storedPath = path.join(uploadsDir, storedName)
  fs.writeFileSync(storedPath, buffer)

  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex')
  const fileSizeBytes = buffer.length
  const createdAt = new Date().toISOString()

  const stmt = db.prepare(
    `INSERT INTO uploads (originalName, storedName, fileSizeBytes, sha256, createdAt)
     VALUES (@originalName, @storedName, @fileSizeBytes, @sha256, @createdAt)`
  )
  const info = stmt.run({ originalName, storedName, fileSizeBytes, sha256, createdAt })

  if (existing) {
    db.prepare('DELETE FROM uploads WHERE id = ?').run(existing.id)
    removeUploadFile(existing.storedName)
  }

  return {
    id: Number(info.lastInsertRowid),
    originalName,
    storedName,
    fileSizeBytes,
    sha256,
    createdAt,
  }
}

export function getUploadById(id: number): UploadRecord | undefined {
  const row = db
    .prepare('SELECT * FROM uploads WHERE id = ?')
    .get(id) as UploadRecord | undefined
  return row
}

export function listUploads(limit = 20): UploadRecord[] {
  const capped = Math.min(Math.max(limit, 1), 200)
  return db
    .prepare('SELECT * FROM uploads ORDER BY createdAt DESC LIMIT ?')
    .all(capped) as UploadRecord[]
}

export function deleteUpload(id: number): boolean {
  const row = db.prepare('SELECT storedName FROM uploads WHERE id = ?').get(id) as
    | { storedName: string }
    | undefined
  if (!row) return false
  db.prepare('DELETE FROM uploads WHERE id = ?').run(id)
  removeUploadFile(row.storedName)
  return true
}
