// import * as XLSX from 'xlsx'
// import pdfParse from 'pdf-parse'

// export type Position = 'TWR' | 'APP'
// export type NightShift = { id: string; date: string; position: Position; workers: string[]; source: string }
// export type ExtraShift = { name: string; date: string; code: string; position: Position }

// const NIGHT_CODES = ['Н-2', 'Н22', 'H-2', 'Н']
// const EXTRA_SHIFT_CODES: string[] = [
//   'I',
//   'II-2',
//   'Д09',
//   'СД',
//   'C2',
//   'C5',
//   'Об3',
//   'Пк11',
//   'пII',
//   'Мп',
//   'R8',
//   'Ос',
//   'К',
//   'Б',
//   'М',
//   'и',
//   'I-2',
//   'Д07',
//   'Д11',
//   'СН/12',
//   'C3',
//   'Рг3',
//   'Об5',
//   'Пк14',
//   'Iан',
//   'Ан',
//   'РД',
//   'Кс',
//   'Кп',
//   'Б8',
//   'От',
//   'II',
//   'Д',
//   'Д13',
//   'C1',
//   'C4',
//   'Рг5',
//   'Пк09',
//   'Iп',
//   'анII',
//   'Р',
//   'О',
//   'Кч',
//   'Ап',
//   'А',
//   'Со',
//   'Х',
//   'Kc',
//   'O',
//   'X',
// ]

// function normalizeCode(value: unknown) {
//   if (typeof value !== 'string') return ''
//   return value.trim()
// }

// export function inferMonthYear(path: string): { month: number; year: number } | null {
//   const match = path.match(/_(\d{4})/i)
//   if (!match) return null
//   const mm = Number(match[1].slice(0, 2))
//   const yy = Number(match[1].slice(2))
//   if (!mm || Number.isNaN(yy)) return null
//   const year = yy >= 70 ? 1900 + yy : 2000 + yy
//   return { month: mm, year }
// }

// function pickPosition(val: string): Position | null {
//   const normalized = val.replace(/\s+/g, ' ')
//   if (normalized.includes('РМ Кула')) return 'TWR'
//   if (normalized.includes('РМ Подход')) return 'APP'
//   return null
// }

// function allowedForRole(roleCell: unknown, position: Position) {
//   const val = typeof roleCell === 'string' ? roleCell.trim() : ''
//   if (val === '') return true
//   if (val.includes('РП-радарен и ЛКК')) return true
//   if (position === 'TWR' && val.includes('РП-ЛКК')) return true
//   if (position === 'APP' && val.includes('РП-радарен')) return true
//   if (position === 'APP' && val.includes('РП-РС')) return true
//   return false
// }

// function isoDay(year: number, month: number, day: number) {
//   const d = new Date(year, month - 1, day)
//   const yyyy = d.getFullYear()
//   const mm = String(d.getMonth() + 1).padStart(2, '0')
//   const dd = String(d.getDate()).padStart(2, '0')
//   return `${yyyy}-${mm}-${dd}`
// }

// function normalizePdfCode(token: string) {
//   const t = token.trim()
//   if (t === '-') return t
//   const dMatch = t.match(/^Д(\d{2}):?\/\d+$/)
//   if (dMatch) return `Д${dMatch[1]}`
//   const dMatch2 = t.match(/^Д(\d{2})\/\d+$/)
//   if (dMatch2) return `Д${dMatch2[1]}`
//   const rg = t.match(/^(Рг\d+)\/\d+$/)
//   if (rg) return rg[1]
//   const ob = t.match(/^(Об\d+)\/\d+$/)
//   if (ob) return ob[1]
//   if (/^СД\/\d+$/.test(t)) return 'СД'
//   return t
// }

