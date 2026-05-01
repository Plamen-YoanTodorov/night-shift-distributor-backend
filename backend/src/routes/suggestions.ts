import { FastifyInstance } from 'fastify'
import fastifyMultipart from '@fastify/multipart'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { db, suggestionMediaDir } from '../db'
import { requireAdmin, verifyToken } from './auth'

const SUGGESTION_STATUSES = [
  'NEW',
  'NEEDS_INFO',
  'ACKNOWLEDGED',
  'ACCEPTED',
  'IN_PROGRESS',
  'ON_HOLD',
  'BLOCKED',
  'DONE',
  'OUT_OF_SCOPE',
] as const
type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number]

type SuggestionRow = {
  id: number
  title: string | null
  message: string
  category: string | null
  status: SuggestionStatus
  isRead: number
  isVisible: number
  adminComment: string | null
  internalNote: string | null
  createdAt: string
  updatedAt: string
}

type SuggestionAttachmentRow = {
  id: number
  suggestionId: number
  originalName: string
  storedName: string
  mimeType: string
  fileSizeBytes: number
  createdAt: string
}

function attachmentUrl(id: number) {
  return `/api/suggestions/attachments/${id}/file`
}

function listAttachmentsForSuggestionIds(ids: number[]) {
  if (!ids.length) return new Map<number, SuggestionAttachmentRow[]>()
  const placeholders = ids.map(() => '?').join(',')
  const rows = db
    .prepare(
      `SELECT id, suggestionId, originalName, storedName, mimeType, fileSizeBytes, createdAt
       FROM suggestion_attachments
       WHERE suggestionId IN (${placeholders})
       ORDER BY id ASC`
    )
    .all(...ids) as SuggestionAttachmentRow[]
  return rows.reduce((map, row) => {
    const existing = map.get(row.suggestionId) || []
    existing.push(row)
    map.set(row.suggestionId, existing)
    return map
  }, new Map<number, SuggestionAttachmentRow[]>())
}

function toAttachmentDto(row: SuggestionAttachmentRow) {
  return {
    id: row.id,
    originalName: row.originalName,
    mimeType: row.mimeType,
    fileSizeBytes: row.fileSizeBytes,
    createdAt: row.createdAt,
    url: attachmentUrl(row.id),
  }
}

function threadStatusFromSuggestionStatus(status: SuggestionStatus) {
  switch (status) {
    case 'ACKNOWLEDGED':
    case 'ACCEPTED':
    case 'ON_HOLD':
      return 'planned'
    case 'IN_PROGRESS':
      return 'in_progress'
    case 'DONE':
      return 'completed'
    case 'BLOCKED':
      return 'blocked'
    case 'OUT_OF_SCOPE':
      return 'answered'
    case 'NEW':
    case 'NEEDS_INFO':
    default:
      return 'under_review'
  }
}

