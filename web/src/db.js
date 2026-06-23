// Access to the registry SQLite DB (the one Archeion.jl ingests). Uses node:sqlite
// (Node 22+ builtin) — no native module, so the SAME code runs on panza (daemon, node 24)
// and Lolipop (node-as-CGI, node 22 glibc-217). Requires the --experimental-sqlite flag.
import { DatabaseSync } from "node:sqlite";

export function openDb(path) {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 4000"); // per-request writers wait for the lock (low concurrency)
  return db;
}

const CARD_COLS =
  "id, project, run, title, date, status, tags, pinned, updated_at";

// "Current changes": most recent by completion date, falling back to ingest time.
export function recents(db, limit = 60) {
  return db
    .prepare(
      `SELECT ${CARD_COLS} FROM records
       ORDER BY COALESCE(NULLIF(date,''), updated_at) DESC LIMIT ?`,
    )
    .all(limit);
}

export function pinned(db) {
  return db
    .prepare(
      `SELECT ${CARD_COLS} FROM records WHERE pinned = 1
       ORDER BY COALESCE(NULLIF(date,''), updated_at) DESC`,
    )
    .all();
}

export function filterRecords(db, { status, tag } = {}, limit = 200) {
  let sql = `SELECT ${CARD_COLS} FROM records WHERE 1=1`;
  const args = [];
  if (status) {
    sql += " AND status = ?";
    args.push(status);
  }
  if (tag) {
    sql += " AND tags LIKE ?";
    args.push(`%"${tag}"%`); // tags is a JSON array string
  }
  sql += " ORDER BY COALESCE(NULLIF(date,''), updated_at) DESC LIMIT ?";
  args.push(limit);
  return db.prepare(sql).all(...args);
}

export function getRecord(db, id) {
  return db.prepare("SELECT * FROM records WHERE id = ?").get(id);
}

// FTS5 search over title/tags/body_md. Each whitespace token is quoted (implicit AND),
// so user input can't inject FTS operators; matches are wrapped with \x02..\x03 for the
// renderer to turn into <mark> after HTML-escaping.
export function search(db, q, limit = 60) {
  const terms = q
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, '""')}"`)
    .join(" ");
  if (!terms) return [];
  try {
    return db
      .prepare(
        `SELECT r.id, r.project, r.run, r.title, r.date, r.status, r.tags,
                snippet(records_fts, 2, char(2), char(3), '…', 14) AS snip
         FROM records_fts JOIN records r ON r.rowid = records_fts.rowid
         WHERE records_fts MATCH ? ORDER BY rank LIMIT ?`,
      )
      .all(terms, limit);
  } catch {
    return [];
  }
}

export function facets(db) {
  const statuses = db
    .prepare(
      "SELECT DISTINCT status FROM records WHERE status IS NOT NULL AND status <> '' ORDER BY status",
    )
    .all()
    .map((r) => r.status);
  const tagSet = new Set();
  for (const r of db.prepare("SELECT tags FROM records").all()) {
    try {
      for (const t of JSON.parse(r.tags || "[]")) tagSet.add(t);
    } catch {
      /* ignore malformed tags */
    }
  }
  return { statuses, tags: [...tagSet].sort() };
}

// ---- write-back (P2) -------------------------------------------------------

export function getComments(db, recordId) {
  return db
    .prepare(
      "SELECT id, author, body_md, created_at FROM comments WHERE record_id = ? ORDER BY id ASC",
    )
    .all(recordId);
}

export function addComment(db, recordId, author, bodyMd) {
  return db
    .prepare("INSERT INTO comments (record_id, author, body_md) VALUES (?,?,?)")
    .run(recordId, author || null, bodyMd).lastInsertRowid;
}

export function setStatus(db, id, status) {
  return db
    .prepare("UPDATE records SET status = ?, updated_at = datetime('now') WHERE id = ?")
    .run(status, id).changes;
}

export function setTags(db, id, tags) {
  return db
    .prepare("UPDATE records SET tags = ?, updated_at = datetime('now') WHERE id = ?")
    .run(JSON.stringify(tags), id).changes;
}

export function setPinned(db, id, pinned) {
  return db
    .prepare("UPDATE records SET pinned = ?, updated_at = datetime('now') WHERE id = ?")
    .run(pinned ? 1 : 0, id).changes;
}
