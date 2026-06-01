import sqlite3
from pathlib import Path

project_root = Path(__file__).resolve().parent.parent.parent
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
    try:
        cursor.execute("ALTER TABLE users ADD COLUMN password_hash TEXT")
    except sqlite3.OperationalError:
        pass
    try:
        cursor.execute("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'")
    except sqlite3.OperationalError:
        pass
        
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS chat_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            org_name TEXT,
            role TEXT,
            content TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS inventory (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            org_name TEXT,
            sku TEXT,
            name TEXT,
            category TEXT,
            price REAL,
            stock INTEGER,
            reorder_point INTEGER DEFAULT 50,
            supplier_lead_days INTEGER DEFAULT 7,
            supplier TEXT,
            status TEXT,
            forecasted_demand INTEGER DEFAULT 0,
            units_sold INTEGER DEFAULT 0,
            last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(org_name, sku)
        )
    ''')
    # Migrate existing DBs gracefully
    for col in [
        "ALTER TABLE inventory ADD COLUMN reorder_point INTEGER DEFAULT 50",
        "ALTER TABLE inventory ADD COLUMN supplier_lead_days INTEGER DEFAULT 7",
        "ALTER TABLE inventory ADD COLUMN forecasted_demand INTEGER DEFAULT 0",
        "ALTER TABLE inventory ADD COLUMN units_sold INTEGER DEFAULT 0",
        "ALTER TABLE inventory ADD COLUMN last_updated TEXT DEFAULT '2025-01-01'",
    ]:
        try:
            cursor.execute(col)
        except Exception:
            pass

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS forecasts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            org_name TEXT,
            sku TEXT,
            forecast_date TEXT,
            predicted_sales REAL,
            lower_bound REAL,
            upper_bound REAL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(org_name, sku, forecast_date)
        )
    ''')
    
    # Create promotions table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS promotions (
            id TEXT PRIMARY KEY,
            org_name TEXT,
            title TEXT,
            type TEXT,
            start_date TEXT,
            end_date TEXT,
            target_product TEXT,
            target_sku TEXT,
            discount_pct TEXT,
            expected_impact TEXT,
            urgency TEXT,
            reason TEXT,
            status TEXT DEFAULT 'scheduled',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Create docs_settings table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS docs_settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    ''')
    
    # Create docs_sections table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS docs_sections (
            section_id TEXT PRIMARY KEY,
            title TEXT,
            content TEXT,
            draft_content TEXT,
            is_published INTEGER DEFAULT 1,
            display_order INTEGER,
            category TEXT,
            last_updated TEXT DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Create docs_team table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS docs_team (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            role TEXT,
            email TEXT,
            avatar_url TEXT,
            display_order INTEGER
        )
    ''')
    
    # Create purchase orders and po items tables
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS purchase_orders (
            id TEXT PRIMARY KEY,
            org_name TEXT,
            supplier TEXT,
            order_date TEXT,
            delivery_date TEXT,
            status TEXT DEFAULT 'Draft',
            total_amount REAL DEFAULT 0.0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS po_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            po_id TEXT,
            sku TEXT,
            name TEXT,
            quantity INTEGER,
            unit_price REAL,
            total_price REAL,
            FOREIGN KEY(po_id) REFERENCES purchase_orders(id) ON DELETE CASCADE
        )
    ''')

    # Seed docs_settings if empty
    cursor.execute("SELECT COUNT(*) FROM docs_settings")
    if cursor.fetchone()[0] == 0:
        settings_seeds = [
            ("is_public", "0"),
            ("start_time", "2026-06-10 00:00:00"),
            ("end_time", "2026-06-14 23:59:59"),
            ("override_enabled", "0")
        ]
        cursor.executemany("INSERT INTO docs_settings (key, value) VALUES (?, ?)", settings_seeds)

    # Seed docs_team if empty
    cursor.execute("SELECT COUNT(*) FROM docs_team")
    if cursor.fetchone()[0] == 0:
        team_seeds = [
            ("Farjan Ahmmed", "Lead Full-Stack Architect", "farjan@stocksense.ai", "assets/team/Farjan Ahmmed.jpg", 1),
            ("Kamrun Nahar Kamona", "ML Engineering & Time-Series Lead", "kamrun@stocksense.ai", "assets/team/Kamrun Nahar Kamona.jpeg", 2),
            ("MD. Robayet Islam", "Frontend UX/UI Designer", "robayet@stocksense.ai", "assets/team/MD.Robayet Islam.jpeg", 3),
            ("Prionti Maliha", "Supply Chain & Business Strategy Director", "prionti@stocksense.ai", "assets/team/Prionti Maliha.jpeg", 4)
        ]
        cursor.executemany("INSERT INTO docs_team (name, role, email, avatar_url, display_order) VALUES (?, ?, ?, ?, ?)", team_seeds)

    # Seed docs_sections if empty
    cursor.execute("SELECT COUNT(*) FROM docs_sections")
    if cursor.fetchone()[0] == 0:
        sections_seeds = [
            ("problem", "The $1.8 Trillion Supply Chain Leak", 
             "Overstocking and catastrophic stockouts cost the global retail supply chain over $1.8 Trillion annually. Modern merchant operations are highly dynamic, yet inventory managers still rely on static, outdated spreadsheets or rigid legacy ERPs. These solutions fail to model seasonal volatility, local events, or promotional demand surges, resulting in dead capital and lost revenue.",
             None, 1, 10, "pitch"),
            ("solution", "Predictive Intelligence at the Edge",
             "StockSense AI is an intelligent supply chain co-pilot that combines state-of-the-art Facebook Prophet time-series ML with stateless AI agents. By capturing complex seasonal waveforms, analyzing driver attributions, and automatically setting dynamic reorder thresholds, StockSense AI helps retailers eliminate stockouts, reduce carrying costs, and optimize working capital.",
             None, 1, 20, "pitch"),
            ("why_now", "Privacy-First Decentralized AI Era",
             "Retailers face severe margin pressures alongside tightening global regulations on customer purchase history privacy (GDPR, CCPA). StockSense AI's local-first architecture stores data securely on local edge nodes. This allows enterprise-grade intelligence to run entirely in client custody, bypassing cloud privacy risks.",
             None, 1, 30, "pitch"),
            ("product_demo", "Enterprise Dashboard Showcase",
             "Experience a fully integrated supply chain cockpit. (1) Live KPI visualizers showing real-time SKU counts and stock health. (2) Interactive 7-day Prophet ML demand visualizers with custom range selectors. (3) SHAP feature attributions showing the exact drivers behind sales peaks. (4) Dynamic Promotional Planner leveraging holiday schedules.",
             None, 1, 40, "pitch"),
            ("market_opportunity", "Massive Addressable Supply Chain Market",
             "The global Supply Chain Management (SCM) software market is projected to reach $32.4 Billion by 2030. Within this market, millions of SMB and mid-market omni-channel retailers are actively seeking accessible, plug-and-play predictive replenishment tools to compete with algorithmic retail giants.",
             None, 1, 50, "pitch"),
            ("business_model", "Highly Scalable B2B SaaS",
             "We offer tier-based B2B SaaS subscription models tailored to retail operations. (1) Core Edge: $79/mo for single locations. (2) Professional: $199/mo with advanced deep learning forecasts and custom holiday mapping. (3) Enterprise: Custom volume licensing with custom database connectors and support.",
             None, 1, 60, "pitch"),
            ("traction", "Proven Edge Sovereignty & Compatibility",
             "StockSense AI is built for maximum distribution. Our edge engine achieves 99.2% device compatibility on all modern desktop and container environments. In active pilot engagements across fashion and hardware verticals, merchant partners report a 30% reduction in out-of-stock events and a 22% improvement in cash flow within 30 days.",
             None, 1, 70, "pitch"),
            ("competition", "Bridging Rigid ERPs and Simple Spreadsheets",
             "Legacy ERP systems (SAP, Oracle) require multi-month, million-dollar deployment cycles and lack agile forecasting. Conversely, basic inventory tools (Excel, Shopify) lack predictive analytics. StockSense AI bridges this gap, offering a zero-install, local-first, highly intelligent forecasting suite accessible to any business.",
             None, 1, 80, "pitch"),
            ("unique_advantage", "The Three Pillars of StockSense AI",
             "Our competitive moat is built on: (1) **Edge Sovereignty**: client-side SQLite storage with SHA-256 local authentication. (2) **Zero-Retention State-of-the-Art ML**: stateless micro-agent inferences that guarantee proprietary sales data safety. (3) **Explainable AI**: SHAP-based model explanations that build trust with supply chain managers.",
             None, 1, 90, "pitch"),
            ("go_to_market", "Algorithmic Growth Channels",
             "Our growth playbook relies on: (1) Seamless app store listings on popular platforms like Shopify, WooCommerce, and Salesforce. (2) Partnerships with digital transformation agencies. (3) An open, developer-friendly Edge API that makes integration with existing warehouse scanners straightforward.",
             None, 1, 100, "pitch"),
            ("team_showcase", "Founding Team & Contributors",
             "StockSense AI is built by seasoned engineers and time-series specialists. We have unified our diverse experience in web scale database systems, high-frequency logistics routing, and deep forecasting models to build a global standard inventory platform.",
             None, 1, 110, "pitch"),
            ("vision", "Decentralizing the World's Supply Chains",
             "Our long-term goal is to build the self-healing supply chain. By networking local-first StockSense edge nodes, we will enable automated, cross-organizational smart procurement, minimizing global product waste, lowering consumer prices, and maximizing supply chain sustainability.",
             None, 1, 120, "pitch"),

            # technical docs
            ("tech_overview", "System Architectural Overview",
             "StockSense AI is built on a local-first, edge-sovereign architecture. By running a high-performance Python FastAPI server connected directly to a local SQLite database, the system executes time-series training and predictions locally on the user machine, using external APIs strictly as a stateless text-synthesis engine.",
             None, 1, 10, "tech"),
            ("tech_feature_matrix", "Application Feature Matrix",
             "Our feature map separates core edge-sovereign features from smart AI-augmented modules. Live features: local SQLite transaction ingestion, Facebook Prophet ML forecasting, SHAP demand driver plots, interactive inventory control, and automated PDF report generation. In development: GraphRAG logistics mapping.",
             None, 1, 20, "tech"),
            ("tech_architecture", "Detailed Architecture Topology",
             "The system operates in three layers: (1) Frontend: Modern Single Page Application built on HTML5, Vanilla CSS3, and Chart.js communicating via asynchronous fetch requests. (2) Local API Core: Python FastAPI ASGI running local Facebook Prophet sub-processes and managing SQLite persistence. (3) Security Boundary: Local SHA-256 encryption.",
             None, 1, 30, "tech"),
            ("tech_data_flow", "Data Processing Lifecycle",
             "Sales transaction details follow a secure, sequential data pipeline: Ingestion (CSV import or REST input) -> Parse & Clean (schema validation) -> Edge Database persistence -> Prophet ML Fitting (local thread compute) -> Explainability analysis (SHAP calculations) -> Stateless AI Insight Generation -> UI rendering.",
             None, 1, 40, "tech"),
            ("tech_stack", "Comprehensive Technology Stack",
             "Our modern stack is optimized for lightweight local execution. Backend: Python 3.10+, FastAPI framework, Uvicorn ASGI, SQLite3, Facebook Prophet, PyJWT, and SHAP. Frontend: HTML5, CSS3 with responsive flex/grid layouts, Outfit Google Font, FontAwesome v6, and Chart.js v4.",
             None, 1, 50, "tech"),
            ("tech_api", "API Routing & Endpoint Documentation",
             "StockSense AI exposes standard REST routers: (1) `auth.py`: `/api/user/login`, `/api/user/signup`, `/api/user/profile`. (2) `inventory.py`: `/api/inventory` GET/POST/PUT/DELETE. (3) `chat.py`: Stateful LLM agent chat `/api/chat`. (4) `analytics.py`: Prophet engine `/api/predict`, `/api/forecast/{sku}`, `/api/report` (PDF export).",
             None, 1, 60, "tech"),
            ("tech_data_layer", "Data Layer & Persistence Model",
             "All user and system tables reside in `data/users.db` SQLite database. This design guarantees local data sovereignty, runs completely offline, allows easy data export/backup, and is immune to centralized cloud breaches or network failures.",
             None, 1, 70, "tech"),
            ("tech_ai_layer", "Machine Learning & Explainable AI Core",
             "The system integrates two AI systems: (1) Local Time-Series: Facebook Prophet, which separates baseline trends, weekly/yearly seasonality, and public holidays. (2) Explainable AI: SHAP values calculated over model parameters to show inventory managers the precise weight of holidays, prices, or seasons.",
             None, 1, 80, "tech"),
            ("tech_roadmap", "Product Engineering Roadmap",
             "Short Term: Automate stock reorder webhook triggers and low-stock email triggers. Mid Term: Multi-location sync, local database replication clusters, and offline-first mobile companion apps. Long Term: GraphRAG supply chain constraint solvers and autonomous vendor negotiation agents.",
             None, 1, 90, "tech"),
            ("tech_scalability", "Decentralized Scalability Strategy",
             "Because StockSense AI executes ML fitting and database transactions locally on client machines, cloud infrastructure demands remain constant at O(1) as the user base grows. This edge-sovereign paradigm allows extreme cost-efficiency and scales infinitely without cloud backend bottlenecks.",
             None, 1, 100, "tech"),
            ("tech_security", "Security Architecture & Cryptography",
             "Security is implemented at the core: (1) Data Custody: Local-first file access. (2) Authentication: Client-side SHA-256 password hashing with static salting. (3) Transit: Strictly stateless outbound AI inquiries, ensuring zero customer transaction details are retained by cloud servers.",
             None, 1, 110, "tech"),
            ("tech_analytics", "Business Intelligence & KPI Dashboard",
             "StockSense AI monitors operational health metrics: (1) Inventory Turn Rate (ITR). (2) Days of Coverage (DoC). (3) Stockout Probability. (4) Mean Absolute Percentage Error (MAPE) of Prophet time-series models to maintain high predictive accuracy.",
             None, 1, 120, "tech"),
            ("tech_team", "Team Structure & Ownership",
             "Our contributors maintain strict ownership of core application modules: Shejan Ahmmed leads frontend and system integration, Jane Doe designs the time-series forecasting backend, and John Smith handles enterprise security audits and logistics partner onboarding.",
             None, 1, 130, "tech"),
            ("tech_changelog", "Application Version Changelog",
             "v1.0.0: Initial launch with local SQLite and Prophet time-series engine. v1.1.0: Refined mobile responsive layouts, added sticky chart navigation. v1.2.0: Introduced this live `/docs` module with YC Pitch Deck, Technical Documentation, Admin scheduler, and PDF/Markdown exports.",
             None, 1, 140, "tech")
        ]
        cursor.executemany("""
            INSERT INTO docs_sections (section_id, title, content, draft_content, is_published, display_order, category)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, sections_seeds)

    conn.commit()
    conn.close()


def get_db_connection():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn
