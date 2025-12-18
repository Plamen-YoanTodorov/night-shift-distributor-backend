import Fastify from 'fastify'
import path from 'path'
import uploadsRoutes from './routes/uploads'
import datasetsRoutes from './routes/datasets'
import authRoutes from './routes/auth'
import holidaysRoutes from './routes/holidays'
import roleLabelsRoutes from './routes/labels'
import cors from "@fastify/cors"
import './db'

const PORT = Number(process.env.PORT) || 8080

async function start() {
  const app = Fastify({
    logger: true,
  })

await app.register(cors, {
  origin: [
    'https://www.atconight.com',
    'https://atconight.com',
    'http://localhost:5173',
    "https://atconight.pages.dev",
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Requested-With'],
  // set this to true ONLY if you use cookies/sessions:
  credentials: false,
})

  app.get('/health', async () => ({ ok: true }))

  app.register(authRoutes)
  app.register(uploadsRoutes)
  app.register(datasetsRoutes)
  app.register(holidaysRoutes)
  app.register(roleLabelsRoutes)

  try {
    await app.listen({ port: PORT, host: '0.0.0.0' })
    console.log(`API running at http://localhost:${PORT}`)
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

start()
