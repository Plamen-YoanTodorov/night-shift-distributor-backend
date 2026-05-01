import { FastifyInstance } from 'fastify'
import { db } from '../db'
import { getAccountFromAuthHeader, requireAdmin } from './auth'

const THREAD_STATUSES = [
  'under_review',
  'planned',
  'in_progress',
  'completed',
  'blocked',
  'answered',
] as const
type ThreadStatus = (typeof THREAD_STATUSES)[number]

type ThreadRow = {
  id: number
  title: string | null
  message: string
  category: string | null
  status: string
  threadStatus: ThreadStatus
  isVisible: number
  isPinned: number
  isLocked: number
  createdAt: string
  updatedAt: string
}

type OfficialReplyRow = {
  id: number
  threadId: number
  body: string
  authorId: number | null
  authorName: string | null
  createdAt: string
  updatedAt: string
}

type CommentRow = {
  id: number
  threadId: number
  body: string
  authorId: number | null
  authorName: string | null
  isAdmin: number
  createdAt: string
  updatedAt: string | null
  deletedAt: string | null
}

type AttachmentRow = {
  id: number
  suggestionId: number
  originalName: string
  mimeType: string
  fileSizeBytes: number
  createdAt: string
}

function legacyStatusFromThreadStatus(status: ThreadStatus) {
  switch (status) {
    case 'planned':
      return 'ACCEPTED'
    case 'in_progress':
      return 'IN_PROGRESS'
    case 'completed':
      return 'DONE'
    case 'blocked':
      return 'BLOCKED'
    case 'answered':
      return 'OUT_OF_SCOPE'
    case 'under_review':
    default:
      return 'NEW'
  }
}

function normalizeCategory(category: string | null) {
  switch ((category || '').trim().toLowerCase()) {
    case 'suggest':
    case 'suggestion':
      return 'suggestion'
    case 'problem':
    case 'bug':
      return 'problem'
    case 'question':
      return 'question'
    case 'news':
      return 'news'
    default:
      return 'other'
  }
}

function generatedTitle(message: string) {
  const normalized = message.replace(/\s+/g, ' ').trim()
  if (normalized.length <= 72) return normalized
  return `${normalized.slice(0, 69).trimEnd()}...`
}

