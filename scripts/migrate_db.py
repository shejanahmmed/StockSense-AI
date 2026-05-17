"""One-off migration: add last_updated column and forecasts table."""
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "users.db"

conn = sqlite3.connect(str(DB_PATH))
cursor = conn.cursor()

# Add last_updated with a static default (SQLite won't accept CURRENT_TIMESTAMP in ALTER TABLE)
try:
    cursor.execute("ALTER TABLE inventory ADD COLUMN last_updated TEXT DEFAULT '2025-01-01'")
    print("Added: last_updated")
except Exception as e:
    print(f"Skip last_updated: {e}")

# Create forecasts table
cursor.execute("""
    CREATE TABLE IF NOT EXISTS forecasts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        org_name TEXT,
        sku TEXT,
        forecast_date TEXT,
        predicted_sales REAL,
        lower_bound REAL,
        upper_bound REAL,
        created_at TEXT DEFAULT '2025-01-01',
        UNIQUE(org_name, sku, forecast_date)
    )
""")
print("forecasts table: OK")

conn.commit()
conn.close()
print("Migration complete.")
