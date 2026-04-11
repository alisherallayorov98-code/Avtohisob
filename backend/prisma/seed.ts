import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'

const prisma = new PrismaClient()

async function main() {
  console.log('Seeding database...')

  // Super admin only
  const adminHash = await bcrypt.hash('Admin@123', 12)
  await prisma.user.upsert({
    where: { email: 'admin@avtohisob.uz' },
    update: {},
    create: {
      email: 'admin@avtohisob.uz',
      passwordHash: adminHash,
      fullName: 'Bosh Admin',
      role: 'super_admin',
    },
  })

  // Expense categories
  const categories = ['Yonilgi', 'Texnik xizmat', 'Sug\'urta', 'Soliq', 'Tozalash', 'Boshqa']
  for (const name of categories) {
    const existing = await prisma.expenseCategory.findFirst({ where: { name } })
    if (!existing) await prisma.expenseCategory.create({ data: { name } })
  }

  console.log('Seed completed!')
  console.log('Super Admin: admin@avtohisob.uz / Admin@123')
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
