import { FastifyInstance } from 'fastify'
import { verifyToken } from './auth'

export default async function editorRoutes(fastify: FastifyInstance) {
  fastify.get('/api/auth/me', async (req, reply) => {
    const role = verifyToken(req.headers.authorization)
    reply.send({ role: role || 'guest' })
  })
}
