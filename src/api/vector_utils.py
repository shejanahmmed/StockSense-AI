import os
import re
import json
import logging
import hashlib
import numpy as np

# Optional dependencies, handle gracefully
try:
    import ollama
except ImportError:
    ollama = None

try:
    from groq import Groq
except ImportError:
    Groq = None

logger = logging.getLogger(__name__)

def get_fallback_embedding(text: str) -> list[float]:
    """
    Generates a deterministic 384-dimension normalized float vector using hashlib MD5.
    Guarantees a valid embedding even if external API connections are offline/unconfigured.
    """
    dim = 384
    vec = np.zeros(dim, dtype=np.float32)
    
    # Simple word and character bigram extraction
    words = text.lower().split()
    for w in words:
        # Hash full word
        h_word = int(hashlib.md5(w.encode('utf-8')).hexdigest(), 16)
        vec[h_word % dim] += 1.0
        
        # Hash character bigrams
        for i in range(len(w) - 1):
            bg = w[i:i+2]
            h_bg = int(hashlib.md5(bg.encode('utf-8')).hexdigest(), 16)
            vec[h_bg % dim] += 0.5
            
    # L2 normalize
    norm = np.linalg.norm(vec)
    if norm > 0:
        vec = vec / norm
        
    return vec.tolist()

def get_groq_embedding(text: str) -> list[float]:
    """Generates embedding using Groq's embedding model."""
    if Groq is None:
        raise ImportError("Groq library is not installed.")
        
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        raise ValueError("GROQ_API_KEY is not set.")
        
    client = Groq(api_key=api_key)
    response = client.embeddings.create(
        input=text,
        model="nomic-embed-text-v1.5"
    )
    return response.data[0].embedding

def get_ollama_embedding(text: str) -> list[float]:
    """Generates embedding using local Ollama model."""
    if ollama is None:
        raise ImportError("Ollama library is not installed.")
        
    response = ollama.embeddings(
        model="nomic-embed-text",
        prompt=text
    )
    return response['embedding']

def get_embedding(text: str) -> list[float]:
    """
    Tries to generate embeddings via the configured DEPLOYMENT_ENV (Groq / Ollama).
    Falls back to a local deterministic TF-IDF bag-of-words hash if APIs are offline or fail.
    """
    if not text or not text.strip():
        return [0.0] * 384
        
    env = os.environ.get("DEPLOYMENT_ENV", "local").lower()
    
    # 1. Try Groq in production
    if env == "production":
        try:
            return get_groq_embedding(text)
        except Exception as e:
            logger.warning(f"Failed to generate Groq embedding: {e}. Falling back to deterministic local embedding.")
            
    # 2. Try Ollama in local
    else:
        try:
            return get_ollama_embedding(text)
        except Exception as e:
            logger.warning(f"Failed to generate Ollama embedding: {e}. Falling back to deterministic local embedding.")
            
    # 3. Deterministic fallback
    return get_fallback_embedding(text)

def cosine_similarity(v1: list[float], v2: list[float]) -> float:
    """Computes cosine similarity between two float vectors."""
    a = np.array(v1)
    b = np.array(v2)
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(np.dot(a, b) / (norm_a * norm_b))

def rewrite_query(query_text: str) -> str:
    """
    Expands and normalizes the search query using key inventory and retail synonyms.
    E.g., mapping 'promo' -> 'promotion discount special offer', 'po' -> 'purchase order supplier buy'
    """
    if not query_text:
        return ""
        
    q = query_text.lower().strip()
    
    # Synonym expansions
    synonyms = {
        "promo": "promotion discount sale campaign special offer",
        "promos": "promotions discounts sales campaigns special offers",
        "po": "purchase order supplier procurement restock buy invoice",
        "pos": "purchase orders suppliers procurement restock buy invoices",
        "restock": "replenish reorder purchase order stock inventory",
        "low stock": "understock replenishment warning reorder critical deficit",
        "excess": "overstock surplus clearance slow-moving dead capital",
        "markdown": "discount price cut campaign promotion"
    }
    
    # Standard replacement of some punctuation with spaces
    q_clean = re.sub(r'[^\w\s\-]', ' ', q)
    words = q_clean.split()
    expanded_words = []
    
    for w in words:
        expanded_words.append(w)
        # Check synonym
        if w in synonyms:
            expanded_words.append(synonyms[w])
            
    # Also check multi-word combinations in synonym map
    for phrase, expansion in synonyms.items():
        if len(phrase.split()) > 1 and phrase in q:
            expanded_words.append(expansion)
            
    # Remove duplicates but preserve order to some extent
    seen = set()
    unique_words = []
    for w in " ".join(expanded_words).split():
        if w not in seen:
            seen.add(w)
            unique_words.append(w)
            
    return " ".join(unique_words)

