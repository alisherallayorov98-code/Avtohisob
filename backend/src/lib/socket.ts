import { Server } from 'socket.io'
import http from 'http'
import jwt from 'jsonwebtoken'

let io: Server | null = null

export function initSocket(server: http.Server): Server {
  io = new Server(server, {
    cors: {
      origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
      credentials: true,
    },
    path: '/ws',
  })

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token
    if (!token) return next(new Error('Authentication required'))
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET!) as any
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

    socket.on('subscribe:vehicle', (vehicleId: string) => {
      socket.join(`vehicle:${vehicleId}`)
    })
    socket.on('unsubscribe:vehicle', (vehicleId: string) => {
      socket.leave(`vehicle:${vehicleId}`)
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
