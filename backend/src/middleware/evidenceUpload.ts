import multer from 'multer'
import path from 'path'
import fs from 'fs'
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

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    try {
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })
    } catch {}
    cb(null, tmpDir)
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg'
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`)
  },
})

export const uploadEvidence = multer({
  storage,
  limits: { fileSize: MAX_SIZE_BYTES, files: 3 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true)
    else cb(new Error('Faqat rasm fayllari qabul qilinadi (JPEG, PNG, WebP)'))
  },
})

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
  for (const file of req.files as Express.Multer.File[]) {
    const outName = `${path.basename(file.filename, path.extname(file.filename))}.jpg`
    const outPath = path.join(monthDir, outName)

    try {
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

  ;(req as any).compressedFiles = compressed
  next()
}
