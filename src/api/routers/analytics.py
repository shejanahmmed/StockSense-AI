from fastapi import APIRouter, HTTPException, UploadFile, File, Query, Depends
from pydantic import BaseModel
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


def get_deterministic_margin(sku: str, category: str) -> int:
    val = sum(ord(c) for c in (sku or ""))
    cat = (category or "").lower()
    if any(x in cat for x in ["accessory", "case", "cable", "charger", "stand"]):
        base, r = 30, 15  # 30% to 45% margin
    elif any(x in cat for x in ["electronic", "watch", "earbud", "power bank"]):
        base, r = 20, 10  # 20% to 30% margin
    else:
        base, r = 15, 15  # 15% to 30% margin
    return base + (val % (r + 1))


def _forecast_for_product(product_df: pd.DataFrame, local_holidays, strategy: str, forecast_horizon: int = 7, region: str = "BD", date_min=None, date_max=None, org_name: str = "Unknown") -> dict:
    """Run the full feature-engineering + Prophet pipeline for a single product's time series."""
    product_df = product_df.copy()
    product_df['date'] = pd.to_datetime(product_df['date'])

    # Aggregate to ONE row per date. If the CSV has multiple transaction rows
    # per day for a product, Prophet would train on individual transaction values
    # instead of the correct daily total, causing a scale mismatch vs. the chart.
    product_daily = (
        product_df
        .groupby('date', as_index=False)
        .agg(sales_qty=('sales_qty', 'sum'),
             promo=('promo', 'max'),
             holiday=('holiday', 'max'))
        .sort_values('date')
    )

    # Reindex daily aggregate to fill missing dates with 0. This ensures a continuous daily time
    # series is fed to Prophet and used for recent 30-calendar-day mean anchoring, correcting
    # major forecasting inflation spikes on sparse/slow-moving SKU records.
    if date_min is not None and date_max is not None:
        product_daily = product_daily.set_index('date')
        full_idx = pd.date_range(start=date_min, end=date_max, freq='D')
        product_daily = product_daily.reindex(full_idx, fill_value=0).reset_index()
        product_daily = product_daily.rename(columns={'index': 'date'})
    else:
        product_daily = product_daily.reset_index(drop=True)


    last_date = product_daily['date'].max()
    future_dates = [last_date + pd.Timedelta(days=i) for i in range(1, forecast_horizon + 1)]
    future_df = pd.DataFrame({'date': future_dates})

    combined_df = pd.concat(
        [product_daily[['date', 'sales_qty', 'promo', 'holiday']]
         .rename(columns={'sales_qty': 'sales'}),
         future_df],
        ignore_index=True
    )

    combined_df = create_date_features(combined_df, region=region)
    future_mask = combined_df['sales'].isna()

    # Load scheduled promotions for this product
    promo_dates = set()
    try:
        sku = str(product_df['product_id'].iloc[0])
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute('''
            SELECT start_date, end_date FROM promotions 
            WHERE org_name = ? AND target_sku = ? AND status = 'scheduled'
        ''', (org_name, sku))
        promo_rows = cursor.fetchall()
        conn.close()
        
        for r in promo_rows:
            start = pd.to_datetime(r['start_date'])
            end = pd.to_datetime(r['end_date'])
            dr = pd.date_range(start, end)
            for d in dr:
                promo_dates.add(d.date())
    except Exception as e:
        print(f"Error querying active promotions for SKU {sku}: {e}")

    combined_df['holiday'] = combined_df['date'].apply(lambda d: 1 if d in local_holidays else 0)
    # Set future promotions based on database promotions
    combined_df.loc[future_mask, 'promo'] = combined_df.loc[future_mask, 'date'].apply(
        lambda d: 1 if d.date() in promo_dates else 0
    )
    combined_df.loc[~future_mask, 'promo'] = combined_df.loc[~future_mask, 'promo'].fillna(0)

    # Only pass truly EXOGENOUS regressors to Prophet — events that are
    # EXTERNAL to the time series and not already modelled internally.
    #
    # ❌ REMOVED: day_of_week, month, is_weekend
    #    These are temporal features already fully captured by Prophet's own
    #    weekly_seasonality component. Passing them as additional regressors
    #    causes double-counting: the weekly component adds +30 for a peak day
    #    AND the day_of_week regressor adds another +20 for the same day.
    #    With more training data (181/365 days) the regressor coefficients
    #    grow stronger, inflating peak-day predictions by 3-4x.
    #
    # ✅ KEPT: promo, holiday
    #    These are genuinely external events Prophet cannot learn on its own.
    EXOGENOUS_COLS = ['date', 'sales', 'promo', 'holiday']
    model_cols = [c for c in EXOGENOUS_COLS if c in combined_df.columns]

    processed_df        = combined_df.loc[~future_mask, model_cols].fillna(0).copy()
    processed_future_df = combined_df.loc[future_mask,  model_cols].fillna(0).copy()

    # Per-product model cache key — always retrain so stale models don't persist.
    sku_hash   = hashlib.md5(product_df['product_id'].iloc[0].encode()).hexdigest()
    model_path = models_dir / f"{sku_hash}.json"
    if model_path.exists():
        model_path.unlink()

    # ── Prophet hyperparameters ──────────────────────────────────────────────
    # growth='flat': no trend extrapolation. With only 1-2 years of data a
    #   linear trend would project 2x the recent baseline into the next month.
    #
    # yearly_seasonality: requires AT LEAST 2 full years (730 days) of data.
    #   With a single year Prophet memorises whatever happened in the same
    #   calendar month last year and reprojects it — even if that was a fluke
    #   spike — producing 3-4x over-predictions. Disable below 730 days.
    #
    # seasonality_prior_scale=5 (default 10): more conservative regularisation
    #   so weekly amplitude doesn't overfit to noisy peaks in the training data.
    data_span_days = (product_daily['date'].max() - product_daily['date'].min()).days
    use_yearly_seasonality = data_span_days >= 730

    model = DemandProphetModel(
        growth='flat',
        yearly_seasonality=use_yearly_seasonality,
        weekly_seasonality=True,
        seasonality_prior_scale=5,
    )
    model.train(processed_df)
    model.save(model_path)

    forecast = model.predict(processed_future_df)
    forecast_result = forecast.rename(columns={
        'ds': 'date', 'yhat': 'predicted_sales',
        'yhat_lower': 'lower_bound', 'yhat_upper': 'upper_bound'
    })
    forecast_result['date'] = forecast_result['date'].dt.strftime('%Y-%m-%d')

    # ── Post-hoc level correction ────────────────────────────────────────────
    # Stage 1 – Mean-anchor: scale Prophet's output so its mean exactly
    # matches the recent 30-day historical mean. Prophet's flat-growth model
    # should already be close, but the weekly seasonality component can still
    # push the average up or down. This one-line correction is the strongest
    # possible guard: no matter what Prophet predicts, the forecast level is
    # always anchored to actual recent sales.
    recent_sales  = product_daily['sales_qty'].tail(30)
    hist_mean     = recent_sales.mean()
    prophet_mean  = forecast_result['predicted_sales'].mean()

    if prophet_mean > 0:
        scale = hist_mean / prophet_mean
        forecast_result['predicted_sales'] = forecast_result['predicted_sales'] * scale
        forecast_result['lower_bound']     = forecast_result['lower_bound']     * scale
        forecast_result['upper_bound']     = forecast_result['upper_bound']     * scale

    # Stage 2 – Hard cap: clip any single-day spike to 1.5× the highest
    # daily sales seen in the last 30 days. This prevents extreme weekly-peak
    # days from going far beyond what has ever been observed.
    hist_max  = recent_sales.max()
    hard_ceil = max(hist_max * 1.5, hist_mean * 2.0)   # whichever is larger
    hard_floor = 0.0

    forecast_result['predicted_sales'] = forecast_result['predicted_sales'].clip(hard_floor, hard_ceil)
    forecast_result['lower_bound']     = forecast_result['lower_bound'].clip(hard_floor, hard_ceil)
    forecast_result['upper_bound']     = forecast_result['upper_bound'].clip(hard_floor, hard_ceil)

    # Use product_daily (already date-aggregated) for KPI calculations.
    # Align the historical sales window to match the length of the forecast horizon dynamically.
    current_week_sales   = int(product_daily.tail(forecast_horizon)['sales_qty'].sum())
    next_week_sales = max(0, int(forecast_result['predicted_sales'].sum()))
    percent_change = ((next_week_sales - current_week_sales) / current_week_sales * 100) if current_week_sales > 0 else 0


    return {
        "forecast": forecast_result[['date', 'predicted_sales', 'lower_bound', 'upper_bound']].to_dict(orient='records'),
        "current_week_sales": current_week_sales,
        "next_week_sales": next_week_sales,
        "percent_change": percent_change,
    }


