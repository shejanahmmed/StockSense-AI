import sys
import os
import sqlite3
import pandas as pd
from pathlib import Path
import logging

# Ensure project root is in sys.path so relative imports work correctly
project_root = Path(__file__).resolve().parent.parent
if str(project_root) not in sys.path:
    sys.path.append(str(project_root))

from mcp.server.fastmcp import FastMCP
from src.api.database import get_db_connection

# Set up logging for the MCP server
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stderr)  # Standard IO MCP servers communicate on stdout, so logs MUST go to stderr!
    ]
)
logger = logging.getLogger("stocksense_mcp")

# Initialize FastMCP Server
mcp = FastMCP("StockSense AI")

def resolve_org_name(org_name: str = None) -> str:
    """Helper function to resolve the active organization name.
    
    If org_name is provided, validates and returns it.
    If not, queries SQLite for the first registered user/org and falls back to that.
    """
    if org_name and org_name.strip():
        return org_name.strip()
    
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT org_name FROM users LIMIT 1")
        row = cursor.fetchone()
        if row:
            resolved = row["org_name"]
            logger.info(f"Automatically resolved active organization context to: '{resolved}'")
            return resolved
    except Exception as e:
        logger.error(f"Error querying default org_name: {e}")
    finally:
        conn.close()
    
    logger.warning("No organizations found in database. Defaulting to 'Unknown'.")
    return "Unknown"

@mcp.tool()
def list_inventory(org_name: str = None) -> str:
    """Retrieve all inventory items with their current stock levels, status, price, and category.
    
    Args:
        org_name: Optional organization name. Defaults to the first user found in the DB.
    """
    resolved_org = resolve_org_name(org_name)
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('''
            SELECT sku, name, category, price, stock, reorder_point, supplier, status 
            FROM inventory 
            WHERE org_name = ?
            ORDER BY status, name
        ''', (resolved_org,))
        rows = cursor.fetchall()
        if not rows:
            return f"No inventory items found for organization '{resolved_org}'."
        
        # Build markdown table
        markdown = f"## Inventory Catalog for **{resolved_org}**\n\n"
        markdown += "| SKU | Name | Category | Price | Stock | Reorder Point | Status | Supplier |\n"
        markdown += "| --- | --- | --- | --- | --- | --- | --- | --- |\n"
        for row in rows:
            price_val = f"{row['price']:.2f}"
            markdown += f"| `{row['sku']}` | {row['name']} | {row['category']} | ৳{price_val} | {row['stock']} | {row['reorder_point']} | {row['status']} | {row['supplier'] or 'N/A'} |\n"
        return markdown
    except Exception as e:
        logger.error(f"list_inventory failed: {e}")
        return f"Error retrieving inventory: {str(e)}"
    finally:
        conn.close()

