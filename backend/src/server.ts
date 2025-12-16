import Fastify from 'fastify'
import path from 'path'
import uploadsRoutes from './routes/uploads'
import datasetsRoutes from './routes/datasets'
import authRoutes from './routes/auth'
import './db'

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000

async function start() {
  const app = Fastify({
    logger: true,
  })

  // Simple CORS
  app.addHook('onRequest', (req, reply, done) => {
    reply.header('Access-Control-Allow-Origin', '*')
    reply.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    if (req.method === 'OPTIONS') {
      reply.status(204).send()
      return
    }
    done()
  })

  app.get('/health', async () => ({ ok: true }))

  app.register(authRoutes)
  app.register(uploadsRoutes)
  app.register(datasetsRoutes)

  try {
    await app.listen({ port: PORT, host: '0.0.0.0' })
    console.log(`API running at http://localhost:${PORT}`)
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

start()
