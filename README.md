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

While most enterprise forecasting tools output complex charts and dataframes, StockSense AI takes it a step further. It predicts future demand, explains *why* demand is changing using SHAP values, and uses Large Language Models (LLMs) to translate these metrics into **3-4 sentences of highly actionable, plain-English advice** for the shop owner.

No data science degree required. Just clear instructions on what to order, when to order it, and why.

## ✨ Key Features

- 📈 **Ensemble Forecasting**: Combines Prophet and LightGBM for highly accurate time-series demand predictions (7–30 days out) with calculated confidence intervals.
- 🧠 **Explainable AI (XAI)**: Utilizes SHAP TreeExplainer to break open the "black box" and identify the top 3-5 drivers influencing your specific forecast (e.g., upcoming holidays, active promotions, weekend effects).
- 💬 **Actionable LLM Insights**: A sophisticated pipeline that packages forecast data, SHAP drivers, and business context into a structured JSON payload, which is then fed to an LLM (Llama 3.1) to generate direct, risk-aware business advice.
- 🎨 **Premium Dashboard**: A stunning, modern frontend built with glassmorphism aesthetics, dark mode, and dynamic Chart.js visualizations that wow users at first glance.

## 🏗️ The 5-Step Architecture Pipeline

1. **Forecast Model Runs**: Prophet + LightGBM ensemble generates predictions, confidence intervals, and trend direction.
2. **SHAP Explainability Runs**: SHAP TreeExplainer extracts feature importance for the specific forecast window.
3. **Calculate Business Metrics**: The system computes percent change vs. current week, stockout risks, and time-to-depletion.
4. **Package into Structured JSON**: All outputs are combined into a clean JSON "insight payload" — zero raw data.
5. **LLM Generation**: The payload is sent to Ollama (local) or Groq API (deployed). The LLM processes the facts and outputs specific, actionable business advice.

## 💻 Tech Stack

### Backend & Machine Learning
- **Python 3.10+**
- **FastAPI / Uvicorn**: High-performance backend API routing.
- **Prophet & LightGBM**: Ensemble time-series forecasting.
- **SHAP**: Model explainability.
- **DuckDB & Pandas**: Fast, analytical data processing.
- **Ollama / Groq**: LLM integration for insight generation.

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

**1. Start the Frontend UI:**
Simply open `frontend/index.html` in your modern web browser, or serve it via a simple HTTP server:
```bash
cd frontend
python -m http.server 8000
```

**2. Test the LLM Insight Generator:**
```bash
python src/api/insight_generator.py
```

## 📊 Example Output

What the SME owner sees directly on their dashboard:

> **🔮 AI Insight for Store 12 — Electronics**
>
> Sales are forecast to increase **23%** next week to approximately **4,850 units**, significantly above your baseline. This surge is driven by the upcoming **Eid holiday (+18% impact)**, your current promotion campaign (+9%), and typical weekend demand patterns (+5%). 
> 
> ⚠️ **Stockout Warning**: Your current inventory of 3,200 units will likely be depleted by Thursday. We recommend ordering at least **5,200 units** (40% above forecast) to meet demand and avoid lost sales. Additionally, schedule extra staff for Friday and Saturday when foot traffic typically peaks during holidays.

---
*Built with ❤️ for SMEs. Empowering small businesses with enterprise-grade AI.*
