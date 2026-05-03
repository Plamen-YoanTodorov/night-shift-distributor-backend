import { FastifyInstance } from 'fastify'
import { db } from '../db'
import { requireEditorOrAdmin } from './auth'

type NameDisplayFormat = 'initials' | 'initial-last' | 'first-last' | 'full'

const ALLOWED_KEYS = ['nameDisplayFormat', 'adminNameDisplayFormat'] as const
type SettingKey = (typeof ALLOWED_KEYS)[number]

const DEFAULTS: Record<SettingKey, string> = {
  nameDisplayFormat: 'first-last',
  adminNameDisplayFormat: 'full',
}

export default async function appSettingsRoutes(fastify: FastifyInstance) {
  fastify.get('/api/settings', async () => {
    const rows = db.prepare('SELECT key, value FROM app_settings').all() as { key: string; value: string }[]
    const result: Record<SettingKey, string> = { ...DEFAULTS }
    rows.forEach((r) => {
      if ((ALLOWED_KEYS as readonly string[]).includes(r.key)) {
        result[r.key as SettingKey] = r.value
      }
    })
    return result
  })

  fastify.put('/api/settings', { preHandler: requireEditorOrAdmin }, async (req, reply) => {
    const body = (req.body ?? {}) as Partial<Record<SettingKey, string>>
    const validFormats: NameDisplayFormat[] = ['initials', 'initial-last', 'first-last', 'full']
    const stmt = db.prepare(
      'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
    )
    const tx = db.transaction(() => {
      if (body.nameDisplayFormat !== undefined && validFormats.includes(body.nameDisplayFormat as NameDisplayFormat)) {
        stmt.run('nameDisplayFormat', body.nameDisplayFormat)
      }
      if (body.adminNameDisplayFormat !== undefined && validFormats.includes(body.adminNameDisplayFormat as NameDisplayFormat)) {
        stmt.run('adminNameDisplayFormat', body.adminNameDisplayFormat)
      }
    })
    tx()
    reply.send({ saved: true })
  })
}
