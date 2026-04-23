import { FastifyInstance } from 'fastify'
import { requireAdmin } from './auth'
import {
  createAccount,
  deleteAccount,
  ensureDefaultAccounts,
  findAccountByCredentials,
  issueAccountToken,
  listAccounts,
  updateAccount,
  type AccountRole,
} from '../services/accounts'

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : 'Request failed'
}

export default async function accountsRoutes(fastify: FastifyInstance) {
  ensureDefaultAccounts()

  fastify.post('/api/accounts/login', async (req, reply) => {
    const body = (req.body as { username?: string; password?: string }) || {}
    const account = findAccountByCredentials(body.username || '', body.password || '')
    if (!account) {
      return reply.code(401).send({ error: 'Invalid credentials' })
    }

    const authToken =
      account.role === 'admin' || account.role === 'editor'
        ? issueAccountToken(account)
        : undefined

    reply.send({
      id: account.id,
      token: issueAccountToken(account),
      expiresInHours: 24 * 365,
      persistent: true,
      username: account.username,
      role: account.role,
      staffName: account.staffName,
      authToken,
    })
  })

  fastify.get('/api/accounts', { preHandler: requireAdmin }, async () => {
    return listAccounts()
  })

  fastify.post('/api/accounts', { preHandler: requireAdmin }, async (req, reply) => {
    try {
      const body =
        (req.body as {
          username?: string
          password?: string
          role?: AccountRole
          staffName?: string | null
        }) || {}
      const account = createAccount({
        username: body.username || '',
        password: body.password || '',
        role: body.role || 'viewer',
        staffName: body.staffName,
      })
      reply.code(201).send(account)
    } catch (err) {
      reply.code(400).send({ error: errorMessage(err) })
    }
  })

  fastify.put('/api/accounts/:id', { preHandler: requireAdmin }, async (req, reply) => {
    try {
      const id = Number((req.params as { id: string }).id)
      const body =
        (req.body as {
          username?: string
          password?: string
          role?: AccountRole
          staffName?: string | null
        }) || {}
      const account = updateAccount(id, body)
      if (!account) return reply.code(404).send({ error: 'Account not found' })
      reply.send(account)
    } catch (err) {
      reply.code(400).send({ error: errorMessage(err) })
    }
  })

  fastify.delete('/api/accounts/:id', { preHandler: requireAdmin }, async (req, reply) => {
    try {
      const id = Number((req.params as { id: string }).id)
      const deleted = deleteAccount(id)
      if (!deleted) return reply.code(404).send({ error: 'Account not found' })
      reply.send({ deleted: true })
    } catch (err) {
      reply.code(400).send({ error: errorMessage(err) })
    }
  })
}
