<div align="center">
  <h1 align="center">StockSense AI</h1>
  <p align="center">
    <strong>Intelligent, Explainable Inventory Forecasting for SMEs</strong>
    <br />
    Translating complex time-series predictions into actionable plain-English business advice.
  </p>
</div>

---

## 🔮 Overview

**StockSense AI** is a machine learning-driven inventory forecasting system designed specifically for e-commerce Small and Medium Enterprises (SMEs). 

While most enterprise forecasting tools output complex charts and dataframes, StockSense AI takes it a step further. It predicts future demand, explains *why* demand is changing using SHAP values, translates these metrics into highly actionable advice via LLMs, and **dynamically recommends optimized promotional campaigns**.

No data science degree required. Just clear instructions on what to order, when to run promotions, and why.

## ✨ Key Features

- 📈 **Ensemble Forecasting & Robust Baselines**: Uses Prophet (zero-filled, calendar-reindexed) and LightGBM for highly accurate time-series demand predictions (7–30 days out) that capture true organic seasonality without over-inflation.
- 🎯 **AI Promotion Recommendation Engine**: Automatically generates data-driven promotional campaigns. It suggests pre-holiday festive boosts, overstock clearances (based on dynamic thresholding), and weekend flash sales, displayed in an interactive, glassmorphic UI planner deck.
- 🧠 **Explainable AI (XAI)**: Utilizes SHAP TreeExplainer to break open the "black box" and identify the top drivers influencing your specific forecast.
- 💬 **Actionable LLM Insights & Chat Assistant**: A sophisticated pipeline that packages forecast data, SHAP drivers, and business context into a structured JSON payload, fed to an LLM (Llama 3.3/Groq) to generate direct business advice.
- 📦 **Global Inventory Management**: Fully-featured inventory database with live tracking, category filtering, low-stock alerts, one-click CSV export, and SKU addition/deletion interfaces.
- 📄 **Automated PDF Reporting**: Generate professional weekly summary reports directly from the dashboard.
- 🎨 **Premium Dashboard**: A stunning, modern frontend built with high-fidelity glassmorphism aesthetics, dark mode, custom typography, and dynamic Chart.js visualizations.
- 🔒 **Enterprise-Grade Security**: Secured with SHA-256 hashed SQLite databases and robust JWT authentication with secure HMAC key lengths.

## 🏗️ The 6-Step Architecture Pipeline

1. **Forecast Model Runs**: Prophet + LightGBM ensemble generates zero-anchored predictions and confidence intervals for multiple products.
2. **SHAP Explainability Runs**: SHAP TreeExplainer extracts feature importance for the specific forecast window.
3. **Calculate Business Metrics**: The system computes percent change, stockout risks, reorder points, and supplier lead times.
4. **Promotion Heuristics Engine**: Evaluates holiday arrays, inventory overstock thresholds, and day-of-week sales lifts to generate targeted campaign recommendations.
5. **Package into Structured JSON**: All outputs are combined into a clean, unified JSON "insight payload".
6. **LLM Generation**: The payload is sent to Ollama (local) or Groq API (deployed) to output specific, actionable business advice.

## 💻 Tech Stack

### Backend & Machine Learning
- **Python 3.10+**
- **FastAPI / Uvicorn**: High-performance backend API routing and authentication.
- **Prophet & LightGBM**: Ensemble time-series forecasting.
- **SHAP**: Model explainability.
- **DuckDB & Pandas**: Fast, analytical data processing.
- **Ollama / Groq**: LLM integration for insight generation.
- **FPDF**: Automated PDF report generation.

### Frontend
- **HTML5 / CSS3 / Vanilla JS**: Lightweight, zero-dependency foundation.
- **Chart.js**: Dynamic data visualization.
- **Google Fonts (Outfit)** & **FontAwesome**: Modern typography and iconography.

## 🚀 Getting Started

### Prerequisites
- Python 3.10 or higher
- [Ollama](https://ollama.ai/) installed locally (optional, for local LLM inference)
- A [Groq](https://groq.com/) API key (for production inference)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/shejanahmmed/StockSense-AI.git
   cd StockSense-AI
   ```

2. **Create a virtual environment & install dependencies**
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows use `venv\Scripts\activate`
   pip install -r requirements.txt
   ```

3. **Set up Environment Variables**
   Create a `.env` file in the root directory based on the provided `.env.example`:
   ```bash
   cp .env.example .env
   ```
   *Edit `.env` to set `DEPLOYMENT_ENV` (local or production) and add your `GROQ_API_KEY` if using production.*

### Running the Application

**Start the FastAPI Backend (includes the frontend):**
```bash
python -m uvicorn src.api.main:app --reload
```
Then navigate to `http://127.0.0.1:8000` in your browser.

## 📊 Example Output

What the SME owner sees directly on their dashboard:

> **🔮 AI Insight for Store 12 — Electronics**
>
> Sales are forecast to increase **23%** next week to approximately **4,850 units**, significantly above your baseline. This surge is driven by the upcoming **Eid holiday (+18% impact)**, your current promotion campaign (+9%), and typical weekend demand patterns (+5%). 
> 
> ⚠️ **Stockout Warning**: Your current inventory of 3,200 units will likely be depleted by Thursday. We recommend ordering at least **5,200 units** (40% above forecast) to meet demand and avoid lost sales.
>
> 🏷️ **Promotional Planner**:
> - **Pre-Holiday Festive Boost**: Recommend 15% discount on Electronics starting 3 days prior.
> - **Stock Clearance**: "Laptop Cooling Pad RGB" is highly overstocked (400 units). Recommend 25% discount to liquidate.

---
*Built with ❤️ for SMEs. Empowering small businesses with enterprise-grade AI.*