def _generate_promo_suggestions(df: pd.DataFrame, local_holidays, forecast_horizon: int, date_max, all_product_results: list) -> list:
    """
    Generate highly tailored, data-driven promotion suggestions based on:
    1. Upcoming holidays (within the next 30 days of the dataset max date)
    2. Overstock/Slow-moving products (stock is very high vs demand)
    3. Strong weekend seasonality trends
    """
    suggestions = []
    
    # Ensure date_max is a pandas Timestamp for comparison
    ref_date = pd.to_datetime(date_max)
    
    # 1. Holiday-based Suggestions (Festive Boost)
    # BD holiday name mapping
    BD_HOLIDAY_EN = {
        "শহীদ দিবস ও আন্তর্জাতিক মাতৃভাষা দিবস": "International Mother Language Day",
        "জাতির জনকের জন্মদিন ও জাতীয় শিশু দিবস": "National Children's Day (Sheikh Mujibur Rahman)",
        "স্বাধীনতা ও জাতীয় দিবস": "Independence Day",
        "শব-ই-বরাত": "Shab-e-Barat",
        "বাংলা নববর্ষ": "Bengali New Year",
        "মে দিবস": "May Day",
        "বুদ্ধ পূর্ণিমা": "Buddha Purnima",
        "ঈদুল ফিতর": "Eid ul-Fitr",
        "ঈদুল আযহা": "Eid ul-Adha",
        "জাতীয় শোক দিবস": "National Mourning Day",
        "জন্মাষ্টমী": "Janmashtami",
        "ঈদে মিলাদুন্নবী (সাঃ)": "Eid-e-Miladunnabi",
        "দুর্গাপূজা": "Durga Puja",
        "বিজয় দিবস": "Victory Day",
        "বড়দিন": "Christmas Day",
        "আশুরা": "Ashura",
    }
    
    # Look for upcoming holidays in the next 30 days
    future_holidays = []
    for d, name in sorted(local_holidays.items()):
        holiday_date = pd.to_datetime(d)
        # Holiday within 30 days after ref_date
        if 0 < (holiday_date - ref_date).days <= 30:
            eng_name = BD_HOLIDAY_EN.get(name, name)
            future_holidays.append((holiday_date, eng_name))
            
    for holiday_date, name in future_holidays[:2]: # Max 2 holidays
        # Target high-demand categories/products (or generally top sellers)
        start_promo = holiday_date - pd.Timedelta(days=3)
        end_promo = holiday_date - pd.Timedelta(days=1)
        
        top_prod = None
        if all_product_results:
            top_products_sorted = sorted(all_product_results, key=lambda x: x["next_week_sales"], reverse=True)
            if top_products_sorted:
                top_prod = top_products_sorted[0]
        
        target_item = "All Products"
        target_sku = "ALL"
        if top_prod:
            target_item = top_prod["product_name"]
            target_sku = top_prod["product_id"]
            
        suggestions.append({
            "id": f"promo-holiday-{holiday_date.strftime('%Y%m%d')}",
            "title": f"Pre-{name} Festive Boost",
            "type": "Holiday",
            "start_date": start_promo.strftime("%Y-%m-%d"),
            "end_date": end_promo.strftime("%Y-%m-%d"),
            "target_product": target_item,
            "target_sku": target_sku,
            "discount_pct": "15% Off",
            "expected_impact": "+35% Sales Lift",
            "urgency": "High",
            "reason": f"Historically, consumer shopping intent surges prior to {name}. Launch a promotion on {target_item} 3 days before the holiday to maximize customer conversion rates and increase order value."
        })
        
    # 2. Overstock Clearance Suggestions
    # Find products that are heavily overstocked (stock > forecasted demand * threshold)
    overstocked_items = []
    for prod in all_product_results:
        stock = prod["current_stock"]
        forecast_demand = prod["next_week_sales"]
        sku = prod["product_id"]
        
        is_overstocked = False
        if forecast_horizon == 7 and stock > forecast_demand * 4 and stock > 80:
            is_overstocked = True
        elif forecast_horizon == 14 and stock > forecast_demand * 2.5 and stock > 80:
            is_overstocked = True
        elif forecast_horizon == 30 and stock > forecast_demand * 1.5 and stock > 80:
            is_overstocked = True
            
        if is_overstocked:
            overstocked_items.append(prod)
            
    overstocked_items = sorted(overstocked_items, key=lambda x: x["current_stock"], reverse=True)
    
    for prod in overstocked_items[:2]: # Max 2 overstock clearance suggestions
        sku = prod["product_id"]
        name = prod["product_name"]
        stock = prod["current_stock"]
        forecast_demand = prod["next_week_sales"]
        
        start_promo = ref_date + pd.Timedelta(days=2)
        end_promo = ref_date + pd.Timedelta(days=5)
        
        suggestions.append({
            "id": f"promo-clearance-{sku}",
            "title": f"{name} Stock Clearance",
            "type": "Clearance",
            "start_date": start_promo.strftime("%Y-%m-%d"),
            "end_date": end_promo.strftime("%Y-%m-%d"),
            "target_product": name,
            "target_sku": sku,
            "discount_pct": "25% Off",
            "expected_impact": "+50% Inventory Liquidation",
            "urgency": "Medium",
            "reason": f"Clearance recommendation for slow-moving SKU {sku}. Your current inventory of {stock} units is heavily overstocked relative to the forecasted demand of {forecast_demand} units. We recommend a 25% discount to liquidate stock and free up working capital."
        })
        
    # 3. Weekly Seasonality Weekend Boosters
    # Inspect weekday vs weekend historical sales
    if len(df) > 30:
        df_copy = df.copy()
        df_copy['dayofweek'] = df_copy['date'].dt.dayofweek
        # BD weekends: Friday (4) and Saturday (5)
        is_weekend = df_copy['dayofweek'].isin([4, 5])
        
        weekend_sales_mean = df_copy[is_weekend]['sales_qty'].mean()
        weekday_sales_mean = df_copy[~is_weekend]['sales_qty'].mean()
        
        if pd.notna(weekend_sales_mean) and pd.notna(weekday_sales_mean) and weekday_sales_mean > 0:
            lift = (weekend_sales_mean - weekday_sales_mean) / weekday_sales_mean
            if lift > 0.15:
                top_cat_df = df_copy.groupby('category')['sales_qty'].sum().reset_index()
                top_cat = top_cat_df.sort_values('sales_qty', ascending=False).iloc[0]['category'] if not top_cat_df.empty else "All Categories"
                
                # Find days to next Friday (4)
                days_to_fri = (4 - ref_date.dayofweek) % 7
                if days_to_fri == 0:
                    days_to_fri = 7
                
                start_promo = ref_date + pd.Timedelta(days=days_to_fri)
                end_promo = start_promo + pd.Timedelta(days=1)
                
                suggestions.append({
                    "id": "promo-weekend-booster",
                    "title": "Weekend Demand Multiplier",
                    "type": "Seasonality",
                    "start_date": start_promo.strftime("%Y-%m-%d"),
                    "end_date": end_promo.strftime("%Y-%m-%d"),
                    "target_product": f"Top items in {top_cat}",
                    "target_sku": "CAT-" + top_cat.upper()[:5],
                    "discount_pct": "10% Off",
                    "expected_impact": f"+{(lift*100):.0f}% Sales Multiplier",
                    "urgency": "Low",
                    "reason": f"Leverage weekend shopping patterns. Friday & Saturday sales are consistently {(lift*100):.1f}% higher than weekdays. Introduce a minor 10% discount on {top_cat} to capture increased foot traffic and boost average basket size."
                })
                
    # Fallback if no specific recommendations are triggered
    if len(suggestions) < 2:
        start_promo = ref_date + pd.Timedelta(days=2)
        end_promo = ref_date + pd.Timedelta(days=3)
        suggestions.append({
            "id": "promo-fallback-weekend",
            "title": "Weekend Flash Campaign",
            "type": "Seasonality",
            "start_date": start_promo.strftime("%Y-%m-%d"),
            "end_date": end_promo.strftime("%Y-%m-%d"),
            "target_product": "Best Sellers",
            "target_sku": "BEST",
            "discount_pct": "15% Off",
            "expected_impact": "+20% Traffic Boost",
            "urgency": "Medium",
            "reason": "Enhance standard weekend customer conversion rates. An attractive, limited-time 15% discount on high-volume products will drive maximum shopper engagement and increase checkout volume."
        })
        
        start_promo = ref_date + pd.Timedelta(days=5)
        end_promo = ref_date + pd.Timedelta(days=10)
        suggestions.append({
            "id": "promo-fallback-category",
            "title": "Mid-Week Category Spotlight",
            "type": "Holiday",
            "start_date": start_promo.strftime("%Y-%m-%d"),
            "end_date": end_promo.strftime("%Y-%m-%d"),
            "target_product": "Accessories",
            "target_sku": "ACC",
            "discount_pct": "20% Off",
            "expected_impact": "+25% Category Lift",
            "urgency": "Low",
            "reason": "Offset slow mid-week demand by launching a specialized 'Category Spotlight' campaign. Highlighting accessories with a 20% promotional discount will optimize overall revenue distribution."
        })
        
    return suggestions


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


