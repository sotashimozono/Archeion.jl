# transport.jl — the registry-sync SEAM (backend-neutral). The registry DB + content live on a remote
# host; `ingest` and the readers (read.jl) work on a LOCAL copy. A `RemoteTransport` moves the registry
# to/from that host, and the backend is PLUGGABLE behind `pull` / `push`, resolved from config — the
# hosting choice (FTPS today; Cloudflare / rsync / local later) never leaks into Archeion's logic.
# Same neutral-seam style as `config.toml` / `agent.json` elsewhere in the stack.
#
# To add a backend: `struct XTransport <: RemoteTransport`, implement `pull_file` + `push_dir`, and a
# `kind` branch in `transport(config)`. Nothing else in Archeion changes.

"A backend that moves the registry to/from its host. Implement `pull_file(t, relpath, local)` and `push_dir(t, dir; delete)`."
abstract type RemoteTransport end

# ===================== FTPS backend (Lolipop) — wraps DeployTarget + lftp =====================
struct FTPSTransport <: RemoteTransport
    target::DeployTarget
end

# lftp script to GET one remote file → local (pure; the password lands only in a 0600 temp script).
function _lftp_get_script(t::FTPSTransport, remote::AbstractString, dest::AbstractString)
    g = t.target
    return """
    set ftp:ssl-force $(g.tls)
    set ftp:ssl-protect-data $(g.tls)
    set ssl:verify-certificate $(g.tls_verify)
    set ftp:passive-mode true
    set net:timeout 30
    set net:max-retries 2
    open ftp://$(g.host)
    user $(g.user) $(g.password)
    get $(remote) -o $(dest)
    bye
    """
end

# remote path of a file under the docroot: absolute as-is, else joined to the FTPS remote_dir.
function _ftps_remote(t::FTPSTransport, rel::AbstractString)
    return startswith(rel, "/") ? String(rel) : rstrip(t.target.remote_dir, '/') * "/" * rel
end

function pull_file(t::FTPSTransport, rel::AbstractString, dest::AbstractString)
    remote = _ftps_remote(t, rel)
    mkpath(dirname(abspath(dest)))
    _run_lftp(_lftp_get_script(t, remote, dest))
    isfile(dest) ||
        error("pull_file: nothing fetched to $(dest) — check the remote path '$(remote)'.")
    return dest
end

function push_dir(t::FTPSTransport, dir::AbstractString; delete::Bool=true)
    return (_run_lftp(_lftp_script(t.target, dir; delete=delete)); true)
end

# ===================== config resolution (kind-dispatched) =====================
"""
    transport(config) -> RemoteTransport

Build the remote transport from `config`'s `[archeion.remote].kind` (default `"ftps"`). FTPS reads its
credentials from `[ftp]` (see `read_deploy_target`). Other backends plug in via a new `kind` branch.
"""
function transport(config::AbstractString)
    d = TOML.parsefile(config)
    rem = get(get(d, "archeion", Dict{String,Any}()), "remote", Dict{String,Any}())
    kind = lowercase(String(get(rem, "kind", "ftps")))
    kind in ("ftps", "ftp") && return FTPSTransport(read_deploy_target(config))
    return error(
        "transport: remote kind '$(kind)' not implemented — supported: ftps. " *
        "Add a RemoteTransport backend (struct + pull_file/push_dir + a kind branch) for '$(kind)'.",
    )
end

# the DB's path relative to the remote docroot — [archeion.remote].db_path (default "data/archeion.db").
function _config_db_relpath(config::AbstractString)
    d = TOML.parsefile(config)
    rem = get(get(d, "archeion", Dict{String,Any}()), "remote", Dict{String,Any}())
    return String(get(rem, "db_path", "data/archeion.db"))
end

"""
    pull(config; out=joinpath(tempdir(), "archeion.db"), remote_db=nothing) -> local_db_path

Fetch the LIVE registry DB from the remote host to `out`, so the annotation readers (`record_comments`,
`record_annotations`, `feedback_md`, …) see the web app's latest human annotations. Backend-neutral —
dispatches on `[archeion.remote].kind`. `remote_db` overrides the DB's remote (docroot-relative) path.
"""
function pull(
    config::AbstractString;
    out::AbstractString=joinpath(tempdir(), "archeion.db"),
    remote_db=nothing,
)
    t = transport(config)
    rel = remote_db === nothing ? _config_db_relpath(config) : String(remote_db)
    return pull_file(t, rel, out)
end

"""
    publish(doc; config, project, source, site, runs=[], html_dir="",
            db=joinpath(site, "data", "archeion.db"), content_dir=dirname(db),
            remote_db=nothing, delete=true) -> NamedTuple

The annotation-SAFE registry round-trip for a REMOTE registry: **pull** the live DB → **ingest** `doc`
into it (content UPSERTs by stable id; the human annotations already in it — comments / tags / status /
project notes — are preserved by the content/annotation split) → **push** `site` (the DB + figures)
back. Use this instead of `ingest` + `deploy` when humans annotate on the remote, so a redeploy never
clobbers their work. On the first publish (no remote DB yet) it ingests fresh and pushes. Returns the
`ingest` result.
"""
function publish(
    doc;
    config::AbstractString,
    project::AbstractString,
    source::AbstractString,
    site::AbstractString,
    runs=Tuple{String,String}[],
    html_dir::AbstractString="",
    db::AbstractString=joinpath(site, "data", "archeion.db"),
    content_dir::AbstractString=dirname(db),
    remote_db=nothing,
    delete::Bool=true,
)
    mkpath(dirname(db))
    try
        pull(config; out=db, remote_db=remote_db)
        @info "publish: pulled the live registry DB (annotations preserved)" db
    catch e
        e isa InterruptException && rethrow()
        @warn "publish: could not pull a remote DB (first publish?) — ingesting fresh" exception =
            e
    end
    res = ingest(
        doc;
        db=db,
        project=project,
        source=source,
        runs=runs,
        html_dir=html_dir,
        content_dir=content_dir,
    )
    push_dir(transport(config), site; delete=delete)   # backend-neutral push (symmetric with pull)
    @info "publish: pushed the registry" record = res.record site
    return res
end
