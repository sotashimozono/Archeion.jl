// Smoke tests for the read app: build a tiny DB from the real schema, then drive the
// transport-agnostic handler and assert the rendered HTML. Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createApp } from "../src/app.js";

const here = dirname(fileURLToPath(import.meta.url));
const dbPath = join(here, "_app_test.db");

function setup() {
  for (const s of ["", "-wal", "-shm"]) rmSync(dbPath + s, { force: true });
  const db = new DatabaseSync(dbPath);
  db.exec(readFileSync(join(here, "..", "db", "schema.sql"), "utf8")); // handles triggers
  db.prepare(
    `INSERT INTO records (id,project,study,run,title,date,status,tags,git_commit,data_keys,figures,body_md,pinned)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    "p/r1", "p", "p", "r1", "p / r1", "2026-06-20", "active",
    '["alpha"]', "abc123", "[]", "[]", "## Provenance\n\nhello world\n", 1,
  );
  db.close();
  return createApp(dbPath);
}

test("landing lists records, pinned section, and tag facet", () => {
  const app = setup();
  const r = app("GET", "/", new URLSearchParams());
  assert.equal(r.status, 200);
  assert.match(r.body, /p \/ r1/);
  assert.match(r.body, /★ Pinned/);
  assert.match(r.body, /#alpha/);
  // record link keeps the slash literal (NOT %2F, which Apache 404s)
  assert.match(r.body, /href="\/r\/p\/r1"/);
});

test("record page renders body_md to HTML", () => {
  const app = setup();
  const r = app("GET", "/r/p/r1", new URLSearchParams());
  assert.equal(r.status, 200);
  assert.match(r.body, /<h1>p \/ r1<\/h1>/);
  assert.match(r.body, /<h2>Provenance<\/h2>/); // markdown ## -> <h2>
  assert.match(r.body, /hello world/);
});

test("missing record is 404", () => {
  const app = setup();
  const r = app("GET", "/r/does/not/exist", new URLSearchParams());
  assert.equal(r.status, 404);
});

test("FTS search finds the record and highlights the term", () => {
  const app = setup();
  const r = app("GET", "/search", new URLSearchParams({ q: "hello" }));
  assert.equal(r.status, 200);
  assert.match(r.body, /p \/ r1/);
  assert.match(r.body, /<mark>hello<\/mark>/);
});

test("status filter narrows the listing", () => {
  const app = setup();
  assert.match(app("GET", "/", new URLSearchParams({ status: "active" })).body, /p \/ r1/);
  assert.doesNotMatch(
    app("GET", "/", new URLSearchParams({ status: "archived" })).body,
    /p \/ r1/,
  );
});

const local = (form) => ({
  headers: { origin: "http://localhost", host: "localhost" },
  body: new URLSearchParams(form),
});

test("write-back: add comment, rendered as markdown, appears on the record", () => {
  const app = setup();
  const post = app("POST", "/r/p/r1/comment", new URLSearchParams(),
    local({ author: "alice", body_md: "looks **good**" }));
  assert.equal(post.status, 303);
  const r = app("GET", "/r/p/r1", new URLSearchParams());
  assert.match(r.body, /alice/);
  assert.match(r.body, /looks <strong>good<\/strong>/);
});

test("write-back: set status persists", () => {
  const app = setup();
  app("POST", "/r/p/r1/status", new URLSearchParams(), local({ status: "done" }));
  assert.match(app("GET", "/r/p/r1", new URLSearchParams()).body, /status-done/);
});

test("write-back: set tags persists and is searchable as facet", () => {
  const app = setup();
  app("POST", "/r/p/r1/tags", new URLSearchParams(), local({ tags: "beta, gamma" }));
  const r = app("GET", "/r/p/r1", new URLSearchParams());
  assert.match(r.body, /#beta/);
  assert.match(r.body, /#gamma/);
});

test("write-back: unpin removes the Pinned section", () => {
  const app = setup(); // record starts pinned=1
  app("POST", "/r/p/r1/pin", new URLSearchParams(), local({ pinned: "0" }));
  assert.doesNotMatch(app("GET", "/", new URLSearchParams()).body, /★ Pinned/);
});

test("write-back: cross-origin POST is rejected (CSRF)", () => {
  const app = setup();
  const r = app("POST", "/r/p/r1/comment", new URLSearchParams(), {
    headers: { origin: "http://evil.example", host: "localhost" },
    body: new URLSearchParams({ body_md: "x" }),
  });
  assert.equal(r.status, 403);
});

test.after(() => {
  for (const s of ["", "-wal", "-shm"]) rmSync(dbPath + s, { force: true });
});