@router.get("/api/holidays")
async def get_holidays(
    region: str = "BD",
    years: str = ""
):
    """Return a sorted list of public holidays for the given region and years.
    No auth required - data is publicly available.
    Falls back to python-holidays library if the online ICS feed is unavailable.
    """
    import datetime
    import urllib.request
    import re as _re

    current_year = datetime.date.today().year
    if years.strip():
        try:
            year_list = [int(y.strip()) for y in years.split(",") if y.strip()]
        except ValueError:
            year_list = [current_year, current_year + 1]
    else:
        year_list = [current_year, current_year + 1]

    region_map = {
        "BD": "bangladesh",
        "US": "usa",
        "UK": "united-kingdom",
        "GB": "united-kingdom",
        "IN": "india",
    }
    country_name = region_map.get(region.upper(), "bangladesh")
    url = f"https://www.officeholidays.com/ics-clean/{country_name}"

    online_holidays = {}
    try:
        req = urllib.request.Request(
            url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
        )
        with urllib.request.urlopen(req, timeout=8) as resp:
            ical_data = resp.read().decode("utf-8")
        events = ical_data.split("BEGIN:VEVENT")
        for event in events[1:]:
            date_match = _re.search(r"DTSTART(?:;VALUE=DATE)?:(\d{8})", event)
            summary_match = _re.search(r"SUMMARY(?:;[^:]+)?:([^\r\n]+)", event)
            if date_match and summary_match:
                try:
                    h_date = datetime.datetime.strptime(date_match.group(1), "%Y%m%d").date()
                    if h_date.year in year_list:
                        online_holidays[h_date] = summary_match.group(1).strip()
                except Exception:
                    pass
    except Exception:
        pass

    fallback = {}
    try:
        h_obj = holidays.country_holidays(region.upper(), years=year_list)
        fallback = dict(h_obj)
    except Exception:
        try:
            h_obj = holidays.BD(years=year_list)
            fallback = dict(h_obj)
        except Exception:
            pass

    result = {}
    for y in year_list:
        year_online = {d: n for d, n in online_holidays.items() if d.year == y}
        if year_online:
            result.update(year_online)
        else:
            result.update({d: n for d, n in fallback.items() if d.year == y})

    def clean(raw):
        lo = raw.lower()
        if "eid-ul-azha" in lo or "eid al-adha" in lo or "eid-ul-adha" in lo:
            return "Eid ul-Adha"
        if "eid al-fitr" in lo or "eid-ul-fitr" in lo:
            return "Eid ul-Fitr"
        if "shab e-barat" in lo or "shab-e-barat" in lo:
            return "Shab-e-Barat"
        if "miladunnabi" in lo or "milad un nabi" in lo:
            return "Eid-e-Miladunnabi"
        if "durga puja" in lo:
            return "Durga Puja"
        if "ashura" in lo:
            return "Ashura"
        if "language martyrs" in lo or "mother language" in lo:
            return "International Mother Language Day"
        if "independence" in lo:
            return "Independence Day"
        if "victory day" in lo:
            return "Victory Day"
        if "bengali new year" in lo or "pohela boishakh" in lo:
            return "Bengali New Year"
        if "labour day" in lo or "may day" in lo:
            return "May Day"
        if "buddha purnima" in lo or "buddha" in lo:
            return "Buddha Purnima"
        if "christmas" in lo:
            return "Christmas Day"
        return raw

    cleaned = {d: clean(n) for d, n in result.items()}
    holiday_list = [
        {"date": d.strftime("%Y-%m-%d"), "name": n}
        for d, n in sorted(cleaned.items())
    ]
    return {"status": "success", "holidays": holiday_list, "years": year_list, "region": region.upper()}



