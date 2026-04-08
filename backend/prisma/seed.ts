import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'

const prisma = new PrismaClient()

async function main() {
  console.log('Seeding database...')

  // Branches
  const branch1 = await prisma.branch.upsert({
    where: { id: 'branch-tashkent' },
    update: {},
    create: {
      id: 'branch-tashkent',
      name: 'Toshkent Markaz',
      location: 'Toshkent sh., Chilonzor t.',
      contactPhone: '+998712001234',
      warehouseCapacity: 500,
    },
  })

  const branch2 = await prisma.branch.upsert({
    where: { id: 'branch-samarkand' },
    update: {},
    create: {
      id: 'branch-samarkand',
      name: 'Samarqand Filiali',
      location: 'Samarqand sh., Registon ko\'chasi',
      contactPhone: '+998662001234',
      warehouseCapacity: 200,
    },
  })

  // Admin user
  const adminHash = await bcrypt.hash('Admin@123', 12)
  const admin = await prisma.user.upsert({
    where: { email: 'admin@avtohisob.uz' },
    update: {},
    create: {
      email: 'admin@avtohisob.uz',
      passwordHash: adminHash,
      fullName: 'Bosh Admin',
      role: 'admin',
    },
  })

  // Manager
  const managerHash = await bcrypt.hash('Manager@123', 12)
  const manager = await prisma.user.upsert({
    where: { email: 'manager@avtohisob.uz' },
    update: {},
    create: {
      email: 'manager@avtohisob.uz',
      passwordHash: managerHash,
      fullName: 'Hamid Karimov',
      role: 'manager',
      branchId: branch1.id,
    },
  })

  // Branch manager
  const bmHash = await bcrypt.hash('Branch@123', 12)
  await prisma.user.upsert({
    where: { email: 'branch@avtohisob.uz' },
    update: {},
    create: {
      email: 'branch@avtohisob.uz',
      passwordHash: bmHash,
      fullName: 'Dilshod Yusupov',
      role: 'branch_manager',
      branchId: branch2.id,
    },
  })

  // Update branch managers
  await prisma.branch.update({ where: { id: branch1.id }, data: { managerId: manager.id } })

  // Supplier
  const supplier = await prisma.supplier.upsert({
    where: { id: 'supplier-main' },
    update: {},
    create: {
      id: 'supplier-main',
      name: 'AutoParts Uzbekistan',
      contactPerson: 'Jasur Toshmatov',
      phone: '+998901234567',
      email: 'info@autoparts.uz',
      address: 'Toshkent, Yunusobod t.',
    },
  })

  // Spare parts
  const parts = [
    { id: 'part-oil-filter', name: 'Moy filtri', partCode: 'OF-001', category: 'filters', unitPrice: 45000 },
    { id: 'part-air-filter', name: 'Havo filtri', partCode: 'AF-001', category: 'filters', unitPrice: 35000 },
    { id: 'part-brake-pad', name: 'Tormoz kolodkasi', partCode: 'BP-001', category: 'brakes', unitPrice: 120000 },
    { id: 'part-engine-oil', name: 'Moy 5W-40 (1L)', partCode: 'EO-001', category: 'oils', unitPrice: 85000 },
    { id: 'part-battery', name: 'Akkumulyator 60Ah', partCode: 'BAT-001', category: 'electrical', unitPrice: 850000 },
    { id: 'part-spark-plug', name: 'O\'tqich shamchasi', partCode: 'SP-001', category: 'engine', unitPrice: 25000 },
    { id: 'part-wiper', name: 'Oyna tozalagich', partCode: 'WB-001', category: 'body', unitPrice: 55000 },
  ]

  for (const p of parts) {
    await prisma.sparePart.upsert({
      where: { partCode: p.partCode },
      update: {},
      create: { ...p, supplierId: supplier.id },
    })
  }

  // Inventory
  for (const p of parts) {
    const sp = await prisma.sparePart.findUnique({ where: { partCode: p.partCode } })
    if (sp) {
      await prisma.inventory.upsert({
        where: { sparePartId_branchId: { sparePartId: sp.id, branchId: branch1.id } },
        update: {},
        create: { sparePartId: sp.id, branchId: branch1.id, quantityOnHand: 20, reorderLevel: 5 },
      })
      await prisma.inventory.upsert({
        where: { sparePartId_branchId: { sparePartId: sp.id, branchId: branch2.id } },
        update: {},
        create: { sparePartId: sp.id, branchId: branch2.id, quantityOnHand: 10, reorderLevel: 3 },
      })
    }
  }

  // Vehicles
  const vehicles = [
    { id: 'v-01', registrationNumber: '01A123AA', model: 'Nexia 3', brand: 'Chevrolet', year: 2021, fuelType: 'petrol' as const, branchId: branch1.id, purchaseDate: new Date('2021-03-15'), mileage: 45000 },
    { id: 'v-02', registrationNumber: '01B456BB', model: 'Cobalt', brand: 'Chevrolet', year: 2020, fuelType: 'petrol' as const, branchId: branch1.id, purchaseDate: new Date('2020-07-20'), mileage: 78000 },
    { id: 'v-03', registrationNumber: '40C789CC', model: 'Lacetti', brand: 'Chevrolet', year: 2019, fuelType: 'gas' as const, branchId: branch2.id, purchaseDate: new Date('2019-11-10'), mileage: 92000 },
  ]

  for (const v of vehicles) {
    await prisma.vehicle.upsert({
      where: { registrationNumber: v.registrationNumber },
      update: {},
      create: v,
    })
  }

  // Expense categories
  const categories = ['Yonilgi', 'Texnik xizmat', 'Sug\'urta', 'Soliq', 'Tozalash', 'Boshqa']
  for (const name of categories) {
    const existing = await prisma.expenseCategory.findFirst({ where: { name } })
    if (!existing) {
      await prisma.expenseCategory.create({ data: { name } })
    }
  }

  console.log('Seed completed!')
  console.log('Admin: admin@avtohisob.uz / Admin@123')
  console.log('Manager: manager@avtohisob.uz / Manager@123')
  console.log('Branch: branch@avtohisob.uz / Branch@123')
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
