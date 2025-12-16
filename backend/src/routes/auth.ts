import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import crypto from 'crypto'

const activeTokens = new Set<string>()
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123'

export function verifyToken(header?: string) {
  if (!header) return false
  const token = header.replace(/^Bearer\\s+/i, '').trim()
  return activeTokens.has(token)
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
    const token = crypto.randomBytes(24).toString('hex')
    activeTokens.add(token)
    reply.send({ token })
  })
}
