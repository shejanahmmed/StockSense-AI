import os
import re
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

def generate_what_if_insight(data: Dict[str, Any], currency: str = "BDT") -> str:
    """
    Generates plain-English business insights for a Simulated Scenario.
    """
    currency_symbols = {
        "USD": "$",
        "CAD": "C$",
        "CNY": "¥",
        "BDT": "৳",
    }
    currency_symbol = currency_symbols.get(currency.upper(), "৳")
    try:
        discount = data.get("discount_pct", 0.0)
        delay = data.get("lead_time_delay", 0)
        target = data.get("target_sku", "ALL")
        
        sim_summary = data.get("simulation_summary", {})
        demand_change = sim_summary.get("demand_change_pct", "0.0%")
        stockout_losses = sim_summary.get("total_stockout_losses", 0.0)
        net_balance = sim_summary.get("net_financial_balance", 0.0)
        at_risk = sim_summary.get("at_risk_count", 0)
        
        prompt = f"""You are a top-tier business analyst helping SME owners make data-driven inventory decisions.
Your task is to generate 2-3 sentences of specific, actionable business advice based on a simulated "What-If" business scenario.

SCENARIO PARAMETERS:
- Target Product/Category: {target}
- Applied Discount: {discount}%
- Supplier Lead Time Delay: {delay} days

SIMULATION RESULTS:
- Projected Demand Change: {demand_change}
- Stockout Losses: {currency_symbol}{stockout_losses:,.2f}
- Net Financial Impact (Profit - Loss): {currency_symbol}{net_balance:,.2f}
- Number of items pushed into high stockout risk: {at_risk} items

Your advice must detail:
1. The immediate consequence of this scenario (e.g. "Applying a {discount}% discount on {target} will surge demand by {demand_change}").
2. The risk (e.g. "However, a {delay}-day delay will trigger stockouts on {at_risk} item(s), costing {currency_symbol}{stockout_losses:,.2f} in lost sales").
3. A clear action item (e.g. "We recommend ordering replenishment stock at least Y days in advance to offset the delay and capture the sales lift").

Keep it concise, realistic, professional, and write for a store owner. Do not use data science jargon.
"""
        insight = call_llm(prompt)
        return insight
    except Exception as e:
        logger.error(f"Failed to generate What-If LLM insight: {e}")
        # Build a robust fallback template
        discount = data.get("discount_pct", 0.0)
        delay = data.get("lead_time_delay", 0)
        target = data.get("target_sku", "ALL")
        sim_summary = data.get("simulation_summary", {})
        demand_change = sim_summary.get("demand_change_pct", "0.0%")
        stockout_losses = sim_summary.get("total_stockout_losses", 0.0)
        net_balance = sim_summary.get("net_financial_balance", 0.0)
        at_risk = sim_summary.get("at_risk_count", 0)
        
        fallback = f"Applying a {discount}% discount on {target} increases demand by {demand_change}. "
        if delay > 0 and at_risk > 0:
            fallback += f"However, the {delay}-day lead time delay pushes {at_risk} item(s) into stockout risk, costing {currency_symbol}{stockout_losses:,.2f} in lost sales. "
            fallback += f"To mitigate this, reorder stock immediately or hold a higher safety buffer."
        else:
            fallback += f"The simulated scenario results in a net financial balance of {currency_symbol}{net_balance:,.2f}. No critical stockout warnings are triggered."
        return fallback