function toOfficialReplyDto(row?: OfficialReplyRow | null) {
  if (!row) return undefined
  return {
    id: row.id,
    threadId: row.threadId,
    body: row.body,
    authorId: row.authorId,
    authorName: row.authorName,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function toCommentDto(row: CommentRow) {
  return {
    id: row.id,
    threadId: row.threadId,
    body: row.body,
    authorId: row.authorId,
    authorName: row.authorName,
    isAdmin: !!row.isAdmin,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  }
}

function toAttachmentDto(row: AttachmentRow) {
  return {
    id: row.id,
    originalName: row.originalName,
    mimeType: row.mimeType,
    fileSizeBytes: row.fileSizeBytes,
    createdAt: row.createdAt,
    url: `/api/suggestions/attachments/${row.id}/file`,
  }
}

function getAttachments(threadId: number) {
  return db
    .prepare(
      `SELECT id, suggestionId, originalName, mimeType, fileSizeBytes, createdAt
         FROM suggestion_attachments
        WHERE suggestionId = ?
        ORDER BY id ASC`
    )
    .all(threadId) as AttachmentRow[]
}

function latestIso(values: Array<string | null | undefined>) {
  const sorted = values.filter(Boolean).sort()
  return sorted[sorted.length - 1] || new Date(0).toISOString()
}

function getThread(id: number, publicOnly: boolean) {
  const where = publicOnly ? 'WHERE id = ? AND isVisible = 1' : 'WHERE id = ?'
  return db
    .prepare(
      `SELECT id, title, message, category, status, threadStatus, isVisible, isPinned, isLocked, createdAt, updatedAt
         FROM suggestions
        ${where}`
    )
    .get(id) as ThreadRow | undefined
}

function getOfficialReply(threadId: number) {
  return db
    .prepare(
      `SELECT id, threadId, body, authorId, authorName, createdAt, updatedAt
         FROM feedback_official_replies
        WHERE threadId = ?`
    )
    .get(threadId) as OfficialReplyRow | undefined
}

function getActiveComments(threadId: number) {
  return db
    .prepare(
      `SELECT id, threadId, body, authorId, authorName, isAdmin, createdAt, updatedAt, deletedAt
         FROM feedback_comments
        WHERE threadId = ? AND deletedAt IS NULL
        ORDER BY createdAt ASC, id ASC`
    )
    .all(threadId) as CommentRow[]
}

function getVoteCount(threadId: number) {
  const row = db
    .prepare('SELECT COALESCE(SUM(vote), 0) AS score FROM feedback_thread_votes WHERE threadId = ?')
    .get(threadId) as { score: number } | undefined
  return Number(row?.score || 0)
}

function toThreadDto(row: ThreadRow, options: { includeComments: boolean }) {
  const officialReply = getOfficialReply(row.id)
  const comments = options.includeComments ? getActiveComments(row.id) : []
  const attachments = getAttachments(row.id)
  const commentStats = db
    .prepare(
      `SELECT COUNT(*) AS count, MAX(COALESCE(updatedAt, createdAt)) AS latest
         FROM feedback_comments
        WHERE threadId = ? AND deletedAt IS NULL`
    )
    .get(row.id) as { count: number; latest: string | null }
  const latestActivityAt = latestIso([
    row.updatedAt,
    officialReply?.updatedAt,
    commentStats.latest,
  ])

  return {
    id: row.id,
    title: row.title || generatedTitle(row.message),
    category: normalizeCategory(row.category),
    status: row.threadStatus,
    originalMessage: row.message,
    attachments: attachments.map(toAttachmentDto),
    officialReply: toOfficialReplyDto(officialReply),
    comments: comments.map(toCommentDto),
    commentCount: Number(commentStats.count || 0),
    upvoteCount: getVoteCount(row.id),
    latestActivityAt,
    isPinned: !!row.isPinned,
    isLocked: !!row.isLocked,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function parseThreadId(raw?: string) {
  const id = Number(raw)
  return Number.isInteger(id) && id > 0 ? id : null
}

function getAuthor(header?: string) {
  const account = getAccountFromAuthHeader(header)
  if (!account) {
    return { authorId: null, authorName: null, isAdmin: false }
  }
  return {
    authorId: account.id,
    authorName: account.staffName || (account.role === 'viewer' ? null : account.username),
    isAdmin: account.role === 'admin',
  }
}

export default async function feedbackRoutes(fastify: FastifyInstance) {
  fastify.get('/api/feedback/threads', async (_req, reply) => {
    const rows = db
      .prepare(
        `SELECT id, title, message, category, status, threadStatus, isVisible, isPinned, isLocked, createdAt, updatedAt
           FROM suggestions
          WHERE isVisible = 1
          ORDER BY isPinned DESC, updatedAt DESC, createdAt DESC`
      )
      .all() as ThreadRow[]
    reply.send(rows.map((row) => toThreadDto(row, { includeComments: false })))
  })

  fastify.get('/api/feedback/threads/:id', async (req, reply) => {
    const id = parseThreadId((req.params as { id?: string }).id)
    if (!id) return reply.status(400).send({ error: 'Invalid thread id' })

    const row = getThread(id, true)
    if (!row) return reply.status(404).send({ error: 'Thread not found' })

    reply.send(toThreadDto(row, { includeComments: true }))
  })

  fastify.post('/api/feedback/threads/:id/comments', async (req, reply) => {
    const id = parseThreadId((req.params as { id?: string }).id)
    if (!id) return reply.status(400).send({ error: 'Invalid thread id' })

    const row = getThread(id, true)
    if (!row) return reply.status(404).send({ error: 'Thread not found' })
    if (row.isLocked) return reply.status(423).send({ error: 'Thread is locked' })

    const body = (req.body || {}) as { body?: string; authorName?: string }
    const text = (body.body || '').trim()
    if (!text) return reply.status(400).send({ error: 'Comment body is required' })
    if (text.length > 4000) {
      return reply.status(400).send({ error: 'Comment body is too long (max 4000 chars)' })
    }

    const author = getAuthor(req.headers.authorization)
    const authorName = author.authorName || (body.authorName || '').trim() || null
    const now = new Date().toISOString()
    const info = db
      .prepare(
        `INSERT INTO feedback_comments (threadId, body, authorId, authorName, isAdmin, createdAt, updatedAt, deletedAt)
         VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)`
      )
      .run(id, text, author.authorId, authorName, author.isAdmin ? 1 : 0, now)
    db.prepare('UPDATE suggestions SET updatedAt = ? WHERE id = ?').run(now, id)

    const comment = db
      .prepare(
        `SELECT id, threadId, body, authorId, authorName, isAdmin, createdAt, updatedAt, deletedAt
           FROM feedback_comments
          WHERE id = ?`
      )
      .get(Number(info.lastInsertRowid)) as CommentRow

    reply.status(201).send(toCommentDto(comment))
  })

  fastify.put('/api/feedback/threads/:id/vote', async (req, reply) => {
    const id = parseThreadId((req.params as { id?: string }).id)
    if (!id) return reply.status(400).send({ error: 'Invalid thread id' })

    const row = getThread(id, true)
    if (!row) return reply.status(404).send({ error: 'Thread not found' })

    const body = (req.body || {}) as { voterId?: string; vote?: number; voteDate?: string }
    const voterId = (body.voterId || '').trim()
    const vote = Number(body.vote)
    const voteDate = (body.voteDate || '').trim()
    if (!voterId || voterId.length > 120) {
      return reply.status(400).send({ error: 'Voter id is required' })
    }
    if (![-1, 1].includes(vote)) {
      return reply.status(400).send({ error: 'Vote must be -1 or 1' })
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(voteDate)) {
      return reply.status(400).send({ error: 'Vote date is required' })
    }

    const existing = db
      .prepare('SELECT vote, voteDate FROM feedback_thread_votes WHERE threadId = ? AND voterId = ?')
      .get(id, voterId) as { vote: number; voteDate: string | null } | undefined
    if (existing?.voteDate === voteDate) {
      return reply.status(429).send({
        error: 'Vote cooldown active',
        threadId: id,
        vote: existing.vote,
        upvoteCount: getVoteCount(id),
      })
    }

    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO feedback_thread_votes (threadId, voterId, vote, voteDate, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(threadId, voterId) DO UPDATE SET
         vote = excluded.vote,
         voteDate = excluded.voteDate,
         updatedAt = excluded.updatedAt`
    ).run(id, voterId, vote, voteDate, now, now)

    reply.send({ threadId: id, vote, upvoteCount: getVoteCount(id) })
  })

  fastify.patch('/api/admin/feedback/threads/:id/status', { preHandler: requireAdmin }, async (req, reply) => {
    const id = parseThreadId((req.params as { id?: string }).id)
    if (!id) return reply.status(400).send({ error: 'Invalid thread id' })

    const body = (req.body || {}) as { status?: string }
    if (!body.status || !THREAD_STATUSES.includes(body.status as ThreadStatus)) {
      return reply.status(400).send({ error: 'Invalid thread status' })
    }

    const row = getThread(id, false)
    if (!row) return reply.status(404).send({ error: 'Thread not found' })

    const now = new Date().toISOString()
    const threadStatus = body.status as ThreadStatus
    db.prepare('UPDATE suggestions SET threadStatus = ?, status = ?, updatedAt = ? WHERE id = ?').run(
      threadStatus,
      legacyStatusFromThreadStatus(threadStatus),
      now,
      id
    )

    reply.send(toThreadDto(getThread(id, false) as ThreadRow, { includeComments: true }))
  })

  fastify.put('/api/admin/feedback/threads/:id/official-reply', { preHandler: requireAdmin }, async (req, reply) => {
    const id = parseThreadId((req.params as { id?: string }).id)
    if (!id) return reply.status(400).send({ error: 'Invalid thread id' })

    const row = getThread(id, false)
    if (!row) return reply.status(404).send({ error: 'Thread not found' })

    const body = (req.body || {}) as { body?: string }
    const text = (body.body || '').trim()
    if (!text) return reply.status(400).send({ error: 'Official reply body is required' })
    if (text.length > 4000) {
      return reply.status(400).send({ error: 'Official reply body is too long (max 4000 chars)' })
    }

    const author = getAuthor(req.headers.authorization)
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO feedback_official_replies (threadId, body, authorId, authorName, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(threadId) DO UPDATE SET
         body = excluded.body,
         authorId = excluded.authorId,
         authorName = excluded.authorName,
         updatedAt = excluded.updatedAt`
    ).run(id, text, author.authorId, author.authorName, now, now)

    // Keep the legacy suggestions API populated for older clients.
    db.prepare('UPDATE suggestions SET adminComment = ?, updatedAt = ? WHERE id = ?').run(text, now, id)

    reply.send(toOfficialReplyDto(getOfficialReply(id)))
  })

  fastify.patch('/api/admin/feedback/threads/:id/settings', { preHandler: requireAdmin }, async (req, reply) => {
    const id = parseThreadId((req.params as { id?: string }).id)
    if (!id) return reply.status(400).send({ error: 'Invalid thread id' })

    const row = getThread(id, false)
    if (!row) return reply.status(404).send({ error: 'Thread not found' })

    const body = (req.body || {}) as { isPinned?: boolean; isLocked?: boolean }
    if (typeof body.isPinned !== 'boolean' && typeof body.isLocked !== 'boolean') {
      return reply.status(400).send({ error: 'Expected isPinned and/or isLocked' })
    }

    const now = new Date().toISOString()
    const nextPinned = typeof body.isPinned === 'boolean' ? body.isPinned : !!row.isPinned
    const nextLocked = typeof body.isLocked === 'boolean' ? body.isLocked : !!row.isLocked
    db.prepare('UPDATE suggestions SET isPinned = ?, isLocked = ?, updatedAt = ? WHERE id = ?').run(
      nextPinned ? 1 : 0,
      nextLocked ? 1 : 0,
      now,
      id
    )

    reply.send(toThreadDto(getThread(id, false) as ThreadRow, { includeComments: true }))
  })
}
