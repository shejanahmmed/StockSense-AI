import logging
from typing import List
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, status
from src.api.auth_utils import get_current_user
from src.api.database import get_db_connection

logger = logging.getLogger(__name__)
router = APIRouter()

# --- Pydantic Body Models ---

class POItemSchema(BaseModel):
    sku: str
    name: str
    quantity: int
    unit_price: float

class POCreateSchema(BaseModel):
    id: str
    supplier: str
    order_date: str
    delivery_date: str
    items: List[POItemSchema]

# --- REST Endpoints ---

@router.get("/api/purchase_orders")
async def get_purchase_orders(user: dict = Depends(get_current_user)):
    """Fetch all purchase orders for the authenticated organization."""
    try:
        org_name = user.get("sub", "Unknown")
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT id, org_name, supplier, order_date, delivery_date, status, total_amount, created_at
            FROM purchase_orders
            WHERE org_name = ?
            ORDER BY created_at DESC
        ''', (org_name,))
        
        rows = cursor.fetchall()
        data = [dict(row) for row in rows]
        conn.close()
        
        return {"status": "success", "data": data}
    except Exception as e:
        logger.error(f"Error fetching POs: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/purchase_orders/{po_id}")
async def get_purchase_order_by_id(po_id: str, user: dict = Depends(get_current_user)):
    """Fetch details of a single purchase order along with its item breakdown."""
    try:
        org_name = user.get("sub", "Unknown")
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # 1. Fetch Header
        cursor.execute('''
            SELECT id, org_name, supplier, order_date, delivery_date, status, total_amount, created_at
            FROM purchase_orders
            WHERE org_name = ? AND id = ?
        ''', (org_name, po_id))
        po_row = cursor.fetchone()
        
        if not po_row:
            conn.close()
            raise HTTPException(status_code=404, detail="Purchase Order not found.")
            
        po_data = dict(po_row)
        
        # 2. Fetch Items
        cursor.execute('''
            SELECT id, po_id, sku, name, quantity, unit_price, total_price
            FROM po_items
            WHERE po_id = ?
        ''', (po_id,))
        
        item_rows = cursor.fetchall()
        po_data["items"] = [dict(item) for item in item_rows]
        
        conn.close()
        return {"status": "success", "data": po_data}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching PO {po_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/purchase_orders")
async def create_purchase_order(po: POCreateSchema, user: dict = Depends(get_current_user)):
    """Persist a new Purchase Order along with its lines in a transaction."""
    try:
        org_name = user.get("sub", "Unknown")
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Check if ID already exists
        cursor.execute('SELECT id FROM purchase_orders WHERE org_name = ? AND id = ?', (org_name, po.id))
        if cursor.fetchone():
            conn.close()
            raise HTTPException(status_code=400, detail=f"Purchase Order ID '{po.id}' already exists.")
            
        # Calculate aggregate total amount
        total_amount = sum(item.quantity * item.unit_price for item in po.items)
        
        # 1. Insert Header
        cursor.execute('''
            INSERT INTO purchase_orders (id, org_name, supplier, order_date, delivery_date, status, total_amount)
            VALUES (?, ?, ?, ?, ?, 'Draft', ?)
        ''', (po.id, org_name, po.supplier, po.order_date, po.delivery_date, total_amount))
        
        # 2. Insert Items
        for item in po.items:
            item_total = item.quantity * item.unit_price
            cursor.execute('''
                INSERT INTO po_items (po_id, sku, name, quantity, unit_price, total_price)
                VALUES (?, ?, ?, ?, ?, ?)
            ''', (po.id, item.sku, item.name, item.quantity, item.unit_price, item_total))
            
        conn.commit()
        conn.close()
        
        return {
            "status": "success", 
            "message": f"Purchase Order '{po.id}' successfully drafted and saved.",
            "po_id": po.id
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating PO: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/api/purchase_orders/{po_id}/status")
async def update_po_status(po_id: str, payload: dict, user: dict = Depends(get_current_user)):
    """
    Transition PO status (e.g. Draft -> Ordered -> Received).
    If status transitions to 'Received', execute atomic stock reconciliation!
    """
    try:
        org_name = user.get("sub", "Unknown")
        new_status = payload.get("status")
        if not new_status:
            raise HTTPException(status_code=400, detail="Missing 'status' in request body.")
            
        allowed_statuses = ["Draft", "Ordered", "Received", "Cancelled"]
        if new_status not in allowed_statuses:
            raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {allowed_statuses}")
            
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Fetch current PO details
        cursor.execute('SELECT status FROM purchase_orders WHERE org_name = ? AND id = ?', (org_name, po_id))
        po_row = cursor.fetchone()
        if not po_row:
            conn.close()
            raise HTTPException(status_code=404, detail="Purchase Order not found.")
            
        old_status = po_row["status"]
        if old_status == "Received" and new_status != "Received":
            conn.close()
            raise HTTPException(status_code=400, detail="Completed orders cannot be reverted to other statuses.")
            
        # If transitioning to Received, increment inventory stock
        if new_status == "Received" and old_status != "Received":
            # Fetch all items under this PO
            cursor.execute('SELECT sku, name, quantity FROM po_items WHERE po_id = ?', (po_id,))
            po_items = cursor.fetchall()
            
            for item in po_items:
                sku = item["sku"]
                qty = item["quantity"]
                
                # Fetch current stock and reorder point of the target SKU
                cursor.execute('SELECT stock, reorder_point FROM inventory WHERE org_name = ? AND sku = ?', (org_name, sku))
                inv_row = cursor.fetchone()
                
                if inv_row:
                    old_stock = inv_row["stock"] or 0
                    reorder_point = inv_row["reorder_point"] or 50
                    new_stock = old_stock + qty
                    
                    # Compute new status based on updated stock
                    if new_stock <= 0:
                        prod_status = "Out of Stock"
                    elif new_stock <= reorder_point:
                        prod_status = "Low Stock"
                    else:
                        prod_status = "In Stock"
                        
                    # Update inventory
                    cursor.execute('''
                        UPDATE inventory
                        SET stock = ?, status = ?, last_updated = CURRENT_TIMESTAMP
                        WHERE org_name = ? AND sku = ?
                    ''', (new_stock, prod_status, org_name, sku))
                    
        # Update PO Status header
        cursor.execute('''
            UPDATE purchase_orders
            SET status = ?
            WHERE org_name = ? AND id = ?
        ''', (new_status, org_name, po_id))
        
        conn.commit()
        conn.close()
        
        return {"status": "success", "message": f"Purchase Order '{po_id}' status successfully updated to '{new_status}'."}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating PO status: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/api/purchase_orders/{po_id}")
async def delete_purchase_order(po_id: str, user: dict = Depends(get_current_user)):
    """Delete a PO record from database (cascade deletes items)."""
    try:
        org_name = user.get("sub", "Unknown")
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Verify ownership
        cursor.execute('SELECT id FROM purchase_orders WHERE org_name = ? AND id = ?', (org_name, po_id))
        if not cursor.fetchone():
            conn.close()
            raise HTTPException(status_code=404, detail="Purchase Order not found.")
            
        # Delete items (foreign key constraint is manual here)
        cursor.execute('DELETE FROM po_items WHERE po_id = ?', (po_id,))
        cursor.execute('DELETE FROM purchase_orders WHERE org_name = ? AND id = ?', (org_name, po_id))
        
        conn.commit()
        conn.close()
        
        return {"status": "success", "message": f"Purchase Order '{po_id}' successfully deleted."}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting PO: {e}")
        raise HTTPException(status_code=500, detail=str(e))
