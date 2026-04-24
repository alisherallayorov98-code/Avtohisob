import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import dotenv from 'dotenv'
import path from 'path'
import http from 'http'
import { errorHandler } from './middleware/errorHandler'
import { initSocket } from './lib/socket'
import { startScheduler } from './lib/scheduler'
import { initTelegramBot } from './services/telegramBot'
import authRoutes from './routes/auth'
import vehicleRoutes from './routes/vehicles'
import sparePartRoutes from './routes/spareParts'
import inventoryRoutes from './routes/inventory'
import maintenanceRoutes from './routes/maintenance'
import sparePartReturnRoutes from './routes/sparePartReturn'
import fuelRoutes from './routes/fuel'
import fuelMeterRoutes from './routes/fuelMeter'
import branchRoutes from './routes/branches'
import reportRoutes from './routes/reports'
import supplierRoutes from './routes/suppliers'
import transferRoutes from './routes/transfers'
import expenseRoutes from './routes/expenses'
import notificationRoutes from './routes/notifications'
import auditLogRoutes from './routes/auditLogs'
import exportRoutes from './routes/exports'
import analyticsRoutes from './routes/analytics'
import articleCodeRoutes from './routes/articleCodes'
import sparePartStatsRoutes from './routes/sparePartStats'
import aiLogRoutes from './routes/aiLogs'
import savedReportRoutes from './routes/savedReports'
import billingRoutes from './routes/billing'
import tireRoutes from './routes/tires'
import fuelImportRoutes from './routes/fuelImports'
import serviceIntervalRoutes from './routes/serviceIntervals'
import waybillRoutes from './routes/waybills'
import warrantyRoutes from './routes/warranties'
import supportRoutes from './routes/support'
import importDataRoutes from './routes/importData'
import warehouseRoutes from './routes/warehouses'
import adminRoutes from './routes/admin'
import engineRecordRoutes from './routes/engineRecords'
import techInspectionRoutes from './routes/techInspections'
import branchAnalyticsRoutes from './routes/branchAnalytics'
import fleetRiskRoutes from './routes/fleetRisk'
import gpsRoutes from './routes/gps'
import oilChangeRoutes from './routes/oilChange'
import driverAnalyticsRoutes from './routes/driverAnalytics'
import vehicleCostsRoutes from './routes/vehicleCosts'
import fuelGpsCheckRoutes from './routes/fuelGpsCheck'
import telegramRoutes from './routes/telegram'
import budgetRoutes from './routes/budget'
import batchRoutes from './routes/batches'
import requestRoutes from './routes/requests'
import tireTrackingRoutes from './routes/tireTracking'
import swaggerUi from 'swagger-ui-express'
import { swaggerSpec } from './lib/swagger'

dotenv.config()

// Critical env validation — fail fast rather than crashing mid-request
const requiredEnvs = ['JWT_SECRET', 'DATABASE_URL']
const missingEnvs = requiredEnvs.filter(k => !process.env[k])
if (missingEnvs.length > 0) {
  console.error(`❌ Majburiy env o'zgaruvchilari yo'q: ${missingEnvs.join(', ')}`)
  process.exit(1)
}
if (process.env.NODE_ENV === 'production' && !process.env.CORS_ORIGIN) {
  console.error('❌ Production rejimida CORS_ORIGIN belgilanishi shart')
  process.exit(1)
}

const app = express()
const PORT = process.env.PORT || 3001
const isProduction = process.env.NODE_ENV === 'production'

// Trust nginx reverse proxy — required for rate-limit and real IP detection
app.set('trust proxy', 1)

app.use(helmet())
app.use(cors({
  origin: (origin, callback) => {
    // No-origin = same-origin (nginx proxy) yoki server-side — JWT bilan himoyalangan.
    if (!origin) return callback(null, true)
    const allowed = isProduction
      ? (process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map(s => s.trim()) : [])
      : [
          'http://localhost:3000',
          'http://localhost:5173',
          ...(process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map(s => s.trim()) : []),
        ]
    if (allowed.some(o => origin === o)) {
      callback(null, true)
    } else {
      callback(new Error(`CORS: ${origin} ruxsatsiz manba`))
    }
  },
  credentials: true,
}))

