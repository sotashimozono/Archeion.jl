// Daemon adapter (panza): a plain node:http server over the transport-agnostic app.
// Parses form POSTs, forwards Origin/Host for the CSRF check, honors redirects, and sets
// security headers on every response. Env: ARCHEION_DB, HOST, PORT.
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import { createApp } from "./app.js";

const here = dirname(fileURLToPath(import.meta.url));
const DB = process.env.ARCHEION_DB || join(here, "..", "data", "archeion.db");
const PUBLIC = join(here, "..", "public");
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 8090);

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "same-origin",
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'none'; form-action 'self'; base-uri 'none'",
};

async function readForm(req) {
  if (req.method !== "POST") return undefined;
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 1_000_000) throw new Error("request body too large");
    chunks.push(c);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

const app = createApp(DB);

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (req.method === "GET" && url.pathname === "/style.css") {
      const css = await readFile(join(PUBLIC, "style.css"));
      res.writeHead(200, {
        "content-type": "text/css; charset=utf-8",
        ...SECURITY_HEADERS,
      });
      return res.end(css);
    }
    const body = await readForm(req);
    const r = app(req.method, url.pathname, url.searchParams, {
      headers: { origin: req.headers.origin, host: req.headers.host },
      body,
    });
    res.writeHead(r.status, {
      "content-type": r.type,
      ...SECURITY_HEADERS,
      ...(r.headers || {}),
    });
    res.end(req.method === "HEAD" ? undefined : r.body);
  } catch (err) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end("Internal error: " + err.message);
  }
});

server.listen(PORT, HOST, () =>
  console.log(`archeion-web → http://${HOST}:${PORT}  (db: ${DB})`),
);