def generate_chat_response(query: str, history: list, context_data: Dict[str, Any], currency: str = "BDT", org_name: str = "Unknown") -> str:
    """
    Generates a conversational AI response for the chat assistant.
    
    Args:
        query: The user's message.
        history: List of previous messages in the conversation.
        context_data: Current inventory or forecast data to inform the answer.
        currency: The user's active dashboard currency preference.
        org_name: The user's active organization identifier.
        
    Returns:
        A conversational string response.
    """
    # Resolve exchange rate
    rates = {
        "BDT": 1.0,
        "USD": 0.0085,
        "CAD": 0.0116,
        "CNY": 0.0617
    }
    try:
        import urllib.request
        import json
        req = urllib.request.Request(
            "https://open.er-api.com/v6/latest/BDT",
            headers={'User-Agent': 'Mozilla/5.0'}
        )
        with urllib.request.urlopen(req, timeout=3) as response:
            data = json.loads(response.read().decode('utf-8'))
            if data and "rates" in data:
                for cur in ["USD", "CAD", "CNY"]:
                    if cur in data["rates"]:
                        rates[cur] = data["rates"][cur]
    except Exception as e:
        logger.error(f"Error fetching live exchange rates on backend: {e}")

    rate = rates.get(currency.upper(), 1.0)

    # Convert pricing fields in context_data list/dict to the target currency
    converted_context_data = None
    if isinstance(context_data, list):
        converted_context_data = []
        for i in context_data:
            item_copy = dict(i)
            if "price" in item_copy:
                item_copy["price"] = float(item_copy["price"] or 0.0) * rate
            converted_context_data.append(item_copy)
    elif isinstance(context_data, dict):
        converted_context_data = dict(context_data)
        if "data" in converted_context_data and isinstance(converted_context_data["data"], list):
            new_data = []
            for i in converted_context_data["data"]:
                item_copy = dict(i)
                if "price" in item_copy:
                    item_copy["price"] = float(item_copy["price"] or 0.0) * rate
                new_data.append(item_copy)
            converted_context_data["data"] = new_data
    else:
        converted_context_data = context_data

    # Check if the active inventory context is empty
    is_empty_inventory = False
    items_in_context = []
    if isinstance(converted_context_data, list):
        items_in_context = converted_context_data
    elif isinstance(converted_context_data, dict) and "data" in converted_context_data:
        items_in_context = converted_context_data["data"]
        
    if not items_in_context:
        try:
            from src.api.database import get_db_connection
            conn = get_db_connection()
            cursor = conn.cursor()
            cursor.execute("SELECT sku FROM inventory WHERE org_name = ? LIMIT 1", (org_name,))
            row = cursor.fetchone()
            conn.close()
            if not row:
                is_empty_inventory = True
        except Exception:
            is_empty_inventory = True
    else:
        is_empty_inventory = len(items_in_context) == 0

    empty_data_instructions = ""
    if is_empty_inventory:
        empty_data_instructions = """
CRITICAL: The user's active inventory database is currently EMPTY (0 items loaded). There is NO active CSV data in the system.
- You MUST politely inform the user that their inventory database is currently empty.
- Advise them to upload their transaction sales history CSV file or input products on the Overview Dashboard first to unlock personalized, live time-series forecasts.
- Do NOT make up, hallucinate, or assume any fictional products, stock counts, or sales values unless you explicitly state that it is a completely hypothetical example to showcase how StockSense AI works.
"""

    inventory_summary = json.dumps(converted_context_data, indent=2)
    
    currency_symbols = {
        "USD": "$",
        "CAD": "C$",
        "CNY": "¥",
        "BDT": "৳",
    }
    currency_symbol = currency_symbols.get(currency.upper(), "৳")
    
    system_prompt = f"""You are StockSense AI, an intelligent inventory assistant for SME business owners.
Your goal is to answer questions about inventory, sales trends, and business strategy using the provided context.

Current Context Data (all monetary values have been pre-converted to your target currency):
{inventory_summary}

{empty_data_instructions}

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

    # ── Pre-flight: resolve inventory items (needed for What-If & local mode) ──
    _items_for_sim = []
    if isinstance(converted_context_data, list):
        _items_for_sim = converted_context_data
    elif isinstance(converted_context_data, dict) and "data" in converted_context_data:
        _items_for_sim = converted_context_data["data"]

    if not _items_for_sim:
        try:
            from src.api.database import get_db_connection
            conn = get_db_connection()
            cursor = conn.cursor()
            cursor.execute(
                "SELECT sku, name, category, price, stock, reorder_point, "
                "supplier_lead_days, supplier, status, forecasted_demand, units_sold "
                "FROM inventory WHERE org_name = ?", (org_name,)
            )
            rows = cursor.fetchall()
            conn.close()
            for row in rows:
                item_dict = dict(row)
                if 'price' in item_dict:
                    item_dict['price'] = float(item_dict['price'] or 0.0) * rate
                _items_for_sim.append(item_dict)
        except Exception as _dberr:
            logger.error(f"Failed to pre-fetch inventory for chat: {_dberr}")

    # ── What-If / Scenario Planning — intercept before LLM ──────────────────
    _q_lower = query.strip().lower()
    _is_what_if = (
        "what if" in _q_lower or "what-if" in _q_lower or
        ("discount" in _q_lower and any(c.isdigit() for c in _q_lower)) or
        ("promo" in _q_lower and any(c.isdigit() for c in _q_lower)) or
        (("lead time" in _q_lower or "lead-time" in _q_lower or
          "delay" in _q_lower or "supplier" in _q_lower)
         and any(c.isdigit() for c in _q_lower))
    )

    if _is_what_if and _items_for_sim:
        # Parse discount %
        _disc_pct = 0.0
        _dm = re.search(r'(\d+(?:\.\d+)?)\s*%?\s*(?:discount|off|promo|sale|markdown)', _q_lower)
        if not _dm:
            _dm = re.search(r'(?:discount|off|promo|sale|markdown)\s+(?:of\s+)?(\d+(?:\.\d+)?)\s*%?', _q_lower)
        if not _dm:
            _dm = re.search(r'(\d+(?:\.\d+)?)\s*%', _q_lower)
        if _dm:
            _disc_pct = float(_dm.group(1))

        # Parse lead-time delay (days)
        _lead_delay = 0
        _lm = re.search(r'(\d+)\s*(?:day|days|d)\s*(?:delay|late|longer|increase|more|extra|behind)?', _q_lower)
        if not _lm:
            _lm = re.search(r'(?:delay|late|longer|increase|more|extra|behind)\s*(\d+)\s*(?:day|days|d)', _q_lower)
        if _lm and any(kw in _q_lower for kw in ["lead", "delay", "supplier", "logistics", "disruption"]):
            _lead_delay = int(_lm.group(1))

        # Parse target category / SKU
        _tgt_label = "ALL"
        _tgt_str   = "all"
        _known_cats = list({i.get('category', '') for i in _items_for_sim if i.get('category')})
        for _cat in _known_cats:
            if _cat.lower() in _q_lower:
                _tgt_label = _cat
                _tgt_str   = _cat.lower()
                break

        # Simulation math
        _ELAST = {
            "accessory": 2.5, "case": 2.5, "cable": 2.5, "charger": 2.5, "stand": 2.5,
            "electronic": 2.0, "watch": 2.0, "earbud": 2.0, "power bank": 2.0,
        }
        _horizon = 7
        _t_orig = _t_sim = _t_so = _t_hold = _t_rev = 0.0
        _at_risk = 0
        _affected = []

        for _it in _items_for_sim:
            _sku   = str(_it.get('sku', 'N/A'))
            _name  = str(_it.get('name', 'N/A'))
            _cat   = str(_it.get('category', ''))
            _price = float(_it.get('price', 0.0) or 0.0)
            _stock = int(_it.get('stock', 0) or 0)
            _lead  = int(_it.get('supplier_lead_days', 7) or 7)
            _fcast = float(_it.get('forecasted_demand', 0.0) or 0.0)

            _targeted = (
                _tgt_str == "all" or
                _tgt_str in _cat.lower() or
                _cat.lower() in _tgt_str or
                _tgt_str == _sku.lower()
            )

            if _targeted:
                _elast = next((v for k, v in _ELAST.items() if k in _cat.lower()), 1.5)
                _dmult = 1.0 + (_disc_pct / 100.0) * _elast
                _sl    = _lead + _lead_delay
            else:
                _dmult = 1.0
                _sl    = _lead

            _sd  = _fcast * _dmult
            _dd  = _sd / _horizon if _horizon > 0 else 0.0
            _t_orig += _fcast
            _t_sim  += _sd

            _d2so = (_stock / _dd) if _dd > 0 else 999.0
            _so_cost = _so_units = 0.0
            if _d2so < _sl:
                _so_days  = _sl - _d2so
                _so_units = min(_sd, _so_days * _dd)
                _so_cost  = _so_units * _price

            _excess  = max(0, _stock - _sd)
            _hcost   = _excess * _price * 0.005
            _sunits  = max(0.0, _sd - _so_units)
            _dfact   = (1.0 - _disc_pct / 100.0) if _targeted else 1.0
            _rev     = _sunits * _price * _dfact

            _sim_rop = int(_dd * _sl * 1.4)
            _sstatus = "Out of Stock" if _stock <= 0 else (
                "Low Stock" if _stock <= _sim_rop else (
                    "Warning" if _stock <= _sim_rop * 1.5 else "In Stock"
                )
            )
            if _sstatus in ["Low Stock", "Out of Stock"]:
                _at_risk += 1

            _t_so   += _so_cost
            _t_hold += _hcost
            _t_rev  += _rev

            if _targeted and (_so_cost > 0 or _sstatus in ["Low Stock", "Out of Stock"]):
                _affected.append({
                    "name": _name, "sku": _sku, "stock": _stock,
                    "sim_demand": round(_sd, 0), "so_cost": round(_so_cost, 2),
                    "sim_status": _sstatus
                })

        _dchg = ((_t_sim - _t_orig) / _t_orig * 100) if _t_orig > 0 else 0.0
        _dsign = "+" if _dchg >= 0 else ""

        # Build markdown response
        _sl_parts = []
        if _disc_pct > 0:
            _sl_parts.append(f"{_disc_pct:.0f}% discount")
        if _lead_delay > 0:
            _sl_parts.append(f"+{_lead_delay}-day supplier delay")
        _scen_str = " + ".join(_sl_parts) if _sl_parts else "baseline (no changes)"

        _out = [
            f"### 🧪 What-If Scenario: {_scen_str} on **{_tgt_label}**",
            "",
            "Here's the simulated impact on your inventory operations:",
            "",
            "| Metric | Result |",
            "| :--- | :--- |",
            f"| {'📈' if _dchg > 0 else '📉'} Projected Demand Change | **{_dsign}{_dchg:.1f}%** |",
            f"| {'🔴' if _at_risk > 3 else ('🟡' if _at_risk > 0 else '🟢')} SKUs at Stockout Risk | **{_at_risk} item(s)** |",
            f"| 💸 Projected Stockout Losses | **{currency_symbol}{_t_so:,.2f}** |",
            f"| 📦 Holding / Carrying Costs | **{currency_symbol}{_t_hold:,.2f}** |",
            f"| 💰 Simulated Revenue | **{currency_symbol}{_t_rev:,.2f}** |",
            "",
        ]

        if _affected:
            _out += [
                "#### ⚠️ Items Most Affected",
                "",
                "| SKU | Product | Stock | Sim. Demand | Stockout Loss | Status |",
                "| :--- | :--- | :---: | :---: | :---: | :--- |",
            ]
            for _r in sorted(_affected, key=lambda x: x['so_cost'], reverse=True)[:5]:
                _sico = "🔴" if _r['sim_status'] == "Out of Stock" else "🟡"
                _out.append(
                    f"| `{_r['sku']}` | {_r['name']} | {_r['stock']} | "
                    f"{_r['sim_demand']:.0f} | {currency_symbol}{_r['so_cost']:,.2f} | "
                    f"{_sico} {_r['sim_status']} |"
                )
            _out.append("")

        if _disc_pct > 0 and _lead_delay > 0:
            _out.append(
                f"**Summary:** A {_disc_pct:.0f}% promotion on **{_tgt_label}** would surge demand by "
                f"{_dsign}{_dchg:.1f}%, but the concurrent {_lead_delay}-day supplier delay puts "
                f"**{_at_risk} SKU(s)** at stockout risk, costing {currency_symbol}{_t_so:,.2f} in "
                f"lost sales. Consider pre-ordering stock before launching the promotion to avoid the gap."
            )
        elif _disc_pct > 0:
            _out.append(
                f"**Summary:** A {_disc_pct:.0f}% discount on **{_tgt_label}** would lift demand by "
                f"{_dsign}{_dchg:.1f}%, generating projected revenue of {currency_symbol}{_t_rev:,.2f}. "
                f"Monitor {_at_risk} at-risk SKU(s) closely and consider a pre-promotion replenishment run."
            )
        elif _lead_delay > 0:
            _out.append(
                f"**Summary:** A {_lead_delay}-day supplier delay would push **{_at_risk} SKU(s)** into "
                f"stockout territory, risking {currency_symbol}{_t_so:,.2f} in lost revenue. "
                f"Issue emergency POs immediately to close the replenishment gap."
            )

        return "\n".join(_out)
    # ── End What-If intercept ─────────────────────────────────────────────────

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
        items = _items_for_sim  # reuse pre-fetched items


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
