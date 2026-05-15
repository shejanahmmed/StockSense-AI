import os
import json
import logging
from typing import Dict, Any
from dotenv import load_dotenv

# Optional dependencies, handle gracefully if not installed yet or errors occur
try:
    import ollama
except ImportError:
    ollama = None

try:
    from groq import Groq
except ImportError:
    Groq = None

# Load environment variables
load_dotenv()

logger = logging.getLogger(__name__)

def build_prompt(data: Dict[str, Any]) -> str:
    """
    Constructs the system prompt instructing the LLM on how to generate the insight.
    
    Args:
        data: The structured JSON data payload containing forecast, drivers, and context.
        
    Returns:
        The formatted prompt string for the LLM.
    """
    payload_str = json.dumps(data, indent=2)
    
    prompt = f"""You are a top-tier business analyst helping SME owners make data-driven inventory decisions.
Your task is to generate 3-4 sentences of specific, actionable business advice based on the provided forecast data.

The output MUST contain exactly these 4 elements:
1. The forecast headline with specific numbers (predicted sales, percentage change).
2. The why: Explain WHY demand is changing by referencing the top 1-3 SHAP drivers and their impact percentages. Do not mention "SHAP" explicitly.
3. A specific action recommendation (e.g., "ordering at least X units (Y% above forecast)").
4. A risk flag: If stockout_risk is high, include a clear warning (e.g., "⚠️ Stockout Warning") and provide the timeline.

Example of a PERFECT output:
"Sales are forecast to increase 23% next week to approximately 4,850 units, significantly above your baseline. This surge is driven by the upcoming Eid holiday (+18% impact), your current promotion campaign (+9%), and typical weekend demand patterns (+5%). ⚠️ Stockout Warning: Your current inventory of 3,200 units will likely be depleted by Thursday. We recommend ordering at least 5,200 units (40% above forecast) to meet demand and avoid lost sales. Additionally, schedule extra staff for Friday and Saturday when foot traffic typically peaks during holidays."

COMMON MISTAKES - DO NOT DO THESE:
❌ Generic advice: Do not say "Sales may go up or down." Always use specific numbers from the forecast.
❌ No drivers: You MUST mention WHY demand is changing based on the drivers, or the insight loses credibility.
❌ Overly technical: Do not use data science jargon (like "ARIMA", "autocorrelation", "SHAP"). Write for a shop owner.
❌ No action: You MUST end with a specific recommendation on what to DO.

Here is the data payload:
{payload_str}
"""
    return prompt

def call_llm(prompt: str) -> str:
    """
    Handles routing the prompt to either the local Ollama instance or the Groq API
    based on the DEPLOYMENT_ENV environment variable.
    
    Args:
        prompt: The fully constructed prompt string.
        
    Returns:
        The generated text insight from the LLM.
    """
    env = os.environ.get("DEPLOYMENT_ENV", "local").lower()
    
    if env == "production":
        if Groq is None:
            raise ImportError("Groq library is not installed. Please install it for production deployment.")
        
        api_key = os.environ.get("GROQ_API_KEY")
        if not api_key:
            logger.warning("GROQ_API_KEY not found in environment variables. Falling back to local if possible, or failing.")
            raise ValueError("GROQ_API_KEY is required for production deployment.")
            
        client = Groq(api_key=api_key)
        
        try:
            response = client.chat.completions.create(
                messages=[
                    {"role": "system", "content": prompt}
                ],
                model="llama-3.1-70b-versatile",
                temperature=0.3,
                max_tokens=150,
            )
            return response.choices[0].message.content.strip()
        except Exception as e:
            logger.error(f"Error calling Groq API: {e}")
            raise
    else:
        # Default to local via Ollama
        if ollama is None:
            raise ImportError("Ollama library is not installed. Please install it for local development.")
            
        try:
            response = ollama.chat(
                model='llama3.1',
                messages=[
                    {"role": "user", "content": prompt}
                ]
            )
            return response['message']['content'].strip()
        except Exception as e:
            logger.error(f"Error calling Ollama local API: {e}")
            raise

def generate_insight(data: Dict[str, Any]) -> str:
    """
    Generates plain-English business insights from forecast data for StockSense AI.
    
    Args:
        data: A dictionary containing:
            - forecast_summary: dict with next_week_sales, current_week_sales, percent_change, trend, confidence_interval
            - top_drivers: list of dicts with feature name and impact percentage
            - context: dict with store_id, product_category, current_stock_level, days_forecasted
            - risk_factors: dict with stockout_risk, overstock_risk
            
    Returns:
        A string containing 3-4 sentences of actionable business advice.
    """
    try:
        # Step 1: Build the prompt
        prompt = build_prompt(data)
        
        # Step 2: Call the LLM (routing handles local vs production)
        insight = call_llm(prompt)
        
        return insight
        
    except Exception as e:
        logger.error(f"Failed to generate LLM insight: {e}")
        
        # Fallback templated message if LLM generation fails entirely
        try:
            forecast = data.get("forecast_summary", {})
            context = data.get("context", {})
            risk = data.get("risk_factors", {}).get("stockout_risk", "unknown")
            
            sales = forecast.get("next_week_sales", "N/A")
            pct = forecast.get("percent_change", "N/A")
            category = context.get("product_category", "products")
            
            fallback = f"Sales for {category} are forecast to change by {pct} next week, reaching approximately {sales} units. "
            if risk.lower() == "high":
                fallback += "Warning: Stockout risk is high based on current inventory levels. Please review stock immediately."
            else:
                fallback += "Please review inventory levels to ensure sufficient stock."
                
            return fallback
        except Exception:
            return "Unable to generate forecast insights at this time. Please review the raw forecast data."

if __name__ == "__main__":
    # Example usage / basic test
    sample_data = {
        "forecast_summary": {
            "next_week_sales": 4250, 
            "current_week_sales": 3800, 
            "percent_change": "+11.8%",
            "trend": "increasing",
            "confidence_interval": [3900, 4600]
        }, 
        "top_drivers": [
            {"feature": "upcoming_holiday", "impact": "+18%"},
            {"feature": "is_promotion", "impact": "+9%"}
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
    
    # Normally you would set DEPLOYMENT_ENV to "local" or "production"
    # os.environ["DEPLOYMENT_ENV"] = "local"
    
    print("Generating insight...")
    # NOTE: This will attempt to connect to an Ollama instance locally by default
    # print(generate_insight(sample_data))
