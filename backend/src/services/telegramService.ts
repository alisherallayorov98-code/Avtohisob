import https from 'https'

export async function sendTelegramMessage(botToken: string, chatId: string, text: string): Promise<boolean> {
  return new Promise(resolve => {
    const body = JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${botToken}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }
    const req = https.request(options, res => {
      resolve(res.statusCode === 200)
    })
    req.on('error', () => resolve(false))
    req.setTimeout(5000, () => { req.destroy(); resolve(false) })
    req.write(body)
    req.end()
  })
}
