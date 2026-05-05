import { Server } from 'socket.io'
import http from 'http'
import jwt from 'jsonwebtoken'
import { prisma } from './prisma'
import { getOrgFilter, isBranchAllowed } from './orgFilter'

let io: Server | null = null

export function initSocket(server: http.Server): Server {
  const allowedOrigin = process.env.CORS_ORIGIN || 'http://localhost:3000'
  io = new Server(server, {
    cors: {
      origin: allowedOrigin,
      credentials: true,
    },
    path: '/ws',
  })

  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token
    if (!token) return next(new Error('Authentication required'))
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET!) as any
      // Check token blacklist (explicit logout/revocation)
      const blacklisted = await prisma.tokenBlacklist.findUnique({ where: { token } })
      if (blacklisted) return next(new Error('Token revoked'))
      // Check user is still active
      const user = await prisma.user.findUnique({ where: { id: payload.id }, select: { isActive: true } })
      if (!user?.isActive) return next(new Error('Account inactive'))
      socket.data.user = payload
      next()
    } catch {
      next(new Error('Invalid token'))
    }
  })

  io.on('connection', (socket) => {
    const user = socket.data.user
    if (user?.branchId) socket.join(`branch:${user.branchId}`)
    socket.join(`user:${user.id}`)

    // Org darajasidagi room — fuel anomaliya kabi org-wide alertlar uchun.
    // user.branchId — admin uchun org root, sub-user uchun filial id.
    // Shuning uchun sub-user'lar uchun branch.organizationId topib qo'shamiz.
    ;(async () => {
      try {
        if (!user?.branchId) return
        if (user.role === 'admin' || user.role === 'super_admin') {
          // Admin uchun branchId = root tashkilot
          socket.join(`org:${user.branchId}`)
        } else {
          const branch = await prisma.branch.findUnique({
            where: { id: user.branchId },
            select: { organizationId: true },
          })
          const orgId = branch?.organizationId || user.branchId
          socket.join(`org:${orgId}`)
        }
      } catch { /* room qo'shilmasdan davom etamiz */ }
    })()

    // Cross-org himoya: vehicle.branchId foydalanuvchining org'iga tegishli bo'lishi shart.
    // Avval istalgan vehicleId ga subscribe bo'lib boshqa kompaniya mashinalarining
    // real-time hodisalarini eshitish mumkin edi.
    socket.on('subscribe:vehicle', async (vehicleId: string) => {
      try {
        if (typeof vehicleId !== 'string' || !vehicleId) return
        const vehicle = await prisma.vehicle.findUnique({
          where: { id: vehicleId },
          select: { branchId: true },
        })
        if (!vehicle) return
        const filter = await getOrgFilter({
          id: user.id,
          role: user.role,
          branchId: user.branchId ?? null,
        })
        if (!isBranchAllowed(filter, vehicle.branchId)) return
        socket.join(`vehicle:${vehicleId}`)
      } catch {
        // ulanishni buzmaymiz — sub bermaymiz xolos
      }
    })
    socket.on('unsubscribe:vehicle', (vehicleId: string) => {
      if (typeof vehicleId === 'string' && vehicleId) socket.leave(`vehicle:${vehicleId}`)
    })
  })

  return io
}

export function getIO(): Server {
  if (!io) throw new Error('Socket.io not initialized')
  return io
}

export function emitToVehicle(vehicleId: string, event: string, data: unknown) {
  try { getIO().to(`vehicle:${vehicleId}`).emit(event, data) } catch {}
}

export function emitToBranch(branchId: string, event: string, data: unknown) {
  try { getIO().to(`branch:${branchId}`).emit(event, data) } catch {}
}

export function emitToUser(userId: string, event: string, data: unknown) {
  try { getIO().to(`user:${userId}`).emit(event, data) } catch {}
}

export function emitToOrg(orgId: string, event: string, data: unknown) {
  try { getIO().to(`org:${orgId}`).emit(event, data) } catch {}
}
