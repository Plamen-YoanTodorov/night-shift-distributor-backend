import { FastifyInstance } from 'fastify'
import crypto from 'crypto'

const SITE_PASSWORD = process.env.SITE_PASSWORD || '1234'
const SITE_TOKEN = crypto.createHash('sha256').update(`${SITE_PASSWORD}|site-gate`).digest('hex')

export async function siteAccessRoutes(fastify: FastifyInstance) {
  fastify.post('/api/site/login', async (req, reply) => {
    const body = (req.body as any) || {}
    const password: string = body.password || ''
    if (password !== SITE_PASSWORD) {
      return reply.code(401).send({ error: 'Invalid credentials' })
    }
    return reply.send({ token: SITE_TOKEN, expiresInHours: 24 })
  })
}

export function verifySiteToken(token?: string) {
  if (!token) return false
  return token.trim() === SITE_TOKEN
}
