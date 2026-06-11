from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel
import sqlite3
import shutil
import os
from pathlib import Path
from src.api.auth_utils import get_current_user, create_access_token, hash_password
from src.api.database import DB_PATH

router = APIRouter()
project_root = Path(__file__).resolve().parent.parent.parent.parent
AVATARS_DIR = project_root / "frontend" / "assets" / "avatars"
AVATARS_DIR.mkdir(parents=True, exist_ok=True)

class UserProfile(BaseModel):
    org_name: str
    industry: str
    avatar_url: str = ""
    password: str = ""

@router.post("/api/user/login")
async def login(profile: UserProfile):
    try:
        conn = sqlite3.connect(str(DB_PATH))
        cursor = conn.cursor()
        cursor.execute('SELECT industry, avatar_url, password_hash, role FROM users WHERE org_name = ?', (profile.org_name,))
        row = cursor.fetchone()
        
        if row:
            role = row[3] if row[3] else 'user'
            token = create_access_token({"sub": profile.org_name, "role": role})
            conn.close()
            return {
                "status": "success",
                "token": token,
                "data": {
                    "org_name": profile.org_name,
                    "industry": row[0],
                    "avatar_url": row[1],
                    "role": role
                }
            }
        else:
            # Auto-signup on login attempt for unknown organizations (Contest Bypass)
            hashed_pw = hash_password(profile.password) if profile.password else ""
            role = "admin"
            cursor.execute('''
                INSERT INTO users (org_name, industry, avatar_url, password_hash, role)
                VALUES (?, ?, ?, ?, ?)
            ''', (profile.org_name, "Retail", "", hashed_pw, role))
            conn.commit()
            conn.close()
            token = create_access_token({"sub": profile.org_name, "role": role})
            return {
                "status": "success",
                "token": token,
                "data": {
                    "org_name": profile.org_name,
                    "industry": "Retail",
                    "avatar_url": "",
                    "role": role
                }
            }
    except Exception as e:
        if 'conn' in locals():
            conn.close()
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/user/signup")
async def signup(profile: UserProfile):
    try:
        conn = sqlite3.connect(str(DB_PATH))
        cursor = conn.cursor()
        cursor.execute('SELECT org_name FROM users WHERE org_name = ?', (profile.org_name,))
        if cursor.fetchone():
            # Auto-login if organization already exists during signup (Contest Bypass)
            role = "admin"
            token = create_access_token({"sub": profile.org_name, "role": role})
            conn.close()
            return {"status": "success", "message": "Account created.", "token": token, "data": {"role": role}}
            
        hashed_pw = hash_password(profile.password) if profile.password else ""
        role = "admin"
        cursor.execute('''
            INSERT INTO users (org_name, industry, avatar_url, password_hash, role)
            VALUES (?, ?, ?, ?, ?)
        ''', (profile.org_name, profile.industry, profile.avatar_url, hashed_pw, role))
        conn.commit()
        conn.close()
        
        token = create_access_token({"sub": profile.org_name, "role": role})
        
        return {"status": "success", "message": "Account created.", "token": token, "data": {"role": role}}
    except Exception as e:
        if 'conn' in locals():
            conn.close()
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/user/profile")
async def save_user_profile(profile: UserProfile, user: dict = Depends(get_current_user)):
    try:
        conn = sqlite3.connect(str(DB_PATH))
        cursor = conn.cursor()
        cursor.execute('''
            INSERT INTO users (org_name, industry, avatar_url) 
            VALUES (?, ?, ?)
            ON CONFLICT(org_name) DO UPDATE SET 
                industry=excluded.industry,
                avatar_url=excluded.avatar_url
        ''', (profile.org_name, profile.industry, profile.avatar_url))
        conn.commit()
        conn.close()
        return {"status": "success", "message": "Profile saved."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/user/profile/{org_name}")
async def get_user_profile(org_name: str):
    try:
        conn = sqlite3.connect(str(DB_PATH))
        cursor = conn.cursor()
        cursor.execute('SELECT org_name, industry, avatar_url FROM users WHERE org_name = ?', (org_name,))
        row = cursor.fetchone()
        conn.close()
        if row:
            return {
                "status": "success",
                "data": {
                    "org_name": row[0],
                    "industry": row[1],
                    "avatar_url": row[2]
                }
            }
        else:
            return {"status": "not_found"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/user/upload-avatar")
async def upload_avatar(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image files are supported.")
    
    try:
        # Generate unique filename
        file_extension = Path(file.filename).suffix
        filename = f"avatar_{os.urandom(4).hex()}{file_extension}"
        file_path = AVATARS_DIR / filename
        
        with file_path.open("wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        # Return the relative path to be used by the frontend
        return {"status": "success", "avatar_url": f"assets/avatars/{filename}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/api/user/purge")
async def purge_org_data(user: dict = Depends(get_current_user)):
    """
    Permanently deletes all inventory items, forecast rows, and chat history for the
    authenticated organization and removes any cached Prophet model files.
    """
    try:
        org_name = user.get("sub", "Unknown")
        conn = sqlite3.connect(str(DB_PATH))
        cursor = conn.cursor()

        cursor.execute("DELETE FROM inventory WHERE org_name = ?", (org_name,))
        deleted_inventory = cursor.rowcount

        cursor.execute("DELETE FROM forecasts WHERE org_name = ?", (org_name,))
        deleted_forecasts = cursor.rowcount

        cursor.execute("DELETE FROM chat_history WHERE org_name = ?", (org_name,))
        deleted_chat = cursor.rowcount

        # Delete PO items and purchase orders
        cursor.execute("DELETE FROM po_items WHERE po_id IN (SELECT id FROM purchase_orders WHERE org_name = ?)", (org_name,))
        cursor.execute("DELETE FROM purchase_orders WHERE org_name = ?", (org_name,))
        deleted_pos = cursor.rowcount

        conn.commit()
        conn.close()

        # Wipe cached Prophet model files so stale predictions don't persist
        models_dir = project_root / "data" / "models"
        if models_dir.exists():
            for model_file in models_dir.glob("*.json"):
                try:
                    model_file.unlink()
                except Exception:
                    pass

        return {
            "status": "success",
            "message": (
                f"Purged {deleted_inventory} inventory items, "
                f"{deleted_forecasts} forecast rows, "
                f"{deleted_pos} purchase orders, and "
                f"{deleted_chat} chat messages for '{org_name}'."
            )
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

