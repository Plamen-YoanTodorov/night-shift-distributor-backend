import { FastifyInstance } from 'fastify'
import { db } from '../db'
import { requireAdmin } from './auth'

export default async function holidaysRoutes(fastify: FastifyInstance) {
  fastify.get('/api/holidays', async () => {
    const rows = db.prepare('SELECT date FROM holidays ORDER BY date ASC').all()
    return rows.map((r: any) => r.date)
  })

  fastify.put('/api/holidays', { preHandler: requireAdmin }, async (req, reply) => {
    const dates: string[] = Array.isArray(req.body) ? (req.body as any[]).map(String) : []
    const insert = db.prepare('INSERT INTO holidays (date, createdAt) VALUES (?, ?)')
    const delAll = db.prepare('DELETE FROM holidays')
    const now = new Date().toISOString()
    const tx = db.transaction((vals: string[]) => {
      delAll.run()
      vals.forEach((d) => insert.run(d, now))
    })
    tx(dates)
    reply.send({ saved: dates.length })
  })
}
