import logging
from fastapi import APIRouter, Depends, HTTPException
from src.api.auth_utils import get_current_user
from src.api.database import get_db_connection

logger = logging.getLogger(__name__)
router = APIRouter()

@router.get("/api/financials/summary")
async def get_financials_summary(user: dict = Depends(get_current_user)):
    """
    Calculate and retrieve high-level B2B SaaS financial analytics.
    Computes retail portfolio values, tied-up capital (COGS),
    predicted sales values at risk of stockouts, and historical PO spends.
    """
    try:
        org_name = user.get("sub", "Unknown")
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # 1. Fetch total units, retail value, and wholesale tied-up capital
        cursor.execute('''
            SELECT SUM(stock) as total_stock, 
                   SUM(stock * price) as retail_value,
                   SUM(stock * (price * 0.7)) as capital_tied_up,
                   COUNT(sku) as total_skus
            FROM inventory
            WHERE org_name = ?
        ''', (org_name,))
        inv_row = cursor.fetchone()
        
        total_stock = inv_row["total_stock"] or 0
        retail_value = inv_row["retail_value"] or 0.0
        capital_tied_up = inv_row["capital_tied_up"] or 0.0
        total_skus = inv_row["total_skus"] or 0
        
        # 2. Calculate Revenue at Risk (lost sales risk)
        # Any item where forecasted_demand > stock is a stockout risk.
        # Revenue at risk = (forecasted_demand - stock) * retail_price
        cursor.execute('''
            SELECT sku, price, stock, forecasted_demand
            FROM inventory
            WHERE org_name = ? AND forecasted_demand > stock
        ''', (org_name,))
        at_risk_rows = cursor.fetchall()
        
        revenue_at_risk = 0.0
        for item in at_risk_rows:
            stock = item["stock"] or 0
            demand = item["forecasted_demand"] or 0
            price = item["price"] or 0.0
            shortfall = demand - stock
            revenue_at_risk += shortfall * price
            
        # 3. Fetch Total Committed Procurement Spend (purchase orders status != Cancelled)
        cursor.execute('''
            SELECT SUM(total_amount) as total_spend
            FROM purchase_orders
            WHERE org_name = ? AND status != 'Cancelled'
        ''', (org_name,))
        po_row = cursor.fetchone()
        total_spend = po_row["total_spend"] or 0.0
        
        # 4. Fetch Supplier Spend Velocity (monthly PO spend aggregation)
        cursor.execute('''
            SELECT strftime('%Y-%m', order_date) as month, SUM(total_amount) as amount
            FROM purchase_orders
            WHERE org_name = ? AND status != 'Cancelled'
            GROUP BY month
            ORDER BY month ASC
        ''', (org_name,))
        velocity_rows = cursor.fetchall()
        
        spend_velocity = []
        for r in velocity_rows:
            m = r["month"] or "Unknown"
            amt = r["amount"] or 0.0
            spend_velocity.append({"month": m, "amount": amt})
            
        # 5. Fetch Supplier Allocation Breakdown
        cursor.execute('''
            SELECT supplier, SUM(total_amount) as amount
            FROM purchase_orders
            WHERE org_name = ? AND status != 'Cancelled'
            GROUP BY supplier
            ORDER BY amount DESC
        ''', (org_name,))
        supplier_rows = cursor.fetchall()
        
        spend_by_supplier = []
        for r in supplier_rows:
            supp = r["supplier"] or "Unknown"
            # Fallback for empty supplier names to generic logistics partners
            if not supp.strip():
                supp = "General Logistics"
            spend_by_supplier.append({"supplier": supp, "amount": r["amount"] or 0.0})
            
        # 6. Fetch Category Asset Allocation Matrix
        cursor.execute('''
            SELECT category, 
                   SUM(stock) as units, 
                   SUM(stock * price) as retail_value,
                   SUM(stock * (price * 0.7)) as capital_tied_up
            FROM inventory
            WHERE org_name = ?
            GROUP BY category
            ORDER BY capital_tied_up DESC
        ''', (org_name,))
        cat_rows = cursor.fetchall()
        
        category_allocation = []
        for r in cat_rows:
            cat = r["category"] or "General"
            units = r["units"] or 0
            ret_val = r["retail_value"] or 0.0
            cap_tied = r["capital_tied_up"] or 0.0
            category_allocation.append({
                "category": cat,
                "units": units,
                "retail_value": ret_val,
                "capital_tied_up": cap_tied,
                "margin_pct": 30.0 # Standard retail-to-wholesale markup baseline (30%)
            })
            
        conn.close()
        
        return {
            "status": "success",
            "kpis": {
                "retail_value": retail_value,
                "capital_tied_up": capital_tied_up,
                "revenue_at_risk": revenue_at_risk,
                "total_spend": total_spend,
                "total_skus": total_skus,
                "total_stock": total_stock
            },
            "spend_velocity": spend_velocity,
            "spend_by_supplier": spend_by_supplier,
            "category_allocation": category_allocation
        }
    except Exception as e:
        logger.error(f"Error calculating financials summary: {e}")
        raise HTTPException(status_code=500, detail=str(e))
