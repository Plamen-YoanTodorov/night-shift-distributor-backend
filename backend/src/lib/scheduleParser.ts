import * as XLSX from 'xlsx'
import pdfParse from 'pdf-parse'
import fs from 'fs'
import path from 'path'

export type Position = 'TWR' | 'APP'
export type NightShift = { id: string; date: string; position: Position; workers: string[]; source: string }
export type ExtraShift = { name: string; date: string; code: string; position: Position }

const NIGHT_CODES = ['Н-2', 'Н22', 'H-2', 'Н']
const EXTRA_SHIFT_CODES: string[] = [
  'I',
  'II-2',
  'Д09',
  'СД',
  'C2',
  'C5',
  'Об3',
  'Пк11',
  'пII',
  'Мп',
  'R8',
  'Ос',
  'К',
  'Б',
  'М',
  'и',
  'I-2',
  'Д07',
  'Д11',
  'СН/12',
  'C3',
  'Рг3',
  'Об5',
  'Пк14',
  'Iан',
  'Ан',
  'РД',
  'Кс',
  'Кп',
  'Б8',
  'От',
  'II',
  'Д',
  'Д13',
  'C1',
  'C4',
  'Рг5',
  'Пк09',
  'Iп',
  'анII',
  'Р',
  'О',
  'Кч',
  'Ап',
  'А',
  'Со',
  'Х',
  'Kc',
  'O',
  'X',
]

function normalizeCode(value: unknown) {
  if (typeof value !== 'string') return ''
  return value.trim()
}

function toISODateWithBase(val: unknown, base?: { year: number; month: number } | null): string | null {
  if (!base) return null
  if (typeof val === 'number') {
    if (val >= 1 && val <= 31) return isoDay(base.year, base.month, val)
  }
  if (typeof val === 'string') {
    const num = Number(val.trim())
    if (!Number.isNaN(num) && num >= 1 && num <= 31) return isoDay(base.year, base.month, num)
  }
  return null
}

export function inferMonthYear(path: string): { month: number; year: number } | null {
  const match = path.match(/_(\d{4})/i)
  if (!match) return null
  const mm = Number(match[1].slice(0, 2))
  const yy = Number(match[1].slice(2))
  if (!mm || Number.isNaN(yy)) return null
  const year = yy >= 70 ? 1900 + yy : 2000 + yy
  return { month: mm, year }
}

function pickPosition(val: string): Position | null {
  const normalized = val.replace(/\s+/g, ' ')
  if (normalized.includes('РМ Кула')) return 'TWR'
  if (normalized.includes('РМ Подход')) return 'APP'
  return null
}

function allowedForRole(roleCell: unknown, position: Position) {
  const val = typeof roleCell === 'string' ? roleCell.trim() : ''
  if (val === '') return true
  if (val.includes('РП-радарен и ЛКК') || val.includes('РП-РС')) return true
  if (position === 'TWR' && val.includes('РП-ЛКК')) return true
  if (position === 'APP' && val.includes('РП-радарен')) return true
  if (position === 'APP' && val.includes('РП-РС')) return true
  return false
}

