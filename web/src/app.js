// Transport-agnostic request handler: (method, path, query, opts) -> { status, type, body, headers? }.
// opts = { headers: {origin, host}, body: URLSearchParams }. The same handler is driven by the
// daemon (server.js) now and a CGI shim later — portable between panza and Lolipop.
import {
  openDb,
  recents,
  pinned,
  getRecord,
  search,
  facets,
  filterRecords,
  getComments,
  addComment,
  setStatus,
  setTags,
  setPinned,
} from "./db.js";
import { renderLanding, renderRecord, renderSearch } from "./render.js";

const html = (body, status = 200) => ({
  status,
  type: "text/html; charset=utf-8",
  body,
});

// id may contain "/", and our routes use real slashes — keep them, encode the rest.
const idPath = (id) => encodeURIComponent(id).replace(/%2F/gi, "/");
const redirect = (id) => ({
  status: 303,
  type: "text/html; charset=utf-8",
  body: "",
  headers: { Location: `/r/${idPath(id)}` },
});

// CSRF: reject cross-origin state changes. Browsers send Origin on POST; if it's present it
// must match Host. (Basic auth gates access on top of this.)
function sameOrigin(headers) {
  const o = headers.origin;
  if (!o) return true;
  try {
    return new URL(o).host === headers.host;
  } catch {
    return false;
  }
}

const parseTags = (s) =>
  (s || "")
    .split(/[,\s]+/)
    .map((t) => t.replace(/^#/, "").trim())
    .filter(Boolean);

export function createApp(dbPath) {
  const db = openDb(dbPath);
  return function handle(method, path, query, opts = {}) {
    const headers = opts.headers || {};
    const body = opts.body || new URLSearchParams();

    if (method === "POST") {
      if (!sameOrigin(headers))
        return { status: 403, type: "text/plain", body: "CSRF: bad origin" };
      const m = path.match(/^\/r\/(.+)\/(comment|status|tags|pin)$/);
      if (!m) return { status: 404, type: "text/plain", body: "Not found" };
      const id = decodeURIComponent(m[1]);
      if (!getRecord(db, id))
        return { status: 404, type: "text/plain", body: "No such record" };
      switch (m[2]) {
        case "comment": {
          const text = (body.get("body_md") || "").trim();
          if (text) addComment(db, id, (body.get("author") || "").trim(), text);
          break;
        }
        case "status":
          setStatus(db, id, (body.get("status") || "").trim());
          break;
        case "tags":
          setTags(db, id, parseTags(body.get("tags")));
          break;
        case "pin":
          setPinned(db, id, body.get("pinned") === "1");
          break;
      }
      return redirect(id);
    }

    if (method !== "GET" && method !== "HEAD")
      return { status: 405, type: "text/plain", body: "Method Not Allowed" };

    if (path === "/") {
      const tag = query.get("tag");
      const status = query.get("status");
      const recs =
        tag || status ? filterRecords(db, { tag, status }) : recents(db);
      return html(
        renderLanding({
          pinned: pinned(db),
          recents: recs,
          facets: facets(db),
          activeTag: tag,
          activeStatus: status,
        }),
      );
    }
    if (path === "/search") {
      const q = (query.get("q") || "").trim();
      return html(renderSearch(q, q ? search(db, q) : []));
    }
    if (path.startsWith("/r/")) {
      const id = decodeURIComponent(path.slice(3));
      const rec = getRecord(db, id);
      return html(
        renderRecord(rec, rec ? { comments: getComments(db, id) } : null),
        rec ? 200 : 404,
      );
    }
    return html(renderRecord(null), 404);
  };
}