// const CODE_LIST = Array.from(new Set([...NIGHT_CODES, ...EXTRA_SHIFT_CODES, '-'])).sort(
//   (a, b) => b.length - a.length
// )
// function splitConcatenatedCodes(raw: string, max: number) {
//   const codes: string[] = []
//   let idx = 0
//   const s = raw.trim()
//   while (idx < s.length && codes.length < max) {
//     const slice = s.slice(idx)
//     const match = CODE_LIST.find((c) => slice.startsWith(c))
//     if (match) {
//       codes.push(match)
//       idx += match.length
//     } else {
//       idx += 1
//     }
//   }
//   return codes
// }

// function tokenIsShift(code: string) {
//   const banned = ['ГРАФИК', 'ЧАСОВЕ', 'часове', 'през', 'месец', 'г.', 'дата']
//   if (banned.some((b) => code.includes(b))) return false
//   return /^[A-Za-zА-Яа-я0-9][A-Za-zА-Яа-я0-9\-/:]*$/.test(code) || code === '-'
// }

// type ColumnRange = { start: number; end: number }
// function buildColumnRanges(header: string, daysInMonth: number, fallbackLen: number): ColumnRange[] {
//   const ranges: ColumnRange[] = []
//   const matches: { day: number; idx: number }[] = []
//   const re = /\b([1-9]|[12]\d|3[01])\b/g
//   let m: RegExpExecArray | null
//   while ((m = re.exec(header)) !== null) {
//     const day = Number(m[1])
//     if (!Number.isNaN(day)) matches.push({ day, idx: m.index })
//   }
//   const sorted = matches
//     .filter((x) => x.day >= 1 && x.day <= daysInMonth)
//     .sort((a, b) => a.idx - b.idx)
//     .slice(0, daysInMonth)

//   if (sorted.length === daysInMonth) {
//     const totalLen = Math.max(header.length, fallbackLen || 0)
//     for (let i = 0; i < sorted.length; i++) {
//       const start = sorted[i].idx
//       const end = i < sorted.length - 1 ? sorted[i + 1].idx : totalLen
//       ranges.push({ start, end })
//     }
//     return ranges
//   }

//   const total = header.length || fallbackLen || daysInMonth
//   const width = Math.max(1, Math.floor(total / daysInMonth))
//   for (let i = 0; i < daysInMonth; i++) {
//     ranges.push({ start: i * width, end: i === daysInMonth - 1 ? total : (i + 1) * width })
//   }
//   return ranges
// }

// function extractCodesByColumns(line: string, cols: ColumnRange[], daysInMonth: number) {
//   const out: string[] = []
//   for (let i = 0; i < daysInMonth; i++) {
//     const { start, end } = cols[i] || { start: 0, end: line.length }
//     const cell = line.slice(start, end)
//     const trimmed = cell.trim()
//     if (!trimmed) {
//       out.push('-')
//     } else {
//       const parts = splitConcatenatedCodes(trimmed, 2)
//       out.push(normalizePdfCode(parts[0] || trimmed))
//     }
//   }
//   return out
// }

// const hoursPattern = /^-?\d+,\d+$/

// function parseExcel(buf: Buffer, path: string) {
//   const workbook = XLSX.read(buf, { type: 'buffer' })
//   const sheetName = workbook.SheetNames[0]
//   const sheet = workbook.Sheets[sheetName]
//   const posCell = sheet['BD3']?.v
//   const position = pickPosition(typeof posCell === 'string' ? posCell : '')
//   if (!position) {
//     throw new Error('Position not detected in Excel')
//   }
//   const base = inferMonthYear(path)
//   const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1')
//   const headerRow = 10
//   const cols = Array.from({ length: range.e.c - XLSX.utils.decode_col('P') + 1 }, (_, i) =>
//     XLSX.utils.encode_col(XLSX.utils.decode_col('P') + i)
//   )
//   const datesByCol = new Map<string, string>()
//   cols.forEach((col) => {
//     const cell = sheet[`${col}${headerRow + 1}`]
//     const val = cell?.v
//     let date: string | null = null
//     if (typeof val === 'number') {
//       if (val > 1000) {
//         const parsed = XLSX.SSF.parse_date_code(val)
//         if (parsed) {
//           date = `${String(parsed.y).padStart(4, '0')}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`
//         }
//       } else if (val >= 1 && val <= 31) {
//         if (base) date = isoDay(base.year, base.month, val)
//       }
//     } else if (typeof val === 'string') {
//       const num = Number(val.trim())
//       if (!Number.isNaN(num) && num >= 1 && num <= 31 && base) {
//         date = isoDay(base.year, base.month, num)
//       } else {
//         const maybe = new Date(val)
//         if (!Number.isNaN(maybe.getTime())) {
//           date = `${maybe.toISOString().slice(0, 10)}`
//         }
//       }
//     }
//     if (date) datesByCol.set(col, date)
//   })

