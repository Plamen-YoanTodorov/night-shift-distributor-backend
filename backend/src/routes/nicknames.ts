import { FastifyInstance } from "fastify";
import { requireAdmin } from "./auth";
import { getNicknames, saveNicknames } from "../services/nicknames";

export default async function nicknamesRoutes(fastify: FastifyInstance) {
  fastify.get("/api/nicknames", async (_req, reply) => {
    reply.send(getNicknames());
  });

  fastify.put(
    "/api/nicknames",
    { preHandler: requireAdmin },
    async (req, reply) => {
      const body = (req.body || []) as { name: string; nickname: string }[];
      if (!Array.isArray(body)) {
        return reply.status(400).send({ error: "Expected array payload" });
      }
      saveNicknames(body);
      reply.send({ status: "ok" });
    }
  );
}
