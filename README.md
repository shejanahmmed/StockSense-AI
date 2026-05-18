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

While most enterprise forecasting tools output complex charts and dataframes, StockSense AI takes it a step further. It predicts future demand, explains *why* demand is changing using SHAP values, and uses Large Language Models (LLMs) to translate these metrics into **highly actionable, plain-English advice** for the shop owner.

No data science degree required. Just clear instructions on what to order, when to order it, and why.

## ✨ Key Features

- 📈 **Ensemble Forecasting**: Combines Prophet and LightGBM for highly accurate time-series demand predictions (7–30 days out) with calculated confidence intervals.
- 🧠 **Explainable AI (XAI)**: Utilizes SHAP TreeExplainer to break open the "black box" and identify the top drivers influencing your specific forecast (e.g., upcoming holidays, active promotions, weekend effects).
- 💬 **Actionable LLM Insights & Chat Assistant**: A sophisticated pipeline that packages forecast data, SHAP drivers, and business context into a structured JSON payload, which is fed to an LLM (Llama 3.3/Groq) to generate direct business advice. You can also chat directly with the AI about your inventory.
- 📦 **Global Inventory Management**: Fully-featured inventory database with live tracking, category filtering, low-stock alerts, one-click CSV export, and SKU addition/deletion interfaces.
- 📄 **Automated PDF Reporting**: Generate professional weekly summary reports directly from the dashboard.
- 🎨 **Premium Dashboard**: A stunning, modern frontend built with glassmorphism aesthetics, dark mode, and dynamic Chart.js visualizations that wow users at first glance.
- 🔒 **Enterprise-Grade Security**: Secured with SHA-256 hashed SQLite databases and robust JWT authentication with secure HMAC key lengths.

## 🏗️ The 5-Step Architecture Pipeline

1. **Forecast Model Runs**: Prophet + LightGBM ensemble generates predictions, confidence intervals, and trend direction for multiple products.
2. **SHAP Explainability Runs**: SHAP TreeExplainer extracts feature importance for the specific forecast window.
3. **Calculate Business Metrics**: The system computes percent change, stockout risks, reorder points, and supplier lead times.
4. **Package into Structured JSON**: All outputs are combined into a clean JSON "insight payload".
5. **LLM Generation**: The payload is sent to Ollama (local) or Groq API (deployed). The LLM processes the facts and outputs specific, actionable business advice.

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
   git clone https://github.com/yourusername/stocksense-ai.git
   cd stocksense-ai
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

---
*Built with ❤️ for SMEs. Empowering small businesses with enterprise-grade AI.*
