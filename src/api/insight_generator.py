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
    
    strategy = data.get("context", {}).get("engine_strategy", "balanced").lower()
    
    strategy_instruction = "Provide a balanced recommendation."
    if strategy == "conservative":
        strategy_instruction = "Provide a CONSERVATIVE recommendation. Emphasize minimizing risk and preventing overstock, even if it means missing some potential upside."
    elif strategy == "aggressive":
        strategy_instruction = "Provide an AGGRESSIVE recommendation. Emphasize maximizing sales and capturing all potential upside, recommending larger order quantities to ensure zero stockouts."

    prompt = f"""You are a top-tier business analyst helping SME owners make data-driven inventory decisions.
Your task is to generate 3-4 sentences of specific, actionable business advice based on the provided forecast data.

STRATEGY: {strategy_instruction}

The output MUST contain exactly these 4 elements:
1. The forecast headline with specific numbers (predicted sales, percentage change).
2. The why: Explain WHY demand is changing by referencing the top 1-3 SHAP drivers and their impact percentages. Do not mention "SHAP" explicitly.
3. A specific action recommendation (e.g., "ordering at least X units (Y% above forecast)"). This MUST align with the STRATEGY above.
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
                model="llama-3.3-70b-versatile",
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

def generate_chat_response(query: str, history: list, context_data: Dict[str, Any], currency: str = "BDT") -> str:
    """
    Generates a conversational AI response for the chat assistant.
    
    Args:
        query: The user's message.
        history: List of previous messages in the conversation.
        context_data: Current inventory or forecast data to inform the answer.
        currency: The user's active dashboard currency preference.
        
    Returns:
        A conversational string response.
    """
    inventory_summary = json.dumps(context_data, indent=2)
    
    currency_symbols = {
        "USD": "$",
        "CAD": "C$",
        "CNY": "¥",
        "BDT": "৳",
    }
    currency_symbol = currency_symbols.get(currency.upper(), "৳")
    
    system_prompt = f"""You are StockSense AI, an intelligent inventory assistant for SME business owners.
Your goal is to answer questions about inventory, sales trends, and business strategy using the provided context.

Current Context Data:
{inventory_summary}

Guidelines:
1. Be concise, friendly, and professional.
2. Use the provided context data to give specific answers (mention numbers and names).
3. If the user asks for advice, provide data-driven recommendations.
4. Keep answers under 4-5 sentences.
5. If you are asked about something not in the context, use your general business knowledge but clarify it is general advice.
6. VERY IMPORTANT: The user's active dashboard currency is {currency} (symbol: {currency_symbol}). You MUST represent and format all currency amounts, prices, revenues, and financial values in your response using the {currency_symbol} symbol (or {currency} abbreviation) and NEVER use the dollar ($) sign unless the active currency itself is USD or CAD. For example, if a price or value is 100, format it as {currency_symbol}100 or 100 {currency}, not $100.
7. When presenting tabular data, lists of products, or metrics, you MUST format them in clean, standard Markdown tables (using '|' borders) for beautiful rendering.
8. If you discuss specific products that are low in stock, out of stock, or need replenishment, you MUST append a trailing structured tag in the exact format: `[RESTOCK:sku|name|stock]` at the very end of your response for each product (where sku is the SKU, name is the product name, and stock is the current stock count). For example: "You should restock Laptop Pro. [RESTOCK:SKU-LAP|Laptop Pro|5]". This will compile into a one-click PO button in the UI.
9. If you suggest active promotions for slow-moving products, you MUST append a trailing structured tag in the exact format: `[PROMO:discount|sku|name|reason]` at the very end of your response. For example: "I suggest a discount for Desk Organizer. [PROMO:20%|SKU-DSK|Desk Organizer|Clear slow-moving stock]".
"""

    messages = [{"role": "system", "content": system_prompt}]
    # Add last 5 messages for context window efficiency
    for msg in history[-5:]:
        messages.append(msg)
    messages.append({"role": "user", "content": query})

    env = os.environ.get("DEPLOYMENT_ENV", "local").lower()
    
    if env == "production" and Groq is not None:
        client = Groq(api_key=os.environ.get("GROQ_API_KEY"))
        try:
            response = client.chat.completions.create(
                messages=messages,
                model="llama-3.3-70b-versatile",
                temperature=0.7,
                max_tokens=400,
            )
            return response.choices[0].message.content.strip()
        except Exception as e:
            logger.error(f"Chat Groq Error: {e}")
            return f"I apologize, but I'm having an API error: {str(e)}"
    else:
        # Fallback to dynamic structured mock if in local environment or Groq fails
        items = []
        if isinstance(context_data, list):
            items = context_data
        elif isinstance(context_data, dict) and "data" in context_data:
            items = context_data["data"]
        
        # If no items available in context, query local database directly!
        if not items:
            try:
                from src.api.database import get_db_connection
                conn = get_db_connection()
                cursor = conn.cursor()
                cursor.execute("SELECT sku, name, category, price, stock, reorder_point, supplier_lead_days, supplier, status, forecasted_demand, units_sold FROM inventory")
                rows = cursor.fetchall()
                conn.close()
                items = [dict(row) for row in rows]
            except Exception as dberr:
                logger.error(f"Failed to query database for chat: {dberr}")
                items = []

        q = query.strip().lower()
        
        # 1. /restock or Stockout Risks command
        if "/restock" in q or "restock" in q or "stockout" in q or "reorder" in q or "low stock" in q or "critical" in q:
            at_risk = []
            for i in items:
                stock = i.get('stock', 0)
                ro = i.get('reorder_point', 50)
                status = i.get('status', '')
                if status in ['Low Stock', 'Out of Stock'] or stock <= ro:
                    at_risk.append(i)
            
            if not at_risk:
                return "Good news! I've scanned your current inventory and all items are well-stocked. None of your products are currently at risk of stockout."
            
            table_lines = [
                f"### ⚠️ Critical Stockout & Replenishment Report",
                f"I've identified **{len(at_risk)}** items that require immediate replenishment to prevent supply chain disruptions:",
                "",
                f"| SKU | Product Name | Stock | Reorder Pt | Forecast (7d) | Status |",
                f"| :--- | :--- | :---: | :---: | :---: | :---: |"
            ]
            for i in at_risk:
                sku = i.get('sku', 'N/A')
                name = i.get('name', 'N/A')
                stock = i.get('stock', 0)
                reorder = i.get('reorder_point', 50)
                forecast = i.get('forecasted_demand', 0)
                status = i.get('status', 'Low Stock')
                status_icon = "🔴" if status == "Out of Stock" else "🟡"
                table_lines.append(f"| `{sku}` | {name} | {stock} | {reorder} | {forecast} | {status_icon} {status} |")
            
            table_lines.append("")
            table_lines.append("I've drafted interactive procurement options below. Simply click **Draft Purchase Order** on any card to automatically generate and review a purchase order for that supplier.")
            table_lines.append("")
            
            # Append action tags at the end
            for i in at_risk:
                sku = i.get('sku')
                name = i.get('name')
                stock = i.get('stock', 0)
                table_lines.append(f"[RESTOCK:{sku}|{name}|{stock}]")
                
            return "\n".join(table_lines)
            
        # 2. /overstock or excess inventory command
        elif "/overstock" in q or "overstock" in q or "excess" in q or "slow" in q or "clear" in q or "promo" in q or "/promos" in q:
            excess_items = []
            for i in items:
                stock = i.get('stock', 0)
                forecast = i.get('forecasted_demand', 0)
                if stock > max(forecast * 2, 20):
                    excess_items.append(i)
                    
            if not excess_items:
                return "I've scanned your inventory for excess stock. Everything looks balanced, and you don't have any significant slow-moving or overstocked inventory tying up capital."
                
            table_lines = [
                f"### 📦 Excess Inventory & Promotional Opportunities",
                f"I've found **{len(excess_items)}** items where current stock levels significantly exceed forecasted demand. These represent dead capital that could be cleared via tactical marketing campaigns:",
                "",
                f"| SKU | Product Name | Stock | Forecast (7d) | Price | Est. Capital Tied |",
                f"| :--- | :--- | :---: | :---: | :---: | :---: |"
            ]
            for i in excess_items:
                sku = i.get('sku', 'N/A')
                name = i.get('name', 'N/A')
                stock = i.get('stock', 0)
                forecast = i.get('forecasted_demand', 0)
                price = i.get('price', 0.0)
                capital = (stock - forecast) * price
                table_lines.append(f"| `{sku}` | {name} | {stock} | {forecast} | {currency_symbol}{price:.2f} | {currency_symbol}{capital:.2f} |")
                
            table_lines.append("")
            table_lines.append("I suggest running targeted promotional discounts to liquidate this stock and recover capital. You can click **Schedule Campaign** on the suggestions below:")
            table_lines.append("")
            
            for i in excess_items:
                sku = i.get('sku')
                name = i.get('name')
                table_lines.append(f"[PROMO:15% Off|{sku}|{name}|Clear slow-moving inventory]")
                
            return "\n".join(table_lines)
            
        # 3. /forecast or sales forecast command
        elif "/forecast" in q or "forecast" in q or "trend" in q or "predict" in q or "sales" in q:
            if not items:
                return "I don't see any inventory data in the active context to perform demand forecasting. Please upload a transaction sales history CSV on the overview dashboard."
                
            table_lines = [
                f"### 📈 7-Day Demand Forecasts & Coverage",
                f"Here is next week's AI-calculated demand projection and estimated stock coverage for your top products:",
                "",
                f"| SKU | Product Name | Current Stock | Forecasted Sales (7d) | Coverage Days | Health |",
                f"| :--- | :--- | :---: | :---: | :---: | :--- |"
            ]
            for i in items[:10]:
                sku = i.get('sku', 'N/A')
                name = i.get('name', 'N/A')
                stock = i.get('stock', 0)
                forecast = i.get('forecasted_demand', 0)
                cov_days = int((stock / forecast) * 7) if forecast > 0 else 999
                cov_text = f"{cov_days} days" if cov_days < 99 else "99+ days"
                
                health = "🟢 Optimal"
                if cov_days < 7:
                    health = "🔴 Critical (<7d)"
                elif cov_days < 14:
                    health = "🟡 Low Stock (<14d)"
                elif cov_days > 90:
                    health = "🔵 Overstock (>90d)"
                    
                table_lines.append(f"| `{sku}` | {name} | {stock} | {forecast} | {cov_text} | {health} |")
                
            table_lines.append("")
            table_lines.append("Prophet time-series predictions are updated automatically. If coverage is critical, use the action buttons to replenish immediately.")
            return "\n".join(table_lines)
            
        # 4. /health or inventory health check
        elif "/health" in q or "health" in q or "diagnostic" in q or "overall" in q:
            if not items:
                return "I cannot calculate system health because no inventory items are loaded. Please import your product database."
                
            total = len(items)
            out_stock = sum(1 for i in items if i.get('status') == 'Out of Stock')
            low_stock = sum(1 for i in items if i.get('status') == 'Low Stock')
            healthy = total - out_stock - low_stock
            health_pct = int((healthy / total) * 100) if total > 0 else 0
            health_color = "🟢 Excellent" if health_pct >= 85 else "🟡 Warning" if health_pct >= 60 else "🔴 Action Required"
            
            report = [
                f"### 🩺 Inventory Health & Security Diagnostics Report",
                f"I've completed an operational diagnostic scan of your supply chain database. Here is the AI-synthesis summary:",
                "",
                f"- **Overall Health Index:** {health_pct}% ({health_color})",
                f"- **Total Tracked SKUs:** {total} products",
                f"- **Optimal Stocked SKUs:** {healthy} products",
                f"- **Low Stock Alert SKUs:** {low_stock} products",
                f"- **Out of Stock SKUs:** {out_stock} products",
                "",
                "#### 🔍 Quick Summary & Diagnosis:",
            ]
            
            if out_stock > 0:
                report.append(f"- ⚠️ **Critical Out of Stock Warning:** You have {out_stock} items completely depleted. This is resulting in immediate lost sales. Type `/restock` to see what to order.")
            if low_stock > 0:
                report.append(f"- ⚠️ **Replenishment Risk:** {low_stock} items are below their calculated safety threshold (reorder points). These should be drafted into a PO today.")
            if healthy == total:
                report.append("- ✅ **Flawless Balance:** Excellent job! All tracked products are currently within optimal supply boundaries. Keep monitoring demand forecasts weekly.")
                
            report.append("")
            report.append("Would you like me to calculate specific cost projections or show details for low stock items?")
            return "\n".join(report)

        # Default fallback conversational response
        if items:
            low_stock_names = [i['name'] for i in items if i.get('status') in ['Low Stock', 'Out of Stock']]
            item_count = len(items)
            if low_stock_names:
                examples = ", ".join(low_stock_names[:2])
                return f"I am StockSense AI. I've analyzed your current inventory of **{item_count} items**. I noticed that some of your products, like **{examples}**, are running low. Would you like me to compile a reorder recommendation report? (You can type `/restock` to see the details, or `/health` to run a diagnostics check)."
            else:
                return f"Hello! I am StockSense AI. I've scanned your **{item_count} items** and they all look well-stocked. How can I help you optimize your business today? (Type `/overstock` to look for capital-clearing ideas, or `/forecast` to see demand predictions)."
        
        return f"I've analyzed your query: '{query}'. To get context-aware answers, please upload your sales transaction CSV on the Dashboard first."


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
