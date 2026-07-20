import { alertServerError, getAndResetErrorCount, opsAlertStatus } from './opsAlert'

// OPS_ALERT_* env sozlanmagan holatda test yuritiladi — bu holatda send() hech
// qanday tarmoq so'rovi qilmaydi (isConfigured() false), shuning uchun fetch
// mock qilish shart emas. Hisoblagich mantig'i konfiguratsiyadan mustaqil ishlaydi.
describe('opsAlert — xato hisoblagichi (DB/tarmoqsiz)', () => {
  beforeEach(() => {
    delete process.env.OPS_ALERT_BOT_TOKEN
    delete process.env.OPS_ALERT_CHAT_ID
    getAndResetErrorCount() // oldingi testlardan qolgan hisobni tozalash
  })

  it('sozlanmagan bo\'lsa ham xato sanaladi', () => {
    expect(opsAlertStatus()).toContain('sozlanmagan')
    alertServerError('GET', '/api/test', 'Xato 1')
    alertServerError('POST', '/api/test2', 'Xato 2')
    expect(getAndResetErrorCount()).toBe(2)
  })

  it('getAndResetErrorCount chaqirilgach hisob 0 ga qaytadi', () => {
    alertServerError('GET', '/api/test', 'Xato')
    getAndResetErrorCount()
    expect(getAndResetErrorCount()).toBe(0)
  })

  it('har chaqiriq hisoblanadi — bir xil xato ham (dedupe faqat Telegram yuborishga tegishli, hisobga emas)', () => {
    for (let i = 0; i < 5; i++) alertServerError('GET', '/api/same', 'Bir xil xato')
    expect(getAndResetErrorCount()).toBe(5)
  })
})
