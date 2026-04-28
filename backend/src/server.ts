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
import hiddenRoutes from './routes/hidden'
import suggestionsRoutes from './routes/suggestions'
import accountsRoutes from './routes/accounts'
import { siteAccessRoutes } from './routes/siteAccess'
import swapsRoutes from './routes/swaps'
import appSettingsRoutes from './routes/settings'
import cors from "@fastify/cors"
import './db'

const PORT = Number(process.env.PORT) || 8080
const isProduction = process.env.NODE_ENV === 'production'

function isPrivateLanHostname(hostname: string) {
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0'
  ) {
    return true
  }

  return (
    /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname)
  )
}

function isAllowedDevOrigin(origin: string) {
  if (isProduction) return false

  try {
    const url = new URL(origin)
    return url.protocol === 'http:' && isPrivateLanHostname(url.hostname)
  } catch {
    return false
  }
}

async function start() {
  const app = Fastify({
    logger: true,
  })

await app.register(cors, {
  origin: (origin, cb) => {
    const allowedOrigins = new Set([
      'https://atconight.com',
      'https://www.atconight.com',
      'https://atco-night.pages.dev',
      'https://staging.atconight.com',
      'https://www.staging.atconight.com',
      'https://dev.atco-night.pages.dev',
      'http://localhost:5173',
      'http://localhost:5174',
      'capacitor://localhost',
      'http://localhost',
      'https://localhost',
      'ionic://localhost',
    ])

    // allow server-to-server / native requests with no Origin header
    if (!origin) {
      cb(null, true)
      return
    }

    if (allowedOrigins.has(origin) || isAllowedDevOrigin(origin)) {
      cb(null, true)
      return
    }

    cb(new Error(`Origin ${origin} not allowed`), false)
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Requested-With'],
  credentials: false,
})

  app.get('/health', async () => ({ ok: true }))

  app.register(authRoutes)
  app.register(siteAccessRoutes)
  app.register(accountsRoutes)
  app.register(swapsRoutes)
  app.register(uploadsRoutes)
  app.register(datasetsRoutes)
  app.register(holidaysRoutes)
  app.register(roleLabelsRoutes)
  app.register(studentsRoutes)
  app.register(goerOnlyRoutes)
  app.register(editorRoutes)
  app.register(schedulesRoutes)
  app.register(nicknamesRoutes)
  app.register(hiddenRoutes)
  app.register(suggestionsRoutes)
  app.register(appSettingsRoutes)

  try {
    await app.listen({ port: PORT, host: '0.0.0.0' })
    console.log(`API running at http://localhost:${PORT}`)
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

start()
