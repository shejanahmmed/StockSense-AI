import urllib.request
import urllib.parse
import json
import logging
import random

logger = logging.getLogger(__name__)

def fetch_competitor_price(product_name: str, our_price: float) -> float:
    """
    Crawls dummyjson.com API to search for similar products and fetch competitor pricing.
    Includes a fallback pricing generator if the API is offline or the product is not found.
    """
    if not product_name or not product_name.strip():
        # Fallback to a small variation of our price
        return round(our_price * random.uniform(0.9, 1.1), 2)
        
    try:
        # URL-encode the search query
        query = urllib.parse.quote(product_name.strip())
        url = f"https://dummyjson.com/products/search?q={query}"
        
        logger.info(f"Scraping competitor price for '{product_name}' via URL: {url}")
        
        # Perform request with standard browser headers to prevent basic blocks
        req = urllib.request.Request(
            url, 
            headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
        )
        
        # 3 seconds timeout to prevent long hangs
        with urllib.request.urlopen(req, timeout=3) as response:
            data = json.loads(response.read().decode('utf-8'))
            
            products = data.get("products", [])
            if products:
                # Grab the first match price
                competitor_price = float(products[0].get("price", 0.0))
                if competitor_price > 0:
                    logger.info(f"Successfully scraped competitor price for '{product_name}': {competitor_price}")
                    return competitor_price
                    
    except Exception as e:
        logger.warning(f"Competitor price crawler failed for '{product_name}': {e}. Falling back to baseline simulation.")
        
    # Standard fallback pricing simulation (between -10% and +10% of our price)
    random.seed(len(product_name)) # Deterministic fallback based on name length
    delta = random.uniform(-0.10, 0.10)
    simulated_price = round(our_price * (1.0 + delta), 2)
    logger.info(f"Simulated fallback competitor price for '{product_name}': {simulated_price}")
    return simulated_price