//   const workerRows = [
//     ...Array.from({ length: 22 }, (_, i) => 13 + i * 2),
//     ...Array.from({ length: 30 }, (_, i) => 63 + i * 2),
//   ]

//   const shifts = new Map<string, { date: string; position: Position; workers: Set<string>; source: string }>()
//   const extras: ExtraShift[] = []

//   for (const row of workerRows) {
//     const nameCell = sheet[`H${row}`]
//     const name = typeof nameCell?.v === 'string' ? nameCell.v.trim() : ''
//     if (!name) continue
//     const roleCell = sheet[`M${row}`]?.v
//     if (!allowedForRole(roleCell, position)) continue

//     cols.forEach((col) => {
//       const date = datesByCol.get(col)
//       if (!date) return
//       const shiftCell = sheet[`${col}${row}`]
//       const code = normalizeCode(shiftCell?.v)
//       if (NIGHT_CODES.includes(code)) {
//         const key = `${position}-${date}`
//         if (!shifts.has(key)) shifts.set(key, { date, position, workers: new Set(), source: path })
//         shifts.get(key)!.workers.add(name)
//       }
//       if (EXTRA_SHIFT_CODES.includes(code)) {
//         extras.push({ name, date, code, position })
//       }
//     })
//   }

//   const nightShifts: NightShift[] = Array.from(shifts.values()).map((s) => ({
//     id: `${s.position}-${s.date}`,
//     date: s.date,
//     position: s.position,
//     workers: Array.from(s.workers),
//     source: path,
//   }))
//   return { nightShifts, extraShifts: extras }
// }

// function parsePdf(buffer: Buffer, path: string) {
//   const DEBUG = false
//   const log = (...args: any[]) => {
//     if (DEBUG) console.info('[pdf]', ...args)
//   }

//   return pdfParse(buffer)
//     .then((res) => res.text)
//     .then((text) => {
//       const cleaned = text.replace(/\r/g, '')
//       const searchText = cleaned.replace(/[ \t]+/g, ' ')
//       const position = pickPosition(searchText)
//       if (!position) throw new Error('Position not detected in PDF')

//       let base = inferMonthYear(path)
//       if (!base) {
//         const mm = searchText.match(
//           /(Януари|Февруари|Март|Април|Май|Юни|Юли|Август|Септември|Октомври|Ноември|Декември)\s+(\d{4})/i
//         )
//         if (mm) {
//           const monthNames: Record<string, number> = {
//             Януари: 1,
//             Февруари: 2,
//             Март: 3,
//             Април: 4,
//             Май: 5,
//             Юни: 6,
//             Юли: 7,
//             Август: 8,
//             Септември: 9,
//             Октомври: 10,
//             Ноември: 11,
//             Декември: 12,
//           }
//           const m = monthNames[mm[1]] || 0
//           const y = Number(mm[2])
//           if (m && y) base = { month: m, year: y }
//         }
//       }
//       if (!base) throw new Error('Month/year not detected in PDF')
//       const daysInMonth = new Date(base.year, base.month, 0).getDate()

//       const lines = cleaned.split('\n').map((l) => l.replace(/\r/g, '')).filter((l) => l.trim().length > 0)

