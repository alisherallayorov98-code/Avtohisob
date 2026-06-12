import { Router } from 'express'
import { getPublicStats } from '../controllers/publicStats'

// Public landing statistikasi — auth yo'q, faqat-o'qish.
// Natija controller'da 5 daqiqa cache'lanadi.
export const publicStatsRouter = Router()
publicStatsRouter.get('/', getPublicStats)

export default publicStatsRouter
