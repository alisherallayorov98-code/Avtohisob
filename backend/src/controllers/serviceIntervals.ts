import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { AuthRequest } from '../types';
import { getOrgFilter, applyBranchFilter, isBranchAllowed } from '../lib/orgFilter';

const SERVICE_TYPES = [
  'oil_change',
  'air_filter',
  'fuel_filter',
  'gearbox_oil',
  'coolant',
  'brake_fluid',
  'timing_belt',
  'spark_plug',
  'brake_pads',
] as const;

type ServiceType = typeof SERVICE_TYPES[number];

/** Recompute status based on current vehicle mileage */
function computeStatus(
  nextDueKm: number | null,
  warningKm: number,
  vehicleMileage: number,
): 'ok' | 'due_soon' | 'overdue' {
  if (nextDueKm === null) return 'ok';
  if (vehicleMileage >= nextDueKm) return 'overdue';
  if (vehicleMileage >= nextDueKm - warningKm) return 'due_soon';
  return 'ok';
}

/** GET /vehicles/:id/service-intervals */
export async function getVehicleIntervals(req: AuthRequest, res: Response) {
  const { id: vehicleId } = req.params;

  const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } });
  if (!vehicle) return res.status(404).json({ error: 'Avtomobil topilmadi' });

  const filter = await getOrgFilter(req.user!);
  if (!isBranchAllowed(filter, vehicle.branchId)) {
    return res.status(403).json({ error: "Ruxsat yo'q" });
  }

  const currentMileage = Number(vehicle.mileage);

  const intervals = await prisma.serviceInterval.findMany({
    where: { vehicleId },
    include: { records: { orderBy: { servicedAt: 'desc' }, take: 1 } },
    orderBy: { serviceType: 'asc' },
  });

  // Recompute & sync status
  const updated = await Promise.all(
    intervals.map(async (interval) => {
      const status = computeStatus(interval.nextDueKm, interval.warningKm, currentMileage);
      if (status !== interval.status) {
        return prisma.serviceInterval.update({
          where: { id: interval.id },
          data: { status },
          include: { records: { orderBy: { servicedAt: 'desc' }, take: 1 } },
        });
      }
      return interval;
    }),
  );

  res.json({ intervals: updated, currentMileage });
}

/** POST /vehicles/:id/service-intervals */
export async function createInterval(req: AuthRequest, res: Response) {
  const { id: vehicleId } = req.params;
  const {
    serviceType,
    intervalKm,
    intervalDays,
    warningKm = 500,
    lastServiceKm,
    lastServiceDate,
    notes,
  } = req.body;

  if (!SERVICE_TYPES.includes(serviceType)) {
    return res.status(400).json({ error: "Noto'g'ri xizmat turi" });
  }
  if (!intervalKm || !intervalDays) {
    return res.status(400).json({ error: 'intervalKm va intervalDays majburiy' });
  }
  if (parseInt(intervalKm) <= 0) {
    return res.status(400).json({ error: 'intervalKm musbat bo\'lishi kerak' });
  }
  if (parseInt(intervalDays) <= 0) {
    return res.status(400).json({ error: 'intervalDays musbat bo\'lishi kerak' });
  }
  if (warningKm !== undefined && parseInt(warningKm) >= parseInt(intervalKm)) {
    return res.status(400).json({ error: 'warningKm intervalKm dan kichik bo\'lishi kerak' });
  }

  const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } });
  if (!vehicle) return res.status(404).json({ error: 'Avtomobil topilmadi' });

  const filter = await getOrgFilter(req.user!);
  if (!isBranchAllowed(filter, vehicle.branchId)) {
    return res.status(403).json({ error: "Ruxsat yo'q" });
  }

  const currentMileage = Number(vehicle.mileage);
  const nextDueKm = lastServiceKm ? lastServiceKm + intervalKm : currentMileage + intervalKm;
  const nextDueDate = lastServiceDate
    ? new Date(new Date(lastServiceDate).getTime() + intervalDays * 24 * 60 * 60 * 1000)
    : new Date(Date.now() + intervalDays * 24 * 60 * 60 * 1000);

  const status = computeStatus(nextDueKm, warningKm, currentMileage);

  const interval = await prisma.serviceInterval.upsert({
    where: { vehicleId_serviceType: { vehicleId, serviceType } },
    create: {
      vehicleId,
      serviceType,
      intervalKm,
      intervalDays,
      warningKm,
      lastServiceKm: lastServiceKm ?? null,
      lastServiceDate: lastServiceDate ? new Date(lastServiceDate) : null,
      nextDueKm,
      nextDueDate,
      status,
      notes: notes ?? null,
    },
    update: {
      intervalKm,
      intervalDays,
      warningKm,
      lastServiceKm: lastServiceKm ?? null,
      lastServiceDate: lastServiceDate ? new Date(lastServiceDate) : null,
      nextDueKm,
      nextDueDate,
      status,
      notes: notes ?? null,
    },
  });

  res.status(201).json(interval);
}

