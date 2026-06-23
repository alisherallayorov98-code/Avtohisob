import crypto from 'crypto'

// GPS parol kabi maxfiy qiymatlarni DB da shifrlab saqlash uchun (AES-256-GCM).
// Kalit: GPS_SECRET_KEY yoki (yo'q bo'lsa) JWT_SECRET dan SHA-256 orqali 32 bayt olinadi.
// Format: enc:v1:<iv_b64>:<tag_b64>:<ciphertext_b64>
const PREFIX = 'enc:v1:'

function getKey(): Buffer {
  const raw = process.env.GPS_SECRET_KEY || process.env.JWT_SECRET
  if (!raw) throw new Error('GPS_SECRET_KEY/JWT_SECRET aniqlanmadi — parol shifrlab bo\'lmadi')
  return crypto.createHash('sha256').update(raw).digest() // 32 bayt
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`
}

export function decryptSecret(stored: string | null | undefined): string | null {
  if (!stored || !stored.startsWith(PREFIX)) return null
  try {
    const [ivB64, tagB64, ctB64] = stored.slice(PREFIX.length).split(':')
    const iv = Buffer.from(ivB64, 'base64')
    const tag = Buffer.from(tagB64, 'base64')
    const ct = Buffer.from(ctB64, 'base64')
    const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}
