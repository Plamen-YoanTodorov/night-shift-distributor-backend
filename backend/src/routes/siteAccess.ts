import { FastifyInstance } from 'fastify'
import crypto from 'crypto'

const SITE_PASSWORD = process.env.SITE_PASSWORD || '1234'
const SITE_BYPASS_PASSWORD = process.env.SITE_BYPASS_PASSWORD || 'never-again'
const SITE_TOKEN = crypto.createHash('sha256').update(`${SITE_PASSWORD}|site-gate`).digest('hex')
const SITE_PERSISTENT_TOKEN = crypto
  .createHash('sha256')
  .update(`${SITE_BYPASS_PASSWORD || 'disabled'}|site-gate-persistent`)
  .digest('hex')

export async function siteAccessRoutes(fastify: FastifyInstance) {
  fastify.post('/api/site/login', async (req, reply) => {
    const body = (req.body as any) || {}
    const password: string = body.password || ''
    if (password === SITE_PASSWORD) {
      return reply.send({ token: SITE_TOKEN, expiresInHours: 24, persistent: false })
    }
    if (SITE_BYPASS_PASSWORD && password === SITE_BYPASS_PASSWORD) {
      return reply.send({
        token: SITE_PERSISTENT_TOKEN,
        expiresInHours: 24 * 365 * 50,
        persistent: true,
      })
    }
    return reply.code(401).send({ error: 'Invalid credentials' })
  })
}

export function verifySiteToken(token?: string) {
  if (!token) return false
  const t = token.trim()
  return t === SITE_TOKEN || t === SITE_PERSISTENT_TOKEN
}