// Auth endpoints: strict limit (brute-force protection)
// skipSuccessfulRequests: muvaffaqiyatli login limitga sanalmaydi —
// foydalanuvchi kun davomida 31 marta login qilishi mumkin (ko'p tab, qayta kirish)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 30,
  skipSuccessfulRequests: true,
  message: { success: false, error: 'Juda ko\'p urinish. 15 daqiqadan keyin qayta urinib ko\'ring.' },
  standardHeaders: true,
  legacyHeaders: false,
})
app.use('/api/auth/login', authLimiter)
app.use('/api/auth/register', authLimiter)
app.use('/api/auth/forgot-password', authLimiter)
app.use('/api/auth/change-password', authLimiter)

// General API: generous limit for normal SPA usage
// (dashboard alone fires 8-10 parallel queries on load)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 1000,
  message: { success: false, error: 'Juda ko\'p so\'rov. Biroz kuting.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path.startsWith('/auth/login') ||
                 req.path.startsWith('/auth/register') ||
                 req.path.startsWith('/auth/forgot-password'),
})
app.use('/api/', limiter)


app.use(express.json({ limit: '2mb' }))
app.use(express.urlencoded({ extended: true, limit: '2mb' }))
const uploadsStatic = express.static(path.join(process.cwd(), 'uploads'))
app.use('/uploads', uploadsStatic)
app.use('/api/uploads', uploadsStatic) // nginx /api/ orqali o'tadi — alohida nginx config shart emas

app.get('/api/health', (_, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime() })
})

app.use('/api/auth', authRoutes)
app.use('/api/vehicles', vehicleRoutes)
app.use('/api/spare-parts', sparePartRoutes)
app.use('/api/inventory', inventoryRoutes)
app.use('/api/maintenance', maintenanceRoutes)
app.use('/api/spare-part-returns', sparePartReturnRoutes)
app.use('/api/fuel-records', fuelRoutes)
app.use('/api/fuel-meter', fuelMeterRoutes)
app.use('/api/branches', branchRoutes)
app.use('/api/reports', reportRoutes)
app.use('/api/suppliers', supplierRoutes)
app.use('/api/transfers', transferRoutes)
app.use('/api/expenses', expenseRoutes)
app.use('/api/notifications', notificationRoutes)
app.use('/api/audit-logs', auditLogRoutes)
app.use('/api/exports', exportRoutes)
app.use('/api/analytics', analyticsRoutes)
app.use('/api/article-codes', articleCodeRoutes)
app.use('/api/spare-part-stats', sparePartStatsRoutes)
app.use('/api/ai-logs', aiLogRoutes)
app.use('/api/saved-reports', savedReportRoutes)
app.use('/api/billing', billingRoutes)
app.use('/api/tires', tireRoutes)
app.use('/api/fuel-imports', fuelImportRoutes)
app.use('/api/service-intervals', serviceIntervalRoutes)
app.use('/api/waybills', waybillRoutes)
app.use('/api/warranties', warrantyRoutes)
app.use('/api/support', supportRoutes)
app.use('/api/data', importDataRoutes)
app.use('/api/warehouses', warehouseRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/engine-records', engineRecordRoutes)
app.use('/api/inspections', techInspectionRoutes)
app.use('/api/branch-analytics', branchAnalyticsRoutes)
app.use('/api/fleet-risk', fleetRiskRoutes)
app.use('/api/gps', gpsRoutes)
app.use('/api/oil-change', oilChangeRoutes)
app.use('/api/analytics/drivers', driverAnalyticsRoutes)
app.use('/api/analytics/vehicle-costs', vehicleCostsRoutes)
app.use('/api/fuel-analytics', fuelGpsCheckRoutes)
app.use('/api/telegram', telegramRoutes)
app.use('/api/budget', budgetRoutes)
app.use('/api/batches', batchRoutes)
app.use('/api/requests', requestRoutes)
app.use('/api/tire-tracking', tireTrackingRoutes)

// Swagger API docs — only in development
if (process.env.NODE_ENV !== 'production') {
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customSiteTitle: 'AutoHisob API Docs',
    customCss: '.swagger-ui .topbar { display: none }',
  }))
}

app.use(errorHandler)

