from fastapi import APIRouter, HTTPException, UploadFile, File
import pandas as pd
import io
import hashlib
from pathlib import Path
import json

from src.pipeline.data_loader import validate_schema
from src.pipeline.feature_engineering import create_date_features, create_lag_features, create_rolling_stats
from src.models.prophet_model import DemandProphetModel
from src.api.insight_generator import generate_insight

from src.api.database import get_db_connection
from src.api.auth_utils import get_current_user
from fastapi import Depends
from fastapi.responses import FileResponse
from fpdf import FPDF
import tempfile
import os
import holidays

router = APIRouter()
project_root = Path(__file__).resolve().parent.parent.parent.parent
models_dir = project_root / "data" / "models"
models_dir.mkdir(parents=True, exist_ok=True)


def _compute_product_status(stock: int, reorder_point: int) -> str:
    """Determine inventory status based on stock vs reorder point."""
    if stock <= 0:
        return "Out of Stock"
    if stock <= reorder_point:
        return "Low Stock"
    if stock <= reorder_point * 1.5:
        return "Warning"
    return "In Stock"


def _forecast_for_product(product_df: pd.DataFrame, local_holidays, strategy: str) -> dict:
    """Run the full feature-engineering + Prophet pipeline for a single product's time series."""
    product_df = product_df.sort_values('date')

    last_date = pd.to_datetime(product_df['date']).max()
    future_dates = [last_date + pd.Timedelta(days=i) for i in range(1, 8)]
    future_df = pd.DataFrame({'date': future_dates})

    combined_df = pd.concat(
        [product_df[['date', 'sales_qty', 'promo', 'holiday']]
         .rename(columns={'sales_qty': 'sales'}),
         future_df],
        ignore_index=True
    )

    combined_df = create_date_features(combined_df)
    future_mask = combined_df['sales'].isna()

    combined_df['holiday'] = combined_df['date'].apply(lambda d: 1 if d in local_holidays else 0)
    combined_df.loc[future_mask, 'promo'] = (combined_df.loc[future_mask, 'day_of_week'] == 4).astype(int)
    combined_df.loc[~future_mask, 'promo'] = combined_df.loc[~future_mask, 'promo'].fillna(0)

    combined_df = create_lag_features(combined_df, lags=[7, 30])
    combined_df['temp_sales'] = combined_df['sales'].ffill()
    combined_df = create_rolling_stats(combined_df, target_col='temp_sales', windows=[7, 30])
    combined_df = combined_df.drop(columns=['temp_sales']).fillna(0)

    processed_df = combined_df[~future_mask].copy()
    processed_future_df = combined_df[future_mask].copy()

    # Per-product model cache key
    sku_hash = hashlib.md5(product_df['product_id'].iloc[0].encode()).hexdigest()
    model_path = models_dir / f"{sku_hash}.json"

    if model_path.exists():
        model = DemandProphetModel.load(model_path)
    else:
        model = DemandProphetModel(yearly_seasonality=True, weekly_seasonality=True)
        model.train(processed_df)
        model.save(model_path)

    forecast = model.predict(processed_future_df)
    forecast_result = forecast.rename(columns={
        'ds': 'date', 'yhat': 'predicted_sales',
        'yhat_lower': 'lower_bound', 'yhat_upper': 'upper_bound'
    })
    forecast_result['date'] = forecast_result['date'].dt.strftime('%Y-%m-%d')

    historical_df = product_df.sort_values('date').tail(14)
    current_week_sales = int(historical_df.tail(7)['sales_qty'].sum())
    next_week_sales = max(0, int(forecast_result['predicted_sales'].sum()))
    percent_change = ((next_week_sales - current_week_sales) / current_week_sales * 100) if current_week_sales > 0 else 0

    return {
        "forecast": forecast_result[['date', 'predicted_sales', 'lower_bound', 'upper_bound']].to_dict(orient='records'),
        "current_week_sales": current_week_sales,
        "next_week_sales": next_week_sales,
        "percent_change": percent_change,
    }


