import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'

const dataDir = path.resolve(process.env.DATA_DIR ?? path.join(process.cwd(), "data"))
const uploadsDir = path.join(dataDir, 'uploads')
fs.mkdirSync(uploadsDir, { recursive: true })

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

// Ensure a default dataset exists so global distribution saves do not violate FKs.
const defaultDataset = db.prepare('SELECT id FROM datasets WHERE id = 1').get()
if (!defaultDataset) {
  const now = new Date().toISOString()
  db.prepare('INSERT INTO datasets (id, name, createdAt) VALUES (1, ?, ?)').run('default', now)
}

// Seed default role labels if missing
const defaultLabels: Record<string, string> = { stayer: 'Stayer', goer1: 'Goer', goer2: 'Goer 2' }
const upsertLabel = db.prepare(
  'INSERT INTO role_labels (role, label) VALUES (?, ?) ON CONFLICT(role) DO UPDATE SET label=excluded.label'
)
Object.entries(defaultLabels).forEach(([role, label]) => upsertLabel.run(role, label))

export { db, uploadsDir }
