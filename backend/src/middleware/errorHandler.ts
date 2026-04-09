import { Request, Response, NextFunction } from 'express'

export class AppError extends Error {
  statusCode: number
  constructor(message: string, statusCode: number = 400) {
    super(message)
    this.statusCode = statusCode
    Error.captureStackTrace(this, this.constructor)
  }
}

export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  const isDev = process.env.NODE_ENV !== 'production'

  // In development: log full error with stack; in production: log minimal info
  if (isDev) {
    console.error('[Error]', err)
  } else {
    console.error(`[Error] ${req.method} ${req.path} — ${err.message || err}`)
  }

  // CORS errors
  if (err.message?.startsWith('CORS:')) {
    return res.status(403).json({ success: false, error: err.message })
  }

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ success: false, error: err.message })
  }

  // Prisma unique constraint
  if (err.code === 'P2002') {
    return res.status(409).json({ success: false, error: 'Bu ma\'lumot allaqachon mavjud' })
  }

  // Prisma not found
  if (err.code === 'P2025') {
    return res.status(404).json({ success: false, error: 'Ma\'lumot topilmadi' })
  }

  // Rate limit errors (from express-rate-limit)
  if (err.status === 429) {
    return res.status(429).json({ success: false, error: err.message })
  }

  // Never expose internal error details to client in production
  res.status(500).json({
    success: false,
    error: isDev ? (err.message || 'Server xatosi') : 'Server xatosi yuz berdi',
  })
}
