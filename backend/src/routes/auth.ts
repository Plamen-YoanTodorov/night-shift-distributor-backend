import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import crypto from 'crypto'

const tokenRoles = new Map<string, 'admin' | 'editor'>()
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123'
const EDITOR_PASSWORD = process.env.EDITOR_PASSWORD || 'editor123'
const STATIC_ADMIN_TOKEN = crypto.createHash('sha256').update(`${ADMIN_PASSWORD}|ns-admin`).digest('hex')
const STATIC_EDITOR_TOKEN = crypto.createHash('sha256').update(`${EDITOR_PASSWORD}|ns-editor`).digest('hex')
const ALLOW_ALL_TOKENS = process.env.ALLOW_ALL_TOKENS === 'true'

export function verifyToken(header?: string): 'admin' | 'editor' | null {
  if (!header) return null
  const token = header.replace(/^Bearer\s+/i, '').trim()
  if (ALLOW_ALL_TOKENS && token) return 'admin'
  const role = tokenRoles.get(token)
  return role || null
}

export function requireAdmin(req: FastifyRequest, reply: FastifyReply, done: () => void) {
  const role = verifyToken(req.headers.authorization)
  if (role === 'admin') {
    return done()
  }
  reply.code(401).send({ error: 'Unauthorized' })
}

export function requireEditorOrAdmin(req: FastifyRequest, reply: FastifyReply, done: () => void) {
  const role = verifyToken(req.headers.authorization)
  if (role === 'admin' || role === 'editor') {
    return done()
  }
  reply.code(401).send({ error: 'Unauthorized' })
}

export default async function authRoutes(fastify: FastifyInstance) {
  fastify.post('/api/auth/login', async (req, reply) => {
    const body = (req.body as any) || {}
    const password: string = body.password || ''
    let token: string | null = null
    let role: 'admin' | 'editor' | null = null
    if (password === ADMIN_PASSWORD) {
      token = STATIC_ADMIN_TOKEN
      role = 'admin'
    } else if (password === EDITOR_PASSWORD) {
      token = STATIC_EDITOR_TOKEN
      role = 'editor'
    }
    if (!token || !role) {
      return reply.code(401).send({ error: 'Invalid credentials' })
    }
    tokenRoles.set(token, role)
    reply.send({ token, role })
  })
}
