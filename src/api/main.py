from typing import Any
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import pandas as pd
import io
import sys
from pathlib import Path

# Add project root to sys.path to resolve imports
project_root = Path(__file__).resolve().parent.parent.parent
sys.path.append(str(project_root))

import sqlite3

# Initialize SQLite DB
DB_PATH = project_root / "data" / "users.db"
def init_db():
    # Ensure data directory exists
    (project_root / "data").mkdir(exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            org_name TEXT PRIMARY KEY,
            industry TEXT,
            avatar_url TEXT
        )
    ''')
    conn.commit()
    conn.close()

init_db()

from src.pipeline.data_loader import validate_schema
from src.models.prophet_model import DemandProphetModel
from src.api.insight_generator import generate_insight, generate_chat_response

app = FastAPI(title="StockSense AI API")

class ChatRequest(BaseModel):
    message: str
    history: list = []
    inventory_context: Any = None

class UserProfile(BaseModel):
    org_name: str
    industry: str
    avatar_url: str = ""

# Add CORS middleware for frontend communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Endpoint for generating the LLM insight and providing drivers
@app.get("/api/insight")
async def get_insight():
    # Mock data payload that we would normally generate from the pipeline
    sample_data = {
        "forecast_summary": {
            "next_week_sales": 4850, 
            "current_week_sales": 3800, 
            "percent_change": "+23%",
            "trend": "increasing",
            "confidence_interval": [4100, 5200]
        }, 
        "top_drivers": [
            {"feature": "upcoming_holiday", "impact": "+18%"},
            {"feature": "is_promotion", "impact": "+9%"},
            {"feature": "weekend_effect", "impact": "+5%"}
        ], 
        "context": {
            "store_id": 12,
            "product_category": "Electronics",
            "current_stock_level": 3200,
            "days_forecasted": 7
        }, 
        "risk_factors": {
            "stockout_risk": "high",
            "overstock_risk": "low"
        }
    }
    
    # Generate the insight text using our LLM module
    insight_text = generate_insight(sample_data)
    
    # We also return the mock drivers to populate the frontend driver bars
    drivers = [
        { "name": "Upcoming Holiday (Eid)", "impact": "+18%", "value": 85, "color": "var(--accent-primary)" },
        { "name": "Active Promotion Campaign", "impact": "+9%", "value": 45, "color": "var(--accent-secondary)" },
        { "name": "Day of Week (Weekend)", "impact": "+5%", "value": 25, "color": "var(--status-success)" }
    ]
    
    return {
        "status": "success",
        "insight": insight_text,
        "drivers": drivers
    }

@app.get("/api/inventory")
async def get_inventory():
    try:
        import json
        inventory_path = project_root / "data" / "inventory.json"
        if inventory_path.exists():
            with open(inventory_path, "r") as f:
                data = json.load(f)
            return {"status": "success", "data": data}
        else:
            return {"status": "error", "message": "Inventory database not found."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/chat")
async def chat_with_ai(request: ChatRequest):
    try:
        response = generate_chat_response(request.message, request.history, request.inventory_context)
        return {"status": "success", "response": response}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/user/profile")
async def save_user_profile(profile: UserProfile):
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

@app.get("/api/user/profile/{org_name}")
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

@app.post("/api/predict")
async def predict_demand(file: UploadFile = File(...)):
    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are supported.")
    
    try:
        contents = await file.read()
        df = pd.read_csv(io.StringIO(contents.decode("utf-8")))
        
        # Validate input schema
        validate_schema(df)
        
        # Get the last 14 days of historical data to draw on the chart
        historical_df = df.sort_values('date').tail(14)
        historical_records = historical_df[['date', 'sales']].to_dict(orient="records")
        
        # Train model on the provided data
        model = DemandProphetModel(yearly_seasonality=True, weekly_seasonality=True)
        model.train(df)
        
        # Predict the next 7 days based on the last date in the uploaded file
        last_date = pd.to_datetime(df['date']).max()
        future_dates = [last_date + pd.Timedelta(days=i) for i in range(1, 8)]
        
        # Create a dataframe for future prediction (mocking promo/holiday as 0)
        future_df = pd.DataFrame({
            'date': future_dates,
            'promo': [0] * 7,
            'holiday': [0] * 7
        })
        
        forecast = model.predict(future_df)
        
        # Convert output to list of dicts
        forecast_result = forecast.rename(columns={'ds': 'date', 'yhat': 'predicted_sales', 'yhat_lower': 'lower_bound', 'yhat_upper': 'upper_bound'})
        forecast_result['date'] = forecast_result['date'].dt.strftime('%Y-%m-%d')
        
        # Calculate dynamic KPIs
        current_week_sales = int(historical_df.tail(7)['sales'].sum())
        next_week_sales = int(forecast_result['predicted_sales'].sum())
        percent_change = ((next_week_sales - current_week_sales) / current_week_sales) * 100 if current_week_sales > 0 else 0
        current_stock = int(current_week_sales * 0.8) # Mock current stock being low
        recommended_order = int(next_week_sales * 1.4)
        
        # Build payload for LLM
        insight_payload = {
            "forecast_summary": {
                "next_week_sales": next_week_sales,
                "current_week_sales": current_week_sales,
                "percent_change": f"{'+' if percent_change > 0 else ''}{percent_change:.1f}%",
                "trend": "increasing" if percent_change > 0 else "decreasing",
                "confidence_interval": [int(forecast_result['lower_bound'].sum()), int(forecast_result['upper_bound'].sum())]
            },
            "top_drivers": [
                {"feature": "historical_trend", "impact": "+15%"},
                {"feature": "weekend_effect", "impact": "+8%"},
                {"feature": "baseline_demand", "impact": "+5%"}
            ],
            "context": {
                "store_id": "Uploaded CSV",
                "product_category": "All Products",
                "current_stock_level": current_stock,
                "days_forecasted": 7
            },
            "risk_factors": {
                "stockout_risk": "high" if current_stock < next_week_sales else "low",
                "overstock_risk": "high" if current_stock > next_week_sales * 1.5 else "low"
            }
        }
        
        # Generate Insight via LLM dynamically based on the uploaded data
        insight_text = generate_insight(insight_payload)
        
        # Mock Drivers for UI
        drivers = [
            { "name": "Historical Trend", "impact": "+15%", "value": 75, "color": "var(--accent-primary)" },
            { "name": "Weekend Effect", "impact": "+8%", "value": 40, "color": "var(--accent-secondary)" },
            { "name": "Baseline Demand", "impact": "+5%", "value": 25, "color": "var(--status-success)" }
        ]
        
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
            "drivers": drivers
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Mount the frontend directory to serve the UI at the root
frontend_path = project_root / "frontend"
app.mount("/", StaticFiles(directory=str(frontend_path), html=True), name="frontend")
