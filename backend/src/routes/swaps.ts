import { FastifyInstance, FastifyRequest } from 'fastify'
import { db } from '../db'
import { requireAccount } from './auth'
import type { AccountDto, AccountRole } from '../services/accounts'

type Position = 'APP' | 'TWR'
type SwapStatus =
  | 'PENDING_TARGET'
  | 'DECLINED_BY_TARGET'
  | 'ACCEPTED_WAITING_ADMIN'
  | 'APPROVED'
  | 'REJECTED_BY_ADMIN'
  | 'CANCELLED'

type SwapRow = {
  id: number
  requesterAccountId: number
  targetAccountId: number
  requesterDate: string
  requesterPosition: Position
  requesterCode: string
  targetDate: string
  targetPosition: Position
  targetCode: string
  status: SwapStatus
  adminAccountId: number | null
  adminNote: string | null
  targetRespondedAt: string | null
  adminReviewedAt: string | null
  createdAt: string
  updatedAt: string
  requesterUsername: string
  requesterRole: AccountRole
  requesterStaffName: string | null
  targetUsername: string
  targetRole: AccountRole
  targetStaffName: string | null
  adminUsername: string | null
  adminStaffName: string | null
}

function accountName(username: string, staffName: string | null) {
  return staffName?.trim() || username
}

function currentAccount(req: FastifyRequest) {
  return (req as FastifyRequest & { account?: AccountDto }).account
}

function parsePosition(value: unknown): Position | null {
  if (value === 'APP' || value === 'TWR') return value
  return null
}

function parseDate(value: unknown) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null
}

function parseCode(value: unknown) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 24) return null
  return trimmed
}

