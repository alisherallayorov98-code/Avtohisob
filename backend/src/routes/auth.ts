import { Router } from 'express'
import {
  register, login, logout, refreshToken, me, changePassword,
  sendVerification, verifyEmail,
  forgotPassword, resetPassword,
  setup2FA, verify2FA, disable2FA,
} from '../controllers/auth'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'
import { authLimiter } from '../middleware/rateLimiter'
import { checkLimit } from '../middleware/subscriptionGuard'

const router = Router()

// Core auth
router.post('/register', authenticate, authorize('admin'), checkLimit('users'), register)
router.post('/login', authLimiter, login)
router.post('/refresh-token', authLimiter, refreshToken)
router.get('/me', authenticate, me)
router.put('/change-password', authenticate, changePassword)
router.post('/logout', authenticate, logout)

// Email verification
router.post('/send-verification', authenticate, sendVerification)
router.post('/verify-email', verifyEmail)

// Password reset
router.post('/forgot-password', authLimiter, forgotPassword)
router.post('/reset-password', authLimiter, resetPassword)

// 2FA
router.post('/2fa/setup', authenticate, setup2FA)
router.post('/2fa/verify', authenticate, verify2FA)
router.delete('/2fa/disable', authenticate, disable2FA)

export default router
