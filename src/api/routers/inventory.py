from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from src.api.auth_utils import get_current_user
from src.api.database import get_db_connection

router = APIRouter()

@router.get("/api/inventory")
async def get_inventory(
    page: int = Query(1, ge=1),
    limit: int = Query(500, ge=1, le=1000),
    user: dict = Depends(get_current_user)
):
    try:
        org_name = user.get("sub", "Unknown")
        conn = get_db_connection()
        cursor = conn.cursor()
        
        offset = (page - 1) * limit
        cursor.execute('''
            SELECT sku, name, category, price, stock, supplier, status, reorder_point, supplier_lead_days, forecasted_demand 
            FROM inventory 
            WHERE org_name = ? 
            LIMIT ? OFFSET ?
        ''', (org_name, limit, offset))
        
        rows = cursor.fetchall()
        
        # Get total count for metadata
        cursor.execute('SELECT COUNT(*) FROM inventory WHERE org_name = ?', (org_name,))
        total_count = cursor.fetchone()[0]
        
        conn.close()
        
        data = [dict(row) for row in rows]
        
        return {
            "status": "success", 
            "data": data,
            "meta": {
                "page": page,
                "limit": limit,
                "total": total_count
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/inventory")
async def add_inventory(item: dict, user: dict = Depends(get_current_user)):
    try:
        org_name = user.get("sub", "Unknown")
        if "sku" not in item:
            return {"status": "error", "message": "SKU is required."}
            
        conn = get_db_connection()
        cursor = conn.cursor()
        
        try:
            cursor.execute('''
                INSERT INTO inventory (org_name, sku, name, category, price, stock, supplier, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                org_name, 
                item.get("sku"), 
                item.get("name", ""), 
                item.get("category", ""), 
                item.get("price", 0.0), 
                item.get("stock", 0), 
                item.get("supplier", ""), 
                item.get("status", "")
            ))
            conn.commit()
        except conn.IntegrityError:
            conn.close()
            return {"status": "error", "message": "SKU already exists."}
            
        conn.close()
        return {"status": "success", "message": "Item added successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/api/inventory/{sku}")
async def update_inventory(sku: str, item: dict, user: dict = Depends(get_current_user)):
    try:
        org_name = user.get("sub", "Unknown")
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Check existence
        cursor.execute('SELECT id FROM inventory WHERE org_name = ? AND sku = ?', (org_name, sku))
        if not cursor.fetchone():
            conn.close()
            return {"status": "error", "message": "Item not found."}
            
        # Update fields dynamically
        fields_to_update = []
        values = []
        allowed_fields = ["name", "category", "price", "stock", "supplier", "status"]
        
        for field in allowed_fields:
            if field in item:
                fields_to_update.append(f"{field} = ?")
                values.append(item[field])
                
        if fields_to_update:
            values.extend([org_name, sku])
            query = f"UPDATE inventory SET {', '.join(fields_to_update)} WHERE org_name = ? AND sku = ?"
            cursor.execute(query, tuple(values))
            conn.commit()
            
        conn.close()
        return {"status": "success", "message": "Item updated successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/api/inventory/{sku}")
async def delete_inventory(sku: str, user: dict = Depends(get_current_user)):
    try:
        org_name = user.get("sub", "Unknown")
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('DELETE FROM inventory WHERE org_name = ? AND sku = ?', (org_name, sku))
        if cursor.rowcount == 0:
            conn.close()
            return {"status": "error", "message": "Item not found."}
            
        conn.commit()
        conn.close()
        return {"status": "success", "message": "Item deleted successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
