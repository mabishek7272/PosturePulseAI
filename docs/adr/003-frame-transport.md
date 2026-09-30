# ADR-003: Synchronous REST for backend-api ↔ ml-service frame transport

## Status
Accepted (Phase 0 / start of Phase 1)

## Context
iOS streams captured frames to the backend; the backend needs the ML service's
pose/quality output per frame to drive the safety state machine.

## Decision
Backend-api → ml-service uses synchronous REST (`POST /internal/frames`) in this
phase, not a message bus. A named, isolated module
(`services/ml-service/app/ingestion/frame_queue.py`) is the intended swap point
if/when real-time throughput requires an async queue (Redis Streams/NATS).
Redis is present in `infra/docker-compose.yml`, health-checked, but not
exercised by any real code path yet — it exists so the swap-in later doesn't
require a compose rewrite too.

## Rationale
At this phase there is one subject/session at a time in dev, and pose inference
on a single frame is the unit of work. Introducing a message bus now adds
operational complexity (another moving part to run, monitor, and debug) with no
phase-0/early-phase-1 payoff — there is no real-time throughput requirement to
validate yet; that is explicitly a later-phase device-benchmarking concern (PRD
§4.1 Phase 1 exit gate: "latency baseline measured," not "target met").

## Trade-off accepted
No backpressure handling in this phase. Acceptable given the above; must be
revisited before any multi-session or production load test.
