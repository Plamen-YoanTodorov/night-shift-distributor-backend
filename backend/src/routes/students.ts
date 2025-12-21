import { FastifyInstance } from 'fastify'
import { db } from '../db'
import { requireAdmin } from './auth'

export default async function studentsRoutes(fastify: FastifyInstance) {
  fastify.get('/api/students', async () => {
    const rows = db.prepare('SELECT name, startDate, endDate FROM students ORDER BY name ASC').all()
    return rows.map((r: any) => ({ name: r.name, start: r.startDate || null, end: r.endDate || null }))
  })

  fastify.put('/api/students', { preHandler: requireAdmin }, async (req, reply) => {
    const body = Array.isArray(req.body) ? (req.body as any[]) : []
    const now = new Date().toISOString()
    const insert = db.prepare(
      `INSERT INTO students (name, startDate, endDate, createdAt)
       VALUES (@name, @startDate, @endDate, @createdAt)
       ON CONFLICT(name) DO UPDATE SET startDate=excluded.startDate, endDate=excluded.endDate`
    )
    const delAll = db.prepare('DELETE FROM students')
    const tx = db.transaction((rows: any[]) => {
      delAll.run()
      rows.forEach((r) =>
        insert.run({
          name: String(r.name),
          startDate: r.start || null,
          endDate: r.end || null,
          createdAt: now,
        })
      )
    })
    tx(body)
    reply.send({ saved: body.length })
  })
}
