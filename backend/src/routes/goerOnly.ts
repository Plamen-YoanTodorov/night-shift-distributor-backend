import { FastifyInstance } from 'fastify'
import { db } from '../db'
import { requireAdmin } from './auth'

export default async function goerOnlyRoutes(fastify: FastifyInstance) {
  fastify.get('/api/goer-only', async () => {
    const rows = db.prepare('SELECT name FROM goer_only ORDER BY name ASC').all()
    return rows.map((r: any) => r.name as string)
  })

  fastify.put('/api/goer-only', { preHandler: requireAdmin }, async (req, reply) => {
    const body = Array.isArray(req.body) ? (req.body as any[]) : []
    const now = new Date().toISOString()
    const delAll = db.prepare('DELETE FROM goer_only')
    const insert = db.prepare(
      `INSERT INTO goer_only (name, createdAt)
       VALUES (@name, @createdAt)
       ON CONFLICT(name) DO UPDATE SET createdAt=excluded.createdAt`
    )
    const tx = db.transaction((rows: any[]) => {
      delAll.run()
      rows.forEach((n) => insert.run({ name: String(n), createdAt: now }))
    })
    tx(body)
    reply.send({ saved: body.length })
  })
}
