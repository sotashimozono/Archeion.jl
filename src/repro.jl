# Capture a run's reproducibility bundle: the exact code + environment needed to reproduce
# it. Pinax records *figure* provenance (which data produced which figure); this records
# *env/code* provenance (which commit + which dependency versions produced the run).

"Snapshot of a source tree's git + environment state at capture time."
struct ReproBundle
    git_commit::String     # full SHA, or "unknown" if srcdir is not a git repo
    git_dirty::Bool        # were there uncommitted changes?
    julia_version::String
    has_manifest::Bool     # was a Manifest.toml captured (env is pinned only if true)?
end

# Run a git subcommand in `srcdir`, returning trimmed stdout or "" on any failure
# (e.g. srcdir is not a git repository — handled gracefully, not an error).
function _git(srcdir::AbstractString, args::Vector{String})
    try
        return strip(read(`git -C $srcdir $args`, String))
    catch e
        e isa InterruptException && rethrow()
        return ""
    end
end

"""
    capture_repro(srcdir, dest; config=nothing, strict=false) -> ReproBundle

Snapshot the reproducibility bundle of the project at `srcdir` into `dest/repro/`: the git
commit + dirty flag, `Project.toml`, `Manifest.toml`, the Julia version, an optional
ParamIO `config` file, and a runnable `reproduce.sh` recipe.

With `strict=true`, a dirty git tree raises (refuse to record a non-reproducible run);
otherwise the dirty state is recorded and a warning is emitted.
"""
function capture_repro(
    srcdir::AbstractString,
    dest::AbstractString;
    config::Union{Nothing,AbstractString}=nothing,
    strict::Bool=false,
)
    repro = joinpath(dest, "repro")
    mkpath(repro)

    sha = _git(srcdir, ["rev-parse", "HEAD"])
    isempty(sha) && (sha = "unknown")
    dirty = !isempty(_git(srcdir, ["status", "--porcelain"]))
    if dirty
        msg = "capture_repro: `$(srcdir)` has uncommitted changes; this record will not be exactly reproducible."
        strict ? error(msg) : @warn msg
    end

    for f in ("Project.toml", "Manifest.toml")
        p = joinpath(srcdir, f)
        isfile(p) && cp(p, joinpath(repro, f); force=true)
    end
    has_manifest = isfile(joinpath(repro, "Manifest.toml"))
    has_manifest ||
        @warn "capture_repro: no Manifest.toml in `$(srcdir)` — environment is NOT pinned (Project.toml alone is insufficient for Julia reproducibility)."

    if config !== nothing && isfile(config)
        cp(config, joinpath(repro, basename(config)); force=true)
    end

    open(joinpath(repro, "reproduce.sh"), "w") do io
        println(io, "#!/usr/bin/env bash")
        println(io, "# Reproduce this Archeion record. Generated — review before running.")
        println(io, "set -euo pipefail")
        println(io, "git checkout ", sha)
        println(io, "julia --project=. -e 'using Pkg; Pkg.instantiate()'")
        return config === nothing || println(io, "# config used: ", basename(config))
    end

    return ReproBundle(sha, dirty, string(VERSION), has_manifest)
end
