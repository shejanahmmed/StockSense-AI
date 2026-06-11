"""
StockSense AI — API Integration Tests
All endpoints that require JWT are tested with a pre-generated test token.
"""
import pytest
from fastapi.testclient import TestClient
import sys
from pathlib import Path

# Ensure project root is on path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.api.main import app
from src.api.auth_utils import create_access_token

client = TestClient(app)

# ── Shared test token ──────────────────────────────────────────────────────────
TEST_ORG  = "test_org_pytest"
TEST_TOKEN = create_access_token({"sub": TEST_ORG, "role": "admin"})
AUTH_HEADERS = {"Authorization": f"Bearer {TEST_TOKEN}"}


# ── Health / Static ────────────────────────────────────────────────────────────
def test_api_health_check():
    """App starts and serves the frontend HTML."""
    response = client.get("/")
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]


# ── Inventory ──────────────────────────────────────────────────────────────────
def test_inventory_requires_auth():
    """GET /api/inventory must return 401 when no token is provided."""
    response = client.get("/api/inventory")
    assert response.status_code == 401


def test_inventory_read_with_auth():
    """GET /api/inventory returns success with a valid JWT."""
    response = client.get("/api/inventory", headers=AUTH_HEADERS)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert "data" in data
    assert "meta" in data


def test_inventory_add_and_delete():
    """POST then DELETE an inventory item round-trip."""
    item = {
        "sku": "TEST-SKU-001",
        "name": "Pytest Test Product",
        "category": "Test",
        "price": 9.99,
        "stock": 100,
        "supplier": "Pytest Supplier",
        "status": "In Stock"
    }
    # Add
    res = client.post("/api/inventory", json=item, headers=AUTH_HEADERS)
    assert res.status_code == 200
    assert res.json()["status"] == "success"

    # Delete
    res = client.delete(f"/api/inventory/{item['sku']}", headers=AUTH_HEADERS)
    assert res.status_code == 200
    assert res.json()["status"] == "success"


def test_inventory_add_requires_auth():
    """POST /api/inventory without token must be rejected."""
    res = client.post("/api/inventory", json={"sku": "X"})
    assert res.status_code == 401


# ── Insight / Analytics ────────────────────────────────────────────────────────
def test_insight_endpoint():
    """GET /api/insight returns correct structure with valid token."""
    response = client.get("/api/insight", headers=AUTH_HEADERS)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert "insight" in data
    assert "drivers" in data


def test_insight_requires_auth():
    """GET /api/insight without token must return 401."""
    response = client.get("/api/insight")
    assert response.status_code == 401


# ── Predict ────────────────────────────────────────────────────────────────────
def test_invalid_upload_format():
    """POST /api/predict without a file must return 422."""
    response = client.post("/api/predict", headers=AUTH_HEADERS)
    assert response.status_code == 422


def test_invalid_file_type():
    """POST /api/predict with a non-CSV file must return 400."""
    response = client.post(
        "/api/predict",
        files={"file": ("test.txt", b"not,a,csv", "text/plain")},
        headers=AUTH_HEADERS
    )
    assert response.status_code == 400


# ── Dependency Graph & Semantic Search ─────────────────────────────────────────
def test_get_dependency_graph():
    """GET /api/analytics/dependency-graph returns graph data and risk lists."""
    response = client.get("/api/analytics/dependency-graph", headers=AUTH_HEADERS)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert "data" in data
    assert "nodes" in data["data"]
    assert "links" in data["data"]
    assert "bottlenecks" in data["data"]
    assert "vulnerabilities" in data["data"]


def test_financials_semantic_search():
    """GET /api/financials/search returns structured matches."""
    response = client.get("/api/financials/search?query=test", headers=AUTH_HEADERS)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert "purchase_orders" in data
    assert "promotions" in data
    assert "query" in data

