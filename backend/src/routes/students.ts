import { FastifyInstance } from 'fastify'
import { db } from '../db'
import { requireAdmin } from './auth'

export default async function studentsRoutes(fastify: FastifyInstance) {
  fastify.get('/api/students', async () => {
    const rows = db
      .prepare('SELECT name, startDate, endDate, position FROM students ORDER BY name ASC')
      .all()
    return rows.map((r: any) => ({
      name: r.name,
      start: r.startDate || null,
      end: r.endDate || null,
      position: r.position || 'BOTH',
    }))
  })

  fastify.put('/api/students', { preHandler: requireAdmin }, async (req, reply) => {
    const body = Array.isArray(req.body) ? (req.body as any[]) : []
    const now = new Date().toISOString()
    const insert = db.prepare(
      `INSERT INTO students (name, startDate, endDate, position, createdAt)
       VALUES (@name, @startDate, @endDate, @position, @createdAt)
       ON CONFLICT(name) DO UPDATE SET
         startDate=excluded.startDate,
         endDate=excluded.endDate,
         position=excluded.position`
    )
    const delAll = db.prepare('DELETE FROM students')
    const normalizePosition = (value: unknown) => {
      const raw = String(value || '').toUpperCase()
      if (raw === 'APP' || raw === 'TWR' || raw === 'BOTH') return raw
      return 'BOTH'
    }
    const tx = db.transaction((rows: any[]) => {
      delAll.run()
      rows.forEach((r) =>
        insert.run({
          name: String(r.name),
          startDate: r.start || null,
          endDate: r.end || null,
          position: normalizePosition(r.position),
          createdAt: now,
        })
      )
    })
    tx(body)
    reply.send({ saved: body.length })
  })
}
