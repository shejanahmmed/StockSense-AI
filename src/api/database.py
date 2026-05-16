import sqlite3
from pathlib import Path

project_root = Path(__file__).resolve().parent.parent.parent
DB_PATH = project_root / "data" / "users.db"

def init_db():
    # Ensure data directory exists
    (project_root / "data").mkdir(exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            org_name TEXT PRIMARY KEY,
            industry TEXT,
            avatar_url TEXT
        )
    ''')
    try:
        cursor.execute("ALTER TABLE users ADD COLUMN password_hash TEXT")
    except sqlite3.OperationalError:
        pass
    try:
        cursor.execute("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'")
    except sqlite3.OperationalError:
        pass
        
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS chat_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            org_name TEXT,
            role TEXT,
            content TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS inventory (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            org_name TEXT,
            sku TEXT,
            name TEXT,
            category TEXT,
            price REAL,
            stock INTEGER,
            supplier TEXT,
            status TEXT,
            UNIQUE(org_name, sku)
        )
    ''')
    conn.commit()
    conn.close()

def get_db_connection():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn
