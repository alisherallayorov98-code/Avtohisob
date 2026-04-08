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
import warrantyRoutes from './routes/warranties'
import supportRoutes from './routes/support'
import importDataRoutes from './routes/importData'
import adminRoutes from './routes/admin'
import swaggerUi from 'swagger-ui-express'
import { swaggerSpec } from './lib/swagger'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3001

app.use(helmet())
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true,
}))

const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'),
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
  message: { success: false, error: 'Too many requests' },
})
app.use('/api/', limiter)

app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))
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
app.use('/api/warranties', warrantyRoutes)
app.use('/api/support', supportRoutes)
app.use('/api/data', importDataRoutes)
app.use('/api/admin', adminRoutes)

// Swagger API docs (non-production or with auth header)
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customSiteTitle: 'AutoHisob API Docs',
  customCss: '.swagger-ui .topbar { display: none }',
}))

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
      console.log('✅ Admin yaratildi: admin@avtohisob.uz / Admin@123')
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
