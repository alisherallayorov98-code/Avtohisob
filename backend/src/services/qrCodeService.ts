import QRCode from 'qrcode'

export async function generateQRBuffer(data: Record<string, unknown>): Promise<Buffer> {
  const payload = JSON.stringify(data)
  return QRCode.toBuffer(payload, {
    errorCorrectionLevel: 'M',
    width: 300,
    margin: 2,
  })
}

export async function generateQRDataUrl(data: Record<string, unknown>): Promise<string> {
  const payload = JSON.stringify(data)
  return QRCode.toDataURL(payload, {
    errorCorrectionLevel: 'M',
    width: 300,
    margin: 2,
  })
}
