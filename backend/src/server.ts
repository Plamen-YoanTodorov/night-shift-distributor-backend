import Fastify from 'fastify'
import path from 'path'
import uploadsRoutes from './routes/uploads'
import datasetsRoutes from './routes/datasets'
import authRoutes from './routes/auth'
import holidaysRoutes from './routes/holidays'
import roleLabelsRoutes from './routes/labels'
import studentsRoutes from './routes/students'
import editorRoutes from './routes/editor'
import schedulesRoutes from './routes/schedules'
import goerOnlyRoutes from './routes/goerOnly'
import nicknamesRoutes from './routes/nicknames'
import { siteAccessRoutes } from './routes/siteAccess'
import hiddenRoutes from './routes/hidden'
import suggestionsRoutes from './routes/suggestions'
import cors from "@fastify/cors"
import './db'

const PORT = Number(process.env.PORT) || 8080

async function start() {
  const app = Fastify({
    logger: true,
  })

await app.register(cors, {
  origin: [
    // Production URLs
    'https://atconight.com',
    'https://www.atconight.com',
    "https://atco-night.pages.dev",

    // Staging URLs
    'https://staging.atconight.com',
    'https://www.staging.atconight.com',
    "https://dev.atco-night.pages.dev",
    
    // Localhost URLs
    'http://localhost:5173',
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
  app.register(studentsRoutes)
  app.register(goerOnlyRoutes)
  app.register(editorRoutes)
  app.register(schedulesRoutes)
  app.register(nicknamesRoutes)
  app.register(siteAccessRoutes)
  app.register(hiddenRoutes)
  app.register(suggestionsRoutes)

  try {
    await app.listen({ port: PORT, host: '0.0.0.0' })
    console.log(`API running at http://localhost:${PORT}`)
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

start()
