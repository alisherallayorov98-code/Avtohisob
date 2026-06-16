import { spawn } from 'child_process'
import fs from 'fs'

// Videoni serverda siqish (ffmpeg). Maqsad: "ishni ko'rib tushunish" sifati saqlanib,
// hajm 5-10 barobar kamaytirilsin — disk to'lib qolmasligi uchun.
// ffmpeg bo'lmasa yoki xato bersa — ASL fayl ishlatiladi (video hech qachon yo'qolmaydi).

let ffmpegChecked = false
let ffmpegAvailable = false

/** ffmpeg serverga o'rnatilganmi (bir marta tekshirib keshlaydi). */
export function isFfmpegAvailable(): Promise<boolean> {
  if (ffmpegChecked) return Promise.resolve(ffmpegAvailable)
  return new Promise((resolve) => {
    try {
      const p = spawn('ffmpeg', ['-version'])
      p.on('error', () => { ffmpegChecked = true; ffmpegAvailable = false; resolve(false) })
      p.on('close', (code) => { ffmpegChecked = true; ffmpegAvailable = code === 0; resolve(ffmpegAvailable) })
    } catch {
      ffmpegChecked = true; ffmpegAvailable = false; resolve(false)
    }
  })
}

// Sifat darajasi: CRF kichikroq = sifat yuqori + hajm katta. 26 = 720p "o'rtacha"
// (ish aniq ko'rinadi). Kerak bo'lsa shu yerdan oson moslanadi:
//   - sifatni oshirish: CRF 23 yoki SCALE_MAX 1920
//   - hajmni yana kamaytirish: CRF 28
const CRF = '26'
const SCALE_MAX = 1280 // uzun tomonni shu pikselgacha cheklaymiz (~720p)

/**
 * Videoni 720p / o'rtacha bitrate ga siqadi (H.264 mp4).
 * @returns true — siqildi (outputPath tayyor); false — siqib bo'lmadi (asl fayl ishlatilsin).
 */
export async function compressVideo(
  inputPath: string,
  outputPath: string,
  opts?: { timeoutMs?: number },
): Promise<boolean> {
  if (!(await isFfmpegAvailable())) return false
  const timeoutMs = opts?.timeoutMs ?? 180_000 // 3 daqiqa — uzun video uchun yetarli

  return new Promise((resolve) => {
    // Uzun tomonni SCALE_MAX gacha cheklaymiz (landshaft/portret ikkalasi uchun),
    // -2 — o'lchamlar juft bo'lishini ta'minlaydi (H.264 talabi)
    const scale = `scale='if(gt(iw,ih),min(${SCALE_MAX},iw),-2)':'if(gt(iw,ih),-2,min(${SCALE_MAX},ih))'`
    const args = [
      '-y', '-i', inputPath,
      '-vf', scale,
      '-c:v', 'libx264', '-crf', CRF, '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '96k',
      '-movflags', '+faststart',
      outputPath,
    ]
    let done = false
    const finish = (ok: boolean) => {
      if (done) return
      done = true
      if (!ok) { try { fs.existsSync(outputPath) && fs.unlinkSync(outputPath) } catch { /* ignore */ } }
      resolve(ok)
    }
    try {
      const p = spawn('ffmpeg', args)
      const timer = setTimeout(() => { try { p.kill('SIGKILL') } catch { /* ignore */ } finish(false) }, timeoutMs)
      p.on('error', () => { clearTimeout(timer); finish(false) })
      p.on('close', (code) => {
        clearTimeout(timer)
        const ok = code === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0
        finish(ok)
      })
    } catch {
      finish(false)
    }
  })
}
