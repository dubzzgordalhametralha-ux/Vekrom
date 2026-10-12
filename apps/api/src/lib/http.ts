import { z } from "zod";
import type { FastifyRequest } from "fastify";
import { config } from "../config.js";

/** Ids são BIGINT: só dígitos (evita 500 do Postgres com "abc"). */
export const id = z.string().regex(/^\d{1,18}$/, "id inválido");

export const params = {
  id: z.object({ id }),
  serverMember: z.object({ id, memberId: id }),
  serverRole: z.object({ id, roleId: id }),
  serverRoleMember: z.object({ id, roleId: id, memberId: id }),
  userId: z.object({ userId: id }),
  code: z.object({ code: z.string().regex(/^[A-Za-z0-9]{6,16}$/) }),
};

/** URL de mídia aceita só se apontar para nossos uploads (sem javascript:, sem pixel de rastreio). */
export const uploadUrl = z
  .string()
  .max(512)
  .refine((u) => u.startsWith(`${config.PUBLIC_UPLOAD_URL}/`) && /^[0-9a-f-]{36}\.[a-z0-9]{2,4}$/.test(u.slice(config.PUBLIC_UPLOAD_URL.length + 1)), "url de upload inválida");

export const attachment = z.object({
  url: uploadUrl,
  name: z.string().min(1).max(255),
  contentType: z.string().max(100),
  sizeBytes: z.number().int().nonnegative().max(config.UPLOAD_MAX_BYTES),
});

export const messageBody = z
  .object({ content: z.string().max(2000).default(""), attachments: z.array(attachment).max(3).default([]) })
  .transform((v) => ({ ...v, content: v.content.trim() }))
  .refine((v) => v.content.length > 0 || v.attachments.length > 0, "mensagem vazia");

export function uid(req: FastifyRequest): string {
  return String(req.user.sub);
}

export class HttpError extends Error {
  constructor(public statusCode: number, code: string, public details?: unknown) {
    super(code);
  }
}

export function fail(status: number, code: string): never {
  throw new HttpError(status, code);
}

/** Valida com zod; erro vira 400 com os campos inválidos. */
export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data ?? {});
  if (!r.success) throw new HttpError(400, "invalid_request", r.error.flatten().fieldErrors);
  return r.data;
}