async function autoSeed() {
  try {
    const { prisma } = await import('./lib/prisma')
    const count = await prisma.user.count()
    if (count !== 0) return

    // Safety guard: if DB contains other data (branches/vehicles) but zero users —
    // bu fresh install emas, balki ma'lumot yo'qolishi stsenariysi. Re-seed qilsak
    // incident forensics ko'milib ketadi va soxta "yangi" admin yaratib foydalanuvchini adashtiramiz.
    // FORCE_SEED_ADMIN=1 bilan qayta majburlab ishga tushirish mumkin.
    const [branchCount, vehicleCount] = await Promise.all([
      prisma.branch.count().catch(() => 0),
      prisma.vehicle.count().catch(() => 0),
    ])
    if ((branchCount + vehicleCount) > 0 && process.env.FORCE_SEED_ADMIN !== '1') {
      console.error('🚨 CRITICAL: DB da branches=' + branchCount + ', vehicles=' + vehicleCount + ' bor, lekin users=0.')
      console.error('🚨 Ehtimoliy ma\'lumot yo\'qolishi — AUTO-SEED O\'TKAZIB YUBORILDI (forensics saqlanadi).')
      console.error('🚨 Agar bu chindan fresh install bo\'lsa, FORCE_SEED_ADMIN=1 bilan qayta ishga tushiring.')
      return
    }

    if (process.env.NODE_ENV === 'production') {
      const seedPw = process.env.ADMIN_SEED_PASSWORD
      const seedEmail = process.env.ADMIN_SEED_EMAIL
      if (!seedPw || !seedEmail) {
        console.warn('⚠️  Database bo\'sh, lekin production da ADMIN_SEED_PASSWORD/ADMIN_SEED_EMAIL belgilanmagan. Auto-seed o\'tkazib yuborildi.')
        return
      }
      const bcrypt = await import('bcrypt')
      await prisma.user.create({
        data: {
          fullName: 'Bosh Admin',
          email: seedEmail,
          passwordHash: await bcrypt.default.hash(seedPw, 12),
          role: 'admin',
          isActive: true,
          emailVerified: true,
        }
      })
      console.log('✅ Production admin yaratildi (parol env dan olindi).')
      return
    }

    // Development only
    const bcrypt = await import('bcrypt')
    await prisma.user.create({
      data: {
        fullName: 'Bosh Admin',
        email: 'admin@avtohisob.uz',
        passwordHash: await bcrypt.default.hash('Admin@123', 12),
        role: 'admin',
        isActive: true,
        emailVerified: true,
      }
    })
    console.log('🌱 Dev admin yaratildi: admin@avtohisob.uz / Admin@123 (faqat development)')
  } catch (e) {
    console.error('Seed xatosi:', e)
  }
}

const server = http.createServer(app)
initSocket(server)

async function logStartupSnapshot() {
  // pm2 logida doimiy tarix qoldiradi — har bir restartda DB hajmini yozib boradi.
  // Agar ma'lumot yo'qolsa, qaysi restartda sodir bo'lganini aniqlash oson bo'ladi.
  try {
    const { prisma } = await import('./lib/prisma')
    const [users, vehicles, branches] = await Promise.all([
      prisma.user.count().catch(() => -1),
      prisma.vehicle.count().catch(() => -1),
      prisma.branch.count().catch(() => -1),
    ])
    console.log(`📊 DB snapshot at startup: users=${users} vehicles=${vehicles} branches=${branches}`)
  } catch (e: any) {
    console.warn('DB snapshot failed:', e?.message ?? e)
  }
}

server.listen(PORT, async () => {
  console.log(`✅ Server running on http://localhost:${PORT}`)
  await logStartupSnapshot()
  await autoSeed()
  startScheduler()
  await initTelegramBot()
  // PM2 wait_ready signal: ecosystem.config.js da wait_ready: true —
  // bu signalsiz PM2 10s timeout kutadi. Ready signal bilan deploy tez va ishonchli.
  if (typeof process.send === 'function') process.send('ready')
})

// Graceful shutdown — yopilayotganda ochiq so'rovlar tugashini kutadi,
// DB ulanishlarini yopadi, 10s dan keyin majburiy chiqadi
async function shutdown(signal: string) {
  console.log(`${signal} qabul qilindi — to'xtatilmoqda...`)
  server.close(async () => {
    try {
      const { prisma } = await import('./lib/prisma')
      await prisma.$disconnect()
    } catch {}
    process.exit(0)
  })
  setTimeout(() => {
    console.error('Graceful shutdown vaqt tugadi — majburiy chiqish')
    process.exit(1)
  }, 10000).unref()
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

export default app
