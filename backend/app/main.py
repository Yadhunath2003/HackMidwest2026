from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from . import config, paper
from .api import router

@asynccontextmanager
async def lifespan(app):
    stop=paper.start_monitor()
    yield
    stop.set()


app = FastAPI(
    lifespan=lifespan,
    title="StrategyLab AI",
    description="Describe it. Backtest it. Understand it. Validate it. Historical simulation only.",
    version="0.1.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router)
