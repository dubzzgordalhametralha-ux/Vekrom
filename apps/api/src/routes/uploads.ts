import type { FastifyInstance } from "fastify";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { limit } from "../services/ratelimit.js";
import { fail, uid } from "../lib/http.js";

/** MIME real por magic bytes (a extensão e o Content-Type do cliente são ignorados). */
export function sniffMime(buf: Buffer): string | null {
  const ascii = (a: number, b: number) => buf.toString("ascii", a, b);
  if (buf[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (ascii(0, 4) === "GIF8") return "image/gif";
  if (buf.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (buf.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return "audio/wav";
  if (ascii(0, 4) === "OggS") return "audio/ogg";
  if (ascii(0, 4) === "fLaC") return "audio/flac";
  if (ascii(0, 3) === "ID3" || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return "audio/mpeg";
  if (buf.length >= 12 && ascii(4, 8) === "ftyp") return ascii(8, 11) === "M4A" ? "audio/mp4" : "video/mp4";
  return null;
}

const EXT: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp",
  "audio/wav": "wav", "audio/ogg": "ogg", "audio/flac": "flac", "audio/mpeg": "mp3", "audio/mp4": "m4a", "video/mp4": "mp4",
};
const MIME_BY_EXT = Object.fromEntries(Object.entries(EXT).map(([m, e]) => [e, m]));
const NAME_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|gif|webp|wav|ogg|flac|mp3|m4a|mp4)$/;

const dir = resolve(config.UPLOAD_DIR);

export async function uploadRoutes(app: FastifyInstance) {
  await mkdir(dir, { recursive: true });

  app.post("/upload", { preHandler: [app.authenticate] }, async (req) => {
    const me = uid(req);
    await limit(`upload:${me}`, 60, 3600);
    const file = await req.file();
    if (!file) fail(400, "no_file");
    const buf = await file.toBuffer(); // estoura com 413 acima de UPLOAD_MAX_BYTES (limite do multipart)
    const mime = sniffMime(buf.subarray(0, 16));
    if (!mime) fail(415, "invalid_type");
    // Nome aleatório: o nome do cliente nunca toca o disco.
    const name = `${randomUUID()}.${EXT[mime]}`;
    await writeFile(join(dir, name), buf, { mode: 0o644 });
    req.log.info({ uploadBytes: buf.length, mime }, "upload");
    return { url: `${config.PUBLIC_UPLOAD_URL}/${name}`, contentType: mime, sizeBytes: buf.length, filename: file.filename.slice(0, 255) };
  });

  // Em produção o Caddy serve /api/files direto do disco; esta rota é o fallback (dev).
  app.get("/files/:name", async (req, reply) => {
    const name = (req.params as { name: string }).name;
    if (!NAME_RE.test(name)) fail(404, "not_found"); // sem "/" nem "..": não há path traversal
    let data: Buffer;
    try {
      data = await readFile(join(dir, name));
    } catch {
      fail(404, "not_found");
    }
    return reply
      .header("Content-Type", MIME_BY_EXT[name.split(".").pop()!])
      .header("Cache-Control", "public, max-age=31536000, immutable")
      .header("X-Content-Type-Options", "nosniff")
      .header("Content-Security-Policy", "default-src 'none'; sandbox")
      .send(data);
  });
}
