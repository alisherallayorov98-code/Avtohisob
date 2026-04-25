import https from 'https'
import http from 'http'

function rawPost(host: string, svc: string, params: object, sid?: string): Promise<any> {
  const bodyStr = new URLSearchParams({
    svc, params: JSON.stringify(params), ...(sid ? { sid } : {})
  }).toString()
  const url = new URL('/wialon/ajax.html', host)
  const isHttps = url.protocol === 'https:'
  const mod = isHttps ? https : http

  return new Promise((resolve, reject) => {
    const req = mod.request({
      hostname: url.hostname,
      port: url.port ? Number(url.port) : (isHttps ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(bodyStr) },
      rejectUnauthorized: false,
      timeout: 20000,
    }, (res) => {
      let raw = ''
      res.on('data', (c: Buffer) => { raw += c })
      res.on('end', () => {
        try { resolve(JSON.parse(raw)) } catch { resolve({ _raw: raw.slice(0, 500) }) }
      })
    })
    req.on('error', reject)
    req.write(bodyStr)
    req.end()
  })
}

async function loginWithToken(host: string, token: string): Promise<string> {
  const data = await rawPost(host, 'token/login', { token, fl: 1 })
  if (!data.eid) throw new Error('Token login muvaffaqiyatsiz')
  return data.eid
}

export default async function wialonDebug(host: string, token: string) {
  const sid = await loginWithToken(host, token)

  // 1. avl_resource with flag 0x1|0x80
  const res1 = await rawPost(host, 'core/search_items', {
    spec: { itemsType: 'avl_resource', propName: 'sys_name', propValueMask: '*', sortType: 'sys_name' },
    force: 1, flags: 0x1 | 0x80, from: 0, to: 0,
  }, sid)

  const resources = res1.items || []
  const summary = resources.map((r: any) => ({
    id: r.id,
    nm: r.nm,
    zlKeys: r.zl ? Object.keys(r.zl).slice(0, 3) : [],
    zlCount: r.zl ? Object.keys(r.zl).length : 0,
    firstZone: r.zl ? Object.values(r.zl)[0] : null,
    hasZl: !!r.zl,
  }))

  // 2. Try flag 0x1 only
  const res2 = await rawPost(host, 'core/search_items', {
    spec: { itemsType: 'avl_resource', propName: 'sys_name', propValueMask: '*', sortType: 'sys_name' },
    force: 1, flags: 0x1, from: 0, to: 0,
  }, sid)
  const resourcesBasic = (res2.items || []).map((r: any) => ({ id: r.id, nm: r.nm, keys: Object.keys(r) }))

  return { resourceCount: resources.length, resources: summary, basicKeys: resourcesBasic }
}
