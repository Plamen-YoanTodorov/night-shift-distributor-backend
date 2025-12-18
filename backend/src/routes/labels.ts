import { FastifyInstance } from 'fastify'
import { db } from '../db'
import { requireAdmin } from './auth'

type RoleKey = 'stayer' | 'goer1' | 'goer2'

const defaults: Record<RoleKey, string> = {
  stayer: 'Stayer',
  goer1: 'Goer',
  goer2: 'Goer 2',
}

export default async function roleLabelsRoutes(fastify: FastifyInstance) {
  fastify.get('/api/role-labels', async () => {
    const rows = db.prepare('SELECT role, label FROM role_labels').all() as { role: RoleKey; label: string }[]
    const res: Record<RoleKey, string> = { ...defaults }
    rows.forEach((r) => {
      res[r.role] = r.label
    })
    return res
  })

  fastify.put('/api/role-labels', { preHandler: requireAdmin }, async (req, reply) => {
    const body = (req.body ?? {}) as Partial<Record<RoleKey, string>>
    const merged: Record<RoleKey, string> = {
      stayer: body.stayer?.trim() || defaults.stayer,
      goer1: body.goer1?.trim() || defaults.goer1,
      goer2: body.goer2?.trim() || defaults.goer2,
    }
    const stmt = db.prepare(
      'INSERT INTO role_labels (role, label) VALUES (?, ?) ON CONFLICT(role) DO UPDATE SET label=excluded.label'
    )
    const tx = db.transaction((vals: [RoleKey, string][]) => {
      vals.forEach(([role, label]) => stmt.run(role, label))
    })
    tx(Object.entries(merged) as [RoleKey, string][])
    reply.send({ saved: Object.keys(merged).length })
  })
}
