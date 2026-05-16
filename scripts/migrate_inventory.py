"""
One-time migration script: Seeds the SQLite `inventory` table from the legacy
`data/inventory.json` flat file, preserving all existing data.
"""
import sys
import json
import sqlite3
from pathlib import Path

# Resolve project root
project_root = Path(__file__).resolve().parent.parent
sys.path.append(str(project_root))

from src.api.database import init_db, DB_PATH

def migrate():
    # Ensure all tables exist first
    init_db()

    json_path = project_root / "data" / "inventory.json"
    if not json_path.exists():
        print(f"[ERROR] inventory.json not found at {json_path}")
        return

    with open(json_path, "r") as f:
        data = json.load(f)

    conn = sqlite3.connect(str(DB_PATH))
    cursor = conn.cursor()

    # Pick the first user org as default owner for the legacy data
    cursor.execute("SELECT org_name FROM users LIMIT 1")
    row = cursor.fetchone()
    default_org = row[0] if row else "default_org"
    print(f"[INFO] Migrating items under org: '{default_org}'")

    migrated, skipped = 0, 0
    for item in data:
        try:
            cursor.execute(
                """
                INSERT INTO inventory (org_name, sku, name, category, price, stock, supplier, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    default_org,
                    item.get("sku"),
                    item.get("name", ""),
                    item.get("category", ""),
                    float(item.get("price", 0.0)),
                    int(item.get("stock", 0)),
                    item.get("supplier", ""),
                    item.get("status", ""),
                ),
            )
            migrated += 1
        except sqlite3.IntegrityError:
            # Already exists (UNIQUE org_name + sku), skip
            skipped += 1

    conn.commit()
    conn.close()

    print(f"[DONE] Migrated: {migrated} items | Skipped (already exist): {skipped}")

if __name__ == "__main__":
    migrate()
