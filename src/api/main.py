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

from src.pipeline.data_loader import validate_schema
from src.models.prophet_model import DemandProphetModel
from src.api.insight_generator import generate_insight

app = FastAPI(title="StockSense AI API")

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
        
        return {
            "status": "success",
            "historical": historical_records,
            "forecast": forecast_result.to_dict(orient="records")
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Mount the frontend directory to serve the UI at the root
frontend_path = project_root / "frontend"
app.mount("/", StaticFiles(directory=str(frontend_path), html=True), name="frontend")
