import * as fs from 'fs'
import * as path from 'path'

// Himoya testi: ta'mirlash yozuvini (MaintenanceRecord/MaintenanceItem) o'qiydigan har bir so'rov
// `status`ni hisobga olishi shart — aks holda rad etilgan/qaytarib olingan/kutilayotgan yozuvlar
// xarajat, statistika, bashorat va hisobotlarga "ishlatildi" bo'lib kirib qoladi.
// Ataylab barcha statusni ko'rsatadigan joy (ro'yxat, bog'liqlik tekshiruvi) so'rovdan oldingi
// qatorga `// all-statuses: <sabab>` izohini qo'yadi.

const SRC = path.resolve(__dirname, '..')

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith('.ts') && !e.name.includes('.test.')) out.push(p)
  }
  return out
}

function balanced(text: string, from: number, open: string, close: string): number {
  let depth = 1
  let i = from
  while (depth > 0 && i < text.length) {
    if (text[i] === open) depth++
    else if (text[i] === close) depth--
    i++
  }
  return i
}

const CALL = /maintenanceRecord\.(findMany|findFirst|aggregate|groupBy|count)\(|maintenanceItem\.(findMany|aggregate|groupBy|count)\(/g
const RELATION = /maintenanceRecords:\s*\{/g

describe("ta'mirlash so'rovlari status bo'yicha filtrlanadi", () => {
  const violations: string[] = []

  for (const file of walk(SRC)) {
    const text = fs.readFileSync(file, 'utf8')
    const lineOf = (idx: number) => text.slice(0, idx).split('\n').length
    const lines = text.split('\n')

    for (const m of text.matchAll(CALL)) {
      const end = balanced(text, m.index! + m[0].length, '(', ')')
      const call = text.slice(m.index!, end)
      const line = lineOf(m.index!)
      const exempt = lines.slice(Math.max(0, line - 3), line).some(l => l.includes('all-statuses'))
      if (!/\bstatus\b/.test(call) && !exempt) violations.push(`${path.relative(SRC, file)}:${line}`)
    }
    for (const m of text.matchAll(RELATION)) {
      const end = balanced(text, m.index! + m[0].length, '{', '}')
      const block = text.slice(m.index!, end)
      const line = lineOf(m.index!)
      const exempt = lines.slice(Math.max(0, line - 3), line).some(l => l.includes('all-statuses'))
      if (!/\bstatus\b/.test(block) && !exempt) violations.push(`${path.relative(SRC, file)}:${line} (relation)`)
    }
  }

  it("status filtrsiz so'rov yo'q (kerak bo'lsa `// all-statuses: sabab` izohi qo'ying)", () => {
    expect(violations).toEqual([])
  })
})
