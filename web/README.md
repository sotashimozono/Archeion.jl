# Archeion.jl/web — the registry web app

Web app for the **Archeion** experiment registry — a private, searchable, annotatable view
over the experiments produced on **panza**. It lives **in this repo** (`Archeion.jl/web/`,
not a separate repository — consolidated to avoid repo overhead).

## Two halves, one data contract

| | role | stack | where |
| --- | --- | --- | --- |
| `Archeion.jl` (the parent, `..`) | render figures (Pinax) + provenance + **ingest → DB/figures** | Julia | panza (build time) |
| `Archeion.jl/web` (here) | **serve** the registry + write-back (tags / bookmark / importance / status + discussion + a **Zettelkasten note layer**) | Node | panza daemon *or* Lolipop CGI |

They meet at the SQLite DB (`db/schema.sql`) + the figures under `data/figures/`. Julia writes the
**content** tables; Node reads them and owns the **annotation** tables (see *Data model*).

## Layout (role-separated)

```
src/        application source — a transport-agnostic handler (app.js) split into db/* (data
            access) + render/* (views) + constants.js; daemon (server.js) and CGI (cgi.js) adapters
editor/     CodeMirror 6 source for the structure-note composer (main.js → bundled)
db/         database management — schema.sql (the Julia↔Node contract); the .db lives in data/
deploy/     deployment + the SELECTABLE deploy modes (see deploy/README.md)
public/     static frontend assets — app.js (progressive enhancement), inject.js (overlay on a
            run's Pinax page), style.css, vendored katex/; compose-editor.js is a build artifact
test/       node --test suite (app.test.js)
data/       (gitignored) ingested runtime data: archeion.db + figures/
bin/        (gitignored) auxiliary binaries (e.g. the vendored node for Lolipop CGI)
```

## Pages & routes

**Read (GET).** `/` landing (recents + activity) · `/search` (FTS5 over records / figures /
comments, field-scoped) · `/gallery` figures · `/p/:project` project page (PARA, tags, todos,
description, notes) · `/r/:id` the run's real Pinax page with the Archeion overlay (`inject.js`) ·
`/bookmarks` · `/archived`.

- **Note layer:** `/notes` (workspace) · `/compose` (composer) · `/show/:id` (advisor page) ·
  `/note/:id` (working "open" view).
- **LLM channel:** `/api/project/:name/context` (atomic JSON, `?format=md` brief — the human
  context a compute-loop LLM reads) · `/api/note/preview` (composer inline preview).

**Write (POST — plain forms, with an optimistic client in `app.js`).** tags · bookmark ·
importance · archive · PARA / project description / project todos · note add / edit / del / pin /
archive · note & record comments.

## The note layer (the Zettelkasten / advisor surface)

A **note** is markdown with `[[project]]` / `[[record-id]]` mentions, `![[figure-id]]` /
`![[rec#Section]]` / `![[rec]]` embeds, and `$…$` math. It moves through four surfaces:

- **`/notes` — the workspace.** Three buckets: **📌 pinned** (advisor pages) · **🗂 all notes**
  (with a client-side filter) · **🗄 archived** (folded). Each card carries date · ✎ edit ·
  🗄 archive · 📌 pin, plus **open ↗** (working view) and — when pinned — **preview ↗** (advisor).
- **`/compose` — the composer.** A CodeMirror 6 editor over **raw markdown** (it never rewrites
  your `[[…]]` / `![[…]]`), rendering inline KaTeX + mention/embed widgets, with a **refs pane** (a
  live Archeion iframe whose add-buttons `postMessage` embed codes into the note) and an **inline
  preview** of the current *unsaved* edits. Saving makes/updates a note; **pin** it to publish an
  advisor page.
- **`/show/:id` — the advisor page.** The note rendered clean (home header + sidebar) — the curated
  page you show the professor.
- **`/note/:id` — the open view.** The note rendered + a **comments / annotations** thread (your
  working view).

Embeds render as: figure (inline, column-flow), section (a folding iframe of just that section,
`&only=1`), page (a `:target` popup). KaTeX is **server-side** (`@vscode/markdown-it-katex`) with
self-hosted fonts under `public/katex` (works under CSP `default-src 'self'`).

## Data model (RAG-portable)

`records.body_md` is clean, atomic, per-record Markdown — the **source of truth**, directly
**embeddable for RAG** ("port the DB as-is"); HTML is a derived view. The schema has two layers —
this split is the re-ingest contract:

- **Content (Julia-owned, immutable):** `records` (+ `record_runs`, M:N to DataVault runs;
  `record_versions`), `figures`, `projects`, and the `search_fts` FTS5 index. Re-ingest is
  idempotent and **never touches annotations**.
- **Annotation (Node-owned, mutable):** `tags` + `record_tags` / `project_tags` / `note_tags`;
  `bookmarks`; `comments` (record discussion) + `note_comments`; `project_todos`; and the **notes**
  (`notes` + the note tables). PARA / status / importance live on `projects` / `records`.

See `db/schema.sql` — it is the **Julia↔Node contract**; evolve the schema, the Julia writer, and
the Node reader **together**. (There is no `links` table; `[[…]]` mentions are parsed from
`body_md` at render time.)

## Hosting: decided late, app is portable

The core handler (`src/app.js`) is transport-agnostic, so the *same* app runs as **P** (panza
daemon `server.js`, via Cloudflare Tunnel + Access — data stays on panza, highest confidentiality)
or **L** (Lolipop **node-as-CGI** `cgi.js` — always-up, ~99 ms cold start measured; needs an
unofficial glibc-2.17 Node 20 build). Pick at deploy time. See `deploy/README.md`.

> **Why two adapters:** Lolipop is **per-request only** — its terms prohibit CGI over 30 s and
> compiled-binary CGI, i.e. no daemons (terms-verified). One request = one node start (≈99 ms, well
> under 30 s) fits; a resident server does not. So `cgi.js` serves Lolipop and `server.js` serves
> panza, sharing the same handler.

## Build · test · deploy

```bash
npm ci
npm test                 # node --test → app.test.js
npm run bundle           # esbuild → dist/cgi.js + public/compose-editor.js (the CM6 editor)
bash deploy/stage.sh     # assemble web/build/ (node-as-CGI tree); then Archeion.deploy("web/build"; …)
```

- **Cache-busting:** bump `ASSET_V` in `src/render/util.js` on any `app.js` / `style.css` / editor
  change — dashboard pages are `no-store`, so a normal reload picks it up (no hard refresh).
- **Build artifacts are gitignored:** `dist/` and `public/compose-editor.js` (the ~750 KB CM6
  bundle) are regenerated by `npm run bundle` (which `stage.sh` runs first). `public/katex/` is
  **vendored** (stage.sh copies it as-is).
- **Deploy with `delete=false`** — the server keeps the Lolipop panel's Basic-auth
  `.htaccess` / `.htpasswd` and the live DB. Never commit `deploy.local.toml` (FTP creds —
  gitignored; or pass `ARCHEION_FTP_PASSWORD`).

## Status

Live on Lolipop (node-as-CGI). Read app + FTS5 search + figures gallery + project/PARA pages +
write-back (tags / bookmark / importance / status / discussion) + the note layer (composer /
advisor `/show` / open `/note` + comments) are in place; `web/test/app.test.js` is the regression
guard. Next ideas: optimistic comment posting, `$$…$$` block math, a graph view over note links.