@router.post("/api/predict")
async def predict_demand(
    file: UploadFile = File(None),
    strategy: str = "balanced",
    deep_learning: bool = True,
    region: str = "BD",
    user: dict = Depends(get_current_user)
):
    org_name = user.get("sub", "Unknown")
    raw_dir = project_root / "data" / "raw"
    csv_save_path = raw_dir / f"{org_name}_uploaded.csv"

    if file is not None:
        if not file.filename.endswith(".csv"):
            raise HTTPException(status_code=400, detail="Only CSV files are supported.")

        try:
            contents = await file.read()
            raw_dir.mkdir(parents=True, exist_ok=True)
            with open(csv_save_path, "wb") as _f:
                _f.write(contents)

            df = pd.read_csv(io.StringIO(contents.decode("utf-8")))
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to parse uploaded CSV: {str(e)}")
    else:
        # Load from disk
        if not csv_save_path.exists():
            raise HTTPException(
                status_code=422,
                detail="No previously uploaded sales history CSV found. Please upload a CSV file first."
            )
        
        try:
            df = pd.read_csv(csv_save_path)
            
            # Retrieve active inventory products from SQLite to sync edits and deletions
            conn = get_db_connection()
            cursor = conn.cursor()
            cursor.execute('SELECT sku, name, category, price, stock, reorder_point, supplier_lead_days FROM inventory WHERE org_name = ?', (org_name,))
            db_items = cursor.fetchall()
            conn.close()
            
            # Standardise columns for comparison
            df.columns = [c.strip().lower().replace(' ', '_') for c in df.columns]
            
            db_items_dict = {str(item["sku"]): item for item in db_items}
            active_skus = set(db_items_dict.keys())
            
            # Sync deletions: drop rows for products not in SQLite inventory
            if active_skus:
                df = df[df['product_id'].astype(str).isin(active_skus)].copy()
            else:
                df = df.iloc[0:0].copy()
                
            # Sync edits: update product details in historical CSV
            for sku, item in db_items_dict.items():
                mask = df['product_id'].astype(str) == sku
                if mask.any():
                    df.loc[mask, 'product_name'] = item['name']
                    df.loc[mask, 'category'] = item['category']
                    df.loc[mask, 'unit_price'] = float(item['price'] or 0.0)
                    df.loc[mask, 'reorder_point'] = int(item['reorder_point'] or 50)
                    df.loc[mask, 'supplier_lead_days'] = int(item['supplier_lead_days'] or 7)
                    
            # Save synchronized CSV back to disk
            df.to_csv(csv_save_path, index=False)
            
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to synchronize and load CSV data: {str(e)}")

    try:

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

        # -- Data span validation & dynamic forecast horizon ------------------
        date_min       = df['date'].min()
        date_max       = df['date'].max()
        data_span_days = (date_max - date_min).days + 1

        if data_span_days < 30:
            raise HTTPException(
                status_code=422,
                detail={
                    "error":          "INSUFFICIENT_DATA",
                    "data_span_days": data_span_days,
                    "required_days":  30,
                    "message": (
                        f"Your CSV only covers {data_span_days} day(s) of sales history, "
                        f"which is not enough to generate a reliable forecast. "
                        f"Minimum: 90 days -> 7-day forecast | "
                        f"180 days -> 14-day forecast | 360 days -> 30-day forecast."
                    )
                }
            )

        # Select forecast horizon based on how much data the user provided
        if data_span_days >= 360:
            forecast_horizon = 30
            forecast_label   = "30-Day Forecast"
        elif data_span_days >= 180:
            forecast_horizon = 14
            forecast_label   = "14-Day Forecast"
        else:
            forecast_horizon = 7
            forecast_label   = "7-Day Forecast"

        # ── Holiday calendar ─────────────────────────────────────────────────────────
        import datetime
        import calendar
        import urllib.request
        import re

        # Use the CSV's max date as the reference point, NOT today.
        # This ensures "upcoming event" is relative to the end of the uploaded data range,
        # so Jan-March CSVs won't surface holidays from August or later.
        csv_end_date = date_max.date() if hasattr(date_max, 'date') else date_max
        ref_year = csv_end_date.year
        years_to_fetch = [ref_year, ref_year + 1]

        # 1. Fetch holidays from the internet dynamically (Office Holidays ICS feed)
        region_map = {
            "BD": "bangladesh",
            "US": "usa",
            "UK": "united-kingdom",
            "GB": "united-kingdom",
            "IN": "india",
        }
        country_name = region_map.get(region.upper(), "bangladesh")
        url = f"https://www.officeholidays.com/ics-clean/{country_name}"
        
        online_holidays = {}
        try:
            req = urllib.request.Request(
                url, 
                headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
            )
            with urllib.request.urlopen(req, timeout=8) as response:
                ical_data = response.read().decode('utf-8')
                
            events = ical_data.split("BEGIN:VEVENT")
            for event in events[1:]:
                date_match = re.search(r'DTSTART(?:;VALUE=DATE)?:(\d{8})', event)
                summary_match = re.search(r'SUMMARY(?:;[^:]+)?:([^\r\n]+)', event)
                
                if date_match and summary_match:
                    date_str = date_match.group(1)
                    summary_val = summary_match.group(1).strip()
                    try:
                        h_date = datetime.datetime.strptime(date_str, "%Y%m%d").date()
                        if h_date.year in years_to_fetch:
                            online_holidays[h_date] = summary_val
                    except Exception:
                        pass
        except Exception:
            # Fall back to local library on failure
            pass

        # 2. Setup python-holidays as fallback
        local_holidays = {}
        try:
            h_obj = holidays.country_holidays(region, years=years_to_fetch)
        except Exception:
            try:
                h_obj = holidays.BD(years=years_to_fetch)
            except Exception:
                h_obj = {}

        # 3. Combine: use online holidays if successfully fetched; otherwise local
        for y in years_to_fetch:
            year_online = {d: n for d, n in online_holidays.items() if d.year == y}
            if year_online:
                for d, n in year_online.items():
                    local_holidays[d] = n
            else:
                for d, n in h_obj.items():
                    if d.year == y:
                        local_holidays[d] = n

        # 4. Standardize and clean holiday names (Translate Bangla strings / unify names)
        BD_HOLIDAY_EN = {
            "শহীদ দিবস ও আন্তর্জাতিক মাতৃভাষা দিবস": "International Mother Language Day",
            "জাতির জনকের জন্মদিন ও জাতীয় শিশু দিবস": "National Children's Day (Sheikh Mujibur Rahman's Birthday)",
            "স্বাধীনতা ও জাতীয় দিবস": "Independence & National Day",
            "শব-ই-বরাত": "Shab-e-Barat",
            "বাংলা নববর্ষ": "Bengali New Year (Pohela Boishakh)",
            "মে দিবস": "May Day (International Workers' Day)",
            "বুদ্ধ পূর্ণিমা": "Buddha Purnima",
            "ঈদুল ফিতর": "Eid ul-Fitr",
            "ঈদুল আযহা": "Eid ul-Adha",
            "জাতীয় শোক দিবস": "National Mourning Day",
            "জন্মাষ্টমী": "Janmashtami",
            "ঈদে মিলাদুন্নবী (সাঃ)": "Eid-e-Miladunnabi (Prophet's Birthday)",
            "দুর্গাপূজা": "Durga Puja",
            "বিজয় দিবস": "Victory Day",
            "বড়দিন": "Christmas Day",
            "আশুরা": "Ashura",
        }

        def clean_holiday_name(raw_name: str) -> str:
            mapped = BD_HOLIDAY_EN.get(raw_name)
            if mapped:
                return mapped
                
            lower_name = raw_name.lower()
            if "eid-ul-azha" in lower_name or "eid al-adha" in lower_name or "eid-ul-adha" in lower_name:
                return "Eid ul-Adha"
            if "eid al-fitr" in lower_name or "eid-ul-fitr" in lower_name:
                return "Eid ul-Fitr"
            if "shab e-barat" in lower_name or "shab-e-barat" in lower_name:
                return "Shab-e-Barat"
            if "shab-e-qadr" in lower_name or "shab e-qadr" in lower_name:
                return "Shab-e-Qadr"
            if "miladunnabi" in lower_name or "milad un nabi" in lower_name:
                return "Eid-e-Miladunnabi"
            if "durga puja" in lower_name:
                return "Durga Puja"
            if "ashura" in lower_name:
                return "Ashura"
            if "language martyrs" in lower_name or "mother language" in lower_name:
                return "International Mother Language Day"
            if "independence" in lower_name:
                return "Independence Day"
            if "victory day" in lower_name:
                return "Victory Day"
            if "bengali new year" in lower_name or "pohela boishakh" in lower_name:
                return "Bengali New Year"
            if "labour day" in lower_name or "may day" in lower_name:
                return "May Day"
            if "buddha purnima" in lower_name or "buddha's birthday" in lower_name:
                return "Buddha Purnima"
            if "christmas" in lower_name:
                return "Christmas Day"
            if "janmashtami" in lower_name:
                return "Janmashtami"
            return raw_name

        local_holidays = {d: clean_holiday_name(n) for d, n in local_holidays.items()}

        # Only consider holidays that come AFTER the last date in the CSV
        future_holidays = {d: n for d, n in local_holidays.items() if d > csv_end_date}
        
        # Check if the closest holiday is within the forecast horizon
        upcoming_holiday = None
        if future_holidays:
            closest_date = min(future_holidays.keys())
            if (closest_date - csv_end_date).days <= forecast_horizon:
                upcoming_holiday = (closest_date, future_holidays[closest_date])

        if upcoming_holiday:
            next_date, raw_name = upcoming_holiday
            upcoming_event_name = raw_name
            upcoming_event_date = next_date.strftime("%b %d, %Y")
            event_impact = "+15% expected"
        else:
            upcoming_event_name = "None"
            upcoming_event_date = ""
            event_impact = "No Holiday Impact"

        # â”€â”€ Per-product loop â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        # org_name already resolved above
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
                result = _forecast_for_product(
                    product_df.copy(),
                    local_holidays,
                    strategy,
                    forecast_horizon,
                    region,
                    date_min=date_min,
                    date_max=date_max,
                    org_name=org_name
                )
            except Exception:
                # Skip products with insufficient data
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

            # Group by date, sum sales_qty, take last 14 days of history
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
            ''', (org_name, sku, product_name, category, unit_price, stock,
                  reorder_point, lead_days, '', status, next_week, units_sold))

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
                "price": unit_price,
                "current_week_sales": result["current_week_sales"],
                "next_week_sales": next_week,
                "percent_change": f"{'+' if result['percent_change'] > 0 else ''}{result['percent_change']:.1f}%",
                "recommended_order": recommended_order,
                "days_to_stockout": days_to_stockout,
                "units_sold": units_sold,
                "forecast": result["forecast"],
            })

        conn.commit()
        conn.close()

        # â”€â”€ Aggregate KPIs across all products â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        overall_pct = (
            (aggregate_next_week - aggregate_current_week) / aggregate_current_week * 100
            if aggregate_current_week > 0 else 0
        )

        # ── Aggregate historical chart data (all SKUs combined by date) ──────
        # Retain the entire historical sales history so that the frontend's
        # dynamic chart range filters (30d, 90d, 180d, 1yr, all) can display
        # the selected time windows.
        historical_agg = (
            df.groupby('date')['sales_qty'].sum()
            .reset_index()
            .sort_values('date')
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
                "days_forecasted": forecast_horizon,
                "engine_strategy": strategy,
            },
            "risk_factors": {
                "stockout_risk": "high" if at_risk else "low",
                "overstock_risk": "low",
            },
        }
        insight_text = generate_insight(insight_payload)

        # Fix: Build an AGGREGATE forecast chart so the predicted line is on
        # the same scale as the aggregate historical line. Previously only the
        # first product's forecast was shown, which looked tiny vs. the sum.
        if all_product_results:
            from collections import defaultdict
            agg_by_date: dict = defaultdict(lambda: {"predicted_sales": 0.0, "lower_bound": 0.0, "upper_bound": 0.0})
            for prod in all_product_results:
                for row in prod["forecast"]:
                    d = row["date"]
                    agg_by_date[d]["predicted_sales"] += row["predicted_sales"]
                    agg_by_date[d]["lower_bound"]     += row["lower_bound"]
                    agg_by_date[d]["upper_bound"]     += row["upper_bound"]
            chart_forecast = [
                {"date": d, **vals}
                for d, vals in sorted(agg_by_date.items())
            ]
        else:
            chart_forecast = []

        # Generate data-driven promotional suggestions
        promo_suggestions = _generate_promo_suggestions(
            df=df,
            local_holidays=local_holidays,
            forecast_horizon=forecast_horizon,
            date_max=date_max,
            all_product_results=all_product_results
        )

        total_forecast_rev = sum((p["next_week_sales"] or 0) * p["price"] for p in all_product_results)
        if total_forecast_rev > 0:
            total_forecast_prof = sum((p["next_week_sales"] or 0) * p["price"] * (get_deterministic_margin(p["product_id"], p["category"]) / 100.0) for p in all_product_results)
            portfolio_avg_margin = (total_forecast_prof / total_forecast_rev) * 100.0
        else:
            portfolio_avg_margin = sum(get_deterministic_margin(p["product_id"], p["category"]) for p in all_product_results) / max(1, len(all_product_results))

        return {
            "status": "success",
            "historical": historical_records,
            "forecast": chart_forecast,
            "forecast_horizon": forecast_horizon,
            "forecast_label": forecast_label,
            "data_span_days": data_span_days,
            "promo_suggestions": promo_suggestions,
            "holidays": [{"date": d.strftime("%Y-%m-%d"), "name": n} for d, n in sorted(local_holidays.items())],
            "kpis": {
                "total_skus": len(all_product_results),
                "current_stock": aggregate_current_stock,
                "forecasted_demand": aggregate_next_week,
                "percent_change": f"{'+' if overall_pct > 0 else ''}{overall_pct:.1f}% Next {forecast_horizon} Days",
                "at_risk_products": len(at_risk),
            },
            "bi_metrics": {
                "daily_sales": int(aggregate_current_week / forecast_horizon) if aggregate_current_week > 0 else 0,
                "daily_forecast": int(aggregate_next_week / forecast_horizon) if aggregate_next_week > 0 else 0,
                "cash_flow": int(aggregate_next_week * 50), # Mock avg $50 per unit
                "demand_trend": "Rising" if overall_pct > 0 else "Falling",
                "demand_trend_pct": f"{'+' if overall_pct > 0 else ''}{overall_pct:.1f}% this period",
                "upcoming_event": upcoming_event_name,
                "upcoming_event_date": upcoming_event_date,
                "event_impact": event_impact,
                "avg_margin": f"{portfolio_avg_margin:.1f}%",
                "next_step": f"Approve purchase order for '{at_risk[0]['product_name']}' ({at_risk[0]['product_id']}) before Friday to avoid stockout." if at_risk else "Monitor inventory levels. No critical actions needed.",
                "timeline": [
                    {
                        "name": p["product_name"],
                        "sku": p["product_id"],
                        "stock": p["current_stock"],
                        "urgency": "Critical" if p["status"] == "Out of Stock" else "Plan" if p["status"] == "Low Stock" else "Healthy",
                        "text": "Reorder immediately" if p["status"] == "Out of Stock" else f"Restock in {p['days_to_stockout'] or 5} days"
                    }
                    for p in sorted(all_product_results, key=lambda x: (x["status"] != "Out of Stock", x["status"] != "Low Stock"))
                ],
                "top_products": [
                    {
                        "name": p["product_name"],
                        "sku": p["product_id"],
                        "margin": f"+{get_deterministic_margin(p['product_id'], p['category'])}% Margin"
                    }
                    for p in sorted(all_product_results, key=lambda x: x["next_week_sales"], reverse=True)
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


class PromotionModel(BaseModel):
    id: str
    title: str
    type: str
    start_date: str
    end_date: str
    target_product: str
    target_sku: str
    discount_pct: str
    expected_impact: str
    urgency: str
    reason: str


@router.post("/api/promotions")
async def add_promotion(promo: PromotionModel, user: dict = Depends(get_current_user)):
    org_name = user.get("sub", "Unknown")
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('''
            INSERT OR REPLACE INTO promotions (
                id, org_name, title, type, start_date, end_date, 
                target_product, target_sku, discount_pct, expected_impact, urgency, reason, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled')
        ''', (promo.id, org_name, promo.title, promo.type, promo.start_date, promo.end_date,
              promo.target_product, promo.target_sku, promo.discount_pct, promo.expected_impact,
              promo.urgency, promo.reason))
        conn.commit()
        return {"status": "success", "message": f"Promotion '{promo.title}' successfully scheduled."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save promotion: {str(e)}")
    finally:
        conn.close()


@router.get("/api/promotions")
async def get_promotions(user: dict = Depends(get_current_user)):
    org_name = user.get("sub", "Unknown")
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('SELECT * FROM promotions WHERE org_name = ? ORDER BY created_at DESC', (org_name,))
        rows = cursor.fetchall()
        promos = [dict(row) for row in rows]
        return {"status": "success", "promotions": promos}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to query promotions: {str(e)}")
    finally:
        conn.close()


@router.delete("/api/promotions/{id}")
async def delete_promotion(id: str, user: dict = Depends(get_current_user)):
    org_name = user.get("sub", "Unknown")
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('DELETE FROM promotions WHERE org_name = ? AND id = ?', (org_name, id))
        conn.commit()
        return {"status": "success", "message": "Promotion successfully cancelled."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete promotion: {str(e)}")
    finally:
        conn.close()


@router.get("/api/purchase_order/draft")
async def draft_purchase_order(
    sku: str = Query(...),
    user: dict = Depends(get_current_user)
):
    org_name = user.get("sub", "Unknown")
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Get product details
    cursor.execute('''
        SELECT sku, name, category, price, stock, reorder_point, 
               supplier_lead_days, supplier, forecasted_demand 
        FROM inventory 
        WHERE org_name = ? AND sku = ?
    ''', (org_name, sku))
    item = cursor.fetchone()
    
    conn.close()
    
    if not item:
        raise HTTPException(status_code=404, detail="Product not found in inventory.")
        
    name = item["name"]
    category = item["category"]
    price = item["price"] or 0.0
    stock = item["stock"] or 0
    reorder_point = item["reorder_point"] or 50
    lead_days = item["supplier_lead_days"] or 7
    supplier = item["supplier"] or ""
    if not supplier.strip():
        supplier = f"{category} Global Logistics"
        
    forecasted = item["forecasted_demand"] or 0
    
    # Recommended quantity: next period's forecasted sales * 1.4 safety buffer - current stock
    recommended = max(10, int(forecasted * 1.4) - stock)
    
    # Round to neat batches of 5 or 10
    if recommended > 10:
        recommended = ((recommended + 4) // 5) * 5
        
    wholesale_price = price * 0.7
    total_cost = recommended * wholesale_price
    
    # Build AI Email
    email_subject = f"Urgent Stock Procurement Request: {name} (SKU: {sku})"
    email_body = f"""Dear Sales and Logistics Team,

I hope this message finds you well.

Based on our automated StockSense AI predictive demand models for {org_name}, we are projecting a significant sales surge for '{name}' over the coming week. To prevent out-of-stock events and satisfy our customers, we would like to immediately place a replenishment purchase order.

Please find the structured order details below:

• Product Name: {name}
• Product SKU: {sku}
• Product Category: {category}
• Quantity Requested: {recommended:,} units
• Target Unit Price: {wholesale_price:.2f} (Wholesale rate)
• Estimated Lead Time: {lead_days} days

Please confirm receipt of this purchase order and reply with a formal invoice and estimated dispatch date at your earliest convenience. If you have any questions regarding these quantities, feel free to contact our inventory desk.

Thank you for your continued support as a valued supply partner.

Best regards,
Procurement Officer
{org_name} — {category} Desk
Powered by StockSense AI
"""

    return {
        "status": "success",
        "sku": sku,
        "name": name,
        "category": category,
        "supplier": supplier,
        "current_stock": stock,
        "forecasted_demand": forecasted,
        "wholesale_price": wholesale_price,
        "recommended_qty": recommended,
        "total_cost": total_cost,
        "lead_days": lead_days,
        "email_subject": email_subject,
        "email_body": email_body
    }

