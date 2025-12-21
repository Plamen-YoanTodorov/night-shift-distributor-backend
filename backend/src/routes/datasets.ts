import { FastifyInstance } from 'fastify'
import { db } from '../db'
import type { DistributionEntry } from '../types'
import { requireAdmin, requireEditorOrAdmin } from './auth'

export default async function datasetsRoutes(fastify: FastifyInstance) {
  fastify.put('/api/distributions', { preHandler: requireEditorOrAdmin }, async (req, reply) => {
    const entries: any[] = Array.isArray(req.body) ? (req.body as any[]) : []
    const now = new Date().toISOString()
    // Ensure a default dataset exists for FK integrity
    db.prepare('INSERT OR IGNORE INTO datasets (id, name, createdAt) VALUES (1, ?, ?)').run('default', now)
    const insert = db.prepare(
      `INSERT INTO distributions (dataset_id, date, position, worker, role, isManual, createdAt)
       VALUES (@dataset_id, @date, @position, @worker, @role, @isManual, @createdAt)`
    )
    const delAll = db.prepare('DELETE FROM distributions')
    const tx = db.transaction((rows: any[]) => {
      delAll.run()
      rows.forEach((r) =>
        insert.run({
          dataset_id: r.datasetId || 1,
          date: r.date,
          position: r.position,
          worker: r.worker,
          role: r.role,
          isManual: r.isManual ? 1 : 0,
          createdAt: now,
        })
      )
    })
    tx(entries)
    reply.send({ saved: entries.length })
  })

  fastify.get('/api/distributions', async (_, reply) => {
    const rows = db
      .prepare('SELECT dataset_id as datasetId, date, position, worker, role, isManual FROM distributions')
      .all()
      .map((r: any) => ({ ...r, isManual: !!r.isManual }))
    reply.send(rows)
  })

  fastify.post('/api/datasets', { preHandler: requireAdmin }, async (req, reply) => {
    const body = req.body as any
    const name: string = body?.name || 'Dataset'
    const uploadIds: number[] = Array.isArray(body?.uploadIds) ? body.uploadIds.map(Number) : []
    const createdAt = new Date().toISOString()

    const stmt = db.prepare('INSERT INTO datasets (name, createdAt) VALUES (?, ?)')
    const info = stmt.run(name, createdAt)
    const datasetId = Number(info.lastInsertRowid)

    const linkStmt = db.prepare('INSERT INTO dataset_uploads (dataset_id, upload_id) VALUES (?, ?)')
    const tx = db.transaction((ids: number[]) => {
      ids.forEach((uid) => linkStmt.run(datasetId, uid))
    })
    tx(uploadIds)

    return reply.send({ id: datasetId, name, createdAt, uploadIds })
  })

  fastify.get('/api/datasets', async (_, reply) => {
    const rows = db.prepare('SELECT * FROM datasets ORDER BY createdAt DESC').all()
    reply.send(rows)
  })

  fastify.get('/api/datasets/:id', async (req, reply) => {
    const id = Number((req.params as any).id)
    const row = db.prepare('SELECT * FROM datasets WHERE id = ?').get(id)
    if (!row) return reply.status(404).send({ error: 'Not found' })
    const uploads = db
      .prepare(
        'SELECT u.* FROM uploads u JOIN dataset_uploads du ON du.upload_id = u.id WHERE du.dataset_id = ?'
      )
      .all(id)
    reply.send({ ...row, uploads })
  })

  fastify.put('/api/datasets/:id/distributions', { preHandler: requireAdmin }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const dataset = db.prepare('SELECT id FROM datasets WHERE id = ?').get(id)
    if (!dataset) return reply.status(404).send({ error: 'Not found' })
    const entries: DistributionEntry[] = Array.isArray(req.body) ? (req.body as DistributionEntry[]) : []
    const now = new Date().toISOString()

    const insert = db.prepare(
      `INSERT INTO distributions (dataset_id, date, position, worker, role, isManual, createdAt)
       VALUES (@datasetId, @date, @position, @worker, @role, @isManual, @createdAt)`
    )
    const del = db.prepare('DELETE FROM distributions WHERE dataset_id = ?')
    const tx = db.transaction((rows: DistributionEntry[]) => {
      del.run(id)
      rows.forEach((r) =>
        insert.run({
          datasetId: id,
          date: r.date,
          position: r.position,
          worker: r.worker,
          role: r.role,
          isManual: r.isManual ? 1 : 0,
          createdAt: now,
        })
      )
    })
    tx(entries)
    reply.send({ saved: entries.length })
  })

  fastify.get('/api/datasets/:id/distributions', async (req, reply) => {
    const id = Number((req.params as any).id)
    const dataset = db.prepare('SELECT id FROM datasets WHERE id = ?').get(id)
    if (!dataset) return reply.status(404).send({ error: 'Not found' })
    const rows = db
      .prepare('SELECT date, position, worker, role, isManual FROM distributions WHERE dataset_id = ?')
      .all(id)
      .map((r: any) => ({ ...r, isManual: !!r.isManual }))
    reply.send(rows)
  })

  fastify.delete('/api/datasets/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const ds = db.prepare('SELECT id FROM datasets WHERE id = ?').get(id)
    if (!ds) return reply.status(404).send({ error: 'Not found' })
    db.prepare('DELETE FROM datasets WHERE id = ?').run(id)
    reply.send({ deleted: true })
  })
}