function isoDay(year: number, month: number, day: number) {
  const d = new Date(year, month - 1, day)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function normalizePdfCode(token: string) {
  const t = token.trim()
  if (t === '-') return t
  const dMatch = t.match(/^Д(\d{2}):?\/\d+$/)
  if (dMatch) return `Д${dMatch[1]}`
  const dMatch2 = t.match(/^Д(\d{2})\/\d+$/)
  if (dMatch2) return `Д${dMatch2[1]}`
  const rg = t.match(/^(Рг\d+)\/\d+$/)
  if (rg) return rg[1]
  const ob = t.match(/^(Об\d+)\/\d+$/)
  if (ob) return ob[1]
  if (/^СД\/\d+$/.test(t)) return 'СД'
  return t
}

const CODE_LIST = Array.from(new Set([...NIGHT_CODES, ...EXTRA_SHIFT_CODES, '-'])).sort(
  (a, b) => b.length - a.length
)
function splitConcatenatedCodes(raw: string, max: number) {
  const codes: string[] = []
  let idx = 0
  const s = raw.trim()
  while (idx < s.length && codes.length < max) {
    const slice = s.slice(idx)
    const match = CODE_LIST.find((c) => slice.startsWith(c))
    if (match) {
      codes.push(match)
      idx += match.length
    } else {
      idx += 1
    }
  }
  return codes
}

function tokenIsShift(code: string) {
  const banned = ['ГРАФИК', 'ЧАСОВЕ', 'часове', 'през', 'месец', 'г.', 'дата']
  if (banned.some((b) => code.includes(b))) return false
  return /^[A-Za-zА-Яа-я0-9][A-Za-zА-Яа-я0-9\-/:]*$/.test(code) || code === '-'
}

// ============================
// Whole-year sheet parser (ALL 2026)
// ============================

function parseWholeYearSheet(workbook: XLSX.WorkBook, filename: string) {
  const target = workbook.SheetNames.find((n) => n.trim().toUpperCase() === 'ALL 2026')
  if (!target) return null
  const sheet = workbook.Sheets[target]
  if (!sheet) return null

  const yearMatch = target.match(/(\d{4})/) || filename.match(/(\d{4})/)
  const year = yearMatch ? Number(yearMatch[1]) : 2026

  const startColIdx = XLSX.utils.decode_col('D')
  const endColIdx = XLSX.utils.decode_col('ND') // Dec 31
  const datesByCol = new Map<number, string>()
  for (let c = startColIdx; c <= endColIdx; c++) {
    const offset = c - startColIdx // 0-based days from Jan 1
    const date = isoDay(year, 1, 1 + offset)
    datesByCol.set(c, date)
  }

  const rows = Array.from({ length: 30 }, (_, i) => 7 + i) // 7..36
  const shifts = new Map<string, { date: string; position: Position; workers: Set<string>; source: string }>()
  const extras: ExtraShift[] = []

  rows.forEach((row) => {
    const nameCell = sheet[`B${row}`]
    const name = typeof nameCell?.v === 'string' ? nameCell.v.trim() : ''
    if (!name) return
    const position: Position = row <= 16 ? 'TWR' : 'APP'
    for (let c = startColIdx; c <= endColIdx; c++) {
      const date = datesByCol.get(c)
      if (!date) continue
      const col = XLSX.utils.encode_col(c)
      const code = normalizeCode(sheet[`${col}${row}`]?.v)
      if (!code) continue
      if (NIGHT_CODES.includes(code)) {
        const key = `${position}-${date}`
        if (!shifts.has(key)) shifts.set(key, { date, position, workers: new Set(), source: filename })
        shifts.get(key)!.workers.add(name)
      }
      if (EXTRA_SHIFT_CODES.includes(code)) {
        extras.push({ name, date, code, position })
      }
    }
  })

  const nightShifts: NightShift[] = Array.from(shifts.values()).map((s) => ({
    id: `${s.position}-${s.date}`,
    date: s.date,
    position: s.position,
    workers: Array.from(s.workers),
    source: filename,
  }))
  return { nightShifts, extraShifts: extras }
}

type ColumnRange = { start: number; end: number }
function buildColumnRanges(header: string, daysInMonth: number, fallbackLen: number): ColumnRange[] {
  const ranges: ColumnRange[] = []
  const matches: { day: number; idx: number }[] = []
  const re = /\b([1-9]|[12]\d|3[01])\b/g
  let m: RegExpExecArray | null
  while ((m = re.exec(header)) !== null) {
    const day = Number(m[1])
    if (!Number.isNaN(day)) matches.push({ day, idx: m.index })
  }
  const sorted = matches
    .filter((x) => x.day >= 1 && x.day <= daysInMonth)
    .sort((a, b) => a.idx - b.idx)
    .slice(0, daysInMonth)

  if (sorted.length === daysInMonth) {
    const totalLen = Math.max(header.length, fallbackLen || 0)
    for (let i = 0; i < sorted.length; i++) {
      const start = sorted[i].idx
      const end = i < sorted.length - 1 ? sorted[i + 1].idx : totalLen
      ranges.push({ start, end })
    }
    return ranges
  }

  const total = header.length || fallbackLen || daysInMonth
  const width = Math.max(1, Math.floor(total / daysInMonth))
  for (let i = 0; i < daysInMonth; i++) {
    ranges.push({ start: i * width, end: i === daysInMonth - 1 ? total : (i + 1) * width })
  }
  return ranges
}

function extractCodesByColumns(line: string, cols: ColumnRange[], daysInMonth: number) {
  const out: string[] = []
  for (let i = 0; i < daysInMonth; i++) {
    const { start, end } = cols[i] || { start: 0, end: line.length }
    const cell = line.slice(start, end)
    const trimmed = cell.trim()
    if (!trimmed) {
      out.push('-')
    } else {
      const parts = splitConcatenatedCodes(trimmed, 2)
      out.push(normalizePdfCode(parts[0] || trimmed))
    }
  }
  return out
}

const hoursPattern = /^-?\d+,\d+$/

function parseExcel(buf: Buffer, path: string) {
  const workbook = XLSX.read(buf, { type: 'buffer' })
  const sheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]
  const posCell = sheet['BD3']?.v
  const position = pickPosition(typeof posCell === 'string' ? posCell : '')
  if (!position) {
    throw new Error('Position not detected in Excel')
  }
  const base = inferMonthYear(path)
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1')
  const headerRow = 10
  const cols = Array.from({ length: range.e.c - XLSX.utils.decode_col('P') + 1 }, (_, i) =>
    XLSX.utils.encode_col(XLSX.utils.decode_col('P') + i)
  )
  const datesByCol = new Map<string, string>()
  cols.forEach((col) => {
    const cell = sheet[`${col}${headerRow + 1}`]
    const val = cell?.v
    let date: string | null = null
    if (typeof val === 'number') {
      if (val > 1000) {
        const parsed = XLSX.SSF.parse_date_code(val)
        if (parsed) {
          date = `${String(parsed.y).padStart(4, '0')}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`
        }
      } else if (val >= 1 && val <= 31) {
        if (base) date = isoDay(base.year, base.month, val)
      }
    } else if (typeof val === 'string') {
      const num = Number(val.trim())
      if (!Number.isNaN(num) && num >= 1 && num <= 31 && base) {
        date = isoDay(base.year, base.month, num)
      } else {
        const maybe = new Date(val)
        if (!Number.isNaN(maybe.getTime())) {
          date = `${maybe.toISOString().slice(0, 10)}`
        }
      }
    }
    if (date) datesByCol.set(col, date)
  })

  const workerRows = [
    ...Array.from({ length: 22 }, (_, i) => 13 + i * 2),
    ...Array.from({ length: 30 }, (_, i) => 63 + i * 2),
  ]

  const shifts = new Map<string, { date: string; position: Position; workers: Set<string>; source: string }>()
  const extras: ExtraShift[] = []

  for (const row of workerRows) {
    const nameCell = sheet[`H${row}`]
    const name = typeof nameCell?.v === 'string' ? nameCell.v.trim() : ''
    if (!name) continue
    const roleCell = sheet[`M${row}`]?.v
    if (!allowedForRole(roleCell, position)) continue

    cols.forEach((col) => {
      const date = datesByCol.get(col)
      if (!date) return
      const shiftCell = sheet[`${col}${row}`]
      const code = normalizeCode(shiftCell?.v)
      if (NIGHT_CODES.includes(code)) {
        const key = `${position}-${date}`
        if (!shifts.has(key)) shifts.set(key, { date, position, workers: new Set(), source: path })
        shifts.get(key)!.workers.add(name)
      }
      if (EXTRA_SHIFT_CODES.includes(code)) {
        extras.push({ name, date, code, position })
      }
    })
  }

  const nightShifts: NightShift[] = Array.from(shifts.values()).map((s) => ({
    id: `${s.position}-${s.date}`,
    date: s.date,
    position: s.position,
    workers: Array.from(s.workers),
    source: path,
  }))
  return { nightShifts, extraShifts: extras }
}

