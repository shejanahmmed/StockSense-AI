import networkx as nx
import logging
import json

logger = logging.getLogger(__name__)

def build_supply_chain_graph(conn, org_name: str) -> nx.DiGraph:
    """
    Constructs a directed graph representing the supply chain dependencies
    of an organization (Suppliers -> Items -> Categories, and POs -> Items).
    """
    G = nx.DiGraph()
    cursor = conn.cursor()
    
    # 1. Fetch Inventory Items
    cursor.execute('''
        SELECT sku, name, category, price, stock, reorder_point, supplier, status, supplier_lead_days, forecasted_demand
        FROM inventory
        WHERE org_name = ?
    ''', (org_name,))
    items = cursor.fetchall()
    
    for item in items:
        sku = item["sku"]
        name = item["name"]
        category = item["category"] or "General"
        supplier = item["supplier"] or "General Logistics"
        if not supplier.strip():
            supplier = "General Logistics"
            
        # Add Category Node
        cat_id = f"C:{category}"
        if not G.has_node(cat_id):
            G.add_node(cat_id, type="category", label=category)
            
        # Add Supplier Node
        sup_id = f"S:{supplier}"
        if not G.has_node(sup_id):
            G.add_node(sup_id, type="supplier", label=supplier)
            
        # Add Item Node
        item_id = f"I:{sku}"
        G.add_node(item_id, 
                   type="item", 
                   label=name, 
                   sku=sku, 
                   stock=item["stock"] or 0,
                   price=item["price"] or 0.0,
                   status=item["status"] or "In Stock",
                   lead_days=item["supplier_lead_days"] or 7,
                   forecast=item["forecasted_demand"] or 0)
                   
        # Add Edges
        G.add_edge(sup_id, item_id, rel="SUPPLIES")
        G.add_edge(item_id, cat_id, rel="BELONGS_TO")

    # 2. Fetch Purchase Orders (Active only)
    cursor.execute('''
        SELECT po.id, po.supplier, po.status, po.total_amount, pi.sku, pi.quantity, pi.total_price
        FROM purchase_orders po
        JOIN po_items pi ON po.id = pi.po_id
        WHERE po.org_name = ? AND po.status != 'Cancelled'
    ''', (org_name,))
    pos = cursor.fetchall()
    
    for po in pos:
        po_id = po["id"]
        sku = po["sku"]
        supplier = po["supplier"] or "General Logistics"
        if not supplier.strip():
            supplier = "General Logistics"
            
        po_node_id = f"P:{po_id}"
        item_id = f"I:{sku}"
        sup_id = f"S:{supplier}"
        
        # Add PO Node
        if not G.has_node(po_node_id):
            G.add_node(po_node_id, type="purchase_order", label=f"PO: {po_id}", status=po["status"], amount=po["total_amount"])
            
        # Ensure Supplier and Item nodes exist (even if not in active catalog)
        if not G.has_node(sup_id):
            G.add_node(sup_id, type="supplier", label=supplier)
        if not G.has_node(item_id):
            G.add_node(item_id, type="item", label=f"SKU: {sku}", sku=sku, stock=0, price=0.0, status="Unknown", lead_days=7, forecast=0)
            
        # Add Edges
        G.add_edge(po_node_id, item_id, rel="CONTAINS", qty=po["quantity"], cost=po["total_price"])
        G.add_edge(po_node_id, sup_id, rel="ROUTED_TO")

    return G

