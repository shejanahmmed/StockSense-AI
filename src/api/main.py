import sys
import logging
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

# Add project root to sys.path to resolve imports
project_root = Path(__file__).resolve().parent.parent.parent
sys.path.append(str(project_root))

from src.api.database import init_db
from src.api.routers import auth, inventory, chat, analytics

# Standard Logging Setup
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(project_root / "app.log")
    ]
)
logger = logging.getLogger(__name__)

# Initialize DB
logger.info("Initializing database...")
init_db()
logger.info("Database initialized successfully.")

app = FastAPI(title="StockSense AI API")

# Add CORS middleware for frontend communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include Routers
app.include_router(auth.router)
app.include_router(inventory.router)
app.include_router(chat.router)
app.include_router(analytics.router)

# Mount the frontend directory to serve the UI at the root
frontend_path = project_root / "frontend"
app.mount("/", StaticFiles(directory=str(frontend_path), html=True), name="frontend")