function parseExcelNew(buf: Buffer, path: string) {
  const workbook = XLSX.read(buf, { type: 'buffer' })
  const sheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]
  const base = inferMonthYear(path)
  const position = pickPosition(typeof sheet['AF1']?.v === 'string' ? (sheet['AF1']?.v as string) : '')
  if (!position) throw new Error('Position not detected in Excel (new layout)')

  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1')
  const dateRow = 3
  const startCol = XLSX.utils.decode_col('K')
  const datesByCol = new Map<string, string>()
  for (let c = startCol; c <= range.e.c; c++) {
    const col = XLSX.utils.encode_col(c)
    const cell = sheet[`${col}${dateRow}`]
    const date = toISODateWithBase(cell?.v, base)
    if (date) datesByCol.set(col, date)
  }

  const shifts = new Map<string, { date: string; position: Position; workers: Set<string>; source: string }>()
  const extras: ExtraShift[] = []

  for (let r = 5; r <= range.e.r; r += 2) {
    const nameCell = sheet[`C${r}`]
    const name = typeof nameCell?.v === 'string' ? nameCell.v.trim() : ''
    if (!name) continue
    const roleCell = sheet[`H${r}`]?.v
    if (!allowedForRole(roleCell, position)) continue
    datesByCol.forEach((date, col) => {
      const shiftCell = sheet[`${col}${r}`]
      const code = normalizeCode(shiftCell?.v)
      if (NIGHT_CODES.includes(code)) {
        const key = `${position}-${date}`
        if (!shifts.has(key)) shifts.set(key, { date, position, workers: new Set(), source: path })
        shifts.get(key)!.workers.add(name)
      }
      if (EXTRA_SHIFT_CODES.includes(code)) {
        extras.push({ name, date, code, position })
      }
    })
  }

  const nightShifts: NightShift[] = Array.from(shifts.values()).map((s) => ({
    id: `${s.position}-${s.date}`,
    date: s.date,
    position: s.position,
    workers: Array.from(s.workers),
    source: path,
  }))
  return { nightShifts, extraShifts: extras }
}

