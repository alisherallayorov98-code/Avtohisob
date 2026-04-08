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
  console.error(err)

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ success: false, error: err.message })
  }

  if (err.code === 'P2002') {
    return res.status(409).json({ success: false, error: 'Bu ma\'lumot allaqachon mavjud' })
  }

  if (err.code === 'P2025') {
    return res.status(404).json({ success: false, error: 'Ma\'lumot topilmadi' })
  }

  res.status(500).json({ success: false, error: 'Server xatosi yuz berdi' })
}
