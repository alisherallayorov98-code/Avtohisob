/**
 * MaintenanceRecord ni snapshot'dan tiklash.
 * Snapshot strukturasi: { primary: MaintenanceRecord, related: { items: [], evidence: [] } }
 *
 * Tiklashda:
 *  - Asosiy yozuv yangi id bilan yaratiladi (asl id da boshqa yozuv bo'lishi mumkin)
 *  - Aslining FK lari (vehicleId, sparePartId, supplierId, ...) hali mavjud bo'lishi shart
 *  - Agar mashina yoki kategoriya o'chirilgan bo'lsa — tiklash ishlamaydi
 */

interface MaintenancePrimary {
  id: string
  vehicleId: string
  sparePartId: string | null
  quantityUsed: number
  sourceWarehouseId: string | null
  installationDate: string | Date
  installationMileage: number | null
  cost: any
  laborCost: any
  workerName: string | null
  paymentType: string
  isPaid: boolean
  supplierId: string | null
  notes: string | null
  performedById: string
  status: string
  approvedById: string | null
  approvedAt: string | Date | null
  rejectedReason: string | null
  // OTP/audit fields are reset on restore (not restored)
}

interface MaintenanceItem {
  sparePartId: string
  warehouseId: string | null
  quantityUsed: number
  unitCost: any
  isTire: boolean
  tireSerial: string | null
  tirePosition: string | null
  // tireId is not restored — tire link may be stale
}

interface MaintenanceEvidence {
  fileUrl: string
  fileSizeBytes: number
  uploadedById: string | null
}

export async function restoreMaintenanceRecord(tx: any, snapshot: any): Promise<void> {
  const primary = snapshot.primary as MaintenancePrimary
  const items: MaintenanceItem[] = snapshot.related?.items || []
  const evidence: MaintenanceEvidence[] = snapshot.related?.evidence || []

  // Mashina hali mavjudligini tekshiramiz
  const vehicle = await tx.vehicle.findUnique({ where: { id: primary.vehicleId } })
  if (!vehicle) {
    throw new Error('Tiklab bo\'lmaydi: bu yozuvga tegishli mashina o\'chirilgan')
  }

  // Yangi id bilan asosiy yozuvni yaratamiz (asl id ni qaytarib bo'lmaydi —
  // boshqa joyda ishlatilgan bo'lishi mumkin)
  const restored = await tx.maintenanceRecord.create({
    data: {
      vehicleId: primary.vehicleId,
      sparePartId: primary.sparePartId,
      quantityUsed: primary.quantityUsed,
      sourceWarehouseId: primary.sourceWarehouseId,
      installationDate: new Date(primary.installationDate),
      installationMileage: primary.installationMileage,
      cost: primary.cost,
      laborCost: primary.laborCost,
      workerName: primary.workerName,
      paymentType: primary.paymentType,
      isPaid: primary.isPaid,
      supplierId: primary.supplierId,
      notes: primary.notes ? `[Tiklangan] ${primary.notes}` : '[Tiklangan]',
      performedById: primary.performedById,
      status: primary.status,
      approvedById: primary.approvedById,
      approvedAt: primary.approvedAt ? new Date(primary.approvedAt) : null,
      rejectedReason: primary.rejectedReason,
    },
  })

  // Items
  if (items.length > 0) {
    await tx.maintenanceItem.createMany({
      data: items.map(it => ({
        maintenanceId: restored.id,
        sparePartId: it.sparePartId,
        warehouseId: it.warehouseId,
        quantityUsed: it.quantityUsed,
        unitCost: it.unitCost,
        isTire: it.isTire,
        tireSerial: it.tireSerial,
        tirePosition: it.tirePosition,
      })),
    })
  }

  // Evidence (rasm fayllari)
  if (evidence.length > 0) {
    await tx.maintenanceEvidence.createMany({
      data: evidence.map(ev => ({
        maintenanceId: restored.id,
        fileUrl: ev.fileUrl,
        fileSizeBytes: ev.fileSizeBytes,
        uploadedById: ev.uploadedById,
      })),
    })
  }
}