// -------- PDF -> pseudo-Excel pipeline (does not touch the real XLS parser) --------

type PdfRow = { name: string; duty: string; codes: string[] }
type PdfTable = { position: Position; daysInMonth: number; rows: PdfRow[]; month: number; year: number }

async function parsePdfToTable(buffer: Buffer, path: string): Promise<PdfTable> {
  const text = (await pdfParse(buffer)).text
  const cleaned = text.replace(/\r/g, '')
  const searchText = cleaned.replace(/[ \t]+/g, ' ')
  const position = pickPosition(searchText)
  if (!position) throw new Error('Position not detected in PDF')

  let base = inferMonthYear(path)
  if (!base) {
    const mm = searchText.match(
      /(Януари|Февруари|Март|Април|Май|Юни|Юли|Август|Септември|Октомври|Ноември|Декември)\s+(\d{4})/i
    )
    if (mm) {
      const monthNames: Record<string, number> = {
        Януари: 1,
        Февруари: 2,
        Март: 3,
        Април: 4,
        Май: 5,
        Юни: 6,
        Юли: 7,
        Август: 8,
        Септември: 9,
        Октомври: 10,
        Ноември: 11,
        Декември: 12,
      }
      const m = monthNames[mm[1]] || 0
      const y = Number(mm[2])
      if (m && y) base = { month: m, year: y }
    }
  }
  if (!base) throw new Error('Month/year not detected in PDF')
  const daysInMonth = new Date(base.year, base.month, 0).getDate()

  const lines = cleaned.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
  const isIdx = (l: string) => /^\d+$/.test(l)

  const rows: PdfRow[] = []
  for (let i = 0; i < lines.length; i++) {
    if (!isIdx(lines[i])) continue
    const nameParts: string[] = []
    let dutyLine = ''
    let j = i + 1
    while (j < lines.length) {
      const l = lines[j]
      if (isIdx(l) && nameParts.length) break
      if (l.includes('РП-')) {
        dutyLine = l
        j++
        break
      } else {
        nameParts.push(l)
        j++
      }
    }
    if (!dutyLine || !nameParts.length) {
      i = j - 1
      continue
    }
    const name = nameParts.join(' ').trim()
    const dutyTokens = dutyLine.split(/\s+/).filter(Boolean)
    const dutyStart = dutyTokens.findIndex((t) => t.startsWith('РП') || t === 'ЛКК')
    if (dutyStart === -1) {
      i = j - 1
      continue
    }
    const duty = dutyTokens.slice(dutyStart).join(' ').trim()
    if (!allowedForRole(duty, position)) {
      i = j - 1
      continue
    }

    // codes are typically on the next line
    const codeLine = lines[j] || ''
    const rawCodes = codeLine.split(/\s+/).filter(Boolean)
    let codes: string[] = []
    rawCodes.forEach((tok) => {
      const norm = normalizePdfCode(tok)
      if (norm.length > 5) codes = codes.concat(splitConcatenatedCodes(norm, daysInMonth - codes.length))
      else codes.push(norm)
    })
    while (codes.length < daysInMonth) codes.push('-')
    if (codes.length > daysInMonth) codes = codes.slice(0, daysInMonth)

    rows.push({ name, duty, codes })
    i = j
  }

  return { position, daysInMonth, rows, month: base.month, year: base.year }
}

