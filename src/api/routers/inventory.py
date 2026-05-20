import datetime
import pandas as pd
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, Query
from src.api.auth_utils import get_current_user
from src.api.database import get_db_connection

# Resolves to the project root (4 levels up from this file)
_project_root = Path(__file__).resolve().parent.parent.parent.parent

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
    """
    Add a new product to the inventory DB and optionally append synthetic
    time-series rows to the user's persisted CSV file so the AI can forecast
    demand for this product on the next prediction run.

    Required body fields:
        sku, name, category, price, stock, reorder_point, supplier_lead_days

    Optional body fields:
        supplier, avg_daily_sales, history_days (default 14), promo (0/1)
    """
    try:
        org_name = user.get("sub", "Unknown")

        sku = (item.get("sku") or "").strip()
        if not sku:
            return {"status": "error", "message": "SKU is required."}

        name             = item.get("name", "").strip()
        category         = item.get("category", "General").strip()
        price            = float(item.get("price", 0.0))
        stock            = int(item.get("stock", 0))
        reorder_point    = int(item.get("reorder_point", 50))
        supplier_lead_days = int(item.get("supplier_lead_days", 7))
        supplier         = item.get("supplier", "").strip()
        avg_daily_sales  = int(item.get("avg_daily_sales", 0))
        history_days     = max(1, int(item.get("history_days", 14)))
        promo            = int(item.get("promo", 0))
        region           = item.get("region", "BD")

        # Derive status from stock vs reorder_point
        if stock <= 0:
            status = "Out of Stock"
        elif stock <= reorder_point:
            status = "Low Stock"
        else:
            status = "In Stock"

        # ── Insert into inventory DB ─────────────────────────────────────────
        conn   = get_db_connection()
        cursor = conn.cursor()
        try:
            cursor.execute('''
                INSERT INTO inventory
                    (org_name, sku, name, category, price, stock,
                     reorder_point, supplier_lead_days, supplier, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (org_name, sku, name, category, price, stock,
                  reorder_point, supplier_lead_days, supplier, status))
            conn.commit()
        except Exception as db_err:
            conn.close()
            if "UNIQUE constraint failed" in str(db_err):
                return {"status": "error", "message": f"SKU '{sku}' already exists in your inventory."}
            raise
        conn.close()

        # ── Append rows to the user's saved CSV (non-fatal if missing) ───────
        csv_rows_added = 0
        csv_updated    = False

        if avg_daily_sales > 0:
            csv_path = _project_root / "data" / "raw" / f"{org_name}_uploaded.csv"
            if csv_path.exists():
                try:
                    existing_df = pd.read_csv(csv_path)

                    # Normalise column names to match the CSV schema
                    existing_df.columns = [
                        c.strip().lower().replace(" ", "_") for c in existing_df.columns
                    ]

                    # Build history_days rows going backwards from today
                    today       = datetime.date.today()
                    # Estimate starting stock (add back all sales we'll subtract)
                    start_stock = stock + avg_daily_sales * history_days
                    cur_stock   = start_stock

                    new_rows = []
                    for i in range(history_days - 1, -1, -1):
                        row_date = today - datetime.timedelta(days=i)
                        # Introduce slight daily variation (+/-2 units)
                        variation   = (i % 5) - 2
                        daily_qty   = max(0, avg_daily_sales + variation)
                        cur_stock   = max(0, cur_stock - daily_qty)
                        # Mark weekend days as promo if promo flag is set
                        weekend_days = (4, 5) if region == "BD" else (5, 6)
                        day_promo   = promo if row_date.weekday() in weekend_days and promo else promo
                        new_rows.append({
                            "date":              row_date.strftime("%Y-%m-%d"),
                            "product_id":        sku,
                            "product_name":      name,
                            "category":          category,
                            "sales_qty":         daily_qty,
                            "unit_price":        price,
                            "stock_on_hand":     cur_stock,
                            "reorder_point":     reorder_point,
                            "promo":             day_promo,
                            "supplier_lead_days": supplier_lead_days,
                        })

                    new_df     = pd.DataFrame(new_rows)
                    updated_df = pd.concat([existing_df, new_df], ignore_index=True)
                    updated_df.to_csv(csv_path, index=False)
                    csv_rows_added = len(new_rows)
                    csv_updated    = True
                except Exception:
                    # Non-fatal — inventory was already saved successfully
                    pass

        msg = f"Product '{name}' ({sku}) added to inventory."
        if csv_updated:
            msg += f" {csv_rows_added} rows appended to your CSV file for AI forecasting."
        elif avg_daily_sales > 0:
            msg += " No uploaded CSV found — re-upload your CSV to enable AI forecasting for this product."

        return {
            "status":         "success",
            "message":        msg,
            "csv_rows_added": csv_rows_added,
            "csv_updated":    csv_updated,
        }

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
