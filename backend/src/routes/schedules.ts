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
        const base = inferMonthYear(filename);
        const month = computeMonth(parsed, base);
        if (!month) {
          return reply
            .status(400)
            .send({ error: "Unable to determine month from schedule" });
        }
        const position =
          parsed.nightShifts[0]?.position || parsed.extraShifts[0]?.position;
        if (!position) {
          return reply
            .status(400)
            .send({ error: "Unable to determine position" });
        }
        saveParsedSchedule(position, month, parsed, {
          originalName: filename,
          uploadedAt: new Date().toISOString(),
        });
        uploaded.push({
          position,
          month,
          counts: {
            night: parsed.nightShifts.length,
            extra: parsed.extraShifts.length,
          },
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