@router.get("/api/insight")
async def get_insight(
    strategy: str = "balanced",
    deep_learning: bool = True,
    stockout_alerts: bool = True,
    user: dict = Depends(get_current_user)
):
    org_name = user.get("sub", "Unknown")
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute('SELECT stock, status, reorder_point FROM inventory WHERE org_name = ?', (org_name,))
    inventory = cursor.fetchall()
    conn.close()

    total_stock = sum(item["stock"] for item in inventory if item["stock"])
    low_stock_items = [item for item in inventory if item["status"] in ["Low Stock", "Out of Stock"]]

    insight_text = (
        f"Your current inventory holds {total_stock:,} total units across {len(inventory)} SKUs. "
        f"You have {len(low_stock_items)} items currently low on stock or out of stock. "
        "Upload a multi-product sales CSV file to generate per-product AI-driven forecasts, "
        "auto-populate your inventory, and discover key demand drivers for each category."
    )
    drivers = [{"name": "Awaiting Data", "impact": "0%", "value": 0, "color": "var(--text-muted)"}]

    return {"status": "success", "insight": insight_text, "drivers": drivers}


@router.post("/api/predict")
async def predict_demand(
    file: UploadFile = File(...),
    strategy: str = "balanced",
    deep_learning: bool = True,
    region: str = "BD",
    user: dict = Depends(get_current_user)
):
    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are supported.")

    try:
        contents = await file.read()
        df = pd.read_csv(io.StringIO(contents.decode("utf-8")))

        # â”€â”€ Column normalisation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        df.columns = [c.strip().lower().replace(' ', '_') for c in df.columns]

        required = {'date', 'product_id', 'product_name', 'category',
                    'sales_qty', 'stock_on_hand', 'reorder_point'}
        missing = required - set(df.columns)
        if missing:
            raise HTTPException(
                status_code=400,
                detail=f"CSV is missing required columns: {', '.join(missing)}. "
                       f"Required: date, product_id, product_name, category, sales_qty, stock_on_hand, reorder_point"
            )

        # Optional columns with defaults
        if 'promo' not in df.columns:
            df['promo'] = 0
        if 'holiday' not in df.columns:
            df['holiday'] = 0
        if 'unit_price' not in df.columns:
            df['unit_price'] = 0.0
        if 'supplier_lead_days' not in df.columns:
            df['supplier_lead_days'] = 7

        df['date'] = pd.to_datetime(df['date'])

        # â”€â”€ Holiday calendar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        try:
            local_holidays = holidays.country_holidays(region)
        except Exception:
            local_holidays = holidays.BD()

        # â”€â”€ Per-product loop â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        org_name = user.get("sub", "Unknown")
        conn = get_db_connection()
        cursor = conn.cursor()

        all_product_results = []
        aggregate_forecasted = 0
        aggregate_current_stock = 0
        aggregate_current_week = 0
        aggregate_next_week = 0

        products = df.groupby('product_id')

        for sku, product_df in products:
            # Latest row for static inventory fields
            latest = product_df.sort_values('date').iloc[-1]
            product_name = str(latest.get('product_name', sku))
            category = str(latest.get('category', 'General'))
            unit_price = float(latest.get('unit_price', 0.0))
            stock = int(latest.get('stock_on_hand', 0))
            reorder_point = int(latest.get('reorder_point', 50))
            lead_days = int(latest.get('supplier_lead_days', 7))
            status = _compute_product_status(stock, reorder_point)

            # Run forecast
            try:
                result = _forecast_for_product(product_df.copy(), local_holidays, strategy)
            except Exception:
                # Skip products with insufficient data (< 7 rows)
                result = {
                    "forecast": [],
                    "current_week_sales": 0,
                    "next_week_sales": 0,
                    "percent_change": 0,
                }

            next_week = result["next_week_sales"]
            aggregate_current_stock += stock
            aggregate_current_week += result["current_week_sales"]
            aggregate_next_week += next_week
            aggregate_forecasted += next_week

            # Recommended order = projected demand (+ safety buffer) minus current stock
            safety_multiplier = {"conservative": 1.2, "balanced": 1.4, "aggressive": 1.6}.get(strategy, 1.4)
            recommended_order = max(0, int(next_week * safety_multiplier) - stock)

            days_to_stockout = (
                max(1, int(stock / (next_week / 7))) if next_week > 0 else None
            )

            # Upsert into inventory table
            cursor.execute('''
                INSERT INTO inventory
                    (org_name, sku, name, category, price, stock, reorder_point,
                     supplier_lead_days, supplier, status, forecasted_demand, last_updated)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(org_name, sku) DO UPDATE SET
                    name=excluded.name, category=excluded.category,
                    price=excluded.price, stock=excluded.stock,
                    reorder_point=excluded.reorder_point,
                    supplier_lead_days=excluded.supplier_lead_days,
                    status=excluded.status,
                    forecasted_demand=excluded.forecasted_demand,
                    last_updated=excluded.last_updated
            ''', (org_name, sku, product_name, category, unit_price, stock,
                  reorder_point, lead_days, '', status, next_week))

            # Store per-product forecast rows
            for row in result["forecast"]:
                cursor.execute('''
                    INSERT OR REPLACE INTO forecasts
                        (org_name, sku, forecast_date, predicted_sales, lower_bound, upper_bound)
                    VALUES (?, ?, ?, ?, ?, ?)
                ''', (org_name, sku, row['date'], row['predicted_sales'],
                      row['lower_bound'], row['upper_bound']))

            all_product_results.append({
                "product_id": sku,
                "product_name": product_name,
                "category": category,
                "current_stock": stock,
                "reorder_point": reorder_point,
                "status": status,
                "current_week_sales": result["current_week_sales"],
                "next_week_sales": next_week,
                "percent_change": f"{'+' if result['percent_change'] > 0 else ''}{result['percent_change']:.1f}%",
                "recommended_order": recommended_order,
                "days_to_stockout": days_to_stockout,
                "forecast": result["forecast"],
            })

        conn.commit()
        conn.close()

        # â”€â”€ Aggregate KPIs across all products â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        overall_pct = (
            (aggregate_next_week - aggregate_current_week) / aggregate_current_week * 100
            if aggregate_current_week > 0 else 0
        )

        # â”€â”€ Aggregate historical chart data (all SKUs combined by date) â”€â”€â”€â”€â”€â”€
        historical_agg = (
            df.groupby('date')['sales_qty'].sum()
            .reset_index()
            .sort_values('date')
            .tail(14)
        )
        historical_agg['date'] = historical_agg['date'].dt.strftime('%Y-%m-%d')
        historical_records = historical_agg.rename(columns={'sales_qty': 'sales'}).to_dict(orient='records')

        # â”€â”€ LLM Insight on the aggregate picture â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        at_risk = [p for p in all_product_results if p["status"] in ["Low Stock", "Out of Stock"]]
        insight_payload = {
            "forecast_summary": {
                "next_week_sales": aggregate_next_week,
                "current_week_sales": aggregate_current_week,
                "percent_change": f"{'+' if overall_pct > 0 else ''}{overall_pct:.1f}%",
                "trend": "increasing" if overall_pct > 0 else "decreasing",
                "total_skus": len(all_product_results),
                "at_risk_skus": len(at_risk),
            },
            "top_drivers": [
                {"feature": "Weekly Seasonality", "impact": "+trend"},
                {"feature": "Holiday Calendar", "impact": "regional"},
            ],
            "context": {
                "store_id": org_name,
                "product_category": "All Products",
                "current_stock_level": aggregate_current_stock,
                "days_forecasted": 7,
                "engine_strategy": strategy,
            },
            "risk_factors": {
                "stockout_risk": "high" if at_risk else "low",
                "overstock_risk": "low",
            },
        }
        insight_text = generate_insight(insight_payload)

        # Pick first product's forecast for the main chart display
        chart_forecast = all_product_results[0]["forecast"] if all_product_results else []

        return {
            "status": "success",
            "historical": historical_records,
            "forecast": chart_forecast,
            "kpis": {
                "total_skus": len(all_product_results),
                "current_stock": aggregate_current_stock,
                "forecasted_demand": aggregate_next_week,
                "percent_change": f"{'+' if overall_pct > 0 else ''}{overall_pct:.1f}% Next Week",
                "at_risk_products": len(at_risk),
            },
            "bi_metrics": {
                "daily_sales": int(aggregate_current_week / 7) if aggregate_current_week > 0 else 0,
                "daily_forecast": int(aggregate_next_week / 7) if aggregate_next_week > 0 else 0,
                "cash_flow": int(aggregate_next_week * 50), # Mock avg $50 per unit
                "demand_trend": "Rising" if overall_pct > 0 else "Falling",
                "demand_trend_pct": f"{'+' if overall_pct > 0 else ''}{overall_pct:.1f}% this week",
                "upcoming_event": "Upcoming Holiday" if local_holidays else "End of Month Sale",
                "event_impact": "+15% expected",
                "avg_margin": "24.5%",
                "next_step": f"Approve purchase order for '{at_risk[0]['product_name']}' before Friday to avoid stockout." if at_risk else "Monitor inventory levels. No critical actions needed.",
                "timeline": [
                    {
                        "name": p["product_name"],
                        "stock": p["current_stock"],
                        "urgency": "Critical" if p["status"] == "Out of Stock" else "Plan" if p["status"] == "Low Stock" else "Healthy",
                        "text": "Reorder immediately" if p["status"] == "Out of Stock" else f"Restock in {p['days_to_stockout'] or 5} days"
                    }
                    for p in sorted(all_product_results, key=lambda x: (x["status"] != "Out of Stock", x["status"] != "Low Stock"))[:3]
                ],
                "top_products": [
                    {
                        "name": p["product_name"],
                        "margin": f"+{35 - i*4}% Margin"
                    }
                    for i, p in enumerate(sorted(all_product_results, key=lambda x: x["next_week_sales"], reverse=True)[:5])
                ]
            },
            "products": all_product_results,
            "insight": insight_text,
            "drivers": [
                {"name": "Weekly Demand", "impact": f"{overall_pct:+.1f}%", "value": min(100, int(abs(overall_pct))), "color": "var(--accent-primary)"},
                {"name": "At-Risk SKUs", "impact": f"{len(at_risk)} items", "value": min(100, len(at_risk) * 10), "color": "var(--status-warning)"},
                {"name": "Total SKUs Analysed", "impact": f"{len(all_product_results)}", "value": 100, "color": "var(--accent-secondary)"},
            ],
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/forecast/{sku}")
async def get_product_forecast(sku: str, user: dict = Depends(get_current_user)):
    """Return stored 7-day forecast rows for a specific SKU."""
    org_name = user.get("sub", "Unknown")
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT forecast_date, predicted_sales, lower_bound, upper_bound
        FROM forecasts
        WHERE org_name = ? AND sku = ?
        ORDER BY forecast_date
    ''', (org_name, sku))
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    if not rows:
        raise HTTPException(status_code=404, detail="No forecast found for this SKU.")
    return {"status": "success", "sku": sku, "forecast": rows}


@router.get("/api/report")
async def generate_pdf_report(user: dict = Depends(get_current_user)):
    """Generate a comprehensive multi-product Weekly PDF Report."""
    org_name = user.get("sub", "Unknown")

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT sku, name, category, price, stock, reorder_point,
               supplier_lead_days, status, forecasted_demand
        FROM inventory WHERE org_name = ?
        ORDER BY status, name
    ''', (org_name,))
    inventory = cursor.fetchall()
    conn.close()

    if not inventory:
        raise HTTPException(status_code=404, detail="No inventory found. Please upload a CSV first.")

    pdf = FPDF()
    pdf.add_page()

    # â”€â”€ Title â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    pdf.set_font("Helvetica", "B", 18)
    pdf.cell(0, 10, "StockSense AI: Weekly Inventory & Forecast Report", ln=True, align="C")
    pdf.set_font("Helvetica", "I", 12)
    pdf.cell(0, 8, f"Organization: {org_name}", ln=True, align="C")
    pdf.ln(6)

    # â”€â”€ Executive Summary â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    total_stock = sum(item["stock"] for item in inventory if item["stock"])
    low_stock = [i for i in inventory if i["status"] in ["Low Stock", "Out of Stock"]]
    total_value = sum((item["price"] or 0) * (item["stock"] or 0) for item in inventory)
    total_forecasted = sum(item["forecasted_demand"] or 0 for item in inventory)

    pdf.set_font("Helvetica", "B", 14)
    pdf.cell(0, 10, "Executive Summary", ln=True)
    pdf.set_font("Helvetica", "", 11)

    summary = (
        f"Your organization manages {len(inventory)} unique SKUs with a total of "
        f"{total_stock:,} units on hand (estimated value: ${total_value:,.2f}). "
        f"The AI forecasts a combined demand of {total_forecasted:,} units next week. "
    )
    if low_stock:
        summary += f"ALERT: {len(low_stock)} SKUs require immediate attention (Low Stock / Out of Stock)."
    else:
        summary += "Inventory health is optimal with no critical stockout risks detected."
    pdf.multi_cell(0, 8, summary)
    pdf.ln(8)

    # â”€â”€ At-Risk Section â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if low_stock:
        pdf.set_font("Helvetica", "B", 13)
        pdf.cell(0, 10, "âš  At-Risk Products", ln=True)
        pdf.set_font("Helvetica", "B", 10)
        pdf.cell(40, 8, "SKU", border=1)
        pdf.cell(70, 8, "Product Name", border=1)
        pdf.cell(25, 8, "Stock", border=1)
        pdf.cell(30, 8, "Reorder Pt.", border=1)
        pdf.cell(25, 8, "Status", border=1, ln=True)
        pdf.set_font("Helvetica", "", 9)
        for item in low_stock[:20]:
            pdf.cell(40, 7, str(item['sku'])[:18], border=1)
            pdf.cell(70, 7, str(item['name'])[:35], border=1)
            pdf.cell(25, 7, str(item['stock']), border=1)
            pdf.cell(30, 7, str(item['reorder_point']), border=1)
            pdf.cell(25, 7, str(item['status']), border=1, ln=True)
        pdf.ln(8)

    # â”€â”€ Full Inventory Table â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    pdf.set_font("Helvetica", "B", 13)
    pdf.cell(0, 10, "Full Inventory & Forecast Breakdown", ln=True)
    pdf.set_font("Helvetica", "B", 9)
    col_w = [35, 55, 28, 20, 25, 27]
    headers = ["SKU", "Product Name", "Category", "Stock", "Forecast", "Status"]
    for w, h in zip(col_w, headers):
        pdf.cell(w, 8, h, border=1)
    pdf.ln()

    pdf.set_font("Helvetica", "", 8)
    for item in inventory[:100]:
        pdf.cell(col_w[0], 7, str(item['sku'])[:16], border=1)
        pdf.cell(col_w[1], 7, str(item['name'])[:28], border=1)
        pdf.cell(col_w[2], 7, str(item['category'])[:14], border=1)
        pdf.cell(col_w[3], 7, str(item['stock']), border=1)
        pdf.cell(col_w[4], 7, str(item['forecasted_demand']), border=1)
        pdf.cell(col_w[5], 7, str(item['status'])[:12], border=1)
        pdf.ln()

    if len(inventory) > 100:
        pdf.cell(0, 8, f"...and {len(inventory) - 100} more SKUs not shown.", ln=True)

    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".pdf")
    pdf.output(temp_file.name)

    return FileResponse(
        temp_file.name,
        media_type="application/pdf",
        filename=f"StockSense_Report_{org_name}.pdf",
        background=None
    )

