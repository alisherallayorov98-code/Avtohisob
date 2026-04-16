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
import authRoutes from './routes/auth'
import vehicleRoutes from './routes/vehicles'
import sparePartRoutes from './routes/spareParts'
import inventoryRoutes from './routes/inventory'
import maintenanceRoutes from './routes/maintenance'
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
import swaggerUi from 'swagger-ui-express'
import { swaggerSpec } from './lib/swagger'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3001

// Trust nginx reverse proxy — required for rate-limit and real IP detection
app.set('trust proxy', 1)

app.use(helmet())
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, Postman in dev)
    if (!origin) return callback(null, true)
    const allowed = [
      'http://localhost:3000',
      'http://localhost:5173',
      ...(process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map(s => s.trim()) : []),
    ]
    if (allowed.some(o => origin === o || origin.startsWith(o))) {
      callback(null, true)
    } else {
      callback(new Error(`CORS: ${origin} ruxsatsiz manba`))
    }
  },
  credentials: true,
}))

// Auth endpoints: strict limit (brute-force protection)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 30,
  message: { success: false, error: 'Juda ko\'p urinish. 15 daqiqadan keyin qayta urinib ko\'ring.' },
  standardHeaders: true,
  legacyHeaders: false,
})
app.use('/api/auth/login', authLimiter)
app.use('/api/auth/register', authLimiter)
app.use('/api/auth/forgot-password', authLimiter)

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
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')))

app.get('/api/health', (_, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime() })
})

app.use('/api/auth', authRoutes)
app.use('/api/vehicles', vehicleRoutes)
app.use('/api/spare-parts', sparePartRoutes)
app.use('/api/inventory', inventoryRoutes)
app.use('/api/maintenance', maintenanceRoutes)
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
    if (count === 0) {
      console.log('🌱 Database bo\'sh — seed ishga tushmoqda...')
      const bcrypt = await import('bcrypt')
      const hash = (pw: string) => bcrypt.default.hash(pw, 12)
      await prisma.user.create({
        data: {
          fullName: 'Bosh Admin',
          email: 'admin@avtohisob.uz',
          passwordHash: await hash('Admin@123'),
          role: 'admin',
          isActive: true,
          emailVerified: true,
        }
      })
      console.log('✅ Standart admin yaratildi: admin@avtohisob.uz — parolni darhol o\'zgartiring!')
    }
  } catch (e) {
    console.error('Seed xatosi:', e)
  }
}

const server = http.createServer(app)
initSocket(server)

server.listen(PORT, async () => {
  console.log(`✅ Server running on http://localhost:${PORT}`)
  await autoSeed()
  startScheduler()
})

export default app