def analyze_dependency_risks(conn, org_name: str) -> dict:
    """
    Analyzes supply chain dependency graphs to identify single-points-of-failure,
    bottlenecks, and capital at risk. Returns a structured JSON payload for frontend dashboards.
    """
    try:
        G = build_supply_chain_graph(conn, org_name)
        
        # If graph is empty, return empty summary
        if len(G) == 0:
            return {
                "nodes": [],
                "links": [],
                "bottlenecks": [],
                "vulnerabilities": []
            }
            
        # 1. Find Supplier Bottlenecks
        # Calculate how many item nodes depend on each supplier node
        suppliers = [n for n, attr in G.nodes(data=True) if attr.get("type") == "supplier"]
        items = [n for n, attr in G.nodes(data=True) if attr.get("type") == "item"]
        
        total_skus = len(items)
        total_retail_value = sum(G.nodes[i].get("stock", 0) * G.nodes[i].get("price", 0.0) for i in items)
        
        bottlenecks = []
        for s in suppliers:
            supplier_name = G.nodes[s].get("label")
            # Items supplied by this supplier
            supplied_items = [v for u, v, data in G.edges(data=True) if u == s and data.get("rel") == "SUPPLIES"]
            
            item_count = len(supplied_items)
            sku_pct = (item_count / total_skus * 100) if total_skus > 0 else 0.0
            
            # Capital/value represented by this supplier
            stock_val = sum(G.nodes[i].get("stock", 0) * G.nodes[i].get("price", 0.0) for i in supplied_items)
            val_pct = (stock_val / total_retail_value * 100) if total_retail_value > 0 else 0.0
            
            # Forecasted demand at risk (sum of forecasted demand for understocked items)
            demand_at_risk = 0.0
            critical_items = []
            for i in supplied_items:
                stock = G.nodes[i].get("stock", 0)
                forecast = G.nodes[i].get("forecast", 0)
                price = G.nodes[i].get("price", 0.0)
                status = G.nodes[i].get("status", "In Stock")
                if status in ["Low Stock", "Out of Stock"] or forecast > stock:
                    shortfall = max(0, forecast - stock)
                    demand_at_risk += shortfall * price
                    critical_items.append(G.nodes[i].get("sku"))
                    
            # Degree of dependency: Degree centrality in our sub-context
            # How central is this supplier node?
            out_deg = G.out_degree(s)
            
            # Bottleneck Index: weighted combine of SKU percentage and value percentage
            bottleneck_score = (sku_pct * 0.4) + (val_pct * 0.6)
            
            # Determine risk tier
            risk_tier = "Low"
            if bottleneck_score > 40 or sku_pct > 50:
                risk_tier = "Critical"
            elif bottleneck_score > 20:
                risk_tier = "Medium"
                
            bottlenecks.append({
                "node_id": s,
                "name": supplier_name,
                "supplied_skus_count": item_count,
                "supplied_skus_pct": round(sku_pct, 1),
                "portfolio_value": round(stock_val, 2),
                "portfolio_value_pct": round(val_pct, 1),
                "demand_at_risk": round(demand_at_risk, 2),
                "critical_skus": critical_items,
                "bottleneck_score": round(bottleneck_score, 1),
                "risk_tier": risk_tier
            })
            
        # Sort bottlenecks by score descending
        bottlenecks.sort(key=lambda x: x["bottleneck_score"], reverse=True)
        
        # 2. Find Vulnerable Items
        # An item is vulnerable if its supplier has long lead times, it's low on stock,
        # or it represents a high percentage of forecasted demand.
        vulnerabilities = []
        for i in items:
            item_attr = G.nodes[i]
            sku = item_attr.get("sku")
            name = item_attr.get("label")
            stock = item_attr.get("stock", 0)
            forecast = item_attr.get("forecast", 0)
            status = item_attr.get("status", "In Stock")
            lead_time = item_attr.get("lead_days", 7)
            price = item_attr.get("price", 0.0)
            
            # Find item's suppliers
            incoming_suppliers = [u for u, v, data in G.in_edges(i, data=True) if data.get("rel") == "SUPPLIES"]
            supplier_name = G.nodes[incoming_suppliers[0]].get("label") if incoming_suppliers else "Unknown"
            
            # Vulnerability math: High lead time + low stock / out of stock + high forecast
            if status in ["Low Stock", "Out of Stock"] or lead_time > 10:
                vuln_factor = 0.0
                if status == "Out of Stock":
                    vuln_factor += 50
                elif status == "Low Stock":
                    vuln_factor += 25
                    
                # Lead time vulnerability
                vuln_factor += min(30, lead_time * 2)
                
                # Demand multiplier
                shortfall_ratio = (forecast / max(1, stock)) if stock > 0 else 5.0
                vuln_factor += min(20, shortfall_ratio * 3)
                
                vulnerabilities.append({
                    "sku": sku,
                    "name": name,
                    "stock": stock,
                    "lead_time": lead_time,
                    "supplier": supplier_name,
                    "status": status,
                    "potential_revenue_loss": round(max(0, forecast - stock) * price, 2),
                    "vulnerability_score": round(vuln_factor, 1)
                })
                
        # Sort vulnerabilities by score descending
        vulnerabilities.sort(key=lambda x: x["vulnerability_score"], reverse=True)
        
        # 3. Format Graph Nodes & Links for D3.js or List Visualizations
        serialized_nodes = []
        for n, attr in G.nodes(data=True):
            node_data = {
                "id": n,
                "type": attr.get("type"),
                "label": attr.get("label")
            }
            # Add specific data depending on node type
            if attr.get("type") == "item":
                node_data["stock"] = attr.get("stock")
                node_data["price"] = attr.get("price")
                node_data["status"] = attr.get("status")
            elif attr.get("type") == "purchase_order":
                node_data["status"] = attr.get("status")
                node_data["amount"] = attr.get("amount")
            serialized_nodes.append(node_data)
            
        serialized_links = []
        for u, v, data in G.edges(data=True):
            link_data = {
                "source": u,
                "target": v,
                "type": data.get("rel")
            }
            if "qty" in data:
                link_data["qty"] = data["qty"]
                link_data["cost"] = data["cost"]
            serialized_links.append(link_data)
            
        return {
            "nodes": serialized_nodes,
            "links": serialized_links,
            "bottlenecks": bottlenecks[:5], # Top 5 bottlenecks
            "vulnerabilities": vulnerabilities[:5] # Top 5 vulnerable items
        }
    except Exception as e:
        logger.error(f"Failed to analyze dependency risks: {e}")
        return {
            "nodes": [],
            "links": [],
            "bottlenecks": [],
            "vulnerabilities": [],
            "error": str(e)
        }
