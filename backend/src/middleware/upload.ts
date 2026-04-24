import multer from 'multer'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { Request, Response, NextFunction } from 'express'
import { AppError } from './errorHandler'

const uploadDir = path.join(process.cwd(), 'uploads')
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true })

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadDir),
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname)
    // Cryptographically unguessable: 32 hex chars = 2^128 space, brute-force mumkin emas
    const random = crypto.randomBytes(16).toString('hex')
    cb(null, `${random}${ext}`)
  },
})

const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const ALLOWED_EXTS  = ['.jpg', '.jpeg', '.png', '.webp', '.gif']

const fileFilter = (_: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const ext = path.extname(file.originalname).toLowerCase()
  if (!ALLOWED_MIMES.includes(file.mimetype) || !ALLOWED_EXTS.includes(ext)) {
    return cb(new AppError('Faqat rasm fayllari qabul qilinadi (jpg, png, webp, gif)'))
  }
  cb(null, true)
}

export const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
})

function checkMagicBytes(filePath: string, mimetype: string): boolean {
  try {
    const buf = Buffer.alloc(12)
    const fd = fs.openSync(filePath, 'r')
    fs.readSync(fd, buf, 0, 12, 0)
    fs.closeSync(fd)
    const hex = buf.toString('hex').toLowerCase()
    if (mimetype === 'image/jpeg') return hex.startsWith('ffd8ff')
    if (mimetype === 'image/png') return hex.startsWith('89504e47')
    if (mimetype === 'image/webp') return buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP'
    if (mimetype === 'image/gif') return hex.startsWith('47494638')
    return false
  } catch { return false }
}

export function validateUpload(req: Request, res: Response, next: NextFunction) {
  if (!req.file) return next()
  if (!checkMagicBytes(req.file.path, req.file.mimetype)) {
    try { fs.unlinkSync(req.file.path) } catch {}
    return next(new AppError('Fayl formati noto\'g\'ri (magic bytes)', 400))
  }
  next()
}