//       const shifts = new Map<string, { date: string; position: Position; workers: Set<string>; source: string }>()
//       const extras: ExtraShift[] = []

//       const isWorkerIndex = (l: string) => /^\d+$/.test(l.trim())

//       for (let i = 0; i < lines.length; i++) {
//         const idxLine = lines[i].trim()
//         if (!isWorkerIndex(idxLine)) continue

//         const block: string[] = []
//         let j = i + 1
//         while (j < lines.length && !isWorkerIndex(lines[j].trim())) {
//           block.push(lines[j].trim())
//           if (hoursPattern.test(lines[j])) {
//             j++
//             break
//           }
//           j++
//         }
//         i = j - 1
//         if (!block.length) continue

//         const dutyIdx = block.findIndex((l) => l.includes('РП-'))
//         if (dutyIdx === -1) continue
//         const name = block.slice(0, dutyIdx).join(' ').trim()
//         if (!name) continue

//         const dutyTokens = block[dutyIdx].split(/\s+/).filter(Boolean)
//         const dutyStart = dutyTokens.findIndex((t) => t.startsWith('РП') || t === 'ЛКК')
//         if (dutyStart === -1) continue
//         const duty = dutyTokens.slice(dutyStart, dutyStart + 2).join(' ').trim()
//         if (!allowedForRole(duty, position)) continue

//         const codeLine = block[dutyIdx + 1] || ''
//         const rawCodes = codeLine.split(/\s+/).filter(Boolean)
//         let codes: string[] = []
//         rawCodes.forEach((tok) => {
//           const norm = normalizePdfCode(tok)
//           if (norm.length > 5) codes = codes.concat(splitConcatenatedCodes(norm, daysInMonth - codes.length))
//           else codes.push(norm)
//         })
//         while (codes.length < daysInMonth) codes.push('-')
//         if (codes.length > daysInMonth) codes = codes.slice(0, daysInMonth)

//         if (DEBUG) log('worker', name, duty, codes.join('|'))

//         for (let d = 0; d < daysInMonth; d++) {
//           const code = normalizePdfCode(codes[d] || '-')
//           const date = isoDay(base.year, base.month, d + 1)
//           if (NIGHT_CODES.includes(code)) {
//             const key = `${position}-${date}`
//             if (!shifts.has(key)) shifts.set(key, { date, position, workers: new Set(), source: path })
//             shifts.get(key)!.workers.add(name)
//           }
//           if (EXTRA_SHIFT_CODES.includes(code)) {
//             extras.push({ name, date, code, position })
//           }
//         }
//       }

//       const nightShifts: NightShift[] = Array.from(shifts.values()).map((s) => ({
//         id: `${s.position}-${s.date}`,
//         date: s.date,
//         position: s.position,
//         workers: Array.from(s.workers),
//         source: path,
//       }))
//       return { nightShifts, extraShifts: extras }
//     })
// }

// export async function parseSchedule(buffer: Buffer, filename: string) {
//   const lower = filename.toLowerCase()
//   if (lower.endsWith('.pdf')) {
//     return parsePdf(buffer, filename)
//   }
//   if (lower.endsWith('.xls') || lower.endsWith('.xlsx')) {
//     return parseExcel(buffer, filename)
//   }
//   throw new Error('Unsupported schedule format')
// }

// export function computeMonth(
//   payload: { nightShifts: NightShift[]; extraShifts: ExtraShift[] },
//   fallback?: { month: number; year: number } | null
// ) {
//   if (payload.nightShifts.length) {
//     const iso = payload.nightShifts[0].date
//     return iso.slice(0, 7)
//   }
//   if (payload.extraShifts.length) {
//     return payload.extraShifts[0].date.slice(0, 7)
//   }
//   if (fallback) {
//     return `${fallback.year}-${String(fallback.month).padStart(2, '0')}`
//   }
//   return ''
// }

// export function parserVersion() {
//   return '1.0.0'
// }