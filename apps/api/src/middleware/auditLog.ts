import type { FastifyReply, FastifyRequest } from "fastify";
import { AuditLogModel } from "../db/models/auditLog.js";

export function withAudit(action: string, targetFn?: (req: FastifyRequest) => string) {
  return async function auditHook(request: FastifyRequest, reply: FastifyReply) {
    const target = targetFn ? targetFn(request) : undefined;
    const jwtPayload = request.user as { sub?: number } | undefined;
    reply.raw.on("finish", () => {
      const result = reply.statusCode < 400 ? "success" : "failure";
      AuditLogModel.record({
        userId: jwtPayload?.sub ?? null,
        action,
        target,
        result,
        sourceIp: request.ip,
      });
    });
  };
}
