# EkoHisob dizayn tizimi (`ui/`)

Import: `import { Button, DataTable, f } from '../ui'` (faqat shu papkadan). Tailwind klasslarini
qo'lda yozmang — primitiv yo'q bo'lsa `ui/` ga qo'shing.

## Uslub: achromatic-ledger
- Chrome (sidebar, karta, jadval, filtr) da rang YO'Q. Yashil aksent FAQAT: (1) sahifadagi bitta `primary`
  tugma, (2) asosiy ma'lumot elementi, (3) "to'langan" holati.
- Qarz shkalasi (`--eko-level-*`) faqat ma'no uchun (`DebtBadge`, `DebtDot`, `DebtAgeStrip`).
- Sirtlar tekis: karta soyasi yo'q, ajratish 1px chiziq. Soya faqat Modal / Menu / Popover.
- Emoji yo'q. Ikonka — lucide. Xom Tailwind ranglar (`green-800`, `gray-500`) yo'q — faqat `eko-*`.

## Qoidalar
| Mavzu | Qoida |
|---|---|
| Matn o'lchami | Eng kichigi 12px (`eko-text-xs`). `text-[10px]`/`text-[11px]` YO'Q. Shkala: `eko-text-xs 12 / sm 13 / base 14 / md 15 / lg 18 / h1 24 / stat 26 / lead 32` |
| Matn rangi | `text`, `text-2` asosiy; `muted` yorliq/izoh/jadval sarlavhasi (kontrast yetarli). `subtle` — FAQAT bezak (ikonka, o'chirilgan); u bilan matn yozmang |
| Sensorli nishon | Mobilda bosiladigan har narsa >= 44px (Button md, IconButton, Menu, Tabs, SegmentedControl avtomatik) |
| Input | Mobilda 16px (iOS zoom yo'q) — `Input/Select/Textarea/DateInput` avtomatik |
| Sana | Faqat `kun.oy.yil` — `f.date()`, `f.dateTime()`; sana kiritish — `DateInput` |
| Pul/son | `f.money`, `f.num`, `<MoneyText/>`, `<Num/>`; jadvalda o'ngga (`align: 'right'`) |
| Tugma | Sahifada bitta `primary`. Qator amali: `RowActions` (1 asosiy + kebab). Havola — `LinkButton` (`<a><Button/></a>` yozmang) |
| Holat belgisi | Qatorda bitta holat belgisi (qarz darajasi YOKI faollik) |
| Z-index | Faqat tokenlar: `eko-z-sticky/nav/drawer/dropdown/toast/tooltip`; modal — `Modal` o'zi stack qiladi |
| Qorong'i rejim | `.eko-app` ga `data-theme="dark"` (yoki `.eko-dark`). Barcha primitivlar tokenlar orqali ishlaydi. Telegram mini ilova: `tg.colorScheme === 'dark'` bo'lsa shuni qo'ying. Diagramma ranglari: `import { chart } from '../ui'` (`chart.main/light/grid/axis/ref`) |

## Qaysi primitiv qachon
- **Sahifa**: `Page` > `PageHeader` (h1, `back`, `meta`, `scope`, `loading`, `error`) > `StatRow` > `FilterBar` > `Card flush` + `DataTable`.
- **KPI**: `StatRow` + `StatTile` (plitkasiz tipografiya). `lead` — eng asosiy raqam. `delta` + `deltaLabel="o'tgan oyga nisbatan"`.
- **Jadval**: `DataTable` (mobilda kartaga o'tadi; `mobile: 'primary' | 'secondary' | 'hide'`), `Pagination` (`pagination` prop orqali).
- **Filtr**: `FilterBar` (qidiruv + Select + chip + "Tozalash"; mobilda "Filtrlar" varag'i).
- **Forma**: `Field` + `Input/Select/Textarea/DateInput/MonthInput/Toggle`. `Field` aria-invalid / aria-describedby / required ni avtomatik ulaydi.
- **Oyna**: `Modal` (sm/md/lg/xl, `footer`), tasdiqlash — `useConfirm`. Sabab so'raladigan amal: `confirm.ask({ ..., reasonRequired: true })`.
- **Menyu**: `Menu` (kebab), `Popover` (ixtiyoriy kontent), `Tooltip` (qo'shimcha izoh; muhim matnni yashirmang).
- **Bo'limlar**: `Tabs` (underline), `SegmentedControl` (2–3 rejim), `SplitPane` (ro'yxat + tafsilot).
- **Holatlar**: `EmptyState` (amal taklif qiling), `ErrorState onRetry`, `Skeleton/SkeletonList/SkeletonTable`, `Banner` (`tone`, `icon`).
- **Mahsulotga xos**: `DebtAgeStrip` (12 oylik qarz yoshi), `Avatar`, `Badge tone="active|inactive|blacklisted|draft"` (`STATUS_BADGE` xaritasi).

## Migratsiya jadvali (sahifa agentlari uchun)
| Eski | Yangi |
|---|---|
| qo'lda `<button className="bg-green-...">` | `<Button variant="primary">` |
| `<a><Button/></a>` / `<Link><button/></Link>` | `<LinkButton to="..." >` |
| qo'lda ikonali `<button>` | `<IconButton label="..."/>` |
| `<table>` + uppercase `<th>` + zebra | `<DataTable columns rows rowKey/>` |
| qo'lda "Oldingi/Keyingi" | `DataTable pagination` yoki `<Pagination/>` |
| `fixed inset-0 ...` modal | `<Modal title footer>` |
| `window.confirm` / `confirm()` | `const confirm = useConfirm(); await confirm({...})` |
| `window.prompt` (sabab) | `confirm.ask({ reasonRequired: true })` |
| `<input type="date">` | `<DateInput value onChange/>`, oraliq — `<DateRange/>` |
| qidiruv + select qatori | `<FilterBar search filters/>` |
| qator ichida 3+ tugma | `<RowActions primary items/>` |
| `title=` tooltip | `<Tooltip content>` |
| emoji (`👁`, `✅`) | lucide ikonka (`Banner icon={<Eye/>}`) |
| `bg-white shadow rounded-xl border` | `<Card>` / `<Card flush>` |
| `<StatTile icon=...>` | `icon` olib tashlang (deprecated, ko'rsatilmaydi) |
| `PageHeader icon=...`, `CardHeader icon=...`, `Modal icon=...` | olib tashlang (deprecated, ko'rsatilmaydi) |
| `text-[10px]`/`text-[11px]` | `eko-text-xs` |
| `z-[9999]` | `eko-z-*` tokenlari |
| recharts `#16a34a` | `chart.main` va h.k. |

## Deprecated (ishlaydi, lekin ko'rsatilmaydi)
`StatTile.icon`, `PageHeader.icon`, `CardHeader.icon`, `Modal.icon`.

## Tokenlar
`tokens.css`: ranglar ("R G B" uchligi, `eko-*` Tailwind kalitlari), tip (`--eko-fs-*`, `--eko-lh-*`, `--eko-font-sans`),
radius (`--eko-radius-sm/…/-lg`), z-index (`--eko-z-*`), chart (`--eko-chart-*`), nav (`--eko-nav-*`).
Tailwind'da faqat ranglar/radius/soya ulangan; qolganlari `.eko-text-*`, `.eko-nav-*`, `.eko-z-*`, `.eko-control`,
`.eko-statrow` CSS klasslari (tailwind.config o'zgartirilmagan).
