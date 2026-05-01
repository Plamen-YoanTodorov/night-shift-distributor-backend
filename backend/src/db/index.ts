import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'

const dataDir = path.resolve(process.env.DATA_DIR ?? path.join(process.cwd(), "data"))
const uploadsDir = path.join(dataDir, 'uploads')
const suggestionMediaDir = path.join(dataDir, 'suggestion-media')
fs.mkdirSync(uploadsDir, { recursive: true })
fs.mkdirSync(suggestionMediaDir, { recursive: true })

const dbPath = path.join(dataDir, 'db.sqlite')
const db = new Database(dbPath)

db.pragma('foreign_keys = ON')

db.exec(`
CREATE TABLE IF NOT EXISTS uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  originalName TEXT NOT NULL,
  storedName TEXT NOT NULL,
  fileSizeBytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS datasets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dataset_uploads (
  dataset_id INTEGER NOT NULL,
  upload_id INTEGER NOT NULL,
  PRIMARY KEY (dataset_id, upload_id),
  FOREIGN KEY (dataset_id) REFERENCES datasets(id) ON DELETE CASCADE,
  FOREIGN KEY (upload_id) REFERENCES uploads(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS distributions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dataset_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  position TEXT NOT NULL,
  worker TEXT NOT NULL,
  role TEXT NOT NULL,
  isManual INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL,
  FOREIGN KEY (dataset_id) REFERENCES datasets(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS holidays (
  date TEXT PRIMARY KEY,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS role_labels (
  role TEXT PRIMARY KEY,
  label TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS students (
  name TEXT PRIMARY KEY,
  startDate TEXT,
  endDate TEXT,
  position TEXT,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS goer_only (
  name TEXT PRIMARY KEY,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS nicknames (
  name TEXT PRIMARY KEY,
  nickname TEXT NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hidden_workers (
  name TEXT PRIMARY KEY,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  position TEXT NOT NULL,
  month TEXT NOT NULL, -- YYYY-MM
  payload TEXT NOT NULL,
  meta TEXT,
  uploadedAt TEXT NOT NULL,
  parserVersion TEXT,
  UNIQUE(position, month)
);

CREATE TABLE IF NOT EXISTS schedule_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  starred INTEGER NOT NULL DEFAULT 0,
  distributions TEXT NOT NULL,
  schedules TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  message TEXT NOT NULL,
  category TEXT,
  status TEXT NOT NULL DEFAULT 'NEW',
  threadStatus TEXT NOT NULL DEFAULT 'under_review',
  isRead INTEGER NOT NULL DEFAULT 0,
  isVisible INTEGER NOT NULL DEFAULT 0,
  isPinned INTEGER NOT NULL DEFAULT 0,
  isLocked INTEGER NOT NULL DEFAULT 0,
  adminComment TEXT,
  internalNote TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS suggestion_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  suggestionId INTEGER NOT NULL,
  originalName TEXT NOT NULL,
  storedName TEXT NOT NULL,
  mimeType TEXT NOT NULL,
  fileSizeBytes INTEGER NOT NULL,
  createdAt TEXT NOT NULL,
  FOREIGN KEY (suggestionId) REFERENCES suggestions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS feedback_official_replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  threadId INTEGER NOT NULL UNIQUE,
  body TEXT NOT NULL,
  authorId INTEGER,
  authorName TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY (threadId) REFERENCES suggestions(id) ON DELETE CASCADE,
  FOREIGN KEY (authorId) REFERENCES accounts(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS feedback_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  threadId INTEGER NOT NULL,
  body TEXT NOT NULL,
  authorId INTEGER,
  authorName TEXT,
  isAdmin INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL,
  updatedAt TEXT,
  deletedAt TEXT,
  FOREIGN KEY (threadId) REFERENCES suggestions(id) ON DELETE CASCADE,
  FOREIGN KEY (authorId) REFERENCES accounts(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS feedback_thread_votes (
  threadId INTEGER NOT NULL,
  voterId TEXT NOT NULL,
  vote INTEGER NOT NULL CHECK(vote IN (-1, 1)),
  voteDate TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  PRIMARY KEY (threadId, voterId),
  FOREIGN KEY (threadId) REFERENCES suggestions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  passwordHash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin', 'editor', 'viewer')),
  staffName TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS swap_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requesterAccountId INTEGER NOT NULL,
  targetAccountId INTEGER NOT NULL,
  requesterDate TEXT NOT NULL,
  requesterPosition TEXT NOT NULL CHECK(requesterPosition IN ('APP', 'TWR')),
  requesterCode TEXT NOT NULL,
  targetDate TEXT NOT NULL,
  targetPosition TEXT NOT NULL CHECK(targetPosition IN ('APP', 'TWR')),
  targetCode TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN (
    'PENDING_TARGET',
    'DECLINED_BY_TARGET',
    'ACCEPTED_WAITING_ADMIN',
    'APPROVED',
    'REJECTED_BY_ADMIN',
    'CANCELLED'
  )),
  adminAccountId INTEGER,
  adminNote TEXT,
  targetRespondedAt TEXT,
  adminReviewedAt TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY (requesterAccountId) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (targetAccountId) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (adminAccountId) REFERENCES accounts(id) ON DELETE SET NULL
);
`)

