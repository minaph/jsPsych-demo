import { isHelloAnswer } from "../shared/contracts";

interface Env {
  DB: D1Database;
}

interface AnswerRow {
  id: string;
  response: "hello";
  rt_ms: number;
  saved_at: string;
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function readBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("invalid_body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) {
        await reader.cancel();
        throw new Error("body_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/health") {
        if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
        await env.DB.prepare("SELECT id FROM hello_responses LIMIT 1").all();
        return json({ ok: true, database: "connected" });
      }

      if (url.pathname !== "/api/responses") return json({ error: "not_found" }, 404);
      if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
      const origin = request.headers.get("Origin");
      if (origin && origin !== url.origin) return json({ error: "origin_not_allowed" }, 403);
      if (request.headers.get("Content-Type")?.split(";")[0].trim() !== "application/json") {
        return json({ error: "json_required" }, 415);
      }

      let data: unknown;
      try {
        data = await readBody(request);
      } catch (error) {
        const tooLarge = error instanceof Error && error.message === "body_too_large";
        return json({ error: tooLarge ? "body_too_large" : "invalid_json" }, tooLarge ? 413 : 400);
      }
      if (!isHelloAnswer(data)) return json({ error: "invalid_answer" }, 400);

      // The primary key makes retries safe, including a lost HTTP response after an insert.
      const result = await env.DB.prepare(
        "INSERT INTO hello_responses (id, response, rt_ms) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING",
      ).bind(data.id, data.response, data.rtMs).run();
      const saved = await env.DB.prepare(
        "SELECT id, response, rt_ms, saved_at FROM hello_responses WHERE id = ? AND delete_after > unixepoch()",
      ).bind(data.id).first<AnswerRow>();

      if (!saved || saved.response !== data.response || saved.rt_ms !== data.rtMs) {
        return json({ error: "answer_conflict" }, 409);
      }
      return json({
        id: saved.id,
        response: saved.response,
        rtMs: saved.rt_ms,
        savedAt: saved.saved_at,
      }, result.meta.changes > 0 ? 201 : 200);
    } catch {
      return json({ error: "database_unavailable" }, 503);
    }
  },

  async scheduled(_controller, env): Promise<void> {
    await env.DB.prepare("DELETE FROM hello_responses WHERE delete_after <= unixepoch()").run();
  },
} satisfies ExportedHandler<Env>;
