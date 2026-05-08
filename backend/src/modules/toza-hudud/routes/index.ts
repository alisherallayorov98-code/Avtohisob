import { Router } from 'express'
import { authenticate } from '../../../middleware/auth'
import { requireFeature } from '../../../middleware/subscriptionGuard'
import { getRegions, createRegion, updateRegion, deleteRegion } from '../controllers/regions'
import { getDistricts, createDistrict, updateDistrict, deleteDistrict } from '../controllers/districts'
import { getMfys, createMfy, updateMfy, deleteMfy } from '../controllers/mfys'
import { getLandfills, createLandfill, updateLandfill, deleteLandfill } from '../controllers/landfills'
import { downloadTemplate, importMfys, upload } from '../controllers/mfyImport'
import { importKml, kmlUpload } from '../controllers/kmlImport'
import { getSchedules, upsertSchedule, deleteSchedule } from '../controllers/schedules'
import { downloadScheduleTemplate, importSchedules, scheduleUpload } from '../controllers/scheduleImport'
import { getServiceTrips, getLandfillTrips, triggerMonitoring, getServiceStats } from '../controllers/trips'
import { getGeozones, linkGeozoneMfy, importMfysFromGeozones, syncPolygonsFromGps, syncContainersGps, getVehiclePositions, getGpsHealthCheck, getUnitMatch } from '../controllers/gps'
import { getContainers, createContainer, updateContainer, deleteContainer, getContainerVisits, getContainerVisitStats, getContainerAnalyticsHandler } from '../controllers/containers'
import {
  getDashboardStats,
  getDailyReport, getMonthlyMfyReport, getMonthlyVehicleReport,
  exportDailyExcel, exportMonthlyMfyExcel, exportMonthlyVehicleExcel,
  getWeeklyTrends,
} from '../controllers/reports'
import { getThSettings, updateThSettings } from '../controllers/settings'
import { getHolidays, createHoliday, deleteHoliday, getScheduleSuggestionsHandler } from '../controllers/holidays'
import { getSupervisorOverview, getSupervisorAiOverview } from '../controllers/supervisor'
import {
  getDriverVehicles, getDriverToday, generateDriverQR,
  getDriverPublicToday, checkDriverPin, getRoutePublic,
} from '../controllers/driver'
import { getVehicleTrack } from '../controllers/tracks'
import { getCoveragePublic, verifyCoverage, startAiTraining, getAiStatus, startIncrementalTraining, getAiTrend, getAiMissedPatterns, getAiDebug } from '../controllers/coverageMap'

const router = Router()

// ── Public endpoints (before auth middleware) ─────────────────────────────────
// Haydovchi token + PIN bilan kiradi — JWT auth shart emas
router.get('/driver/public-today', getDriverPublicToday)
router.post('/driver/check-pin', checkDriverPin)
// Ko'cha qamrovi xaritasi — HMAC-token orqali, ochiq havola
router.get('/coverage-public', getCoveragePublic)
// Haydovchi "Men oldim" tasdiqlash — GPS yangi tortiladi
router.post('/coverage-verify', verifyCoverage)
// Haydovchi marshut taklifi — token orqali, public
router.get('/routes/public', getRoutePublic)

// ── Authenticated endpoints ───────────────────────────────────────────────────
router.use(authenticate, requireFeature('tozahudud_module'))

router.get('/regions', getRegions)
router.post('/regions', createRegion)
router.put('/regions/:id', updateRegion)
router.delete('/regions/:id', deleteRegion)

router.get('/districts', getDistricts)
router.post('/districts', createDistrict)
router.put('/districts/:id', updateDistrict)
router.delete('/districts/:id', deleteDistrict)

router.get('/mfys', getMfys)
router.post('/mfys', createMfy)
router.put('/mfys/:id', updateMfy)
router.delete('/mfys/:id', deleteMfy)
router.get('/mfys/template', downloadTemplate)
router.post('/mfys/import', upload.single('file'), importMfys)

router.get('/schedules', getSchedules)
router.post('/schedules', upsertSchedule)
router.delete('/schedules/:vehicleId/:mfyId', deleteSchedule)
router.get('/schedules/template', downloadScheduleTemplate)
router.post('/schedules/import', scheduleUpload.single('file'), importSchedules)

router.get('/landfills', getLandfills)
router.post('/landfills', createLandfill)
router.put('/landfills/:id', updateLandfill)
router.delete('/landfills/:id', deleteLandfill)

router.get('/trips/service', getServiceTrips)
router.get('/trips/service/stats', getServiceStats)
router.get('/trips/landfills', getLandfillTrips)
router.post('/trips/run', triggerMonitoring)

router.get('/gps/positions', getVehiclePositions)
router.get('/gps/health-check', getGpsHealthCheck)
router.get('/gps/unit-match', getUnitMatch)
router.get('/gps/zones', getGeozones)
router.post('/gps/zones/link', linkGeozoneMfy)
router.post('/gps/import-mfys', importMfysFromGeozones)
router.post('/gps/sync-polygons', syncPolygonsFromGps)
router.post('/gps/sync-containers', syncContainersGps)

router.get('/containers', getContainers)
router.post('/containers', createContainer)
router.put('/containers/:id', updateContainer)
router.delete('/containers/:id', deleteContainer)
router.get('/containers/analytics', getContainerAnalyticsHandler)
router.get('/containers/visits', getContainerVisits)
router.get('/containers/visits/stats', getContainerVisitStats)
router.post('/mfys/import-kml', kmlUpload.single('file'), importKml)

router.get('/settings', getThSettings)
router.put('/settings', updateThSettings)

router.get('/supervisor/overview', getSupervisorOverview)
router.get('/supervisor/ai-overview', getSupervisorAiOverview)

router.get('/holidays', getHolidays)
router.post('/holidays', createHoliday)
router.delete('/holidays/:id', deleteHoliday)
router.get('/schedules/suggest', getScheduleSuggestionsHandler)

// AI Coverage Fingerprint
router.post('/ai/train', startAiTraining)
router.post('/ai/train-incremental', startIncrementalTraining)
router.get('/ai/status', getAiStatus)
router.get('/ai/trend/:vehicleId/:mfyId', getAiTrend)
router.get('/ai/missed-patterns', getAiMissedPatterns)
router.get('/ai/debug', getAiDebug)

router.get('/driver/vehicles', getDriverVehicles)
router.get('/driver/today', getDriverToday)
router.get('/driver/qr/:vehicleId', generateDriverQR)

router.get('/tracks', getVehicleTrack)

router.get('/reports/dashboard', getDashboardStats)
router.get('/reports/trends/weekly', getWeeklyTrends)
router.get('/reports/daily', getDailyReport)
router.get('/reports/daily/excel', exportDailyExcel)
router.get('/reports/monthly/mfy', getMonthlyMfyReport)
router.get('/reports/monthly/mfy/excel', exportMonthlyMfyExcel)
router.get('/reports/monthly/vehicles', getMonthlyVehicleReport)
router.get('/reports/monthly/vehicles/excel', exportMonthlyVehicleExcel)

export default router
