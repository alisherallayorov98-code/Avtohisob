import { Router } from 'express'
import {
  register, login, logout, refreshToken, me, changePassword, acceptTerms, completeOnboarding,
  sendVerification, verifyEmail,
  forgotPassword, resetPassword,
  setup2FA, verify2FA, disable2FA,
  setPreferredLanguage,
} from '../controllers/auth'
import { signupSendCode, signupVerify } from '../controllers/signup'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'
import { authLimiter } from '../middleware/rateLimiter'
import { checkLimit } from '../middleware/subscriptionGuard'

const router = Router()

// Public self-registration (telefon + SMS tasdiqlash)
router.post('/signup/send-code', authLimiter, signupSendCode)
router.post('/signup/verify', authLimiter, signupVerify)

// Core auth
router.post('/register', authenticate, authorize('admin'), checkLimit('users'), register)
router.post('/login', authLimiter, login)
router.post('/refresh-token', authLimiter, refreshToken)
router.get('/me', authenticate, me)
router.put('/change-password', authenticate, authLimiter, changePassword)
router.post('/accept-terms', authenticate, acceptTerms)
router.post('/complete-onboarding', authenticate, completeOnboarding)
router.patch('/me/language', authenticate, setPreferredLanguage)
router.post('/logout', authenticate, logout)

// Email verification
router.post('/send-verification', authenticate, sendVerification)
router.post('/verify-email', authLimiter, verifyEmail)

// Password reset
router.post('/forgot-password', authLimiter, forgotPassword)
router.post('/reset-password', authLimiter, resetPassword)

// 2FA
router.post('/2fa/setup', authenticate, setup2FA)
router.post('/2fa/verify', authenticate, verify2FA)
router.delete('/2fa/disable', authenticate, disable2FA)

export default router
