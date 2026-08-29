import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { SavdoRequest } from '../middleware/savdoAuth'
import { DEFAULT_SMS_TEMPLATE } from '../lib/savdoSmsTemplate'

export async function getSettings(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const settings = await (prisma as any).savdoOrgSettings.findUnique({ where: { orgId } })
    // Shablon hech qachon bo'sh qaytmasin — UI darhol tahrirlashi uchun standart matn
    res.json({
      success: true,
      data: {
        ...(settings || { orgId }),
        smsEnabled: Boolean(settings?.smsEnabled),
        smsTemplate: settings?.smsTemplate || DEFAULT_SMS_TEMPLATE,
      },
    })
  } catch (err) { next(err) }
}

export async function updateSettings(req: SavdoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.savdoUser!
    const {
      companyName, stir, address, phone, bankAccount, bankName, director, accountant,
      smsEnabled, smsTemplate,
    } = req.body

    const data = {
      companyName: companyName || null, stir: stir || null, address: address || null,
      phone: phone || null, bankAccount: bankAccount || null, bankName: bankName || null,
      director: director || null, accountant: accountant || null,
      // SMS maydonlari faqat so'rovda kelgan bo'lsa yangilanadi — boshqa
      // joydan yuborilgan rekvizit so'rovi sozlamani nolga tushirib qo'ymasin
      ...(smsEnabled !== undefined && { smsEnabled: Boolean(smsEnabled) }),
      ...(smsTemplate !== undefined && {
        smsTemplate: (typeof smsTemplate === 'string' && smsTemplate.trim()) || null,
      }),
    }

    const settings = await (prisma as any).savdoOrgSettings.upsert({
      where: { orgId },
      create: { orgId, ...data },
      update: data,
    })
    res.json({ success: true, data: settings, message: 'Sozlamalar saqlandi' })
  } catch (err) { next(err) }
}
