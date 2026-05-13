import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { tmaAuth, tmaMe } from '../controllers/tma'

const router = Router()

router.post('/auth', tmaAuth)              // public — initData bilan token olish
router.get('/me', authenticate, tmaMe)    // token tekshirish

export default router
