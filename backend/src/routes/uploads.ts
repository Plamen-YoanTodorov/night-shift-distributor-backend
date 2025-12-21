import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import fastifyMultipart from '@fastify/multipart'
import fs from 'fs'
import path from 'path'
import { listUploads, saveUploadedFile, getUploadById, deleteUpload } from '../services/storage'
import { requireAdmin } from './auth'
import { uploadsDir } from '../db'

export default async function uploadsRoutes(fastify: FastifyInstance) {
  await fastify.register(fastifyMultipart, {
    limits: {
      fileSize: 50 * 1024 * 1024, // 50MB
      files: 20,
    },
  })

  fastify.post('/api/uploads', { preHandler: requireAdmin }, async (req: FastifyRequest, reply: FastifyReply) => {
    const parts = req.parts()
    const uploaded: any[] = []

    for await (const part of parts) {
      // @ts-ignore 
      if (!part.file) continue
      // @ts-ignore 
      const lower = part.filename?.toLowerCase() || ''
      if (!(lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.pdf'))) {
        return reply.status(400).send({ error: 'Only .xls/.xlsx/.pdf files are allowed' })
      }
      const chunks: Buffer[] = []
      // @ts-ignore 
      for await (const chunk of part.file) {
        chunks.push(chunk as Buffer)
      }
      const buffer = Buffer.concat(chunks)
      // @ts-ignore 
      const record = saveUploadedFile(buffer, part.filename)
      uploaded.push(record)
    }

    if (!uploaded.length) {
      return reply.status(400).send({ error: 'No files uploaded' })
    }

    return reply.send({ count: uploaded.length, uploaded })
  })

  fastify.get('/api/uploads', async (req, reply) => {
    const limit = Number((req.query as any)?.limit) || 20
    const rows = listUploads(limit)
    reply.send(rows)
  })

  fastify.get('/api/uploads/:id', async (req, reply) => {
    const id = Number((req.params as any).id)
    const row = getUploadById(id)
    if (!row) return reply.status(404).send({ error: 'Not found' })
    reply.send(row)
  })

  fastify.get('/api/uploads/:id/download', async (req, reply) => {
    const id = Number((req.params as any).id)
    const row = getUploadById(id)
    if (!row) return reply.status(404).send({ error: 'Not found' })
    const filePath = path.join(uploadsDir, row.storedName)
    if (!fs.existsSync(filePath)) return reply.status(404).send({ error: 'File missing' })
    reply.header('Content-Disposition', `attachment; filename="${row.originalName}"`)
    const stream = fs.createReadStream(filePath)
    return reply.send(stream)
  })

  fastify.delete('/api/uploads/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const ok = deleteUpload(id)
    if (!ok) return reply.status(404).send({ error: 'Not found' })
    reply.send({ deleted: true })
  })
}