@mcp.tool()
def get_product_detail(sku: str, org_name: str = None) -> str:
    """Get complete profile details and current forecasts for a specific product SKU.
    
    Args:
        sku: The product SKU to query.
        org_name: Optional organization name.
    """
    resolved_org = resolve_org_name(org_name)
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        # Fetch inventory details
        cursor.execute('''
            SELECT sku, name, category, price, stock, reorder_point, supplier_lead_days, supplier, status, forecasted_demand, units_sold, last_updated
            FROM inventory 
            WHERE org_name = ? AND sku = ?
        ''', (resolved_org, sku))
        item = cursor.fetchone()
        if not item:
            return f"Product with SKU '{sku}' not found for organization '{resolved_org}'."
        
        # Fetch forecast steps
        cursor.execute('''
            SELECT forecast_date, predicted_sales, lower_bound, upper_bound
            FROM forecasts
            WHERE org_name = ? AND sku = ?
            ORDER BY forecast_date
        ''', (resolved_org, sku))
        forecast_rows = cursor.fetchall()
        
        # Build response
        md = f"## Product Details: **{item['name']}** (`{item['sku']}`)\n\n"
        md += f"- **Category:** {item['category']}\n"
        md += f"- **Price:** ৳{item['price']:.2f}\n"
        md += f"- **Current Stock:** {item['stock']} units ({item['status']})\n"
        md += f"- **Reorder Point:** {item['reorder_point']} units\n"
        md += f"- **Supplier Lead Time:** {item['supplier_lead_days']} days\n"
        md += f"- **Supplier:** {item['supplier'] or 'Not specified'}\n"
        md += f"- **Units Sold (Recent Window):** {item['units_sold']}\n"
        md += f"- **Forecasted Demand (Next Period):** {item['forecasted_demand']} units\n"
        md += f"- **Last Synchronized:** {item['last_updated']}\n\n"
        
        if forecast_rows:
            md += "### 📈 AI Forecast Steps\n\n"
            md += "| Date | Predicted Sales | Lower Bound | Upper Bound |\n"
            md += "| --- | --- | --- | --- |\n"
            for row in forecast_rows:
                md += f"| {row['forecast_date']} | {row['predicted_sales']:.1f} | {row['lower_bound']:.1f} | {row['upper_bound']:.1f} |\n"
        else:
            md += "*No detailed forecast steps available. Run demand forecasting to populate.*"
            
        return md
    except Exception as e:
        logger.error(f"get_product_detail failed: {e}")
        return f"Error retrieving product details: {str(e)}"
    finally:
        conn.close()

@mcp.tool()
def update_stock_level(sku: str, stock: int, org_name: str = None) -> str:
    """Update the physical stock count of a specific SKU in SQLite.
    
    This automatically updates the stock status (In Stock, Low Stock, Warning, Out of Stock) 
    based on the configured reorder point.
    
    Args:
        sku: The product SKU to update.
        stock: The new physical stock count (must be non-negative).
        org_name: Optional organization name.
    """
    if stock < 0:
        return "Error: Stock count cannot be negative."
        
    resolved_org = resolve_org_name(org_name)
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        # Get reorder point first to recalculate status
        cursor.execute('SELECT reorder_point, name FROM inventory WHERE org_name = ? AND sku = ?', (resolved_org, sku))
        row = cursor.fetchone()
        if not row:
            return f"Product with SKU '{sku}' not found for organization '{resolved_org}'."
            
        reorder_point = row['reorder_point']
        name = row['name']
        
        # Calculate new status using the exact formula from analytics.py
        from src.api.routers.analytics import _compute_product_status
        new_status = _compute_product_status(stock, reorder_point)
        
        cursor.execute('''
            UPDATE inventory 
            SET stock = ?, status = ?, last_updated = CURRENT_TIMESTAMP
            WHERE org_name = ? AND sku = ?
        ''', (stock, new_status, resolved_org, sku))
        conn.commit()
        
        return f"Successfully updated stock for **{name}** (`{sku}`). New Stock: **{stock}** units. Status: **{new_status}**."
    except Exception as e:
        logger.error(f"update_stock_level failed: {e}")
        return f"Error updating stock: {str(e)}"
    finally:
        conn.close()

