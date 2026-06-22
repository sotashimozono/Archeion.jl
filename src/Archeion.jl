module Archeion

# Archeion — a reproducible experiment registry that publishes Pinax galleries as a
# private, searchable static site. A thin layer over Pinax (presentation) and, later,
# DataVault (ledger/provenance): it adds what those don't — reproducibility/environment
# capture (git + Project/Manifest), a cross-run index, static-site search (Pagefind), and
# deploy. Design notes live in notes/.

using TOML: TOML
using Dates: Dates
using LibGit2: LibGit2
using Pinax: Pinax

include("repro.jl")    # git + environment snapshot (env/code provenance, not just figures)
include("record.jl")   # Record metadata <-> record.toml
include("index.jl")    # records -> cross-run index, via Pinax.contents
include("search.jl")   # Pagefind full-text search over the assembled site

export ReproBundle, capture_repro
export Record, write_record, read_record
export build_index, add_search

end # module Archeion
