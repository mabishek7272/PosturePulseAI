# ADR-001: Monorepo layout

## Status
Accepted (Phase 0)

## Context
This repository starts from nothing (no code, no existing prototype committed).
It needs to host an iOS client, a NestJS backend service, a Python ML service, and
a shared schema package, while keeping the schema-to-consumer contract from
drifting between TypeScript and Python.

## Decision
Single monorepo (`apps/`, `services/`, `packages/`, `docs/`, `protocols/`,
`infra/`) rather than per-service repositories.

## Rationale
The central risk in this architecture is schema drift between the TypeScript
backend and the Python ML service. A monorepo with a shared `packages/schemas`
lets one PR touch a schema change and both generated consumers atomically, and
lets a single CI job run `npm run schemas:check` as a cross-language contract
gate on every change.

## Trade-off accepted
Heavier initial tooling (npm workspaces for JS packages, a separately-installed
Python package for `packages/schemas/generated/python`). Acceptable at this size;
revisit if/when services need genuinely independent release cadences.
