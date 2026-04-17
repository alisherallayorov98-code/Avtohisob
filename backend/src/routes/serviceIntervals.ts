import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { authorize } from '../middleware/rbac';
import {
  getVehicleIntervals,
  createInterval,
  updateInterval,
  completeService,
  getDueIntervals,
  updateVehicleOdometer,
  deleteInterval,
} from '../controllers/serviceIntervals';

const router = Router();
router.use(authenticate);

// Fleet-wide: GET /api/service-intervals/due
router.get('/due', getDueIntervals);

// Per-vehicle: GET/POST /api/service-intervals/vehicles/:id/intervals
router.get('/vehicles/:id/intervals', getVehicleIntervals);
router.post('/vehicles/:id/intervals', authorize('admin', 'super_admin', 'manager', 'branch_manager'), createInterval);

// Odometer quick-update: PATCH /api/service-intervals/vehicles/:id/odometer
router.patch('/vehicles/:id/odometer', authorize('admin', 'super_admin', 'manager', 'branch_manager'), updateVehicleOdometer);

// Per-interval: PATCH/POST/DELETE /api/service-intervals/:id
router.patch('/:id', authorize('admin', 'super_admin', 'manager', 'branch_manager'), updateInterval);
router.post('/:id/complete', authorize('admin', 'super_admin', 'manager', 'branch_manager'), completeService);
router.delete('/:id', authorize('admin', 'super_admin'), deleteInterval);

export default router;
