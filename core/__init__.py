# =============================================================================
# BlastRadius — shared core library
# =============================================================================
# WHY this is a separate package from backend/ and cli/:
#   - The FastAPI app (backend/) imports it to expose schemas over HTTP.
#   - The CLI (cli/) imports it directly to run experiments in-process.
#   - It must NEVER import FastAPI, Typer, or anything UI/network-specific.
#     If it does, the CLI drags in a web framework for no reason.
# Rule of thumb: if a function needs an HTTP request object, it belongs in
# backend/, not here.
# =============================================================================
