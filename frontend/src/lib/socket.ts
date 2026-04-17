import { io, Socket } from 'socket.io-client'

let socket: Socket | null = null

export function connectSocket(token: string): Socket {
  if (socket?.connected) return socket

  const baseUrl = (import.meta.env.VITE_API_URL as string)?.replace('/api', '') || 'http://localhost:3001'

  socket = io(baseUrl, {
    path: '/ws',
    auth: { token },
    autoConnect: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: 5,
  })

  if (import.meta.env.DEV) {
    socket.on('connect', () => console.log('[Socket] Connected'))
    socket.on('disconnect', (reason) => console.log('[Socket] Disconnected:', reason))
    socket.on('connect_error', (err) => console.warn('[Socket] Error:', err.message))
  }

  return socket
}

export function getSocket(): Socket | null { return socket }

export function disconnectSocket() {
  socket?.disconnect()
  socket = null
}

export function subscribeToVehicle(vehicleId: string) {
  socket?.emit('subscribe:vehicle', vehicleId)
}

export function unsubscribeFromVehicle(vehicleId: string) {
  socket?.emit('unsubscribe:vehicle', vehicleId)
}
