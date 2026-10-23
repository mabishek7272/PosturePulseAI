from __future__ import annotations

from fastapi import FastAPI

from app.api.clip_routes import router as clip_router
from app.api.internal_routes import router as internal_router

app = FastAPI(title="beAIve ml-service", version="0.0.0")
app.include_router(internal_router)
app.include_router(clip_router)
