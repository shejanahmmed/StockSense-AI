import sqlite3
import datetime
from pathlib import Path
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Header
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel

from src.api.auth_utils import get_current_user, require_admin
from src.api.database import DB_PATH, get_db_connection

router = APIRouter()

# Resolve paths
project_root = Path(__file__).resolve().parent.parent.parent.parent

# Pydantic models for admin edits
class SettingsUpdate(BaseModel):
    is_public: str
    start_time: str
    end_time: str
    override_enabled: str

class SectionUpdate(BaseModel):
    title: str
    content: str
    draft_content: Optional[str] = None
    is_published: int
    publish_now: bool = False

class SectionReorder(BaseModel):
    section_ids: List[str]

class TeamMemberUpdate(BaseModel):
    id: Optional[int] = None
    name: str
    role: str
    email: str
    avatar_url: str = ""
    display_order: int = 1


# Helper function to check if documentation is currently public
def is_docs_public_now() -> tuple:
    """
    Checks settings to see if public access is currently allowed.
    Returns (is_allowed: bool, settings_dict: dict)
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT key, value FROM docs_settings")
    rows = cursor.fetchall()
    conn.close()
    
    settings = {row["key"]: row["value"] for row in rows}
    
    is_public = settings.get("is_public", "0") == "1"
    override_enabled = settings.get("override_enabled", "0") == "1"
    start_time = settings.get("start_time", "2026-06-10 00:00:00")
    end_time = settings.get("end_time", "2026-06-14 23:59:59")
    
    if not is_public:
        return False, settings
        
    if override_enabled:
        return True, settings
        
    # Check scheduled window
    current_time_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    if start_time <= current_time_str <= end_time:
        return True, settings
        
    return False, settings


# 1. Page router to serve docs.html at {app_base_url}/docs
@router.get("/docs", response_class=HTMLResponse)
async def serve_docs_page():
    docs_path = project_root / "frontend" / "docs.html"
    if not docs_path.exists():
        raise HTTPException(status_code=404, detail="docs.html template file not found.")
    with docs_path.open("r", encoding="utf-8") as f:
        return f.read()


# 2. Get active configurations (visible to everyone so countdown shows correct dates)
@router.get("/api/docs/config")
async def get_docs_config():
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT key, value FROM docs_settings")
        rows = cursor.fetchall()
        conn.close()
        
        settings = {row["key"]: row["value"] for row in rows}
        is_allowed, _ = is_docs_public_now()
        
        return {
            "status": "success",
            "is_public_now": is_allowed,
            "config": settings
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# 3. Get all sections
@router.get("/api/docs/sections")
async def get_sections(authorization: Optional[str] = Header(None)):
    is_admin = False
    
    # Check if admin session is active
    if authorization and authorization.startswith("Bearer "):
        try:
            user = get_current_user(authorization)
            if user and user.get("role") == "admin":
                is_admin = True
        except Exception:
            pass # Treat as non-admin if token is invalid
            
    if not is_admin:
        is_allowed, settings = is_docs_public_now()
        if not is_allowed:
            return JSONResponse(
                status_code=403,
                content={
                    "status": "locked",
                    "message": "Access restricted. Documentation is currently locked.",
                    "config": settings
                }
            )
            
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        if is_admin:
            cursor.execute("SELECT * FROM docs_sections ORDER BY display_order ASC")
        else:
            cursor.execute("SELECT section_id, title, content, display_order, category, last_updated FROM docs_sections WHERE is_published = 1 ORDER BY display_order ASC")
            
        rows = cursor.fetchall()
        conn.close()
        
        sections = [dict(row) for row in rows]
        return {
            "status": "success",
            "role": "admin" if is_admin else "visitor",
            "data": sections
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# 4. Update section content (Admin only)
@router.post("/api/docs/sections/{section_id}")
async def update_section(section_id: str, section: SectionUpdate, user: dict = Depends(require_admin)):
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Verify section exists
        cursor.execute("SELECT section_id FROM docs_sections WHERE section_id = ?", (section_id,))
        if not cursor.fetchone():
            conn.close()
            raise HTTPException(status_code=404, detail="Section not found.")
            
        current_time = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        
        if section.publish_now:
            # Publish draft straight to live
            cursor.execute("""
                UPDATE docs_sections 
                SET title = ?, content = ?, draft_content = ?, is_published = ?, last_updated = ? 
                WHERE section_id = ?
            """, (section.title, section.content, None, section.is_published, current_time, section_id))
        else:
            # Save draft only, keep original content unchanged
            cursor.execute("""
                UPDATE docs_sections 
                SET title = ?, draft_content = ?, is_published = ?, last_updated = ? 
                WHERE section_id = ?
            """, (section.title, section.draft_content, section.is_published, current_time, section_id))
            
        conn.commit()
        conn.close()
        
        return {"status": "success", "message": "Section updated successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# 5. Reorder sections (Admin only)
@router.post("/api/docs/sections/reorder")
async def reorder_sections(payload: SectionReorder, user: dict = Depends(require_admin)):
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        for idx, sec_id in enumerate(payload.section_ids):
            # Display order is multiples of 10 for easy interleaving
            cursor.execute("UPDATE docs_sections SET display_order = ? WHERE section_id = ?", ((idx + 1) * 10, sec_id))
            
        conn.commit()
        conn.close()
        
        return {"status": "success", "message": "Sections reordered successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# 6. Update general settings (Admin only)
@router.post("/api/docs/settings")
async def update_settings(settings: SettingsUpdate, user: dict = Depends(require_admin)):
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute("INSERT OR REPLACE INTO docs_settings (key, value) VALUES ('is_public', ?)", (settings.is_public,))
        cursor.execute("INSERT OR REPLACE INTO docs_settings (key, value) VALUES ('start_time', ?)", (settings.start_time,))
        cursor.execute("INSERT OR REPLACE INTO docs_settings (key, value) VALUES ('end_time', ?)", (settings.end_time,))
        cursor.execute("INSERT OR REPLACE INTO docs_settings (key, value) VALUES ('override_enabled', ?)", (settings.override_enabled,))
        
        conn.commit()
        conn.close()
        
        return {"status": "success", "message": "Settings updated successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# 7. Get team list
@router.get("/api/docs/team")
async def get_team(authorization: Optional[str] = Header(None)):
    is_admin = False
    
    # Check if admin session is active
    if authorization and authorization.startswith("Bearer "):
        try:
            user = get_current_user(authorization)
            if user and user.get("role") == "admin":
                is_admin = True
        except Exception:
            pass
            
    if not is_admin:
        is_allowed, settings = is_docs_public_now()
        if not is_allowed:
            return JSONResponse(
                status_code=403,
                content={
                    "status": "locked",
                    "message": "Access restricted. Team members are currently locked.",
                    "config": settings
                }
            )
            
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM docs_team ORDER BY display_order ASC")
        rows = cursor.fetchall()
        conn.close()
        
        team = [dict(row) for row in rows]
        return {
            "status": "success",
            "data": team
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# 8. Add or edit team member (Admin only)
@router.post("/api/docs/team")
async def update_team_member(member: TeamMemberUpdate, user: dict = Depends(require_admin)):
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        if member.id:
            # Edit existing
            cursor.execute("""
                UPDATE docs_team 
                SET name = ?, role = ?, email = ?, avatar_url = ?, display_order = ? 
                WHERE id = ?
            """, (member.name, member.role, member.email, member.avatar_url, member.display_order, member.id))
        else:
            # Insert new
            cursor.execute("""
                INSERT INTO docs_team (name, role, email, avatar_url, display_order) 
                VALUES (?, ?, ?, ?, ?)
            """, (member.name, member.role, member.email, member.avatar_url, member.display_order))
            
        conn.commit()
        conn.close()
        
        return {"status": "success", "message": "Team member saved successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# 9. Delete team member (Admin only)
@router.delete("/api/docs/team/{member_id}")
async def delete_team_member(member_id: int, user: dict = Depends(require_admin)):
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM docs_team WHERE id = ?", (member_id,))
        conn.commit()
        conn.close()
        
        return {"status": "success", "message": "Team member deleted successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# 10. Live sync stats from the DB
@router.get("/api/docs/live-stats")
async def get_live_stats():
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # 1. Total unique organizations registered
        cursor.execute("SELECT COUNT(*) FROM users")
        total_users = cursor.fetchone()[0]
        
        # 2. Total physical units in warehouse
        cursor.execute("SELECT SUM(stock) FROM inventory")
        total_stock = cursor.fetchone()[0] or 0
        
        # 3. Total unique SKUs
        cursor.execute("SELECT COUNT(*) FROM inventory")
        total_skus = cursor.fetchone()[0]
        
        # 4. Total forecast intervals calculated
        cursor.execute("SELECT COUNT(*) FROM forecasts")
        total_forecasts = cursor.fetchone()[0]
        
        # 5. Total state-sovereign chat interactions
        cursor.execute("SELECT COUNT(*) FROM chat_history")
        total_chats = cursor.fetchone()[0]
        
        conn.close()
        
        return {
            "status": "success",
            "stats": {
                "total_users": total_users,
                "total_skus": total_skus,
                "total_units": total_stock,
                "total_forecasts": total_forecasts,
                "total_chats": total_chats,
                "system_uptime": "99.98%",
                "service_status": "Operational"
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
