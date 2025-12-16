export interface UploadRecord {
  id: number
  originalName: string
  storedName: string
  fileSizeBytes: number
  sha256: string
  createdAt: string
}

export interface DatasetRecord {
  id: number
  name: string
  createdAt: string
}

export interface DistributionEntry {
  datasetId: number
  date: string // ISO
  position: 'TWR' | 'APP' | string
  worker: string
  role: string
  isManual: boolean
}
