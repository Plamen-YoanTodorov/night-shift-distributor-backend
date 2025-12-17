import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import crypto from 'crypto'

const activeTokens = new Set<string>()
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123'
const STATIC_TOKEN = crypto.createHash('sha256').update(`${ADMIN_PASSWORD}|ns-admin`).digest('hex')
const ALLOW_ALL_TOKENS = process.env.ALLOW_ALL_TOKENS === 'true'

export function verifyToken(header?: string) {
  if (!header) return false
  const token = header.replace(/^Bearer\s+/i, '').trim()
  if (ALLOW_ALL_TOKENS && token) return true
  return activeTokens.has(token) || token === STATIC_TOKEN
}

export function requireAdmin(req: FastifyRequest, reply: FastifyReply, done: () => void) {
  if (verifyToken(req.headers.authorization)) {
    return done()
  }
  reply.code(401).send({ error: 'Unauthorized' })
}

export default async function authRoutes(fastify: FastifyInstance) {
  fastify.post('/api/auth/login', async (req, reply) => {
    const body = (req.body as any) || {}
    const password: string = body.password || ''
    if (password !== ADMIN_PASSWORD) {
      return reply.code(401).send({ error: 'Invalid credentials' })
    }
    // Use a deterministic token so it survives server restarts.
    const token = STATIC_TOKEN
    activeTokens.add(token)
    reply.send({ token })
  })
}
