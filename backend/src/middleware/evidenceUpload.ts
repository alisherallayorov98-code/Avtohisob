import multer from 'multer'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { Request, Response, NextFunction } from 'express'

// Lazy-load sharp so a missing native binary doesn't crash the server at startup
let sharpLib: typeof import('sharp') | null = null
async function getSharp() {
  if (!sharpLib) {
    try {
      sharpLib = (await import('sharp')).default as any
    } catch (e: any) {
      console.error('[evidenceUpload] sharp yüklenmedi:', e.message)
    }
  }
  return sharpLib
}

const MAX_SIZE_BYTES = 10 * 1024 * 1024 // 10MB raw upload limit
const TARGET_SIZE_BYTES = 500 * 1024    // compress to ≤500KB

const tmpDir = path.join(process.cwd(), 'uploads', 'tmp')
const evidenceDir = path.join(process.cwd(), 'uploads', 'maintenance-evidence')

for (const dir of [tmpDir, evidenceDir]) {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  } catch (e: any) {
    console.warn(`[evidenceUpload] Could not create ${dir}: ${e.message}`)
  }
}

const ALLOWED_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const ALLOWED_IMAGE_EXTS  = ['.jpg', '.jpeg', '.png', '.webp', '.gif']
const ALLOWED_VIDEO_MIMES = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo']
const ALLOWED_VIDEO_EXTS  = ['.mp4', '.mov', '.webm', '.avi']

const MAX_VIDEO_SIZE_BYTES = 50 * 1024 * 1024 // 50MB video uchun

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    try {
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })
    } catch {}
    cb(null, tmpDir)
  },
  filename: (_req, file, cb) => {
    const random = crypto.randomBytes(16).toString('hex')
    const isVideo = ALLOWED_VIDEO_MIMES.includes(file.mimetype)
    const ext = isVideo ? (path.extname(file.originalname).toLowerCase() || '.mp4') : '.jpg'
    cb(null, `${random}${ext}`)
  },
})

export const uploadEvidence = multer({
  storage,
  limits: { fileSize: MAX_VIDEO_SIZE_BYTES, files: 3 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    const isImage = ALLOWED_IMAGE_MIMES.includes(file.mimetype) && ALLOWED_IMAGE_EXTS.includes(ext)
    const isVideo = ALLOWED_VIDEO_MIMES.includes(file.mimetype) && ALLOWED_VIDEO_EXTS.includes(ext)
    if (isImage || isVideo) cb(null, true)
    else cb(new Error('Faqat rasm (JPEG, PNG, WebP) yoki video (MP4, MOV, WebM) fayllari qabul qilinadi'))
  },
})

// Verify uploaded files are actually images by checking magic bytes.
// Defense-in-depth: MIME type can be spoofed, but file headers cannot (easily).
function checkMagicBytes(filePath: string): boolean {
  try {
    const buf = Buffer.alloc(12)
    const fd = fs.openSync(filePath, 'r')
    fs.readSync(fd, buf, 0, 12, 0)
    fs.closeSync(fd)
    const hex = buf.toString('hex').toLowerCase()
    if (hex.startsWith('ffd8ff')) return true // JPEG
    if (hex.startsWith('89504e47')) return true // PNG
    if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return true
    if (hex.startsWith('47494638')) return true // GIF
    return false
  } catch { return false }
}

function isVideoFile(file: Express.Multer.File): boolean {
  return ALLOWED_VIDEO_MIMES.includes(file.mimetype)
}

export function validateEvidenceFiles(req: Request, res: Response, next: NextFunction) {
  const files = req.files as Express.Multer.File[] | undefined
  if (!files || files.length === 0) return next()
  for (const file of files) {
    if (isVideoFile(file)) continue  // Video magic bytes tekshirilmaydi
    if (!checkMagicBytes(file.path)) {
      for (const f of files) { try { fs.unlinkSync(f.path) } catch {} }
      return next(new Error('Fayl formati noto\'g\'ri — yuklangan rasm emas'))
    }
  }
  next()
}

// After multer saves tmp file — compress with sharp and move to final location
export async function compressAndSave(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (!req.files || (req.files as Express.Multer.File[]).length === 0) {
    return next()
  }
  const month = new Date().toISOString().slice(0, 7) // YYYY-MM
  const monthDir = path.join(evidenceDir, month)
  if (!fs.existsSync(monthDir)) fs.mkdirSync(monthDir, { recursive: true })

  const compressed: Array<{ url: string; size: number }> = []

  const sharp = await getSharp()
  try {
    for (const file of req.files as Express.Multer.File[]) {
      const outName = `${path.basename(file.filename, path.extname(file.filename))}.jpg`
      const outPath = path.join(monthDir, outName)

      try {
        if (isVideoFile(file)) {
          // Video — siqish yo'q, to'g'ridan-to'g'ri ko'chirish
          const videoExt = path.extname(file.filename)
          const videoName = `${path.basename(file.filename, path.extname(file.filename))}${videoExt}`
          const videoOutPath = path.join(monthDir, videoName)
          fs.copyFileSync(file.path, videoOutPath)
          const stat = fs.statSync(videoOutPath)
          compressed.push({
            url: `/uploads/maintenance-evidence/${month}/${videoName}`,
            size: stat.size,
          })
          fs.unlink(file.path, () => {})
          continue
        }

        if (sharp) {
          await (sharp as any)(file.path)
            .rotate()
            .resize(1280, 1280, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 80, progressive: true })
            .toFile(outPath)

          const stat = fs.statSync(outPath)
          if (stat.size > TARGET_SIZE_BYTES) {
            await (sharp as any)(file.path)
              .rotate()
              .resize(960, 960, { fit: 'inside', withoutEnlargement: true })
              .jpeg({ quality: 60, progressive: true })
              .toFile(outPath)
          }
        } else {
          // sharp unavailable: copy original file as-is
          fs.copyFileSync(file.path, outPath)
        }

        const finalStat = fs.statSync(outPath)
        compressed.push({
          url: `/uploads/maintenance-evidence/${month}/${outName}`,
          size: finalStat.size,
        })
      } finally {
        fs.unlink(file.path, () => {})
      }
    }
  } catch (err) {
    return next(err)
  }

  ;(req as any).compressedFiles = compressed
  next()
}
