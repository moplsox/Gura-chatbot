from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api import chat, health, speech
from app.config.settings import PROJECT_ROOT, get_settings
from app.services import build_services

settings = get_settings()
logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
)
log = logging.getLogger("gura")


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.services = build_services(settings)
    log.info("Backend ready on http://%s:%s", settings.backend_host, settings.backend_port)
    yield
    await app.state.services.aclose()


app = FastAPI(title="Gura AI Live2D Chat", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(health.router)
app.include_router(chat.router)
app.include_router(speech.router)

# Serve user-provided model folders (Live2D / misc) from <repo>/models for the frontend.
if settings.models_dir.exists():
    app.mount("/models", StaticFiles(directory=str(settings.models_dir)), name="models")

# Production: serve the built frontend if present (npm run build → frontend/dist).
DIST = PROJECT_ROOT / "frontend" / "dist"
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=str(DIST / "assets")), name="assets")
    if (DIST / "live2d").exists():
        app.mount("/live2d", StaticFiles(directory=str(DIST / "live2d")), name="live2d")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa(full_path: str) -> FileResponse:
        candidate = DIST / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(DIST / "index.html")
