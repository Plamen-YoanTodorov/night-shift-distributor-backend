import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'

const dataDir = path.resolve(process.cwd(), 'data')
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
`)

// Ensure a default dataset exists so global distribution saves do not violate FKs.
const defaultDataset = db.prepare('SELECT id FROM datasets WHERE id = 1').get()
if (!defaultDataset) {
  const now = new Date().toISOString()
  db.prepare('INSERT INTO datasets (id, name, createdAt) VALUES (1, ?, ?)').run('default', now)
}

export { db, uploadsDir }