/** PATCH /service-intervals/:id */
export async function updateInterval(req: AuthRequest, res: Response) {
  const { id } = req.params;
  const { intervalKm, intervalDays, warningKm, notes } = req.body;

  const interval = await prisma.serviceInterval.findUnique({ where: { id } });
  if (!interval) return res.status(404).json({ error: 'Interval topilmadi' });

  const vehicle = await prisma.vehicle.findUnique({ where: { id: interval.vehicleId } });
  if (!vehicle) return res.status(404).json({ error: 'Avtomobil topilmadi' });

  const filter = await getOrgFilter(req.user!);
  if (!isBranchAllowed(filter, vehicle.branchId)) {
    return res.status(403).json({ error: "Ruxsat yo'q" });
  }

  const currentMileage = Number(vehicle.mileage ?? 0);

  const newIntervalKm = intervalKm ?? interval.intervalKm;
  const newIntervalDays = intervalDays ?? interval.intervalDays;
  const newWarningKm = warningKm ?? interval.warningKm;

  const nextDueKm = interval.lastServiceKm
    ? interval.lastServiceKm + newIntervalKm
    : interval.nextDueKm;
  const nextDueDate = interval.lastServiceDate
    ? new Date(interval.lastServiceDate.getTime() + newIntervalDays * 24 * 60 * 60 * 1000)
    : interval.nextDueDate;

  const status = computeStatus(nextDueKm ?? null, newWarningKm, currentMileage);

  const updated = await prisma.serviceInterval.update({
    where: { id },
    data: { intervalKm: newIntervalKm, intervalDays: newIntervalDays, warningKm: newWarningKm, nextDueKm, nextDueDate, status, notes: notes ?? interval.notes },
  });

  res.json(updated);
}

/** POST /service-intervals/:id/complete */
export async function completeService(req: AuthRequest, res: Response) {
  const { id } = req.params;
  const { servicedAtKm, servicedAt, cost = 0, technicianName, notes, nextDueKm: customNextDueKm } = req.body;

  const interval = await prisma.serviceInterval.findUnique({
    where: { id },
    include: { vehicle: true },
  });
  if (!interval) return res.status(404).json({ error: 'Interval topilmadi' });

  const filter = await getOrgFilter(req.user!);
  if (!isBranchAllowed(filter, interval.vehicle.branchId)) {
    return res.status(403).json({ error: "Ruxsat yo'q" });
  }

  const km = servicedAtKm ?? Number(interval.vehicle.mileage);
  const date = servicedAt ? new Date(servicedAt) : new Date();

  const nextDueKm = customNextDueKm ?? km + interval.intervalKm;
  const nextDueDate = new Date(date.getTime() + interval.intervalDays * 24 * 60 * 60 * 1000);
  const currentMileage = Number(interval.vehicle.mileage);
  const status = computeStatus(nextDueKm, interval.warningKm, currentMileage);

  const [record, updatedInterval] = await prisma.$transaction([
    prisma.serviceRecord.create({
      data: {
        vehicleId: interval.vehicleId,
        serviceIntervalId: interval.id,
        serviceType: interval.serviceType,
        servicedAtKm: km,
        servicedAt: date,
        cost,
        technicianName: technicianName ?? null,
        notes: notes ?? null,
        nextDueKm,
        nextDueDate,
        createdById: req.user?.id ?? null,
      },
    }),
    prisma.serviceInterval.update({
      where: { id },
      data: {
        lastServiceKm: km,
        lastServiceDate: date,
        nextDueKm,
        nextDueDate,
        status,
      },
    }),
  ]);

  res.json({ record, interval: updatedInterval });
}

/** GET /service-intervals/due — all due/overdue across fleet */
export async function getDueIntervals(req: AuthRequest, res: Response) {
  const { branchId } = req.query;

  const filter = await getOrgFilter(req.user!);
  const bv = applyBranchFilter(filter);

  const where: any = {
    status: { in: ['due_soon', 'overdue'] },
  };

  if (bv !== undefined) {
    where.vehicle = { branchId: bv };
  } else if (branchId) {
    where.vehicle = { branchId };
  }

  const intervals = await prisma.serviceInterval.findMany({
    where,
    include: {
      vehicle: { select: { id: true, registrationNumber: true, brand: true, model: true, mileage: true } },
    },
    orderBy: [{ status: 'asc' }, { nextDueKm: 'asc' }],
  });

  res.json(intervals);
}

/** PATCH /vehicles/:id/odometer — quick mileage update */
export async function updateVehicleOdometer(req: AuthRequest, res: Response) {
  const { id: vehicleId } = req.params;
  const { mileage } = req.body;

  if (mileage === undefined || mileage < 0) {
    return res.status(400).json({ error: "Kilometr qiymati noto'g'ri" });
  }

  const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } });
  if (!vehicle) return res.status(404).json({ error: 'Avtomobil topilmadi' });

  const filter = await getOrgFilter(req.user!);
  if (!isBranchAllowed(filter, vehicle.branchId)) {
    return res.status(403).json({ error: "Ruxsat yo'q" });
  }

  if (Number(vehicle.mileage) > mileage) {
    return res.status(400).json({ error: 'Yangi kilometr joriy kilometrdan kam bo`lishi mumkin emas' });
  }

  const updated = await prisma.vehicle.update({
    where: { id: vehicleId },
    data: { mileage },
  });

  // Recompute all service interval statuses for this vehicle
  const intervals = await prisma.serviceInterval.findMany({ where: { vehicleId } });
  await Promise.all(
    intervals.map((interval) => {
      const status = computeStatus(interval.nextDueKm, interval.warningKm, mileage);
      return prisma.serviceInterval.update({ where: { id: interval.id }, data: { status } });
    }),
  );

  res.json({ mileage: updated.mileage });
}

/** DELETE /service-intervals/:id */
export async function deleteInterval(req: AuthRequest, res: Response) {
  const { id } = req.params;
  const interval = await prisma.serviceInterval.findUnique({
    where: { id },
    include: { vehicle: { select: { branchId: true } } },
  });
  if (!interval) return res.status(404).json({ error: 'Interval topilmadi' });

  const filter = await getOrgFilter(req.user!);
  if (!isBranchAllowed(filter, interval.vehicle.branchId)) {
    return res.status(403).json({ error: "Ruxsat yo'q" });
  }

  await prisma.serviceInterval.delete({ where: { id } });
  res.json({ success: true });
}