@mcp.tool()
def get_stock_predictions(sku: str, org_name: str = None) -> str:
    """Retrieve Prophet ML demand forecasts (dates, predicted sales, lower/upper bounds) for a specific SKU.
    
    Args:
        sku: The product SKU.
        org_name: Optional organization name.
    """
    resolved_org = resolve_org_name(org_name)
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('''
            SELECT name, status, stock, reorder_point FROM inventory WHERE org_name = ? AND sku = ?
        ''', (resolved_org, sku))
        item = cursor.fetchone()
        if not item:
            return f"Product with SKU '{sku}' not found for organization '{resolved_org}'."
            
        cursor.execute('''
            SELECT forecast_date, predicted_sales, lower_bound, upper_bound
            FROM forecasts
            WHERE org_name = ? AND sku = ?
            ORDER BY forecast_date
        ''', (resolved_org, sku))
        rows = cursor.fetchall()
        
        if not rows:
            return f"No predictions found for product **{item['name']}** (`{sku}`). You may need to run demand forecasting first."
            
        total_forecasted = sum(r['predicted_sales'] for r in rows)
        
        md = f"### 🔮 Demand Predictions: **{item['name']}** (`{sku}`)\n"
        md += f"- **Current Physical Stock:** {item['stock']} units ({item['status']})\n"
        md += f"- **Forecasted Cumulative Demand (Next Period):** {total_forecasted:.1f} units\n\n"
        
        md += "| Date | Predicted Sales | Lower Bound (95%) | Upper Bound (95%) |\n"
        md += "| --- | --- | --- | --- |\n"
        for r in rows:
            md += f"| {r['forecast_date']} | {r['predicted_sales']:.1f} | {r['lower_bound']:.1f} | {r['upper_bound']:.1f} |\n"
            
        return md
    except Exception as e:
        logger.error(f"get_stock_predictions failed: {e}")
        return f"Error retrieving predictions: {str(e)}"
    finally:
        conn.close()