// Backward-compatible migration for existing databases created before "starred".
try {
  db.exec('ALTER TABLE schedule_versions ADD COLUMN starred INTEGER NOT NULL DEFAULT 0')
} catch (err) {
  // Ignore duplicate-column errors on already-migrated DBs.
}

// Backward-compatible migration for existing databases created before students.position.
try {
  db.exec('ALTER TABLE students ADD COLUMN position TEXT')
} catch (err) {
  // Ignore duplicate-column errors on already-migrated DBs.
}

// Backward-compatible migration for existing databases created before suggestions.status.
try {
  db.exec("ALTER TABLE suggestions ADD COLUMN status TEXT NOT NULL DEFAULT 'NEW'")
} catch (err) {
  // Ignore duplicate-column errors on already-migrated DBs.
}

// Backward-compatible migration for feedback thread fields on suggestions.
try {
  db.exec("ALTER TABLE suggestions ADD COLUMN title TEXT")
} catch (err) {
  // Ignore duplicate-column errors on already-migrated DBs.
}

try {
  db.exec("ALTER TABLE suggestions ADD COLUMN threadStatus TEXT NOT NULL DEFAULT 'under_review'")
} catch (err) {
  // Ignore duplicate-column errors on already-migrated DBs.
}

try {
  db.exec("ALTER TABLE suggestions ADD COLUMN isPinned INTEGER NOT NULL DEFAULT 0")
} catch (err) {
  // Ignore duplicate-column errors on already-migrated DBs.
}

try {
  db.exec("ALTER TABLE suggestions ADD COLUMN isLocked INTEGER NOT NULL DEFAULT 0")
} catch (err) {
  // Ignore duplicate-column errors on already-migrated DBs.
}

try {
  db.exec("ALTER TABLE suggestions ADD COLUMN internalNote TEXT")
} catch (err) {
  // Ignore duplicate-column errors on already-migrated DBs.
}

try {
  db.exec("ALTER TABLE feedback_thread_votes ADD COLUMN voteDate TEXT")
} catch (err) {
  // Ignore duplicate-column errors on already-migrated DBs.
}

// Backward-compatible migration for existing databases created before suggestions.isRead.
try {
  db.exec("ALTER TABLE suggestions ADD COLUMN isRead INTEGER NOT NULL DEFAULT 0")
} catch (err) {
  // Ignore duplicate-column errors on already-migrated DBs.
}

// Backward-compatible migration for existing databases created before account staff links.
try {
  db.exec('ALTER TABLE accounts ADD COLUMN staffName TEXT')
} catch (err) {
  // Ignore duplicate-column errors on already-migrated DBs.
}

// Normalize legacy suggestion statuses to the current enum.
try {
  db.exec(`
    UPDATE suggestions SET status = 'NEW' WHERE status = 'UNDER_REVIEW';
    UPDATE suggestions SET status = 'IN_PROGRESS' WHERE status = 'WORKING';
    UPDATE suggestions SET status = 'NEW' WHERE status IS NULL OR TRIM(status) = '';
    UPDATE suggestions
       SET threadStatus = CASE status
         WHEN 'ACKNOWLEDGED' THEN 'planned'
         WHEN 'ACCEPTED' THEN 'planned'
         WHEN 'ON_HOLD' THEN 'planned'
         WHEN 'IN_PROGRESS' THEN 'in_progress'
         WHEN 'DONE' THEN 'completed'
         WHEN 'BLOCKED' THEN 'blocked'
         WHEN 'OUT_OF_SCOPE' THEN 'answered'
         ELSE 'under_review'
       END
     WHERE threadStatus IS NULL
        OR TRIM(threadStatus) = ''
        OR threadStatus NOT IN ('under_review', 'planned', 'in_progress', 'completed', 'blocked', 'answered');
  `)
} catch (err) {
  // Ignore migration failures for DBs without suggestions table/state.
}

// Preserve existing public update text as the official reply backing record.
try {
  db.exec(`
    INSERT INTO feedback_official_replies (threadId, body, authorName, createdAt, updatedAt)
    SELECT id, adminComment, 'Admin', updatedAt, updatedAt
      FROM suggestions
     WHERE adminComment IS NOT NULL
       AND TRIM(adminComment) <> ''
       AND NOT EXISTS (
         SELECT 1 FROM feedback_official_replies r WHERE r.threadId = suggestions.id
       );
  `)
} catch (err) {
  // Ignore migration failures for DBs without feedback tables.
}

// Ensure a default dataset exists so global distribution saves do not violate FKs.
const defaultDataset = db.prepare('SELECT id FROM datasets WHERE id = 1').get()
if (!defaultDataset) {
  const now = new Date().toISOString()
  db.prepare('INSERT INTO datasets (id, name, createdAt) VALUES (1, ?, ?)').run('default', now)
}

// Seed default role labels if missing
const defaultLabels: Record<string, string> = { stayer: 'H-3', goer1: 'H-1', goer2: 'H-2' }
const upsertLabel = db.prepare(
  'INSERT INTO role_labels (role, label) VALUES (?, ?) ON CONFLICT(role) DO UPDATE SET label=excluded.label'
)
Object.entries(defaultLabels).forEach(([role, label]) => upsertLabel.run(role, label))

export { db, uploadsDir, suggestionMediaDir }
