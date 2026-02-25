import { FastifyInstance } from 'fastify'
import { db } from '../db'
import { requireAdmin } from './auth'

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
  message: string
  category: string | null
  status: SuggestionStatus
  isRead: number
  isVisible: number
  adminComment: string | null
  createdAt: string
  updatedAt: string
}

function toPublicDto(row: SuggestionRow) {
  return {
    id: row.id,
    message: row.message,
    category: row.category,
    status: row.status,
    isRead: !!row.isRead,
    adminComment: row.adminComment,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function toAdminDto(row: SuggestionRow) {
  return {
    id: row.id,
    message: row.message,
    category: row.category,
    status: row.status,
    isRead: !!row.isRead,
    isVisible: !!row.isVisible,
    adminComment: row.adminComment,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export default async function suggestionsRoutes(fastify: FastifyInstance) {
  fastify.get('/api/suggestions', async (_req, reply) => {
    const rows = db
      .prepare(
        `SELECT id, message, category, status, isRead, isVisible, adminComment, createdAt, updatedAt
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
    reply.send(rows.map(toPublicDto))
  })

  fastify.post('/api/suggestions', async (req, reply) => {
    const body = (req.body || {}) as { message?: string; category?: string }
    const message = (body.message || '').trim()
    const categoryRaw = (body.category || '').trim()
    if (!message) {
      return reply.status(400).send({ error: 'Message is required' })
    }
    if (message.length > 4000) {
      return reply.status(400).send({ error: 'Message is too long (max 4000 chars)' })
    }

    const now = new Date().toISOString()
    const info = db
      .prepare(
        `INSERT INTO suggestions (message, category, status, isRead, isVisible, adminComment, createdAt, updatedAt)
         VALUES (?, ?, 'NEW', 0, 0, NULL, ?, ?)`
      )
      .run(message, categoryRaw || null, now, now)

    reply.send({
      queued: true,
      id: Number(info.lastInsertRowid),
    })
  })

  fastify.get('/api/suggestions/all', { preHandler: requireAdmin }, async (_req, reply) => {
    const rows = db
      .prepare(
        `SELECT id, message, category, status, isRead, isVisible, adminComment, createdAt, updatedAt
         FROM suggestions
         ORDER BY createdAt DESC`
      )
      .all() as SuggestionRow[]
    reply.send(rows.map(toAdminDto))
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
    }
    const isValidStatus =
      typeof body.status === 'string' &&
      SUGGESTION_STATUSES.includes(body.status as SuggestionStatus)
    if (
      typeof body.isVisible !== 'boolean' &&
      typeof body.isRead !== 'boolean' &&
      typeof body.adminComment !== 'string' &&
      body.adminComment !== null &&
      !isValidStatus
    ) {
      return reply.status(400).send({ error: 'Expected isVisible and/or isRead and/or adminComment and/or status' })
    }

    const existing = db
      .prepare(
        `SELECT id, message, category, status, isRead, isVisible, adminComment, createdAt, updatedAt
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
    const nextStatus = isValidStatus
      ? (body.status as SuggestionStatus)
      : existing.status
    const now = new Date().toISOString()

    db.prepare(
      `UPDATE suggestions
       SET isVisible = ?, isRead = ?, adminComment = ?, status = ?, updatedAt = ?
       WHERE id = ?`
    ).run(nextVisible ? 1 : 0, nextRead ? 1 : 0, nextComment, nextStatus, now, id)

    const updated = db
      .prepare(
        `SELECT id, message, category, status, isRead, isVisible, adminComment, createdAt, updatedAt
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
