import { FastifyInstance } from 'fastify'
import { getHidden, saveHidden } from '../services/hidden'
import { requireAdmin } from './auth'

export default async function hiddenRoutes(fastify: FastifyInstance) {
  fastify.get('/api/hidden', async (_req, reply) => {
    reply.send(getHidden())
  })

  fastify.put('/api/hidden', { preHandler: requireAdmin }, async (req, reply) => {
    const body = (req.body as any) || []
    if (!Array.isArray(body)) {
      return reply.status(400).send({ error: 'Expected an array of names' })
    }
    saveHidden(body.map((n) => String(n)))
    reply.send({ ok: true })
  })
}
