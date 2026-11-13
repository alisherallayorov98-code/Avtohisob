import { Response, NextFunction } from 'express'
import { AuthRequest, successResponse } from '../types'
import { getInsights, dismissInsight, listDismissals, restoreDismissal } from '../services/insightsService'

export async function getInsightsHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { branchId, refresh } = req.query as Record<string, string | undefined>
    res.json(successResponse(await getInsights(req.user!, { branchId: branchId || undefined, refresh: refresh === '1' })))
  } catch (err) { next(err) }
}

export async function dismissInsightHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(successResponse(await dismissInsight(req.user!, req.body)))
  } catch (err) { next(err) }
}

export async function listDismissalsHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(successResponse(await listDismissals(req.user!)))
  } catch (err) { next(err) }
}

export async function restoreDismissalHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(successResponse(await restoreDismissal(req.user!, req.params.id)))
  } catch (err) { next(err) }
}
