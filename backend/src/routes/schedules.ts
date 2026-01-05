import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fastifyMultipart from "@fastify/multipart";
import { requireAdmin } from "./auth";
import {
  parseSchedule,
  inferMonthYear,
  computeMonth,
} from "../lib/scheduleParser";
import {
  saveParsedSchedule,
  getSchedule,
  listSchedules,
  deleteAllSchedules,
} from "../services/schedules";

export default async function schedulesRoutes(fastify: FastifyInstance) {
  await fastify.register(fastifyMultipart, {
    limits: { fileSize: 50 * 1024 * 1024, files: 10 },
  });

  fastify.post(
    "/api/schedules/upload",
    { preHandler: requireAdmin },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parts = req.parts();
      const uploaded: any[] = [];
      const now = new Date().toISOString();
      for await (const part of parts) {
        // @ts-ignore
        if (!part.file) continue;
        // @ts-ignore
        const filename = part.filename || "upload";
        const chunks: Buffer[] = [];
        // @ts-ignore
        for await (const chunk of part.file) {
          chunks.push(chunk as Buffer);
        }
        const buffer = Buffer.concat(chunks);
        const parsed = await parseSchedule(buffer, filename);
        // Group by position + month so whole-year files get split per month
        type Bucket = { nightShifts: any[]; extraShifts: any[]; month: string; position: string };
        const bucketMap = new Map<string, Bucket>();

        const ensureBucket = (pos: string, month: string) => {
          const key = `${pos}-${month}`;
          if (!bucketMap.has(key)) {
            bucketMap.set(key, { nightShifts: [], extraShifts: [], month, position: pos });
          }
          return bucketMap.get(key)!;
        };

        parsed.nightShifts.forEach((ns: any) => {
          const month = ns.date.slice(0, 7);
          const b = ensureBucket(ns.position, month);
          b.nightShifts.push(ns);
        });

        parsed.extraShifts.forEach((ex: any) => {
          const month = ex.date.slice(0, 7);
          const b = ensureBucket(ex.position, month);
          b.extraShifts.push(ex);
        });

        if (bucketMap.size === 0) {
          return reply
            .status(400)
            .send({ error: "Unable to determine position/month from schedule" });
        }

        const monthsSet = new Set<string>();
        bucketMap.forEach((b) => monthsSet.add(b.month));
        const isWholeYear = monthsSet.size > 1;

        bucketMap.forEach((bucket) => {
          if (isWholeYear) {
            const existing = getSchedule(bucket.position, bucket.month);
            if (existing) {
              // Skip overwriting existing month when uploading baseline/whole-year file
              uploaded.push({
                position: bucket.position,
                month: bucket.month,
                skipped: true,
                reason: "existing-schedule",
              });
              return;
            }
          }
          saveParsedSchedule(
            bucket.position,
            bucket.month,
            {
              nightShifts: bucket.nightShifts,
              extraShifts: bucket.extraShifts,
            },
            {
              originalName: filename,
              uploadedAt: now,
            }
          );
          uploaded.push({
            position: bucket.position,
            month: bucket.month,
            counts: {
              night: bucket.nightShifts.length,
              extra: bucket.extraShifts.length,
            },
          });
        });
      }
      if (!uploaded.length)
        return reply.status(400).send({ error: "No schedule files uploaded" });
      reply.send({ saved: uploaded });
    }
  );

  fastify.get("/api/schedules", async (req, reply) => {
    const query = (req.query || {}) as { month?: string; position?: string };
    if (query.month && query.position) {
      const row = getSchedule(query.position, query.month);
      if (!row) return reply.status(404).send({ error: "Schedule not found" });
      return reply.send(row);
    }
    const rows = listSchedules();
    reply.send(rows);
  });

  fastify.post(
    "/api/schedules/reset",
    { preHandler: requireAdmin },
    async (_req, reply) => {
      deleteAllSchedules();
      reply.send({ status: "ok" });
    }
  );
}
