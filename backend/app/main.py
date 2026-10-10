from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import config
from .api import router

app = FastAPI(
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