function rowToDto(row: SwapRow, account: AccountDto) {
  const requester = {
    id: row.requesterAccountId,
    username: row.requesterUsername,
    role: row.requesterRole,
    staffName: row.requesterStaffName,
    displayName: accountName(row.requesterUsername, row.requesterStaffName),
  }
  const target = {
    id: row.targetAccountId,
    username: row.targetUsername,
    role: row.targetRole,
    staffName: row.targetStaffName,
    displayName: accountName(row.targetUsername, row.targetStaffName),
  }

  return {
    id: row.id,
    status: row.status,
    direction:
      row.requesterAccountId === account.id
        ? 'outgoing'
        : row.targetAccountId === account.id
          ? 'incoming'
          : 'admin',
    requester,
    target,
    requesterShift: {
      date: row.requesterDate,
      position: row.requesterPosition,
      code: row.requesterCode,
    },
    targetShift: {
      date: row.targetDate,
      position: row.targetPosition,
      code: row.targetCode,
    },
    admin:
      row.adminAccountId && row.adminUsername
        ? {
            id: row.adminAccountId,
            username: row.adminUsername,
            staffName: row.adminStaffName,
            displayName: accountName(row.adminUsername, row.adminStaffName),
          }
        : null,
    adminNote: row.adminNote,
    targetRespondedAt: row.targetRespondedAt,
    adminReviewedAt: row.adminReviewedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function selectSwaps(whereSql: string, params: unknown[], account: AccountDto) {
  const rows = db
    .prepare(
      `SELECT
         s.id,
         s.requesterAccountId,
         s.targetAccountId,
         s.requesterDate,
         s.requesterPosition,
         s.requesterCode,
         s.targetDate,
         s.targetPosition,
         s.targetCode,
         s.status,
         s.adminAccountId,
         s.adminNote,
         s.targetRespondedAt,
         s.adminReviewedAt,
         s.createdAt,
         s.updatedAt,
         requester.username AS requesterUsername,
         requester.role AS requesterRole,
         requester.staffName AS requesterStaffName,
         target.username AS targetUsername,
         target.role AS targetRole,
         target.staffName AS targetStaffName,
         admin.username AS adminUsername,
         admin.staffName AS adminStaffName
       FROM swap_requests s
       JOIN accounts requester ON requester.id = s.requesterAccountId
       JOIN accounts target ON target.id = s.targetAccountId
       LEFT JOIN accounts admin ON admin.id = s.adminAccountId
       ${whereSql}
       ORDER BY
         CASE s.status
           WHEN 'PENDING_TARGET' THEN 0
           WHEN 'ACCEPTED_WAITING_ADMIN' THEN 1
           WHEN 'APPROVED' THEN 2
           WHEN 'DECLINED_BY_TARGET' THEN 3
           WHEN 'REJECTED_BY_ADMIN' THEN 4
           WHEN 'CANCELLED' THEN 5
           ELSE 6
         END ASC,
         s.createdAt DESC`
    )
    .all(...params) as SwapRow[]
  return rows.map((row) => rowToDto(row, account))
}

function loadSwap(id: number) {
  return db
    .prepare('SELECT * FROM swap_requests WHERE id = ?')
    .get(id) as
    | {
        id: number
        requesterAccountId: number
        targetAccountId: number
        status: SwapStatus
      }
    | undefined
}

export default async function swapsRoutes(fastify: FastifyInstance) {
  fastify.get('/api/swaps/accounts', { preHandler: requireAccount }, async (req, reply) => {
    const account = currentAccount(req)
    if (!account) return reply.code(401).send({ error: 'Unauthorized' })

    const rows = db
      .prepare(
        `SELECT id, username, role, staffName
         FROM accounts
         WHERE id != ?
         ORDER BY COALESCE(NULLIF(TRIM(staffName), ''), username) COLLATE NOCASE ASC`
      )
      .all(account.id) as { id: number; username: string; role: AccountRole; staffName: string | null }[]

    reply.send(
      rows.map((row) => ({
        ...row,
        displayName: accountName(row.username, row.staffName),
      }))
    )
  })

  fastify.get('/api/swaps', { preHandler: requireAccount }, async (req, reply) => {
    const account = currentAccount(req)
    if (!account) return reply.code(401).send({ error: 'Unauthorized' })

    const where =
      account.role === 'admin'
        ? `WHERE s.requesterAccountId = ? OR s.targetAccountId = ? OR s.status = 'ACCEPTED_WAITING_ADMIN'`
        : `WHERE s.requesterAccountId = ? OR s.targetAccountId = ?`
    reply.send(selectSwaps(where, [account.id, account.id], account))
  })

  fastify.post('/api/swaps', { preHandler: requireAccount }, async (req, reply) => {
    const account = currentAccount(req)
    if (!account) return reply.code(401).send({ error: 'Unauthorized' })

    const body =
      (req.body as {
        targetAccountId?: number
        requesterShift?: { date?: string; position?: string; code?: string }
        targetShift?: { date?: string; position?: string; code?: string }
      }) || {}
    const targetAccountId = Number(body.targetAccountId)
    const requesterDate = parseDate(body.requesterShift?.date)
    const requesterPosition = parsePosition(body.requesterShift?.position)
    const requesterCode = parseCode(body.requesterShift?.code)
    const targetDate = parseDate(body.targetShift?.date)
    const targetPosition = parsePosition(body.targetShift?.position)
    const targetCode = parseCode(body.targetShift?.code)

    if (!Number.isFinite(targetAccountId) || targetAccountId <= 0 || targetAccountId === account.id) {
      return reply.code(400).send({ error: 'Choose another account to request a swap.' })
    }
    if (!requesterDate || !requesterPosition || !requesterCode || !targetDate || !targetPosition || !targetCode) {
      return reply.code(400).send({ error: 'Both shifts need a date, position, and code.' })
    }
    const target = db.prepare('SELECT id FROM accounts WHERE id = ?').get(targetAccountId) as { id: number } | undefined
    if (!target) return reply.code(404).send({ error: 'Target account not found.' })

    const now = new Date().toISOString()
    const info = db
      .prepare(
        `INSERT INTO swap_requests (
           requesterAccountId,
           targetAccountId,
           requesterDate,
           requesterPosition,
           requesterCode,
           targetDate,
           targetPosition,
           targetCode,
           status,
           createdAt,
           updatedAt
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_TARGET', ?, ?)`
      )
      .run(
        account.id,
        targetAccountId,
        requesterDate,
        requesterPosition,
        requesterCode,
        targetDate,
        targetPosition,
        targetCode,
        now,
        now
      )

    const created = selectSwaps('WHERE s.id = ?', [info.lastInsertRowid], account)[0]
    reply.code(201).send(created)
  })

  fastify.put('/api/swaps/:id/respond', { preHandler: requireAccount }, async (req, reply) => {
    const account = currentAccount(req)
    if (!account) return reply.code(401).send({ error: 'Unauthorized' })
    const id = Number((req.params as { id?: string }).id)
    const body = (req.body as { accept?: boolean }) || {}
    const swap = loadSwap(id)
    if (!swap) return reply.code(404).send({ error: 'Swap request not found.' })
    if (swap.targetAccountId !== account.id) {
      return reply.code(403).send({ error: 'Only the requested account can respond.' })
    }
    if (swap.status !== 'PENDING_TARGET') {
      return reply.code(409).send({ error: 'This swap is no longer waiting for a response.' })
    }

    const status: SwapStatus = body.accept ? 'ACCEPTED_WAITING_ADMIN' : 'DECLINED_BY_TARGET'
    const now = new Date().toISOString()
    db.prepare(
      `UPDATE swap_requests
       SET status = ?, targetRespondedAt = ?, updatedAt = ?
       WHERE id = ?`
    ).run(status, now, now, id)

    reply.send(selectSwaps('WHERE s.id = ?', [id], account)[0])
  })

  fastify.put('/api/swaps/:id/cancel', { preHandler: requireAccount }, async (req, reply) => {
    const account = currentAccount(req)
    if (!account) return reply.code(401).send({ error: 'Unauthorized' })
    const id = Number((req.params as { id?: string }).id)
    const swap = loadSwap(id)
    if (!swap) return reply.code(404).send({ error: 'Swap request not found.' })
    if (swap.requesterAccountId !== account.id) {
      return reply.code(403).send({ error: 'Only the requester can cancel this swap.' })
    }
    if (swap.status !== 'PENDING_TARGET' && swap.status !== 'ACCEPTED_WAITING_ADMIN') {
      return reply.code(409).send({ error: 'This swap can no longer be cancelled.' })
    }

    const now = new Date().toISOString()
    db.prepare(
      `UPDATE swap_requests
       SET status = 'CANCELLED', updatedAt = ?
       WHERE id = ?`
    ).run(now, id)

    reply.send(selectSwaps('WHERE s.id = ?', [id], account)[0])
  })

  fastify.put('/api/swaps/:id/admin', { preHandler: requireAccount }, async (req, reply) => {
    const account = currentAccount(req)
    if (!account) return reply.code(401).send({ error: 'Unauthorized' })
    if (account.role !== 'admin') return reply.code(403).send({ error: 'Admin approval is required.' })

    const id = Number((req.params as { id?: string }).id)
    const body = (req.body as { approve?: boolean; note?: string }) || {}
    const swap = loadSwap(id)
    if (!swap) return reply.code(404).send({ error: 'Swap request not found.' })
    if (swap.status !== 'ACCEPTED_WAITING_ADMIN') {
      return reply.code(409).send({ error: 'This swap is not waiting for admin approval.' })
    }

    const status: SwapStatus = body.approve ? 'APPROVED' : 'REJECTED_BY_ADMIN'
    const now = new Date().toISOString()
    const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null
    db.prepare(
      `UPDATE swap_requests
       SET status = ?, adminAccountId = ?, adminNote = ?, adminReviewedAt = ?, updatedAt = ?
       WHERE id = ?`
    ).run(status, account.id, note, now, now, id)

    reply.send(selectSwaps('WHERE s.id = ?', [id], account)[0])
  })
}
