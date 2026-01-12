import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fastifyMultipart from "@fastify/multipart";
import { requireAdmin, requireEditorOrAdmin } from "./auth";
import {
  parseSchedule,
  inferMonthYear,
  computeMonth,
} from "../lib/scheduleParser";
import * as XLSX from "xlsx";
import {
  saveParsedSchedule,
  getSchedule,
  listSchedules,
  deleteAllSchedules,
  deleteScheduleMonth,
} from "../services/schedules";
import { db } from "../db";
import type { DistributionEntry } from "../types";

function parseExportedWorkbook(buffer: Buffer, filename: string) {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
  }) as any[][];
  if (!rows.length) return null;

  const headerRow = rows.find(
    (r) => r[0] && r[0].toString().toLowerCase().includes("name")
  );
  if (!headerRow) return null;
  const dateCols: { idx: number; date: string }[] = [];
  headerRow.forEach((val, idx) => {
    if (idx === 0) return;
    const v = typeof val === "string" ? val.trim() : "";
    if (v && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
      dateCols.push({ idx, date: v });
    }
  });
  if (!dateCols.length) return null;
  const month = dateCols[0].date.slice(0, 7);

  const buckets = new Map<
    string,
    { date: string; position: "APP" | "TWR"; workers: Set<string>; assignments: DistributionEntry[] }
  >();
  const extras: { name: string; date: string; code: string; position: "APP" | "TWR" }[] = [];

  const addBucket = (pos: "APP" | "TWR", date: string) => {
    const key = `${pos}-${date}`;
    if (!buckets.has(key)) {
      buckets.set(key, { date, position: pos, workers: new Set(), assignments: [] });
    }
    return buckets.get(key)!;
  };

  const detectRole = (text: string): DistributionEntry["role"] => {
    const t = text.toLowerCase();
    if (t.includes("stayer")) return "stayer";
    if (t.includes("goer2")) return "goer2";
    if (t.includes("goer 2")) return "goer2";
    return "goer1";
  };

  rows.forEach((row) => {
    const nameCell = row[0];
    if (!nameCell || nameCell.toString().toLowerCase().includes("legend")) return;
    const person = nameCell.toString().trim();
    // Skip rows that don't look like full names (avoids stray initials like "N.")
    if (!person || person.length < 3 || !/\s/.test(person)) return;
    dateCols.forEach(({ idx, date }) => {
      const cell = row[idx];
      if (!cell) return;
      const parts = cell
        .toString()
        .split(/\n+/)
        .map((p: string) => p.trim())
        .filter(Boolean);
      parts.forEach((p: string) => {
        if (p.startsWith("Extra:")) {
          const code = p.replace("Extra:", "").trim();
          extras.push({ name: person, date, code, position: "APP" });
          return;
        }
        const [posRaw, restRaw] = p.split(":");
        const pos =
          posRaw && posRaw.trim().toUpperCase() === "TWR" ? "TWR" : "APP";
        const bucket = addBucket(pos, date);
        bucket.workers.add(person);
        const role = restRaw ? detectRole(restRaw) : "goer1";
        bucket.assignments.push({
          datasetId: 1,
          date,
          position: pos,
          worker: person,
          role,
          isManual: false,
        });
      });
    });
  });

  const nightShifts = Array.from(buckets.values()).map((b) => ({
    id: `${b.position}-${b.date}`,
    date: b.date,
    position: b.position,
    workers: Array.from(b.workers),
    source: filename,
  }));

  const byPos = new Map<string, { nightShifts: any[]; extraShifts: any[]; assignments: DistributionEntry[] }>();
  nightShifts.forEach((ns) => {
    if (!byPos.has(ns.position))
      byPos.set(ns.position, { nightShifts: [], extraShifts: [], assignments: [] });
    byPos.get(ns.position)!.nightShifts.push(ns);
    const bucket = buckets.get(`${ns.position}-${ns.date}`);
    if (bucket) {
      byPos.get(ns.position)!.assignments.push(...bucket.assignments);
    }
  });
  extras.forEach((ex) => {
    if (!byPos.has(ex.position))
      byPos.set(ex.position, { nightShifts: [], extraShifts: [], assignments: [] });
    byPos.get(ex.position)!.extraShifts.push(ex);
  });

  return { byPos, month };
}

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
        // First, try to detect exported-overview format
        const exported = parseExportedWorkbook(buffer, filename);
        if (exported) {
          const { byPos, month } = exported;
          // Save schedules per position
          byPos.forEach((payload, pos) => {
            saveParsedSchedule(
              pos,
              month,
              { nightShifts: payload.nightShifts, extraShifts: payload.extraShifts },
              {
                originalName: filename,
                uploadedAt: now,
                importType: "export-reimport",
              }
            );
            uploaded.push({
              position: pos,
              month,
              counts: {
                night: payload.nightShifts.length,
                extra: payload.extraShifts.length,
                assignments: payload.assignments?.length || 0,
              },
            });
          });
          // Persist distributions across all positions at once
          const allAssignments: any[] = [];
          byPos.forEach((payload) => {
            if (payload.assignments?.length) allAssignments.push(...payload.assignments);
          });
          if (allAssignments.length) {
            db.prepare('INSERT OR IGNORE INTO datasets (id, name, createdAt) VALUES (1, ?, ?)').run('default', now);
            const del = db.prepare('DELETE FROM distributions');
            const ins = db.prepare(
              `INSERT INTO distributions (dataset_id, date, position, worker, role, isManual, createdAt)
               VALUES (1, ?, ?, ?, ?, ?, ?)`
            );
            const tx = db.transaction((rows: any[]) => {
              del.run();
              rows.forEach((r) => {
                ins.run(r.date, r.position, r.worker, r.role, r.isManual ? 1 : 0, now);
              });
            });
            tx(allAssignments);
          }
          continue;
        }

        let parsed;
        try {
          parsed = await parseSchedule(buffer, filename);
        } catch (err) {
          return reply
            .status(400)
            .send({ error: (err as Error).message || "Failed to parse schedule" });
        }
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

  // Import previously exported overview Excel (Name + date columns)
  fastify.post(
    "/api/schedules/import-export",
    { preHandler: requireAdmin },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parts = req.parts();
      const saved: any[] = [];
      const now = new Date().toISOString();

      for await (const part of parts) {
        // @ts-ignore
        if (!part.file) continue;
        // @ts-ignore
        const filename = part.filename || "import.xlsx";
        // @ts-ignore
        const chunks: Buffer[] = [];
        // @ts-ignore
        for await (const chunk of part.file) chunks.push(chunk as Buffer);
        const buffer = Buffer.concat(chunks);
        const wb = XLSX.read(buffer, { type: "buffer" });
        const sheetName = wb.SheetNames[0];
        const sheet = wb.Sheets[sheetName];
        const rows: any[][] = XLSX.utils.sheet_to_json(sheet, {
          header: 1,
          raw: false,
        }) as any[][];
        if (!rows.length) continue;

        const headerRow = rows.find(
          (r) => r[0] && r[0].toString().toLowerCase().includes("name")
        );
        if (!headerRow) continue;
        const dateCols: { idx: number; date: string }[] = [];
        headerRow.forEach((val, idx) => {
          if (idx === 0) return;
          const v = typeof val === "string" ? val.trim() : "";
          if (v && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
            dateCols.push({ idx, date: v });
          }
        });
        if (!dateCols.length) continue;
        const month = dateCols[0].date.slice(0, 7);

        const buckets = new Map<
          string,
          { date: string; position: "APP" | "TWR"; workers: Set<string> }
        >();
        const extras: { name: string; date: string; code: string; position: "APP" | "TWR" }[] = [];

        const addBucket = (pos: "APP" | "TWR", date: string) => {
          const key = `${pos}-${date}`;
          if (!buckets.has(key)) {
            buckets.set(key, { date, position: pos, workers: new Set() });
          }
          return buckets.get(key)!;
        };

        rows.forEach((row) => {
          const nameCell = row[0];
          if (!nameCell || nameCell.toString().toLowerCase().includes("legend")) return;
          const person = nameCell.toString().trim();
          if (!person) return;
          dateCols.forEach(({ idx, date }) => {
            const cell = row[idx];
            if (!cell) return;
            const parts = cell
              .toString()
              .split(/\n+/)
              .map((p: string) => p.trim())
              .filter(Boolean);
            parts.forEach((p: string) => {
              if (p.startsWith("Extra:")) {
                const code = p.replace("Extra:", "").trim();
                extras.push({ name: person, date, code, position: "APP" });
                return;
              }
              const [posRaw] = p.split(":");
              const pos =
                posRaw && posRaw.trim().toUpperCase() === "TWR" ? "TWR" : "APP";
              addBucket(pos, date).workers.add(person);
            });
          });
        });

        const nightShifts = Array.from(buckets.values()).map((b) => ({
          id: `${b.position}-${b.date}`,
          date: b.date,
          position: b.position,
          workers: Array.from(b.workers),
          source: filename,
        }));

        // save per position bucket
        const byPos = new Map<
          string,
          { nightShifts: any[]; extraShifts: any[] }
        >();
        nightShifts.forEach((ns) => {
          if (!byPos.has(ns.position))
            byPos.set(ns.position, { nightShifts: [], extraShifts: [] });
          byPos.get(ns.position)!.nightShifts.push(ns);
        });
        extras.forEach((ex) => {
          if (!byPos.has(ex.position))
            byPos.set(ex.position, { nightShifts: [], extraShifts: [] });
          byPos.get(ex.position)!.extraShifts.push(ex);
        });

        byPos.forEach((payload, pos) => {
          saveParsedSchedule(pos, month, payload, {
            originalName: filename,
            uploadedAt: now,
            importType: "export-reimport",
          });
          saved.push({ position: pos, month, counts: { night: payload.nightShifts.length, extra: payload.extraShifts.length } });
        });
      }

      if (!saved.length) return reply.status(400).send({ error: "No data imported" });
      reply.send({ imported: saved });
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

  fastify.put(
    "/api/schedules/edit",
    { preHandler: requireEditorOrAdmin },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = (req.body as any) || {};
      const month: string = body.month;
      const schedules: {
        position: "APP" | "TWR";
        nightShifts: any[];
        extraShifts: any[];
      }[] = body.schedules || [];
      if (!month || !schedules.length) {
        return reply.status(400).send({ error: "month and schedules are required" });
      }
      const now = new Date().toISOString();
      schedules.forEach((s) => {
        const validNight = (s.nightShifts || []).filter((ns: any) => ns.date?.startsWith(month));
        const validExtra = (s.extraShifts || []).filter((ex: any) => ex.date?.startsWith(month));
        saveParsedSchedule(
          s.position,
          month,
          { nightShifts: validNight, extraShifts: validExtra },
          { originalName: "manual-edit", uploadedAt: now, importType: "manual-edit" }
        );
      });
      reply.send({ saved: schedules.length });
    }
  );

  fastify.post(
    "/api/schedules/reset",
    { preHandler: requireAdmin },
    async (_req, reply) => {
      deleteAllSchedules();
      reply.send({ status: "ok" });
    }
  );

  fastify.delete(
    "/api/schedules/month/:month",
    { preHandler: requireAdmin },
    async (req, reply) => {
      const month = (req.params as any).month;
      if (!month || !/^\d{4}-\d{2}$/.test(month)) {
        return reply.status(400).send({ error: "Invalid month format; expected YYYY-MM" });
      }
      deleteScheduleMonth(month);
      // also clear distributions for that month
      db.prepare("DELETE FROM distributions WHERE date LIKE ?").run(`${month}-%`);
      reply.send({ status: "ok", month });
    }
  );
}