def index_entity(conn, org_name: str, target_type: str, target_id: str, content_text: str):
    """
    Creates/updates a vector embedding for a target entity and persists it.
    Uses Contextual RAG to automatically query related database tables and enrich
    the text representation before generating the embedding vector.
    """
    try:
        cursor = conn.cursor()
        
        # 1. Contextual RAG enrichment
        if target_type == "purchase_order":
            try:
                # Query all items under this PO and their stock status from inventory
                cursor.execute('''
                    SELECT pi.sku, pi.name, pi.quantity, inv.stock, inv.reorder_point, inv.status
                    FROM po_items pi
                    LEFT JOIN inventory inv ON pi.sku = inv.sku AND inv.org_name = ?
                    WHERE pi.po_id = ?
                ''', (org_name, target_id))
                items = cursor.fetchall()
                if items:
                    items_str = ", ".join([f"{item[1]} x{item[2]}" for item in items])
                    context_parts = []
                    for item in items:
                        sku, name, quantity, stock, reorder, status = item
                        if stock is not None:
                            context_parts.append(f"{name} (SKU: {sku}) stock: {stock}/{reorder} ({status})")
                    inventory_context = "; ".join(context_parts)
                    if inventory_context:
                        inventory_context = f" Current inventory stock profiles: {inventory_context}."
                    
                    # Fetch PO header total amount and supplier
                    cursor.execute('''
                        SELECT supplier, order_date, total_amount 
                        FROM purchase_orders 
                        WHERE org_name = ? AND id = ?
                    ''', (org_name, target_id))
                    header = cursor.fetchone()
                    if header:
                        supplier, order_date, total_amount = header
                        content_text = f"Purchase Order ID: {target_id}, Supplier: {supplier or 'Unknown Supplier'}, Order Date: {order_date or 'N/A'}, Total Amount: BDT {total_amount or 0.0:.2f}. Items: {items_str}.{inventory_context}"
            except Exception as context_err:
                logger.warning(f"Failed to build contextual PO text: {context_err}")
                
        elif target_type == "promotion":
            try:
                # Query the promotion details and target SKU current inventory
                cursor.execute('''
                    SELECT title, type, target_sku, target_product, discount_pct, expected_impact, reason
                    FROM promotions
                    WHERE org_name = ? AND id = ?
                ''', (org_name, target_id))
                promo = cursor.fetchone()
                if promo:
                    title, p_type, target_sku, target_product, discount_pct, expected_impact, reason = promo
                    
                    cursor.execute('''
                        SELECT stock, reorder_point, forecasted_demand, status
                        FROM inventory
                        WHERE org_name = ? AND sku = ?
                    ''', (org_name, target_sku))
                    inv = cursor.fetchone()
                    
                    inventory_context = ""
                    if inv:
                        stock, reorder, forecasted, status = inv
                        inventory_context = f" Target product current inventory: stock={stock or 0}, reorder point={reorder or 50}, forecasted demand={forecasted or 0.0}, status={status or 'Unknown'}."
                        
                    content_text = f"Promotion: {title}, Type: {p_type or 'Discount'}, Target SKU: {target_sku} ({target_product or 'N/A'}), Discount: {discount_pct or '0%'}, Expected Impact: {expected_impact or 'N/A'}, Reason: {reason or 'N/A'}.{inventory_context}"
            except Exception as context_err:
                logger.warning(f"Failed to build contextual promo text: {context_err}")
        
        # 2. Embedding calculation and database save
        embedding = get_embedding(content_text)
        embedding_json = json.dumps(embedding)
        cursor.execute('''
            INSERT OR REPLACE INTO vector_embeddings (org_name, target_type, target_id, content_text, embedding_json)
            VALUES (?, ?, ?, ?, ?)
        ''', (org_name, target_type, target_id, content_text, embedding_json))
        logger.info(f"Successfully indexed {target_type} ID '{target_id}' for org '{org_name}'")
    except Exception as e:
        logger.error(f"Failed to index {target_type} ID '{target_id}': {e}")

