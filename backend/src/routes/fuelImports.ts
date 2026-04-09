import { Router } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import {
  parseVedomost,
  listImports,
  getImport,
  updateRow,
  deleteRow,
  confirmImport,
  deleteImport,
} from '../controllers/fuelImports'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'

const router = Router()
router.use(authenticate)

// Vedomost upload: accept images, PDF, Excel
const uploadDir = path.join(process.cwd(), 'uploads')
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true })

const vedomostStorage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadDir),
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname)
    cb(null, `vedomost-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`)
  },
})

const vedomostUpload = multer({
  storage: vedomostStorage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (_, file, cb) => {
    const allowed = [
      'image/jpeg', 'image/png', 'image/webp',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ]
    const ext = path.extname(file.originalname).toLowerCase()
    const allowedExt = ['.jpg', '.jpeg', '.png', '.webp', '.pdf', '.xlsx', '.xls']
    if (allowed.includes(file.mimetype) || allowedExt.includes(ext)) {
      cb(null, true)
    } else {
      cb(new Error('Faqat rasm (JPG/PNG), PDF yoki Excel (.xlsx) fayllar qabul qilinadi'))
    }
  },
})

router.post('/parse', authorize('admin', 'manager', 'branch_manager'), vedomostUpload.single('file'), parseVedomost)
router.get('/', listImports)
router.get('/:id', getImport)
router.patch('/:id/rows/:rowId', authorize('admin', 'manager', 'branch_manager'), updateRow)
router.delete('/:id/rows/:rowId', authorize('admin', 'manager', 'branch_manager'), deleteRow)
router.post('/:id/confirm', authorize('admin', 'manager'), confirmImport)
router.delete('/:id', authorize('admin', 'manager'), deleteImport)

export default router
