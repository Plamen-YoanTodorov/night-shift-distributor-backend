# Night Shift Backend

Fastify + SQLite service for storing uploaded schedules and distribution data.

## Prerequisites
- Node.js 18–22 (better-sqlite3 does not yet ship prebuilds for Node 23/24)

## Setup
```bash
cd backend
npm install
```
If you switch Node versions, reinstall to rebuild `better-sqlite3`:
```bash
rm -rf node_modules
npm install
```

## Run (dev)
```bash
npm run dev
```
API defaults to http://localhost:4000.

## Build & start
```bash
npm run build
npm start
```

Data persists in `./data` (SQLite + uploads).

## API

### Upload XLSX schedules
```bash
curl -F "file=@./GrafikNK_1225.xlsx" http://localhost:4000/api/uploads
```

### List uploads
```bash
curl http://localhost:4000/api/uploads
```

### Create dataset with uploads
```bash
curl -X POST http://localhost:4000/api/datasets \
  -H "Content-Type: application/json" \
  -d '{"name":"Dec 2025","uploadIds":[1,2]}'
```

### Save distributions for a dataset
```bash
curl -X PUT http://localhost:4000/api/datasets/1/distributions \
  -H "Content-Type: application/json" \
  -d '[
    {"datasetId":1,"date":"2025-12-01","position":"TWR","worker":"Ivan","role":"stayer","isManual":false}
  ]'
```

### Load distributions for a dataset
```bash
curl http://localhost:4000/api/datasets/1/distributions
```

### Download upload
```bash
curl -O http://localhost:4000/api/uploads/1/download
```

## Notes
- No Excel parsing or distribution algorithm here; this service only stores files and distribution data.
- Uploads are limited to `.xlsx`, 50MB per file, saved to `data/uploads`.
- SQLite lives at `data/db.sqlite`; tables: uploads, datasets, dataset_uploads, distributions.
