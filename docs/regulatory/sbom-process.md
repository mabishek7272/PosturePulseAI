# Software Bill of Materials (SBOM) process

Part of the Phase 5 regulatory-readiness set (`docs/regulatory/`, ADR-011).
Addresses the cybersecurity-documentation expectation that a submission
identify third-party/open-source components (FDA premarket cybersecurity
guidance; a comparable expectation exists under EU MDR Annex I and most
other jurisdictions' SaMD guidance) — **not** a completed cybersecurity
submission on its own; see `docs/regulatory/cybersecurity-documentation.md`.

## What exists

Real, generated CycloneDX 1.6 SBOMs for all three services, committed under
`docs/regulatory/sbom/`:

| File | Service | Component count (at generation time) |
|---|---|---|
| `backend-api.cdx.json` | `services/backend-api` (npm) | 591 |
| `clinician-web.cdx.json` | `apps/clinician-web` (npm) | 119 |
| `ml-service.cdx.json` | `services/ml-service` (pip) | 139 |

Generated with `@cyclonedx/cyclonedx-npm` (Node services) and
`cyclonedx-bom`/`cyclonedx-py` (Python service) — both real, independently
maintained CycloneDX tooling, not hand-authored lists. Regenerate with:

```sh
pip install cyclonedx-bom   # once, for ml-service
./scripts/generate-sbom.sh
```

## Known scoping caveat — read before treating the ml-service SBOM as exact

This sandbox installs `services/ml-service`'s dependencies into the system
Python environment rather than a per-service virtualenv (there is no
`services/ml-service/.venv`). `cyclonedx-py environment` scans the active
Python environment, so `ml-service.cdx.json` includes whatever else was
installed into that same environment at generation time — including the
SBOM tooling's own dependencies (`cyclonedx-bom`, `lxml`, `packageurl-python`,
etc.), which are not things `app/` actually imports at runtime. The npm
SBOMs do not have this problem — `cyclonedx-npm` reads `package-lock.json`,
which is already scoped to that one workspace member.

**Before this is treated as an authoritative submission artifact**: regenerate
`ml-service.cdx.json` from an isolated virtualenv or the built container
image (`services/ml-service/Dockerfile`) containing only `pip install -e .`'s
actual dependency closure, so every listed component is one the shipped
service really depends on. This is a mechanical fix (create the venv, `pip
install -e .`, run `cyclonedx-py environment` inside it) deliberately not
done here to avoid restructuring this sandbox's shared Python environment
outside the scope of this pass.

## What this does not do

- Does not scan for known vulnerabilities (CVEs) in listed components — an
  SBOM is an inventory, not a vulnerability report. Pairing this with a
  vulnerability scanner (e.g. `grype`, `osv-scanner`, or a commercial SCA
  tool) against these exact files is a real, mechanical next step, not
  attempted here.
- Does not include the iOS client (`apps/ios-client`) — it has no lockfile
  or resolvable dependency graph in this sandbox (no Swift toolchain; see
  `apps/ios-client/README.md`). A `Package.resolved`-based SBOM should be
  generated once that app is built with Xcode.
- Is not re-generated automatically on every dependency change — there is
  no CI job wired to run `scripts/generate-sbom.sh` and fail on drift. A
  real submission pipeline would add one.
