# Static-site full-text search via Pagefind. Pagefind runs through `npx` (no install), reads
# the already-built HTML, and writes a `/pagefind/` bundle the pages load client-side — so
# search needs no server and works on any private host (Lolipop, Cloudflare, tunnel).

"""
    add_search(site) -> Bool

Run Pagefind over the assembled static site at `site`, producing a client-side search
index. Call this AFTER [`build_index`](@ref) and after the galleries are in place. Returns
`true` on success; warns and returns `false` if `npx` is unavailable or Pagefind fails.
"""
function add_search(site::AbstractString)
    npx = Sys.which("npx")
    if npx === nothing
        @warn "add_search: `npx` not found — skipping search index. Install Node, or run `npx pagefind --site $(site)` manually."
        return false
    end
    try
        run(`$npx --yes pagefind --site $site`)
        return true
    catch e
        e isa InterruptException && rethrow()
        @warn "add_search: pagefind failed" exception = e
        return false
    end
end
