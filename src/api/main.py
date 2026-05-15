from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
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

app = FastAPI(title="StockSense AI API")

# Add CORS middleware for frontend communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"message": "Welcome to StockSense AI API. Use /predict to get forecasts."}

@app.post("/predict")
async def predict_demand(file: UploadFile = File(...)):
    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are supported.")
    
    try:
        contents = await file.read()
        df = pd.read_csv(io.StringIO(contents.decode("utf-8")))
        
        # Validate input schema
        validate_schema(df)
        
        # Train model on the provided data (Simplified for MVP)
        # In a real scenario, you'd load a pre-trained model and predict future dates.
        model = DemandProphetModel(yearly_seasonality=True, weekly_seasonality=True)
        model.train(df)
        
        # Let's predict the next 7 days based on the last date in the uploaded file
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
            "forecast": forecast_result.to_dict(orient="records")
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
