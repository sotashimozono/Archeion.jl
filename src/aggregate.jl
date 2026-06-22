# Cross-project aggregation — the "Vault of DataVaults" layer. DataVault formalizes a
# per-project directory layout and deliberately leaves cross-outdir aggregation to a higher
# layer (see DataVault.build_master_ledger's docstring). This module discovers every
# (project, study, run) under a set of DataVault output dirs, reads each one's frozen
# discovery anchor (log.toml) + ledger, writes a small self-contained summary page per run,
# and returns Records ready for `build_index` / `add_search`.
#
# NOTE: this uses DataVault.open_all, which *attaches* to each study and idempotently
# upserts its log.toml (refreshes [meta].datavault_version). That is the intended read API,
# but it does touch the source anchors — aggregate copies, or a future read-only variant,
# if you must not modify the originals.

_esc(s) = replace(string(s), "&" => "&amp;", "<" => "&lt;", ">" => "&gt;", "\"" => "&quot;")

# Filesystem/href-safe slug for a project or run name.
_slug(s) = replace(lowercase(string(s)), r"[^a-z0-9._-]+" => "-")

"""
    master_ledger(outdirs) -> Vector{Dict{String,String}}

Concatenate `DataVault.build_master_ledger` across several project `outdirs`. Each row is a
ledger entry enriched by DataVault with `project_name` / `run` / `log_toml`; this is the
cross-project ledger DataVault intentionally leaves to a higher layer.
"""
function master_ledger(outdirs)
    rows = Dict{String,String}[]
    for od in outdirs
        append!(rows, DataVault.build_master_ledger(String(od)))
    end
    return rows
end

# Write a small self-contained summary page (provenance + ledger table) for one (study,run).
function _write_run_summary(dest; project, run, info, rows)
    mkpath(dest)
    io = IOBuffer()
    title = string(project, " / ", run)
    print(io, "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">")
    print(io, "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">")
    println(io, "<title>", _esc(title), "</title></head><body>")
    println(io, "<h1>", _esc(title), "</h1>")
    println(io, "<h2>Provenance</h2><ul>")
    println(io, "<li>project: ", _esc(project), "</li>")
    println(io, "<li>run: ", _esc(run), "</li>")
    println(io, "<li>julia: ", _esc(info.julia_version), "</li>")
    println(io, "<li>host: ", _esc(info.hostname), "</li>")
    println(io, "<li>created: ", _esc(info.created_at), "</li>")
    println(io, "<li>datavault: ", _esc(info.datavault_version), "</li>")
    println(io, "</ul>")
    if isempty(rows)
        println(io, "<p>No ledger yet (run <code>build_ledger</code>).</p>")
    else
        cols = sort(collect(keys(rows[1])))
        println(io, "<h2>Ledger (", length(rows), " rows)</h2>")
        println(io, "<table border=\"1\" cellpadding=\"4\"><tr>")
        for c in cols
            print(io, "<th>", _esc(c), "</th>")
        end
        println(io, "</tr>")
        for r in rows
            print(io, "<tr>")
            for c in cols
                print(io, "<td>", _esc(get(r, c, "")), "</td>")
            end
            println(io, "</tr>")
        end
        println(io, "</table>")
    end
    println(io, "</body></html>")
    return write(joinpath(dest, "index.html"), String(take!(io)))
end

"""
    records_from_outdirs(outdirs; site) -> Vector{Record}

Discover every `(project, study, run)` under the DataVault `outdirs` (each containing a
`.datavault/` anchor), write a summary page for each under `site/<project>/<run>/`, and
return the corresponding Records (provenance from the log.toml + ledger).
"""
function records_from_outdirs(outdirs; site::AbstractString)
    recs = Record[]
    for od in outdirs
        for st in DataVault.open_all(String(od))
            info = st.info
            rows = DataVault.load_ledger(st.vault)
            project = info.project_name
            run = info.run
            slug = joinpath(_slug(project), _slug(run))
            _write_run_summary(
                joinpath(site, slug); project=project, run=run, info=info, rows=rows
            )
            done = count(r -> get(r, "status", "") == "done", rows)
            git = isempty(rows) ? "unknown" : get(rows[end], "git_hash", "unknown")
            date = isempty(rows) ? "" : get(rows[end], "completed_at", "")
            push!(
                recs,
                Record(;
                    id=slug,
                    project=project,
                    title=string(project, " / ", run),
                    summary=string(length(rows), " keys, ", done, " done"),
                    gallery=joinpath(slug, "index.html"),
                    tags=[project],
                    git_commit=git,
                    date=isempty(date) ? string(Dates.now()) : date,
                ),
            )
        end
    end
    return recs
end

"""
    discover(outdirs; out, title="Archeion") -> Vector{Record}

End-to-end cross-project aggregation: discover all `(project, study, run)` under `outdirs`,
write per-run summaries + the cross-run index into `out`, add Pagefind search, and return
the Records. `outdirs` are DataVault output directories (each containing `.datavault/`).
"""
function discover(outdirs; out::AbstractString, title::AbstractString="Archeion")
    recs = records_from_outdirs(outdirs; site=out)
    build_index(recs; out=out, title=title)
    add_search(out)
    return recs
end
