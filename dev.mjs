// Lokalny serwer testowy (bez Netlify): node dev.mjs  →  http://localhost:8888
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
process.env.FLYALERT_LOCAL_STORE ||= path.resolve(".local-data");
const api = (await import("./netlify/functions/api.mjs")).default;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost:" + (process.env.PORT || 8888));
  if (url.pathname.startsWith("/api/")) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const r = await api(new Request(url, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) }));
    res.writeHead(r.status, Object.fromEntries(r.headers));
    return res.end(Buffer.from(await r.arrayBuffer()));
  }
  const f = path.join("public", url.pathname === "/" ? "index.html" : url.pathname);
  try { const b = await fs.readFile(f); res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" }); res.end(b); }
  catch { res.writeHead(404); res.end("404"); }
}).listen(process.env.PORT || 8888, () => console.log("FlyAlert dev: http://localhost:" + (process.env.PORT || 8888)));
