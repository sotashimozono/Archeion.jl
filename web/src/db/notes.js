// Notes = free-form Zettelkasten layer (app-owned). A note is scoped to a project (scope = slug) or
// global (scope = ""). body_md may carry [[project]] / [[record-id]] mentions; parseMentions extracts
// them and resolveMentions classifies each as record / project / unresolved (so the view can linkify
// and the LLM context can emit a typed mentions[]). This is the human-authored context the harness
// output exposes to the compute loop.

// "[[a/b]] text [[c]]" → ["a/b","c"] (deduped, trimmed)
export const parseMentions = (body) => {
  const out = []; const re = /\[\[([^\]]+)\]\]/g; let m;
  while ((m = re.exec(String(body || "")))) out.push(m[1].trim());
  return [...new Set(out.filter(Boolean))];
};

// classify each mention target against the live registry: a record id, a project name, or unresolved
export function resolveMentions(db, targets) {
  return (targets || []).map((t) => {
    if (db.prepare("SELECT 1 FROM records WHERE id = ?").get(t)) return { target: t, kind: "record", ref: `/r/${t}` };
    if (db.prepare("SELECT 1 FROM projects WHERE name = ?").get(t)) return { target: t, kind: "project", ref: `/p/${t}` };
    return { target: t, kind: "unresolved", ref: null };
  });
}

export function listNotes(db, scope) {
  return db
    .prepare("SELECT id, scope, title, body_md, created_at, updated_at FROM notes WHERE scope = ? ORDER BY updated_at DESC")
    .all(String(scope ?? ""));
}
export function allNotes(db, { limit = 500 } = {}) {
  return db
    .prepare("SELECT id, scope, title, body_md, created_at, updated_at FROM notes ORDER BY updated_at DESC LIMIT ?")
    .all(limit);
}
// notes with their resolved mentions attached — for rendering (linkify) and the LLM context
export function notesForDisplay(db, scope) {
  return listNotes(db, scope).map((n) => ({ ...n, mentions: resolveMentions(db, parseMentions(n.body_md)) }));
}
export function allNotesForDisplay(db) {
  return allNotes(db).map((n) => ({ ...n, mentions: resolveMentions(db, parseMentions(n.body_md)) }));
}

export function getNote(db, id) {
  return db.prepare("SELECT * FROM notes WHERE id = ?").get(id);
}
export function addNote(db, scope, title, body) {
  body = String(body || "").trim();
  if (!body) return null;
  return db
    .prepare("INSERT INTO notes (scope, title, body_md) VALUES (?,?,?)")
    .run(String(scope || ""), String(title || "").trim(), body).lastInsertRowid;
}
export function updateNote(db, id, title, body) {
  return db
    .prepare("UPDATE notes SET title = ?, body_md = ?, updated_at = datetime('now') WHERE id = ?")
    .run(String(title || "").trim(), String(body || ""), id).changes;
}
export function removeNote(db, id) {
  return db.prepare("DELETE FROM notes WHERE id = ?").run(id).changes;
}

// backlinks: notes that mention a given target (project name or record id)
export function notesMentioning(db, target, { limit = 100 } = {}) {
  return db
    .prepare("SELECT id, scope, title, body_md, updated_at FROM notes WHERE body_md LIKE ? ORDER BY updated_at DESC LIMIT ?")
    .all(`%[[${target}]]%`, limit);
}
