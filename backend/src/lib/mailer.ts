import nodemailer from 'nodemailer'

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
})

const FROM = `"AutoHisob" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`
const APP_URL = process.env.APP_URL || 'http://localhost:5173'

function smtpConfigured(): boolean {
  return !!(process.env.SMTP_USER && process.env.SMTP_PASS)
}

async function sendMailSafe(options: nodemailer.SendMailOptions): Promise<void> {
  if (!smtpConfigured()) {
    console.log(`[MAILER] SMTP sozlanmagan. Email yuborilmadi → ${options.to} | Mavzu: ${options.subject}`)
    return
  }
  await transporter.sendMail(options)
}

function baseTemplate(title: string, content: string): string {
  return `<!DOCTYPE html>
<html lang="uz">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">
        <tr><td style="background:linear-gradient(135deg,#2563eb,#1d4ed8);padding:32px 40px;text-align:center;">
          <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;letter-spacing:-0.5px;">🚗 AutoHisob</h1>
          <p style="margin:6px 0 0;color:#bfdbfe;font-size:13px;">Fleet Management System</p>
        </td></tr>
        <tr><td style="padding:36px 40px;">
          ${content}
        </td></tr>
        <tr><td style="background:#f9fafb;padding:20px 40px;border-top:1px solid #e5e7eb;text-align:center;">
          <p style="margin:0;color:#9ca3af;font-size:12px;">© ${new Date().getFullYear()} AutoHisob. Barcha huquqlar himoyalangan.</p>
          <p style="margin:4px 0 0;color:#9ca3af;font-size:12px;">Ushbu xat avtomatik yuborilgan.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

export async function sendVerificationEmail(email: string, fullName: string, token: string) {
  const link = `${APP_URL}/verify-email?token=${token}`
  const html = baseTemplate('Email tasdiqlash', `
    <h2 style="margin:0 0 8px;color:#111827;font-size:20px;">Salom, ${fullName}!</h2>
    <p style="color:#6b7280;font-size:15px;line-height:1.6;margin:0 0 24px;">
      AutoHisob tizimiga xush kelibsiz! Email manzilingizni tasdiqlash uchun quyidagi tugmani bosing.
    </p>
    <div style="text-align:center;margin:32px 0;">
      <a href="${link}" style="background:#2563eb;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;display:inline-block;">
        Email tasdiqlash
      </a>
    </div>
    <p style="color:#9ca3af;font-size:13px;text-align:center;">
      Ushbu havola 24 soat ichida amal qiladi.<br>
      Agar siz ro'yxatdan o'tmagan bo'lsangiz, ushbu xatni e'tiborsiz qoldiring.
    </p>
  `)
  await sendMailSafe({ from: FROM, to: email, subject: 'AutoHisob — Email manzilingizni tasdiqlang', html })
}

export async function sendPasswordResetEmail(email: string, fullName: string, token: string) {
  const link = `${APP_URL}/reset-password?token=${token}`
  const html = baseTemplate('Parolni tiklash', `
    <h2 style="margin:0 0 8px;color:#111827;font-size:20px;">Parolni tiklash</h2>
    <p style="color:#6b7280;font-size:15px;line-height:1.6;margin:0 0 24px;">
      Salom, <strong>${fullName}</strong>. Parolni tiklash so'rovi qabul qilindi. Yangi parol o'rnatish uchun quyidagi tugmani bosing.
    </p>
    <div style="text-align:center;margin:32px 0;">
      <a href="${link}" style="background:#dc2626;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;display:inline-block;">
        Parolni tiklash
      </a>
    </div>
    <p style="color:#9ca3af;font-size:13px;text-align:center;">
      Ushbu havola <strong>1 soat</strong> ichida amal qiladi.<br>
      Agar siz bu so'rovni yubormagan bo'lsangiz, parolingiz xavfsiz — hech narsa o'zgarmaydi.
    </p>
  `)
  await sendMailSafe({ from: FROM, to: email, subject: 'AutoHisob — Parolni tiklash', html })
}

export async function sendWelcomeEmail(email: string, fullName: string) {
  const html = baseTemplate('Xush kelibsiz!', `
    <h2 style="margin:0 0 8px;color:#111827;font-size:20px;">Xush kelibsiz, ${fullName}! 🎉</h2>
    <p style="color:#6b7280;font-size:15px;line-height:1.6;margin:0 0 20px;">
      AutoHisob — zamonaviy avtomobil parki boshqaruv tizimiga xush kelibsiz! Quyida sizga foydali bo'lgan asosiy imkoniyatlar:
    </p>
    <table width="100%" cellpadding="0" cellspacing="0">
      ${[
        ['🚗 Avtomobil boshqaruvi', 'Park holatini real vaqtda kuzating'],
        ['⛽ Yoqilgi hisobi', 'AI yordamida avtomatik hisoblagich'],
        ['🔧 Texnik xizmat', 'Profilaktika jadvallarini boshqaring'],
        ['📊 Hisobotlar', "Ko'p varaqdagi Excel hisobotlari"],
      ].map(([icon_title, desc]) => `
        <tr><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;">
          <strong style="color:#111827;">${icon_title}</strong>
          <br><span style="color:#6b7280;font-size:13px;">${desc}</span>
        </td></tr>
      `).join('')}
    </table>
    <div style="text-align:center;margin:32px 0;">
      <a href="${APP_URL}" style="background:#2563eb;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;display:inline-block;">
        Tizimga kirish
      </a>
    </div>
  `)
  await sendMailSafe({ from: FROM, to: email, subject: 'AutoHisob — Xush kelibsiz!', html })
}

export async function sendAlertEmail(email: string, fullName: string, alertTitle: string, alertMessage: string, link?: string) {
  const html = baseTemplate('Muhim ogohlantirish', `
    <h2 style="margin:0 0 8px;color:#111827;font-size:20px;">⚠️ ${alertTitle}</h2>
    <p style="color:#6b7280;font-size:15px;line-height:1.6;margin:0 0 20px;">
      Salom, <strong>${fullName}</strong>. Quyidagi muhim bildirishnoma sizga yuborildi:
    </p>
    <div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:16px 20px;border-radius:8px;margin:0 0 24px;">
      <p style="margin:0;color:#92400e;font-size:14px;line-height:1.6;">${alertMessage}</p>
    </div>
    ${link ? `<div style="text-align:center;margin:24px 0;">
      <a href="${link}" style="background:#2563eb;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;display:inline-block;">Batafsil ko'rish</a>
    </div>` : ''}
  `)
  await sendMailSafe({ from: FROM, to: email, subject: `AutoHisob — ${alertTitle}`, html })
}

export async function sendInvoiceEmail(email: string, fullName: string, amount: string, planName: string, periodEnd: string) {
  const html = baseTemplate('To\'lov tasdiqlandi', `
    <h2 style="margin:0 0 8px;color:#111827;font-size:20px;">To'lov muvaffaqiyatli!</h2>
    <p style="color:#6b7280;font-size:15px;line-height:1.6;margin:0 0 24px;">
      Salom, <strong>${fullName}</strong>. To'lovingiz qabul qilindi. Obunangiz ma'lumotlari:
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
      ${[
        ['Tarif rejasi', planName],
        ['To\'langan summa', amount],
        ['Keyingi to\'lov sanasi', periodEnd],
      ].map(([k, v]) => `
        <tr style="background:#f9fafb;">
          <td style="padding:12px 16px;color:#6b7280;font-size:14px;border-bottom:1px solid #e5e7eb;">${k}</td>
          <td style="padding:12px 16px;color:#111827;font-size:14px;font-weight:600;border-bottom:1px solid #e5e7eb;text-align:right;">${v}</td>
        </tr>
      `).join('')}
    </table>
    <div style="text-align:center;margin:28px 0 0;">
      <a href="${APP_URL}/billing" style="background:#2563eb;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;display:inline-block;">Obuna ma'lumotlari</a>
    </div>
  `)
  await sendMailSafe({ from: FROM, to: email, subject: 'AutoHisob — To\'lov tasdiqlandi', html })
}
