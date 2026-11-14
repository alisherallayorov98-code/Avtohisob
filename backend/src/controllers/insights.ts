import { Response, NextFunction } from 'express'
import { AuthRequest, successResponse } from '../types'
import {
  getInsights, dismissInsight, listDismissals, restoreDismissal, askInsights, getVehicleDossier,
  listAssignees, assignInsight, unassignInsight, getInsightSettings, saveInsightSettings, buildInsightsWorkbook,
} from '../services/insightsService'
import { uzDay } from '../lib/insights/context'

type Handler = (req: AuthRequest) => Promise<unknown>
const wrap = (fn: Handler) => async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(successResponse(await fn(req))) } catch (err) { next(err) }
}

export const getInsightsHandler = wrap(req => {
  const { branchId, refresh } = req.query as Record<string, string | undefined>
  return getInsights(req.user!, { branchId: branchId || undefined, refresh: refresh === '1' })
})
export const askHandler = wrap(req => askInsights(req.user!, req.body))
export const dossierHandler = wrap(req => getVehicleDossier(req.user!, req.params.id))
export const dismissInsightHandler = wrap(req => dismissInsight(req.user!, req.body))
export const listDismissalsHandler = wrap(req => listDismissals(req.user!))
export const restoreDismissalHandler = wrap(req => restoreDismissal(req.user!, req.params.id))
export const assigneesHandler = wrap(req => listAssignees(req.user!))
export const assignHandler = wrap(req => assignInsight(req.user!, req.body))
export const unassignHandler = wrap(req => unassignInsight(req.user!, req.params.id))
export const getSettingsHandler = wrap(req => getInsightSettings(req.user!))
export const saveSettingsHandler = wrap(req => saveInsightSettings(req.user!, req.body))

export async function exportHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { branchId } = req.query as Record<string, string | undefined>
    const wb = await buildInsightsWorkbook(req.user!, branchId || undefined)
    const day = uzDay(new Date()).split('-').reverse().join('.')
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="tahlil-${day}.xlsx"`)
    await wb.xlsx.write(res)
    res.end()
  } catch (err) { next(err) }
}
