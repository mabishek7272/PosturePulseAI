"""Named, isolated swap point for moving from synchronous REST handling to an
async queue (Redis Streams/NATS) if real-time throughput later requires it -
see docs/adr/003-frame-transport.md. In this phase, frames are handled
synchronously inline in app/api/internal_routes.py; this module intentionally
contains no logic yet beyond documenting where that future change goes.
"""
