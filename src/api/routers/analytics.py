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

router = APIRouter()
project_root = Path(__file__).resolve().parent.parent.parent.parent
models_dir = project_root / "data" / "models"
models_dir.mkdir(parents=True, exist_ok=True)


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
    
    cursor.execute('SELECT stock, status FROM inventory WHERE org_name = ?', (org_name,))
    inventory = cursor.fetchall()
    conn.close()
            
    total_stock = sum(item["stock"] for item in inventory if item["stock"])
    low_stock_items = [item for item in inventory if item["status"] in ["Low Stock", "Out of Stock"]]
    
    # Generate realistic default insight
    insight_text = f"Your current inventory holds {total_stock} total units across {len(inventory)} products. You have {len(low_stock_items)} items currently low on stock or out of stock. Upload a sales history CSV file to generate detailed AI-driven forecasts, predict future demand, and discover key drivers for your business."
    
    # Return placeholder driver until a forecast is run
    drivers = [
        { "name": "Awaiting Data", "impact": "0%", "value": 0, "color": "var(--text-muted)" }
    ]
    
    return {
        "status": "success",
        "insight": insight_text,
        "drivers": drivers
    }

@router.post("/api/predict")
async def predict_demand(
    file: UploadFile = File(...),
    strategy: str = "balanced",
    deep_learning: bool = True,
    user: dict = Depends(get_current_user)
):
    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are supported.")
    
    try:
        contents = await file.read()
        file_hash = hashlib.md5(contents).hexdigest()
        
        df = pd.read_csv(io.StringIO(contents.decode("utf-8")))
        
        # Validate input schema
        validate_schema(df)
        
        # Get the last 14 days of historical data to draw on the chart
        historical_df = df.sort_values('date').tail(14)
        historical_records = historical_df[['date', 'sales']].to_dict(orient="records")
        
        # Predict the next 7 days based on the last date in the uploaded file
        last_date = pd.to_datetime(df['date']).max()
        future_dates = [last_date + pd.Timedelta(days=i) for i in range(1, 8)]
        future_df = pd.DataFrame({'date': future_dates})
        
        # Combine historical and future to compute features seamlessly
        combined_df = pd.concat([df[['date', 'sales', 'promo', 'holiday']], future_df], ignore_index=True)
        
        # 1. Apply Date Features
        combined_df = create_date_features(combined_df)
        
        # 2. Simulate future promotions and holidays dynamically
        # Let's say weekends are holidays and Fridays are promo days
        future_mask = combined_df['sales'].isna()
        combined_df.loc[future_mask, 'holiday'] = combined_df.loc[future_mask, 'is_weekend']
        combined_df.loc[future_mask, 'promo'] = (combined_df.loc[future_mask, 'day_of_week'] == 4).astype(int)
        
        # 3. Apply Lag Features (Requires past data, which is now preceding the future dates)
        combined_df = create_lag_features(combined_df, lags=[7, 30])
        
        # 4. Apply Rolling Stats (Use forward-filled sales to calculate rolling mean across the missing future gap)
        combined_df['temp_sales'] = combined_df['sales'].ffill()
        combined_df = create_rolling_stats(combined_df, target_col='temp_sales', windows=[7, 30])
        combined_df = combined_df.drop(columns=['temp_sales']).fillna(0)
        
        # Extract processed historical and future data
        processed_df = combined_df[~future_mask].copy()
        processed_future_df = combined_df[future_mask].copy()
        
        # Train or Load Model from Disk Cache
        model_path = models_dir / f"{file_hash}.json"
        if model_path.exists():
            model = DemandProphetModel.load(model_path)
        else:
            model = DemandProphetModel(yearly_seasonality=True, weekly_seasonality=True)
            model.train(processed_df)
            model.save(model_path)
        
        # Predict
        forecast = model.predict(processed_future_df)
        
        # Convert output to list of dicts
        forecast_result = forecast.rename(columns={'ds': 'date', 'yhat': 'predicted_sales', 'yhat_lower': 'lower_bound', 'yhat_upper': 'upper_bound'})
        forecast_result['date'] = forecast_result['date'].dt.strftime('%Y-%m-%d')
        
        # Calculate dynamic KPIs
        org_name = user.get("sub", "Unknown")
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute('SELECT stock FROM inventory WHERE org_name = ?', (org_name,))
        rows = cursor.fetchall()
        conn.close()
        current_stock = sum(item["stock"] for item in rows if item["stock"])
                
        current_week_sales = int(historical_df.tail(7)['sales'].sum())
        next_week_sales = int(forecast_result['predicted_sales'].sum())
        percent_change = ((next_week_sales - current_week_sales) / current_week_sales) * 100 if current_week_sales > 0 else 0
        recommended_order = max(0, int(next_week_sales * 1.4) - current_stock)
        
        # Dynamically extract top drivers from Prophet's components
        driver_impacts = []
        base_yhat = forecast['yhat'].mean() if 'yhat' in forecast else 1
        
        potential_components = ['trend', 'weekly', 'yearly', 'holiday', 'promo', 'sales_lag_7', 'sales_lag_30', 'sales_rolling_mean_7', 'sales_rolling_mean_30']
        for col in potential_components:
            if col in forecast.columns:
                impact_value = forecast[col].abs().mean()
                if impact_value > 0.01 * base_yhat: # Include if >1% impact
                    driver_impacts.append({"feature": col, "value": impact_value})
                    
        driver_impacts = sorted(driver_impacts, key=lambda x: x["value"], reverse=True)[:3]
        
        top_drivers = []
        colors = ["var(--accent-primary)", "var(--accent-secondary)", "var(--status-success)"]
        for i, driver in enumerate(driver_impacts):
            pct = (driver["value"] / base_yhat * 100) if base_yhat > 0 else 0
            formatted_name = driver["feature"].replace('_', ' ').title()
            top_drivers.append({
                "name": formatted_name,
                "impact": f"+{pct:.1f}%",
                "value": min(100, int(pct * 2)), 
                "color": colors[i % len(colors)]
            })
            
        if not top_drivers:
            top_drivers = [{"name": "Baseline Demand", "impact": "+100%", "value": 100, "color": "var(--accent-primary)"}]
        
        # Build payload for LLM
        insight_payload = {
            "forecast_summary": {
                "next_week_sales": next_week_sales,
                "current_week_sales": current_week_sales,
                "percent_change": f"{'+' if percent_change > 0 else ''}{percent_change:.1f}%",
                "trend": "increasing" if percent_change > 0 else "decreasing",
                "confidence_interval": [int(forecast_result['lower_bound'].sum()), int(forecast_result['upper_bound'].sum())]
            },
            "top_drivers": [{"feature": d["name"], "impact": d["impact"]} for d in top_drivers],
            "context": {
                "store_id": org_name,
                "product_category": "All Products",
                "current_stock_level": current_stock,
                "days_forecasted": 7,
                "engine_strategy": strategy,
                "deep_learning_enabled": deep_learning
            },
            "risk_factors": {
                "stockout_risk": "high" if current_stock < next_week_sales else "low",
                "overstock_risk": "high" if current_stock > next_week_sales * 1.5 else "low"
            }
        }
        
        # Generate Insight via LLM dynamically based on the uploaded data
        insight_text = generate_insight(insight_payload)
        
        return {
            "status": "success",
            "historical": historical_records,
            "forecast": forecast_result.to_dict(orient="records"),
            "kpis": {
                "current_stock": current_stock,
                "forecasted_demand": next_week_sales,
                "percent_change": f"{'+' if percent_change > 0 else ''}{percent_change:.1f}% Next Week",
                "recommended_order": recommended_order,
                "time_to_stockout": f"{max(1, int(current_stock / (next_week_sales / 7)))} Days" if next_week_sales > 0 else "Healthy"
            },
            "insight": insight_text,
            "drivers": top_drivers
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/report")
async def generate_pdf_report(user: dict = Depends(get_current_user)):
    """Generate a Weekly PDF Report for the logged-in organization."""
    org_name = user.get("sub", "Unknown")
    
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT stock, name, sku, status FROM inventory WHERE org_name = ?', (org_name,))
    inventory = cursor.fetchall()
    conn.close()
    
    if not inventory:
        raise HTTPException(status_code=404, detail="No inventory found to report on.")
        
    pdf = FPDF()
    pdf.add_page()
    
    # Title
    pdf.set_font("Helvetica", "B", 18)
    pdf.cell(0, 10, f"StockSense AI: Weekly Inventory Report", ln=True, align="C")
    
    pdf.set_font("Helvetica", "I", 12)
    pdf.cell(0, 10, f"Organization: {org_name}", ln=True, align="C")
    pdf.ln(10)
    
    # Executive Summary
    pdf.set_font("Helvetica", "B", 14)
    pdf.cell(0, 10, "Executive Summary", ln=True)
    pdf.set_font("Helvetica", "", 12)
    
    total_stock = sum(item["stock"] for item in inventory if item["stock"])
    low_stock = [i for i in inventory if i["status"] in ["Low Stock", "Out of Stock"]]
    
    summary = f"Your organization currently holds {total_stock} total units across {len(inventory)} unique SKUs. "
    if low_stock:
        summary += f"Attention is required: {len(low_stock)} items are currently marked as Low Stock or Out of Stock."
    else:
        summary += "Inventory health is optimal with no immediate stockout risks detected."
        
    pdf.multi_cell(0, 8, summary)
    pdf.ln(10)
    
    # Inventory Table Header
    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(40, 10, "SKU", border=1)
    pdf.cell(90, 10, "Product Name", border=1)
    pdf.cell(30, 10, "Stock", border=1)
    pdf.cell(30, 10, "Status", border=1, ln=True)
    
    # Inventory Table Rows
    pdf.set_font("Helvetica", "", 10)
    for item in inventory[:50]:  # Limit to 50 for the PDF
        pdf.cell(40, 8, str(item['sku']), border=1)
        # truncate name to fit
        name = str(item['name'])[:40] + ("..." if len(str(item['name'])) > 40 else "")
        pdf.cell(90, 8, name, border=1)
        pdf.cell(30, 8, str(item['stock']), border=1)
        pdf.cell(30, 8, str(item['status']), border=1, ln=True)
        
    if len(inventory) > 50:
        pdf.cell(0, 10, f"...and {len(inventory)-50} more items.", ln=True)

    # Save to temp file and return
    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".pdf")
    pdf.output(temp_file.name)
    
    return FileResponse(
        temp_file.name, 
        media_type="application/pdf", 
        filename=f"StockSense_Report_{org_name}.pdf",
        background=None
    )