function parsePdfTable(table: PdfTable, pdfPath: string) {
  const shifts = new Map<string, { date: string; position: Position; workers: Set<string>; source: string }>()
  const extras: ExtraShift[] = []

  const spreadGaps = (codes: string[], days: number) => {
    if (codes.length === 0) return Array<string>(days).fill('-')
    if (codes.length >= days) return codes.slice(0, days)
    const gaps = days - codes.length
    const result: string[] = []
    let remainingGaps = gaps
    let slots = codes.length + 1
    codes.forEach((c) => {
      const g = Math.floor(remainingGaps / slots)
      for (let i = 0; i < g; i++) result.push('-')
      remainingGaps -= g
      slots -= 1
      result.push(c)
    })
    while (remainingGaps-- > 0) result.push('-')
    return result
  }

  // Write a debug Excel so it can be inspected manually
  try {
    const wb = XLSX.utils.book_new()
    const header = ['Name', ...Array.from({ length: table.daysInMonth }, (_, i) => String(i + 1))]
    const rowsForSheet = [
      header,
      ...table.rows.map((r) => [r.name, ...spreadGaps(r.codes.map(normalizePdfCode), table.daysInMonth)]),
    ]
    const ws = XLSX.utils.aoa_to_sheet(rowsForSheet)
    XLSX.utils.book_append_sheet(wb, ws, 'PDF')
    const outDir = path.resolve(process.cwd(), 'data', 'debug')
    fs.mkdirSync(outDir, { recursive: true })
    const baseName = path.basename(pdfPath || `pdf-${Date.now()}.pdf`).replace(/\.[^.]+$/, '')
    const outFile = path.join(outDir, `${baseName}_parsed.xlsx`)
    XLSX.writeFile(wb, outFile)
  } catch (err) {
    // best-effort debug output; ignore errors
  }

  for (const row of table.rows) {
    const distributed = spreadGaps(row.codes.map(normalizePdfCode), table.daysInMonth)
    for (let d = 0; d < table.daysInMonth; d++) {
      const code = normalizePdfCode(distributed[d] || '-')
      const date = isoDay(table.year, table.month, d + 1)
      if (NIGHT_CODES.includes(code)) {
        const key = `${table.position}-${date}`
        if (!shifts.has(key)) shifts.set(key, { date, position: table.position, workers: new Set(), source: pdfPath })
        shifts.get(key)!.workers.add(row.name)
      }
      if (EXTRA_SHIFT_CODES.includes(code)) {
        extras.push({ name: row.name, date, code, position: table.position })
      }
    }
  }
  const nightShifts: NightShift[] = Array.from(shifts.values()).map((s) => ({
    id: `${s.position}-${s.date}`,
    date: s.date,
    position: s.position,
    workers: Array.from(s.workers),
    source: pdfPath,
  }))
  return { nightShifts, extraShifts: extras }
}

export async function parseSchedule(buffer: Buffer, filename: string) {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.pdf')) {
    const table = await parsePdfToTable(buffer, filename)
    return parsePdfTable(table, filename)
  }
  if (lower.endsWith('.xls') || lower.endsWith('.xlsx') || lower.endsWith('.xlsm')) {
    const workbook = XLSX.read(buffer, { type: 'buffer' })
    const wholeYear = parseWholeYearSheet(workbook, filename)
    if (wholeYear) return wholeYear
    // Detect layout: if BD3 has a value -> old layout; else new layout
    const sheetName = workbook.SheetNames[0]
    const sheet = workbook.Sheets[sheetName]
    const hasBD3 = sheet['BD3'] && sheet['BD3'].v
    return hasBD3 ? parseExcel(buffer, filename) : parseExcelNew(buffer, filename)
  }
  throw new Error('Unsupported schedule format')
}

export function computeMonth(
  payload: { nightShifts: NightShift[]; extraShifts: ExtraShift[] },
  fallback?: { month: number; year: number } | null
) {
  if (payload.nightShifts.length) {
    const iso = payload.nightShifts[0].date
    return iso.slice(0, 7)
  }
  if (payload.extraShifts.length) {
    return payload.extraShifts[0].date.slice(0, 7)
  }
  if (fallback) {
    return `${fallback.year}-${String(fallback.month).padStart(2, '0')}`
  }
  return ''
}

export function parserVersion() {
  return '1.0.0'
}
