from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Any
import sqlite3
from pathlib import Path
from src.api.auth_utils import get_current_user
from src.api.database import DB_PATH
from src.api.insight_generator import generate_chat_response

router = APIRouter()

class ChatRequest(BaseModel):
    message: str
    history: list = []
    inventory_context: Any = None
    currency: str = "BDT"

@router.post("/api/chat")
async def chat_with_ai(request: ChatRequest, user: dict = Depends(get_current_user)):
    try:
        org_name = user.get("sub", "Unknown")
        
        # Connect DB
        conn = sqlite3.connect(str(DB_PATH))
        cursor = conn.cursor()
        
        # Generate Response
        response = generate_chat_response(
            request.message,
            request.history,
            request.inventory_context,
            currency=request.currency,
            org_name=org_name
        )
        
        # Store both messages
        cursor.execute("INSERT INTO chat_history (org_name, role, content) VALUES (?, ?, ?)", (org_name, "user", request.message))
        cursor.execute("INSERT INTO chat_history (org_name, role, content) VALUES (?, ?, ?)", (org_name, "assistant", response))
        conn.commit()
        conn.close()
        
        return {"status": "success", "response": response}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/chat/history")
async def get_chat_history(user: dict = Depends(get_current_user)):
    try:
        org_name = user.get("sub", "Unknown")
        conn = sqlite3.connect(str(DB_PATH))
        cursor = conn.cursor()
        
        # Fetch last 50 messages
        cursor.execute("SELECT role, content FROM chat_history WHERE org_name = ? ORDER BY timestamp ASC LIMIT 50", (org_name,))
        rows = cursor.fetchall()
        conn.close()
        
        history = [{"role": row[0], "content": row[1]} for row in rows]
        return {"status": "success", "history": history}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
