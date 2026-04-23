import crypto from 'crypto'
import { db } from '../db'

export type AccountRole = 'admin' | 'editor' | 'viewer'

export type AccountRow = {
  id: number
  username: string
  passwordHash: string
  role: AccountRole
  staffName: string | null
  createdAt: string
  updatedAt: string
}

export type AccountDto = {
  id: number
  username: string
  role: AccountRole
  staffName: string | null
  createdAt: string
  updatedAt: string
}

const TOKEN_SECRET =
  process.env.AUTH_TOKEN_SECRET ||
  process.env.ADMIN_PASSWORD ||
  'night-shift-account-token-secret'

function normalizeUsername(username: string) {
  return username.trim().toLowerCase()
}

function normalizeRole(role: unknown): AccountRole {
  if (role === 'admin' || role === 'editor' || role === 'viewer') return role
  return 'viewer'
}

function normalizeStaffName(staffName: unknown) {
  if (typeof staffName !== 'string') return null
  const normalized = staffName.trim()
  return normalized.length > 0 ? normalized : null
}

function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

function verifyPassword(password: string, stored: string) {
  const [salt, expectedHash] = stored.split(':')
  if (!salt || !expectedHash) return false
  const actual = crypto.scryptSync(password, salt, 64)
  const expected = Buffer.from(expectedHash, 'hex')
  if (actual.length !== expected.length) return false
  return crypto.timingSafeEqual(actual, expected)
}

function toDto(row: AccountRow): AccountDto {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    staffName: row.staffName,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function base64url(input: string) {
  return Buffer.from(input).toString('base64url')
}

function sign(payload: string) {
  return crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('base64url')
}

function adminCount(exceptId?: number) {
  const row = db
    .prepare(
      `SELECT COUNT(*) as count
       FROM accounts
       WHERE role = 'admin' AND (? IS NULL OR id != ?)`
    )
    .get(exceptId ?? null, exceptId ?? null) as { count: number }
  return row.count
}

export function ensureDefaultAccounts() {
  const row = db.prepare('SELECT COUNT(*) as count FROM accounts').get() as { count: number }
  if (row.count > 0) return

  const now = new Date().toISOString()
  const adminUsername = normalizeUsername(process.env.ADMIN_USERNAME || 'admin')
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123'
  const viewerUsername = normalizeUsername(process.env.SITE_USERNAME || 'rp_view')
  const viewerPassword = process.env.SITE_PASSWORD || '1234'

  const insert = db.prepare(
    `INSERT INTO accounts (username, passwordHash, role, staffName, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?)`
  )

  insert.run(adminUsername, hashPassword(adminPassword), 'admin', null, now, now)

  if (viewerUsername !== adminUsername) {
    insert.run(viewerUsername, hashPassword(viewerPassword), 'viewer', null, now, now)
  }
}

export function listAccounts() {
  ensureDefaultAccounts()
  const rows = db
    .prepare(
      `SELECT id, username, passwordHash, role, staffName, createdAt, updatedAt
       FROM accounts
       ORDER BY username ASC`
    )
    .all() as AccountRow[]
  return rows.map(toDto)
}

export function findAccountByCredentials(username: string, password: string) {
  ensureDefaultAccounts()
  const normalized = normalizeUsername(username)
  const row = db
    .prepare(
      `SELECT id, username, passwordHash, role, staffName, createdAt, updatedAt
       FROM accounts
       WHERE username = ?`
    )
    .get(normalized) as AccountRow | undefined

  if (!row || !verifyPassword(password, row.passwordHash)) return null
  return row
}

export function createAccount(input: {
  username: string
  password: string
  role: AccountRole
  staffName?: string | null
}) {
  const username = normalizeUsername(input.username)
  const password = input.password || ''
  const role = normalizeRole(input.role)
  const staffName = normalizeStaffName(input.staffName)
  if (username.length < 2) throw new Error('Username must be at least 2 characters.')
  if (password.length < 6) throw new Error('Password must be at least 6 characters.')

  const now = new Date().toISOString()
  const info = db
    .prepare(
      `INSERT INTO accounts (username, passwordHash, role, staffName, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(username, hashPassword(password), role, staffName, now, now)

  const row = db
    .prepare(
      `SELECT id, username, passwordHash, role, staffName, createdAt, updatedAt
       FROM accounts
       WHERE id = ?`
    )
    .get(info.lastInsertRowid) as AccountRow
  return toDto(row)
}

export function updateAccount(
  id: number,
  input: {
    username?: string
    password?: string
    role?: AccountRole
    staffName?: string | null
  }
) {
  const current = db
    .prepare(
      `SELECT id, username, passwordHash, role, staffName, createdAt, updatedAt
       FROM accounts
       WHERE id = ?`
    )
    .get(id) as AccountRow | undefined
  if (!current) return null

  const username =
    input.username === undefined ? current.username : normalizeUsername(input.username)
  const role = input.role === undefined ? current.role : normalizeRole(input.role)
  const staffName =
    input.staffName === undefined ? current.staffName : normalizeStaffName(input.staffName)
  const passwordHash =
    input.password && input.password.length > 0
      ? hashPassword(input.password)
      : current.passwordHash

  if (username.length < 2) throw new Error('Username must be at least 2 characters.')
  if (input.password !== undefined && input.password !== '' && input.password.length < 6) {
    throw new Error('Password must be at least 6 characters.')
  }
  if (current.role === 'admin' && role !== 'admin' && adminCount(current.id) === 0) {
    throw new Error('At least one admin account is required.')
  }

  const now = new Date().toISOString()
  db.prepare(
    `UPDATE accounts
     SET username = ?, passwordHash = ?, role = ?, staffName = ?, updatedAt = ?
     WHERE id = ?`
  ).run(username, passwordHash, role, staffName, now, id)

  const row = db
    .prepare(
      `SELECT id, username, passwordHash, role, staffName, createdAt, updatedAt
       FROM accounts
       WHERE id = ?`
    )
    .get(id) as AccountRow
  return toDto(row)
}

export function deleteAccount(id: number) {
  const current = db
    .prepare('SELECT id, role FROM accounts WHERE id = ?')
    .get(id) as { id: number; role: AccountRole } | undefined
  if (!current) return false
  if (current.role === 'admin' && adminCount(current.id) === 0) {
    throw new Error('At least one admin account is required.')
  }
  db.prepare('DELETE FROM accounts WHERE id = ?').run(id)
  return true
}

export function issueAccountToken(account: Pick<AccountRow, 'id'>) {
  const payload = JSON.stringify({
    accountId: account.id,
    iat: Date.now(),
  })
  const encoded = base64url(payload)
  return `acct.${encoded}.${sign(encoded)}`
}

export function verifyAccountToken(token: string): AccountRole | null {
  return verifyAccountTokenDetails(token)?.role || null
}

export function verifyAccountTokenDetails(token: string): AccountDto | null {
  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== 'acct') return null
  const [, encoded, signature] = parts
  if (sign(encoded) !== signature) return null

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as {
      accountId?: number
    }
    if (!payload.accountId) return null
    const row = db
      .prepare(
        `SELECT id, username, passwordHash, role, staffName, createdAt, updatedAt
         FROM accounts
         WHERE id = ?`
      )
      .get(payload.accountId) as AccountRow | undefined
    if (!row) return null
    return toDto(row)
  } catch {
    return null
  }
}

export function getAccountById(id: number) {
  const row = db
    .prepare(
      `SELECT id, username, passwordHash, role, staffName, createdAt, updatedAt
       FROM accounts
       WHERE id = ?`
    )
    .get(id) as AccountRow | undefined
  return row ? toDto(row) : null
}
