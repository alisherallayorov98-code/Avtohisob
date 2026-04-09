import rateLimit from 'express-rate-limit'

/** Strict rate limiter for authentication endpoints — brute-force protection */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,                    // max 10 attempts per window
  skipSuccessfulRequests: true,
  message: { success: false, error: "Juda ko'p urinish. 15 daqiqadan so'ng qayta urinib ko'ring." },
  standardHeaders: true,
  legacyHeaders: false,
})