@mcp.tool()
def run_demand_forecasting(strategy: str = "balanced", region: str = "BD", org_name: str = None) -> str:
    """Trigger the local Prophet machine learning pipeline to retrain and update all SKU forecasts.
    
    This loads the historical transaction CSV from disk, synchronizes it with active inventory 
    edits/deletions, fits time-series Prophet models on each product (incorporating holiday/promo calendars),
    and updates SQLite forecasts and statuses.
    
    Args:
        strategy: Conservative, Balanced, or Aggressive safety stock strategy. Defaults to "balanced".
        region: Region code for holidays (e.g., "BD", "US"). Defaults to "BD".
        org_name: Optional organization name.
    """
    resolved_org = resolve_org_name(org_name)
    strategy = strategy.lower().strip()
    if strategy not in ["conservative", "balanced", "aggressive"]:
        return "Error: Strategy must be one of: conservative, balanced, aggressive."
        
    csv_save_path = project_root / "data" / "raw" / f"{resolved_org}_uploaded.csv"
    if not csv_save_path.exists():
        return f"Error: No previously uploaded sales history CSV found for '{resolved_org}'. Please upload a CSV via the dashboard first to establish baseline historical transactions."
        
    try:
        import holidays as py_holidays
        from src.api.routers.analytics import _forecast_for_product, _compute_product_status
        
        df = pd.read_csv(csv_save_path)
        
        # 1. Sync from SQLite inventory to handle manual edits/deletions
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute('''
            SELECT sku, name, category, price, stock, reorder_point, supplier_lead_days 
            FROM inventory 
            WHERE org_name = ?
        ''', (resolved_org,))
        db_items = cursor.fetchall()
        conn.close()
        
        df.columns = [c.strip().lower().replace(' ', '_') for c in df.columns]
        db_items_dict = {str(item["sku"]): item for item in db_items}
        active_skus = set(db_items_dict.keys())
        
        if active_skus:
            df = df[df['product_id'].astype(str).isin(active_skus)].copy()
        else:
            df = df.iloc[0:0].copy()
            
        for sku, item in db_items_dict.items():
            mask = df['product_id'].astype(str) == sku
            if mask.any():
                df.loc[mask, 'product_name'] = item['name']
                df.loc[mask, 'category'] = item['category']
                df.loc[mask, 'unit_price'] = float(item['price'] or 0.0)
                df.loc[mask, 'reorder_point'] = int(item['reorder_point'] or 50)
                df.loc[mask, 'supplier_lead_days'] = int(item['supplier_lead_days'] or 7)
                
        df.to_csv(csv_save_path, index=False)
        
        if len(df) == 0:
            return "Forecasting completed: No products in active inventory to forecast."
            
        # 2. Setup date processing
        df['date'] = pd.to_datetime(df['date'])
        date_min = df['date'].min()
        date_max = df['date'].max()
        data_span_days = (date_max - date_min).days + 1
        
        if data_span_days < 30:
            return f"Error: CSV only covers {data_span_days} days of history. Minimum required is 30 days."
            
        if data_span_days >= 360:
            forecast_horizon = 30
        elif data_span_days >= 180:
            forecast_horizon = 14
        else:
            forecast_horizon = 7
            
        # 3. Retrieve holiday mappings
        csv_end_date = date_max.date()
        ref_year = csv_end_date.year
        years_to_fetch = [ref_year, ref_year + 1]
        
        local_holidays = {}
        try:
            h_obj = py_holidays.country_holidays(region, years=years_to_fetch)
        except Exception:
            try:
                h_obj = py_holidays.BD(years=years_to_fetch)
            except Exception:
                h_obj = {}
                
        for y in years_to_fetch:
            for d, n in h_obj.items():
                if d.year == y:
                    local_holidays[d] = n
                    
        # 4. Fit Prophet models per-product
        conn = get_db_connection()
        cursor = conn.cursor()
        
        products = df.groupby('product_id')
        updated_count = 0
        
        for sku, product_df in products:
            latest = product_df.sort_values('date').iloc[-1]
            product_name = str(latest.get('product_name', sku))
            category = str(latest.get('category', 'General'))
            unit_price = float(latest.get('unit_price', 0.0))
            stock = int(latest.get('stock_on_hand', 0))
            reorder_point = int(latest.get('reorder_point', 50))
            lead_days = int(latest.get('supplier_lead_days', 7))
            
            try:
                result = _forecast_for_product(
                    product_df.copy(),
                    local_holidays,
                    strategy,
                    forecast_horizon,
                    region,
                    date_min=date_min,
                    date_max=date_max
                )
            except Exception as ml_err:
                logger.error(f"ML fitting failed for SKU {sku}: {ml_err}")
                continue
                
            next_week = result["next_week_sales"]
            status = _compute_product_status(stock, reorder_point)
            
            # Group by date, sum sales_qty, last 14 days
            prod_daily = product_df.groupby('date')['sales_qty'].sum().sort_index()
            history_days_count = min(14, len(prod_daily))
            units_sold = int(prod_daily.tail(history_days_count).sum())
            
            # Upsert into inventory table
            cursor.execute('''
                INSERT INTO inventory
                    (org_name, sku, name, category, price, stock, reorder_point,
                     supplier_lead_days, supplier, status, forecasted_demand, units_sold, last_updated)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(org_name, sku) DO UPDATE SET
                    name=excluded.name, category=excluded.category,
                    price=excluded.price, stock=excluded.stock,
                    reorder_point=excluded.reorder_point,
                    supplier_lead_days=excluded.supplier_lead_days,
                    status=excluded.status,
                    forecasted_demand=excluded.forecasted_demand,
                    units_sold=excluded.units_sold,
                    last_updated=excluded.last_updated
            ''', (resolved_org, sku, product_name, category, unit_price, stock,
                  reorder_point, lead_days, '', status, next_week, units_sold))
                  
            # Store per-product forecast rows
            for row in result["forecast"]:
                cursor.execute('''
                    INSERT OR REPLACE INTO forecasts
                        (org_name, sku, forecast_date, predicted_sales, lower_bound, upper_bound)
                    VALUES (?, ?, ?, ?, ?, ?)
                ''', (resolved_org, sku, row['date'], row['predicted_sales'],
                      row['lower_bound'], row['upper_bound']))
                      
            updated_count += 1
            
        conn.commit()
        conn.close()
        
        return f"Demand forecasting pipeline successfully run for **{resolved_org}**.\n- Strategy: **{strategy}**\n- Forecast Horizon: **{forecast_horizon} days**\n- Products successfully updated: **{updated_count}** SKUs."
        
    except Exception as e:
        logger.error(f"run_demand_forecasting failed: {e}")
        return f"Error executing forecasting pipeline: {str(e)}"

if __name__ == "__main__":
    mcp.run()