function toPublicDto(row: SuggestionRow, attachments: SuggestionAttachmentRow[] = []) {
  return {
    id: row.id,
    title: row.title,
    message: row.message,
    category: row.category,
    status: row.status,
    isRead: !!row.isRead,
    adminComment: row.adminComment,
    attachments: attachments.map(toAttachmentDto),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function toAdminDto(row: SuggestionRow, attachments: SuggestionAttachmentRow[] = []) {
  return {
    id: row.id,
    title: row.title,
    message: row.message,
    category: row.category,
    status: row.status,
    isRead: !!row.isRead,
    isVisible: !!row.isVisible,
    adminComment: row.adminComment,
    internalNote: row.internalNote,
    attachments: attachments.map(toAttachmentDto),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export default async function suggestionsRoutes(fastify: FastifyInstance) {
  await fastify.register(fastifyMultipart, {
    limits: {
      fileSize: 25 * 1024 * 1024,
      files: 10,
    },
  })

  fastify.get('/api/suggestions', async (_req, reply) => {
    const rows = db
      .prepare(
        `SELECT id, title, message, category, status, isRead, isVisible, adminComment, internalNote, createdAt, updatedAt
         FROM suggestions
         WHERE isVisible = 1
         ORDER BY
           CASE status
             WHEN 'NEW' THEN 0
             WHEN 'NEEDS_INFO' THEN 1
             WHEN 'ACKNOWLEDGED' THEN 2
             WHEN 'ACCEPTED' THEN 3
             WHEN 'IN_PROGRESS' THEN 4
             WHEN 'ON_HOLD' THEN 5
             WHEN 'BLOCKED' THEN 6
             WHEN 'DONE' THEN 7
             WHEN 'OUT_OF_SCOPE' THEN 8
             ELSE 9
           END ASC,
           createdAt DESC`
      )
      .all() as SuggestionRow[]
    const attachments = listAttachmentsForSuggestionIds(rows.map((row) => row.id))
    reply.send(rows.map((row) => toPublicDto(row, attachments.get(row.id))))
  })

  fastify.post('/api/suggestions', async (req, reply) => {
    const body = (req.body || {}) as { title?: string; message?: string; category?: string; isPinned?: boolean }
    const isAdminSubmit = verifyToken(req.headers.authorization) === 'admin'
    const title = (body.title || '').trim()
    const message = (body.message || '').trim()
    const categoryRaw = (body.category || '').trim()
    if (!message) {
      return reply.status(400).send({ error: 'Message is required' })
    }
    if (message.length > 4000) {
      return reply.status(400).send({ error: 'Message is too long (max 4000 chars)' })
    }
    if ((categoryRaw.toLowerCase() === 'news' || body.isPinned) && !isAdminSubmit) {
      return reply.status(401).send({ error: 'Unauthorized' })
    }

    const now = new Date().toISOString()
    const info = db
      .prepare(
        `INSERT INTO suggestions (title, message, category, status, isRead, isVisible, isPinned, adminComment, createdAt, updatedAt)
         VALUES (?, ?, ?, 'NEW', ?, ?, ?, NULL, ?, ?)`
      )
      .run(
        title || null,
        message,
        categoryRaw || null,
        isAdminSubmit ? 1 : 0,
        isAdminSubmit ? 1 : 0,
        isAdminSubmit && body.isPinned ? 1 : 0,
        now,
        now
      )

    reply.send({
      queued: true,
      id: Number(info.lastInsertRowid),
    })
  })

  fastify.post('/api/suggestions/:id/attachments', async (req, reply) => {
    const id = Number((req.params as { id?: string }).id)
    if (!Number.isFinite(id) || id <= 0) {
      return reply.status(400).send({ error: 'Invalid suggestion id' })
    }

    const existing = db.prepare('SELECT id FROM suggestions WHERE id = ?').get(id)
    if (!existing) {
      return reply.status(404).send({ error: 'Suggestion not found' })
    }

    const uploaded: SuggestionAttachmentRow[] = []
    const parts = req.parts()
    for await (const part of parts) {
      // @ts-ignore multipart file parts expose file/filename/mimetype.
      if (!part.file) continue
      // @ts-ignore
      const mimeType = String(part.mimetype || '')
      const chunks: Buffer[] = []
      // @ts-ignore
      for await (const chunk of part.file) chunks.push(chunk as Buffer)
      const buffer = Buffer.concat(chunks)
      const now = new Date().toISOString()
      // @ts-ignore
      const originalName = String(part.filename || 'media')
      const safeOriginal = originalName.replace(/[^a-zA-Z0-9_.-]/g, '_')
      const random = crypto.randomBytes(5).toString('hex')
      const storedName = `${id}_${Date.now()}_${random}__${safeOriginal}`
      fs.writeFileSync(path.join(suggestionMediaDir, storedName), buffer)

      const info = db
        .prepare(
          `INSERT INTO suggestion_attachments (suggestionId, originalName, storedName, mimeType, fileSizeBytes, createdAt)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(id, originalName, storedName, mimeType || 'application/octet-stream', buffer.length, now)

      uploaded.push({
        id: Number(info.lastInsertRowid),
        suggestionId: id,
        originalName,
        storedName,
        mimeType: mimeType || 'application/octet-stream',
        fileSizeBytes: buffer.length,
        createdAt: now,
      })
    }

    if (!uploaded.length) {
      return reply.status(400).send({ error: 'No files uploaded' })
    }

    reply.send({ attachments: uploaded.map(toAttachmentDto) })
  })

  fastify.get('/api/suggestions/attachments/:id/file', async (req, reply) => {
    const id = Number((req.params as { id?: string }).id)
    const row = db
      .prepare('SELECT originalName, storedName, mimeType FROM suggestion_attachments WHERE id = ?')
      .get(id) as { originalName: string; storedName: string; mimeType: string } | undefined
    if (!row) return reply.status(404).send({ error: 'Attachment not found' })

    const filePath = path.join(suggestionMediaDir, row.storedName)
    if (!fs.existsSync(filePath)) return reply.status(404).send({ error: 'File missing' })
    reply.header('Content-Type', row.mimeType)
    reply.header('Content-Disposition', `inline; filename="${row.originalName.replace(/"/g, '')}"`)
    return reply.send(fs.createReadStream(filePath))
  })

  fastify.get('/api/suggestions/all', { preHandler: requireAdmin }, async (_req, reply) => {
    const rows = db
      .prepare(
        `SELECT id, title, message, category, status, isRead, isVisible, adminComment, internalNote, createdAt, updatedAt
         FROM suggestions
         ORDER BY createdAt DESC`
      )
      .all() as SuggestionRow[]
    const attachments = listAttachmentsForSuggestionIds(rows.map((row) => row.id))
    reply.send(rows.map((row) => toAdminDto(row, attachments.get(row.id))))
  })

  fastify.put('/api/suggestions/:id/moderate', { preHandler: requireAdmin }, async (req, reply) => {
    const id = Number((req.params as { id?: string }).id)
    if (!Number.isFinite(id) || id <= 0) {
      return reply.status(400).send({ error: 'Invalid suggestion id' })
    }
    const body = (req.body || {}) as {
      isVisible?: boolean
      adminComment?: string | null
      status?: string
      isRead?: boolean
      internalNote?: string | null
    }
    const isValidStatus =
      typeof body.status === 'string' &&
      SUGGESTION_STATUSES.includes(body.status as SuggestionStatus)
    if (
      typeof body.isVisible !== 'boolean' &&
      typeof body.isRead !== 'boolean' &&
      typeof body.adminComment !== 'string' &&
      body.adminComment !== null &&
      typeof body.internalNote !== 'string' &&
      body.internalNote !== null &&
      !isValidStatus
    ) {
      return reply.status(400).send({ error: 'Expected isVisible and/or isRead and/or adminComment and/or status' })
    }

    const existing = db
      .prepare(
        `SELECT id, title, message, category, status, isRead, isVisible, adminComment, internalNote, createdAt, updatedAt
         FROM suggestions
         WHERE id = ?`
      )
      .get(id) as SuggestionRow | undefined
    if (!existing) {
      return reply.status(404).send({ error: 'Suggestion not found' })
    }

    const nextVisible = typeof body.isVisible === 'boolean' ? body.isVisible : !!existing.isVisible
    const nextRead = typeof body.isRead === 'boolean' ? body.isRead : !!existing.isRead
    const nextCommentRaw =
      typeof body.adminComment === 'string' ? body.adminComment.trim() : body.adminComment === null ? '' : existing.adminComment || ''
    const nextComment = nextCommentRaw ? nextCommentRaw : null
    const nextInternalNoteRaw =
      typeof body.internalNote === 'string' ? body.internalNote.trim() : body.internalNote === null ? '' : existing.internalNote || ''
    const nextInternalNote = nextInternalNoteRaw ? nextInternalNoteRaw : null
    const nextStatus = isValidStatus
      ? (body.status as SuggestionStatus)
      : existing.status
    const now = new Date().toISOString()

    db.prepare(
      `UPDATE suggestions
       SET isVisible = ?, isRead = ?, adminComment = ?, internalNote = ?, status = ?, threadStatus = ?, updatedAt = ?
       WHERE id = ?`
    ).run(nextVisible ? 1 : 0, nextRead ? 1 : 0, nextComment, nextInternalNote, nextStatus, threadStatusFromSuggestionStatus(nextStatus), now, id)

    if (nextComment) {
      db.prepare(
        `INSERT INTO feedback_official_replies (threadId, body, authorName, createdAt, updatedAt)
         VALUES (?, ?, 'Admin', ?, ?)
         ON CONFLICT(threadId) DO UPDATE SET
           body = excluded.body,
           authorName = COALESCE(feedback_official_replies.authorName, excluded.authorName),
           updatedAt = excluded.updatedAt`
      ).run(id, nextComment, now, now)
    } else {
      db.prepare('DELETE FROM feedback_official_replies WHERE threadId = ?').run(id)
    }

    const updated = db
      .prepare(
        `SELECT id, title, message, category, status, isRead, isVisible, adminComment, internalNote, createdAt, updatedAt
         FROM suggestions
         WHERE id = ?`
      )
      .get(id) as SuggestionRow

    reply.send(toAdminDto(updated))
  })

  fastify.delete('/api/suggestions/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const id = Number((req.params as { id?: string }).id)
    if (!Number.isFinite(id) || id <= 0) {
      return reply.status(400).send({ error: 'Invalid suggestion id' })
    }
    const existing = db.prepare('SELECT id FROM suggestions WHERE id = ?').get(id) as { id: number } | undefined
    if (!existing) {
      return reply.status(404).send({ error: 'Suggestion not found' })
    }
    db.prepare('DELETE FROM suggestions WHERE id = ?').run(id)
    reply.send({ ok: true, id })
  })
}
