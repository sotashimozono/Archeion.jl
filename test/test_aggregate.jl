# Cross-project aggregation tests ("Vault of DataVaults"). Build a real (tiny) DataVault
# study in a temp dir via the DataVault API, then verify Archeion's discovery reads it.
using Archeion
using Test
using DataVault

@testset "aggregation over a synthetic DataVault" begin
    tmp = mktempdir()
    outdir = joinpath(tmp, "out")
    cfg = joinpath(tmp, "config.toml")
    write(
        cfg,
        """
        [study]
        project_name = "smoke"
        total_samples = 1
        outdir = "$(outdir)"

        [datavault]
        path_keys = ["system.N"]

        [[paramsets]]
        [paramsets.system]
        N = [4, 8]
        """,
    )

    vault = DataVault.Vault(cfg; run="r1", outdir=outdir)
    for k in DataVault.keys(vault; status=:all)
        DataVault.save!(vault, k, Dict("x" => 1.0))
        DataVault.mark_done!(vault, k; tag_value=1.0)
    end
    DataVault.build_ledger(vault)

    # master_ledger: 2 keys (N∈{4,8} × 1 sample), each tagged with its project
    ml = Archeion.master_ledger([outdir])
    @test length(ml) == 2
    @test all(row -> row["project_name"] == "smoke", ml)

    # records_from_outdirs: one (study, run) record + a written summary page
    site = joinpath(tmp, "site")
    recs = Archeion.records_from_outdirs([outdir]; site=site)
    @test length(recs) == 1
    r = recs[1]
    @test r.project == "smoke"
    @test occursin("2 keys, 2 done", r.summary)
    @test isfile(joinpath(site, r.gallery))
    summary = read(joinpath(site, r.gallery), String)
    @test occursin("Provenance", summary)
    @test occursin("smoke", summary)

    # empty outdir (no .datavault) yields nothing, not an error
    @test isempty(Archeion.master_ledger([mktempdir()]))
    @test isempty(Archeion.records_from_outdirs([mktempdir()]; site=mktempdir()))
end
