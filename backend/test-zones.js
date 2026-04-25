const https = require('https')
const http = require('http')

async function post(host, svc, params, sid) {
  const body = new URLSearchParams({svc, params: JSON.stringify(params), ...(sid ? {sid} : {})}).toString()
  const url = new URL('/wialon/ajax.html', host)
  const mod = url.protocol === 'https:' ? https : http
  return new Promise((res, rej) => {
    const req = mod.request({
      hostname: url.hostname, port: url.port || 80, path: url.pathname, method: 'POST',
      headers: {'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body)},
      rejectUnauthorized: false, timeout: 30000
    }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)) } catch { res({_raw: d.slice(0,300)}) } }) })
    req.on('error', rej)
    req.write(body)
    req.end()
  })
}

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient();

(async () => {
  const cred = await prisma.gpsCredential.findFirst({ where: { isActive: true } })
  const login = await post(cred.host, 'token/login', { token: cred.token, fl: 1 })
  const sid = login.eid
  const resourceId = 33685

  // 1: core/search_item bitta item barcha flaglar
  const r1 = await post(cred.host, 'core/search_item', { id: resourceId, flags: 0xFFFFFFFF }, sid)
  const zl1 = r1?.item?.zl || {}
  const fz = Object.values(zl1)[0]
  console.log('1) search_item zone keys:', fz ? Object.keys(fz) : 'none')
  console.log('   Has p:', !!(fz?.p), '| p sample:', JSON.stringify(fz?.p)?.slice(0, 100))

  // 2: resource/get_zones
  const r2 = await post(cred.host, 'resource/get_zones', { itemId: resourceId }, sid)
  console.log('2) get_zones:', JSON.stringify(r2).slice(0, 200))

  // 3: resource/export_zones_to_kml
  const r3 = await post(cred.host, 'resource/export_zones_to_kml', { itemId: resourceId, zoneIds: [1] }, sid)
  console.log('3) export_kml:', JSON.stringify(r3).slice(0, 200))

  // 4: avl_resource get with geofences flag
  const r4 = await post(cred.host, 'core/search_items', {
    spec: { itemsType: 'avl_resource', propName: 'sys_id', propValueMask: String(resourceId), sortType: 'sys_name' },
    force: 1, flags: 0x1 | 0x80 | 0x100 | 0x200 | 0x400, from: 0, to: 0
  }, sid)
  const fz4 = Object.values(r4?.items?.[0]?.zl || {})[0]
  console.log('4) flags 0x780 zone keys:', fz4 ? Object.keys(fz4) : 'none')
  console.log('   Has p:', !!(fz4?.p))

  await prisma.$disconnect()
})().catch(e => console.error(e.message))