def search_similar(conn, org_name: str, target_type: str, query_text: str, limit: int = 5) -> list[dict]:
    """
    Calculates query embedding and returns matches sorted by hybrid similarity score.
    Combines expanded-query semantic vector search with keyword overlap matches.
    """
    try:
        # 1. Query Rewriting / expansion for semantic matching
        expanded_query = rewrite_query(query_text)
        query_embedding = get_embedding(expanded_query)
        
        cursor = conn.cursor()
        cursor.execute('''
            SELECT target_id, content_text, embedding_json 
            FROM vector_embeddings 
            WHERE org_name = ? AND target_type = ?
        ''', (org_name, target_type))
        rows = cursor.fetchall()
        
        # Word-level clean sets for keyword match
        query_words_orig = set(re.findall(r'\w+', query_text.lower()))
        query_words_expanded = set(re.findall(r'\w+', expanded_query.lower()))
        all_query_words = query_words_orig.union(query_words_expanded)
        
        matches = []
        for row in rows:
            target_id = row[0]
            content_text = row[1]
            embedding = json.loads(row[2])
            
            # Semantic (vector) similarity
            sim = cosine_similarity(query_embedding, embedding)
            
            # Keyword overlap matching score
            content_words = set(re.findall(r'\w+', content_text.lower()))
            if all_query_words:
                overlap = len(all_query_words.intersection(content_words))
                keyword_score = overlap / len(all_query_words)
            else:
                keyword_score = 0.0
                
            # Hybrid search scoring: 70% vector relevance + 30% keyword overlap
            hybrid_score = 0.7 * sim + 0.3 * keyword_score
            
            matches.append({
                "target_id": target_id,
                "content_text": content_text,
                "similarity": hybrid_score, # Keep field name as similarity for compatibility
                "vector_sim": sim,
                "keyword_sim": keyword_score
            })
            
        # Sort by similarity descending
        matches.sort(key=lambda x: x["similarity"], reverse=True)
        return matches[:limit]
    except Exception as e:
        logger.error(f"Search similar failed for type '{target_type}': {e}")
        return []

def sync_existing_data():
    """
    Performs a background check to index any historical purchase orders
    or promotions that do not currently have vector embeddings.
    """
    from src.api.database import get_db_connection
    
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        # 1. Sync Purchase Orders
        cursor.execute('''
            SELECT po.id, po.org_name, po.supplier, po.order_date, po.total_amount,
                   GROUP_CONCAT(pi.name || ' x' || pi.quantity, ', ') as items
            FROM purchase_orders po
            LEFT JOIN po_items pi ON po.id = pi.po_id
            WHERE po.id NOT IN (
                SELECT target_id FROM vector_embeddings WHERE target_type = 'purchase_order'
            )
            GROUP BY po.id
        ''')
        pos_to_index = cursor.fetchall()
        
        for po in pos_to_index:
            po_id = po["id"]
            org_name = po["org_name"]
            supplier = po["supplier"] or "Unknown Supplier"
            order_date = po["order_date"] or "N/A"
            total_amount = po["total_amount"] or 0.0
            items_str = po["items"] or "No items"
            
            content_text = f"Purchase Order ID: {po_id}, Supplier: {supplier}, Order Date: {order_date}, Total Amount: BDT {total_amount:.2f}. Items: {items_str}."
            index_entity(conn, org_name, "purchase_order", po_id, content_text)
            
        # 2. Sync Promotions
        cursor.execute('''
            SELECT id, org_name, title, type, target_product, target_sku, discount_pct, expected_impact, reason
            FROM promotions
            WHERE id NOT IN (
                SELECT target_id FROM vector_embeddings WHERE target_type = 'promotion'
            )
        ''')
        promos_to_index = cursor.fetchall()
        
        for promo in promos_to_index:
            promo_id = promo["id"]
            org_name = promo["org_name"]
            title = promo["title"]
            p_type = promo["type"] or "Discount"
            target_product = promo["target_product"] or "N/A"
            target_sku = promo["target_sku"] or "N/A"
            discount_pct = promo["discount_pct"] or "0%"
            expected_impact = promo["expected_impact"] or "N/A"
            reason = promo["reason"] or "N/A"
            
            content_text = f"Promotion: {title}, Type: {p_type}, Target SKU: {target_sku} ({target_product}), Discount: {discount_pct}, Expected Impact: {expected_impact}, Reason: {reason}."
            index_entity(conn, org_name, "promotion", promo_id, content_text)
            
        conn.commit()
    except Exception as e:
        logger.error(f"Error during startup vector sync: {e}")
    finally:
        conn.close()
